/**
 * Real-time WebSocket server for Retell AI Custom LLM integration.
 * Attaches to the existing Express HTTP server — no separate port needed.
 * (Retell AI 커스텀 LLM 연동을 위한 실시간 WebSocket 서버.
 *  기존 Express HTTP 서버에 부착 — 별도 포트 불필요)
 *
 * ── Retell Custom LLM WebSocket Protocol ──────────────────────────────────────
 *
 * Retell does NOT send an initial call_details setup message.
 * It immediately begins sending update_only / response_required frames.
 * The agent_id is therefore passed by the caller as a URL query parameter:
 *   wss://host/llm-websocket/<call_id>?agent_id=<agent_id>
 * (Retell은 초기 call_details 설정 메시지를 전송하지 않음.
 *  즉시 update_only / response_required 프레임을 전송하기 시작함.
 *  따라서 agent_id는 호출자가 URL 쿼리 파라미터로 전달)
 *
 * Retell → Server (receives):
 *   update_only      : transcript state push — signals barge-in (끼어들기 신호 — 응답 불필요)
 *   response_required: agent must reply with a spoken utterance (에이전트가 발화로 응답해야 함)
 *
 * Server → Retell (sends) — streaming protocol:
 *   Partial chunk  : { response_type, response_id, content, content_complete: false, end_call: false }
 *   Final chunk    : { response_type, response_id, content, content_complete: true,  end_call: false }
 *
 * ── Streaming + Barge-in Architecture ────────────────────────────────────────
 *
 * Two mechanisms work together to enable interruption without ChatSession corruption:
 *
 *   1. activeResponseId  — updated immediately on every incoming frame.
 *      The streaming loop checks this before each sendChunk(); if the ID no longer
 *      matches, the loop exits silently and the stale chunks never reach Retell.
 *
 *   2. generationQueue   — a Promise chain that serialises all session.chat calls.
 *      This prevents two concurrent sendMessageStream() calls on the same ChatSession,
 *      which would corrupt its internal history and cause silent failures on future turns.
 *      Because activeResponseId is updated immediately (before the queue is chained),
 *      interrupted generations are skipped at the head of the queue with zero latency.
 *
 * (두 메커니즘이 협력하여 ChatSession 손상 없이 끼어들기를 구현:
 *   1. activeResponseId — 모든 수신 프레임에서 즉시 업데이트.
 *      스트리밍 루프가 각 sendChunk() 전에 확인 — ID 불일치 시 즉시 종료.
 *   2. generationQueue — 모든 chat 호출을 직렬화하는 Promise 체인.
 *      동일 ChatSession에서 두 sendMessageStream() 호출의 동시 실행을 방지.)
 */

import { WebSocketServer } from 'ws';
import { supabase }        from '../config/supabase.js';
import {
  createChatSession,
  extractOrderIntent,
}                          from '../services/llm/gemini.js';
import { enqueueOrder }    from '../queue/producer.js';

// WebSocket path — must match the path configured in Retell's agent dashboard
// (WebSocket 경로 — Retell 에이전트 대시보드에 설정된 경로와 일치해야 함)
const WS_PATH = '/llm-websocket';

// ── Public Setup Function ─────────────────────────────────────────────────────

/**
 * Attach a WebSocket server to an existing Node.js http.Server instance.
 * Express and WebSocket share the same port — the ws library discriminates by upgrade request.
 * (기존 Node.js http.Server 인스턴스에 WebSocket 서버 부착.
 *  Express와 WebSocket이 동일 포트 공유 — ws 라이브러리가 업그레이드 요청으로 구별)
 *
 * @param {import('http').Server} httpServer
 * @returns {WebSocketServer}
 */
export function setupWebSocket(httpServer) {
  // noServer mode — manual upgrade routing to support Retell's call_id URL suffix
  // (noServer 모드 — Retell의 call_id URL 접미사를 지원하기 위한 수동 업그레이드 라우팅)
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith(WS_PATH)) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy(); // Reject unrecognised upgrade paths (인식되지 않는 경로 거절)
    }
  });

  // ── Connection Handler ─────────────────────────────────────────────────────
  wss.on('connection', async (ws, req) => {
    // ── Extract agent_id and call_id from URL ──────────────────────────────
    // Retell format: /llm-websocket/<call_id>?agent_id=<agent_id>
    // (Retell 형식: /llm-websocket/<call_id>?agent_id=<agent_id>)
    const { pathname, searchParams } = new URL(req.url, 'http://localhost');
    const agentId = searchParams.get('agent_id');
    const callId  = searchParams.get('call_id')
      ?? (pathname.slice(WS_PATH.length).replace(/^\//, '') || null);

    console.log(
      `[WS] New connection | agent: ${agentId ?? 'unknown'} | call: ${callId ?? 'unknown'} | ` +
      `from: ${req.socket.remoteAddress} ` +
      `(새 연결 | 에이전트: ${agentId ?? 'unknown'} | 통화: ${callId ?? 'unknown'})`
    );

    if (!agentId) {
      console.error('[WS] Missing agent_id in WebSocket URL — closing (URL에 agent_id 없음 — 연결 종료)');
      ws.close(1008, 'Missing agent_id');
      return;
    }

    // ── Fetch store configuration on connect ───────────────────────────────
    const storeData = await fetchStoreData(agentId);
    if (!storeData) {
      console.error(`[DB Error] No store found for agent_id: ${agentId} (스토어 없음 — 연결 종료)`);
      ws.close(1008, `No store found for agent_id: ${agentId}`);
      return;
    }

    // ── Initialise Gemini session ──────────────────────────────────────────
    const masterPrompt = buildMasterPrompt(storeData);
    const chat         = createChatSession(masterPrompt);

    // ── Per-connection session state ───────────────────────────────────────
    // activeResponseId: the response_id whose stream is currently allowed to send chunks.
    //   Set to the new responseId on response_required; set to null on update_only (barge-in).
    //   The streaming loop exits silently when this no longer matches.
    // generationQueue: Promise chain that serialises all chat.sendMessageStream() calls.
    //   Prevents concurrent calls on the same ChatSession — which corrupt its history.
    //   activeResponseId is updated immediately (before the queue appends), so superseded
    //   generations are skipped at queue head with no added latency.
    // (activeResponseId: 현재 청크 전송이 허용된 response_id.
    //   response_required 시 새 responseId로 설정; update_only(끼어들기) 시 null로 설정.
    //   스트리밍 루프는 불일치 시 조용히 종료.
    //   generationQueue: 모든 sendMessageStream() 호출을 직렬화하는 Promise 체인.
    //   동일 ChatSession 동시 호출 방지 — 히스토리 손상 유발.
    //   activeResponseId는 즉시 업데이트되므로 추월된 생성은 큐 헤드에서 즉시 건너뜀)
    const session = {
      agentId,
      callId,
      storeData,
      chat,
      activeResponseId: null,
      generationQueue:  Promise.resolve(),
    };

    console.log(
      `[WS] Session ready | agent: ${agentId} | store: ${storeData.store_name ?? '(unnamed)'} | ` +
      `master prompt: ${masterPrompt.length} chars ` +
      `(세션 준비 완료 | 에이전트: ${agentId} | 마스터 프롬프트: ${masterPrompt.length}자)`
    );

    // ── Proactive Greeting (response_id: 0) ───────────────────────────────
    // Retell expects the LLM to speak first. Prompt Gemini with a hidden system
    // turn so the greeting is persona-aware and consistent with the master prompt.
    // (Retell은 LLM이 먼저 말하기를 기대. 숨겨진 시스템 턴으로 Gemini에 인사말 요청)
    session.activeResponseId = 0;
    session.generationQueue = session.generationQueue.then(async () => {
      try {
        const greetStream = await chat.sendMessageStream(
          'Greet the caller warmly, introduce yourself by name, and ask how you can help them today. Keep it to one or two sentences.'
        );
        for await (const chunk of greetStream.stream) {
          if (session.activeResponseId !== 0) return; // Superseded before greeting finished (인사 전 추월)
          const text = textFromChunk(chunk);
          if (text) sendChunk(ws, 0, text, false);
        }
        if (session.activeResponseId === 0) sendChunk(ws, 0, '', true); // Close greeting stream (인사 스트림 완료)
      } catch (err) {
        console.error(`[WS] [${agentId}] Greeting error (인사말 오류):`, err);
        sendChunk(ws, 0, "Hello! I'm your voice assistant. How can I help you today?", true);
      }
    });

    // ── Message Handler ────────────────────────────────────────────────────
    ws.on('message', (rawData) => {
      let msg;
      try {
        msg = JSON.parse(rawData.toString());
      } catch {
        console.error('[WS] Non-JSON frame — closing (JSON이 아닌 프레임 — 연결 종료)');
        ws.close(1003, 'Expected JSON');
        return;
      }

      // update_only — barge-in: user started speaking, silence the active stream immediately
      // (update_only — 끼어들기: 사용자 발화 시작, 활성 스트림 즉시 침묵)
      if (msg.interaction_type === 'update_only') {
        session.activeResponseId = null;
        return;
      }

      // response_required — Retell needs a spoken reply
      // (response_required — Retell이 발화 응답을 요청)
      if (msg.interaction_type === 'response_required') {
        const responseId = msg.response_id;

        // Immediately update activeResponseId — this silences any in-progress stream
        // at the next chunk boundary, with no queue wait required
        // (즉시 activeResponseId 업데이트 — 다음 청크 경계에서 진행 중인 스트림 침묵.
        //  큐 대기 없음)
        session.activeResponseId = responseId;

        // Serialise the actual Gemini call behind the queue so ChatSession history
        // is never written by two concurrent sendMessageStream() calls
        // (실제 Gemini 호출을 큐 뒤에 직렬화 — 동시 sendMessageStream() 호출로
        //  ChatSession 히스토리가 손상되지 않도록)
        session.generationQueue = session.generationQueue.then(async () => {
          // Skip if this generation was already superseded while waiting in queue
          // (큐 대기 중 이미 추월된 경우 건너뜀)
          if (session.activeResponseId !== responseId) return;
          await handleTranscript(ws, session, msg.transcript ?? [], responseId);
        }).catch((err) => {
          console.error(`[WS] [${agentId}] Unhandled generation error (처리되지 않은 생성 오류):`, err);
        });

        return;
      }

      // All other types (ping, call_ended, etc.) — silently ignored
      // (그 외 타입 — 무시)
    });

    // ── Close Handler ──────────────────────────────────────────────────────
    ws.on('close', (code) => {
      // Silence any pending stream by clearing activeResponseId
      // (activeResponseId 초기화로 보류 중인 스트림 침묵)
      session.activeResponseId = null;
      console.log(
        `[WS] Connection closed | agent: ${agentId} | call: ${callId ?? 'unknown'} | code: ${code} ` +
        `(연결 종료 | 에이전트: ${agentId} | 통화: ${callId ?? 'unknown'})`
      );
    });

    // ── Error Handler ──────────────────────────────────────────────────────
    ws.on('error', (err) => {
      console.error(`[WS] Socket error | agent: ${agentId} | ${err.message} (소켓 오류)`);
    });
  });

  console.log(`[WS] WebSocket server ready on path: ${WS_PATH} (WebSocket 서버 준비 완료)`);
  return wss;
}

// ── Transcript Handler (Streaming) ────────────────────────────────────────────

/**
 * Stream a response_required turn through Gemini and forward chunks to Retell in real time.
 * Handles the function-calling two-turn flow with full streaming on both turns.
 * Called exclusively through session.generationQueue so ChatSession calls are serialised.
 * (Gemini를 통해 response_required 턴을 스트리밍하고 청크를 Retell에 실시간 전달.
 *  두 턴의 함수 호출 흐름을 완전한 스트리밍으로 처리.
 *  ChatSession 호출 직렬화를 위해 session.generationQueue를 통해서만 호출)
 *
 * @param {import('ws').WebSocket} ws
 * @param {object} session    — live session state (라이브 세션 상태)
 * @param {Array}  transcript — full transcript array from Retell (Retell의 전체 transcript 배열)
 * @param {number} responseId — must be echoed in every outbound frame (모든 출력 프레임에 반환 필수)
 */
async function handleTranscript(ws, session, transcript, responseId) {
  const lastUserTurn = transcript.filter((t) => t.role === 'user').at(-1);
  const userText     = lastUserTurn?.content?.trim() ?? '';

  if (!userText) {
    // Empty transcript — nudge the caller (빈 transcript — 사용자에게 안내)
    sendChunk(ws, responseId, "I'm listening. How can I help you today?", true);
    return;
  }

  console.log(
    `[WS] [${session.agentId}] User: "${userText.slice(0, 80)}${userText.length > 80 ? '…' : ''}" ` +
    `(사용자 발화)`
  );

  try {
    // ── Turn 1: stream user utterance to Gemini ────────────────────────────
    const turn1 = await session.chat.sendMessageStream(userText);
    let turn1HasText = false;

    for await (const chunk of turn1.stream) {
      // Stale-generation check — exit if this response was superseded by barge-in or a new turn
      // (추월 확인 — 끼어들기나 새 턴으로 추월된 경우 종료)
      if (session.activeResponseId !== responseId) return;

      const text = textFromChunk(chunk);
      if (text) {
        turn1HasText = true;
        sendChunk(ws, responseId, text, false); // Partial — more chunks coming (부분 청크 — 추가 청크 예정)
      }
    }

    // Await the aggregated response to inspect for a function call
    // (집계된 응답을 기다려 함수 호출 확인)
    const turn1Response = await turn1.response;
    if (session.activeResponseId !== responseId) return;

    const turn1Parts = turn1Response.candidates?.[0]?.content?.parts ?? [];
    const fnPart     = turn1Parts.find((p) => p.functionCall != null);

    if (!fnPart) {
      // Pure text turn — send the final completion frame
      // If no chunks had text (edge case), fall back to the aggregated response text
      // (순수 텍스트 턴 — 최종 완료 프레임 전송.
      //  청크에 텍스트가 없는 경우 집계된 응답 텍스트로 폴백)
      const fallback = turn1HasText ? '' : (turn1Parts.find((p) => p.text)?.text ?? '');
      sendChunk(ws, responseId, fallback, true);
      return;
    }

    // ── Function call detected ─────────────────────────────────────────────
    const { name: fnName, args: fnArgs } = fnPart.functionCall;

    console.log(
      `[WS] [${session.agentId}] Function call: "${fnName}" | args: ${JSON.stringify(fnArgs)} ` +
      `(함수 호출: "${fnName}")`
    );

    const fnResponse = await executeFunctionCall(fnName, fnArgs, session);
    if (session.activeResponseId !== responseId) return;

    // ── Turn 2: stream function result back into Gemini ────────────────────
    const turn2 = await session.chat.sendMessageStream([
      { functionResponse: { name: fnName, response: fnResponse } },
    ]);
    let turn2HasText = false;

    for await (const chunk of turn2.stream) {
      if (session.activeResponseId !== responseId) return;

      const text = textFromChunk(chunk);
      if (text) {
        turn2HasText = true;
        sendChunk(ws, responseId, text, false);
      }
    }

    const turn2Response = await turn2.response;
    if (session.activeResponseId !== responseId) return;

    const turn2Fallback = turn2HasText
      ? ''
      : (turn2Response.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? '');

    sendChunk(ws, responseId, turn2Fallback, true); // Final completion frame (최종 완료 프레임)

    console.log(`[WS] [${session.agentId}] Function turn complete (함수 턴 완료) | response_id: ${responseId}`);

  } catch (err) {
    console.error(`[WS] [${session.agentId}] Streaming error (스트리밍 오류):`, err);
    // Only send fallback if this generation is still active — avoids clobbering a newer response
    // (이 생성이 여전히 활성인 경우에만 폴백 전송 — 더 새로운 응답 덮어쓰기 방지)
    if (session.activeResponseId === responseId) {
      sendChunk(ws, responseId, "I'm sorry, I had a little trouble. Could you please say that again?", true);
    }
  }
}

// ── Function Call Executor ────────────────────────────────────────────────────

/**
 * Execute a Gemini function call and return the result payload to inject back into the chat.
 * (Gemini 함수 호출 실행 후 채팅에 다시 주입할 결과 페이로드 반환)
 *
 * @param {string} fnName
 * @param {object} fnArgs
 * @param {object} session
 * @returns {Promise<object>}
 */
async function executeFunctionCall(fnName, fnArgs, session) {
  // ── get_menu ────────────────────────────────────────────────────────────────
  if (fnName === 'get_menu') {
    // Use pre-fetched menu_cache — avoids a live POS round-trip per call
    // (사전 조회된 menu_cache 사용 — 통화마다 라이브 POS 왕복 방지)
    const menuContent = session.storeData.menu_cache ?? 'Menu information is currently unavailable.';
    return { menu: menuContent };
  }

  // ── create_order ────────────────────────────────────────────────────────────
  if (fnName === 'create_order') {
    const storeContext = buildStoreContext(session.storeData);
    const orderData    = extractOrderIntent(
      { type: 'TOOL_CALL', name: fnName, args: fnArgs },
      storeContext
    );

    // Fire-and-forget — worker handles POS + payment asynchronously
    // (fire-and-forget — 워커가 POS + 결제 비동기 처리)
    enqueueOrder(orderData, storeContext).catch((err) => {
      console.error(
        `[WS] [${session.agentId}] Enqueue failed for order ${orderData.orderId}: ${err.message} ` +
        `(주문 큐 등록 실패)`
      );
    });

    return {
      success: true,
      orderId: orderData.orderId,
      total:   `$${(orderData.totalAmountCents / 100).toFixed(2)}`,
      items:   orderData.items.length,
    };
  }

  // Unknown function — return neutral payload so Gemini can recover
  // (알 수 없는 함수 — Gemini가 복구할 수 있도록 중립 페이로드 반환)
  console.warn(`[WS] Unknown function: "${fnName}" (알 수 없는 함수 호출: "${fnName}")`);
  return { error: `Function "${fnName}" is not implemented.` };
}

// ── Store Data Fetcher ────────────────────────────────────────────────────────

/**
 * Fetch the full store configuration row from Supabase for a given agent_id.
 * Returns null if the agent is not found or is inactive.
 * Falls back to mock data in development when USE_MOCK_TENANT=true.
 * (agent_id에 대한 전체 스토어 설정 행을 Supabase에서 조회.
 *  에이전트를 찾을 수 없거나 비활성인 경우 null 반환.
 *  USE_MOCK_TENANT=true인 개발 환경에서 목 데이터로 폴백)
 *
 * @param {string} agentId
 * @returns {Promise<object|null>}
 */
async function fetchStoreData(agentId) {
  // Development mock path (개발 목 경로)
  if (process.env.NODE_ENV === 'development' && process.env.USE_MOCK_TENANT === 'true') {
    return getMockStoreData(agentId);
  }

  // Debug: confirm the Supabase URL is present (디버그: Supabase URL 존재 확인)
  console.log('[DB Debug] Connecting to Supabase URL:', process.env.SUPABASE_URL ? 'Loaded' : 'MISSING!');

  const { data, error } = await supabase
    .from('stores')
    .select('*')
    .eq('retell_agent_id', agentId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Row not found (행 없음)
    console.error(`[WS] Supabase error: ${error.message} (Supabase 오류)`);
    console.error('[WS] Supabase error detail:', error.cause || error);
    return null;
  }

  // Strict boolean check — is_active === false rejects; NULL passes through
  // (엄격한 불리언 확인 — is_active가 false면 거절; NULL은 통과)
  if (data.is_active === false) {
    console.warn(`[WS] Agent ${agentId} is inactive — rejecting (에이전트 비활성 — 거절)`);
    return null;
  }

  return data;
}

// ── Master Prompt Builder ─────────────────────────────────────────────────────

/**
 * Assemble the Master Prompt by concatenating all store knowledge fields.
 * (모든 스토어 지식 필드를 연결하여 마스터 프롬프트 조립)
 *
 * @param {object} storeData
 * @returns {string}
 */
function buildMasterPrompt(storeData) {
  const sections = [
    storeData.system_prompt,
    storeData.business_hours  && `Business Hours:\n${storeData.business_hours}`,
    storeData.parking_info    && `Parking & Directions:\n${storeData.parking_info}`,
    storeData.custom_knowledge && `Additional Information:\n${storeData.custom_knowledge}`,
    storeData.menu_cache      && `Current Menu:\n${storeData.menu_cache}`,
  ].filter(Boolean);

  if (sections.length === 0) {
    return (
      `You are a helpful voice ordering assistant for ${storeData.store_name ?? 'this store'}. ` +
      `Help customers browse the menu and place orders clearly and efficiently.`
    );
  }

  return sections.join('\n\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Safely extract plain text from a streaming Gemini chunk.
 * Filters out function-call parts so text() is never called on a non-text response.
 * (스트리밍 Gemini 청크에서 일반 텍스트 안전 추출.
 *  함수 호출 파트를 필터링하여 비텍스트 응답에서 text() 호출 방지)
 *
 * @param {import('@google/generative-ai').GenerateContentResponse} chunk
 * @returns {string}
 */
function textFromChunk(chunk) {
  return (chunk.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
}

/**
 * Send a Retell-protocol frame over the WebSocket.
 * contentComplete=false → partial streaming chunk.
 * contentComplete=true  → final frame; signals the utterance is complete.
 * No-ops when the socket is not OPEN.
 * (WebSocket을 통해 Retell 프로토콜 프레임 전송.
 *  contentComplete=false → 부분 스트리밍 청크.
 *  contentComplete=true  → 최종 프레임; 발화 완료 신호.
 *  소켓이 OPEN 상태가 아니면 아무것도 하지 않음)
 *
 * @param {import('ws').WebSocket} ws
 * @param {number}  responseId      — echoed from response_required (response_required에서 반환)
 * @param {string}  content         — text for Retell TTS (Retell TTS용 텍스트)
 * @param {boolean} contentComplete — true signals stream end (true는 스트림 종료 신호)
 * @param {boolean} [endCall]       — true instructs Retell to hang up (true이면 Retell에 전화 종료 지시)
 */
function sendChunk(ws, responseId, content, contentComplete, endCall = false) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({
    response_type:    'response',
    response_id:      responseId,
    content,
    content_complete: contentComplete,
    end_call:         endCall,
  }));
}

/**
 * Map raw Supabase storeData to the storeContext shape used by extractOrderIntent().
 * (원시 Supabase storeData를 extractOrderIntent()가 사용하는 storeContext 형태로 매핑)
 *
 * @param {object} storeData
 * @returns {object}
 */
function buildStoreContext(storeData) {
  return {
    agentId:     storeData.id,
    storeName:   storeData.store_name ?? null,
    posType:     storeData.pos_type,
    posApiKey:   storeData.pos_api_key,
    paymentType: storeData.payment_type,
    timezone:    storeData.timezone ?? 'America/Los_Angeles',
  };
}

// ── Development Mock ──────────────────────────────────────────────────────────

/**
 * Mock store data for local development — mirrors tenantMiddleware mock.
 * (로컬 개발용 목 스토어 데이터 — tenantMiddleware 목과 동일)
 *
 * @param {string} agentId
 * @returns {object|null}
 */
function getMockStoreData(agentId) {
  const MOCK_STORES = {
    'agent-001': {
      id:               'agent-001',
      store_name:       'JM Korean BBQ — Downtown',
      pos_type:         'LOYVERSE',
      pos_api_key:      'mock-loyverse-key-001',
      payment_type:     'stripe',
      timezone:         'America/Los_Angeles',
      active:           true,
      is_active:        true,

      system_prompt:
        'You are Mina, a warm and knowledgeable voice assistant for JM Korean BBQ Downtown. ' +
        'You speak naturally and help customers order Korean BBQ dishes with enthusiasm. ' +
        'Always confirm the total price before placing any order.',

      business_hours:
        'Monday–Friday: 11:00 AM – 10:00 PM\n' +
        'Saturday–Sunday: 11:00 AM – 11:00 PM\n' +
        'Last seating is 30 minutes before closing.',

      parking_info:
        'Free parking in the lot behind the restaurant on Main St. ' +
        'Street parking available on Oak Ave (2-hour limit on weekdays).',

      custom_knowledge:
        'We offer a 10% discount for students with valid ID on weekdays before 5 PM. ' +
        'All meats are USDA Choice grade. Gluten-free options are available — ask your server.',

      menu_cache:
        'BEEF: Bulgogi $18 | Galbi (Short Rib) $26 | Brisket $22\n' +
        'PORK: Samgyeopsal (Pork Belly) $20 | Spicy Pork Shoulder $19\n' +
        'CHICKEN: Dak Galbi $17\n' +
        'SIDES: Steamed Rice $3 | Kimchi $4 | Japchae $8 | Doenjang Jjigae $7\n' +
        'DRINKS: Korean Beer $6 | Soju $12 | Makgeolli $9 | Soft Drink $3',
    },

    'agent-002': {
      id:               'agent-002',
      store_name:       'JM Boba Tea — Koreatown',
      pos_type:         'QUANTIC',
      pos_api_key:      'mock-quantic-key-002',
      payment_type:     'toss',
      timezone:         'America/Los_Angeles',
      active:           true,
      is_active:        true,

      system_prompt:
        'You are Jamie, a friendly voice assistant for JM Boba Tea in Koreatown. ' +
        'Help customers choose and order boba drinks quickly and cheerfully. ' +
        'Always ask about sugar level (25%, 50%, 75%, 100%) and ice level (no ice, less, normal, extra).',

      business_hours: 'Daily: 10:00 AM – 9:00 PM',

      parking_info:
        'Street parking on Western Ave. Shared lot with the plaza — first 30 minutes free.',

      custom_knowledge:
        'We use real tea leaves and fresh tapioca pearls made in-house daily. ' +
        'Dairy-free milk alternatives available: oat milk (+$1), almond milk (+$1).',

      menu_cache:
        'MILK TEA: Classic Milk Tea $6 | Taro Milk Tea $6.50 | Matcha Milk Tea $7\n' +
        'FRUIT TEA: Passion Fruit Green Tea $6 | Strawberry Lemonade $6.50\n' +
        'SPECIALS: Brown Sugar Boba Milk $7.50 | Tiger Milk Tea $7.50\n' +
        'ADD-ONS: Boba +$0.75 | Jelly +$0.75 | Pudding +$1',
    },
  };

  return MOCK_STORES[agentId] ?? null;
}
