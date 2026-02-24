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
 *  따라서 agent_id는 호출자가 URL 쿼리 파라미터로 전달:
 *  wss://host/llm-websocket/<call_id>?agent_id=<agent_id>)
 *
 * Retell → Server (receives):
 *   update_only      : transcript state push — no reply expected (응답 불필요 transcript 상태 푸시)
 *   response_required: agent must reply with a spoken utterance (에이전트가 발화로 응답해야 함)
 *   reminder_required: agent has been silent too long — nudge required (에이전트가 너무 오래 무음 — 응답 요청)
 *
 * Server → Retell (sends):
 *   { response_type: "response", content: "...", content_complete: true, end_call: false }
 *
 * ── Per-Connection Lifecycle ──────────────────────────────────────────────────
 *   connect → extract agent_id from URL → fetchStoreData → buildMasterPrompt
 *           → createChatSession → message* → [response_required → handleTranscript]
 *           → close
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
 * @param {import('http').Server} httpServer — the return value of app.listen() (app.listen() 반환값)
 * @returns {WebSocketServer}
 */
export function setupWebSocket(httpServer) {
  // Use noServer mode so we control upgrade routing ourselves.
  // The `path` option performs a strict equality check (req.url === path), which breaks
  // when Retell appends the call_id to the URL: /llm-websocket/<call_id>.
  // By handling the 'upgrade' event manually we can use startsWith() for a prefix match.
  // (noServer 모드 사용 — 업그레이드 라우팅을 직접 제어.
  //  `path` 옵션은 엄격한 동등 비교(req.url === path)를 수행하므로,
  //  Retell이 URL에 call_id를 추가할 때(/llm-websocket/<call_id>) 연결이 거절됨.
  //  'upgrade' 이벤트를 직접 처리하면 startsWith()로 접두사 일치 사용 가능)
  const wss = new WebSocketServer({ noServer: true });

  // Intercept every HTTP Upgrade request on the shared server.
  // Route to the WebSocket server only when the path starts with WS_PATH —
  // this handles both /llm-websocket (exact) and /llm-websocket/<call_id> (Retell).
  // (공유 서버의 모든 HTTP Upgrade 요청 인터셉트.
  //  경로가 WS_PATH로 시작할 때만 WebSocket 서버로 라우팅 —
  //  /llm-websocket(정확) 및 /llm-websocket/<call_id>(Retell) 모두 처리)
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith(WS_PATH)) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req); // Triggers the 'connection' handler below (아래 'connection' 핸들러 실행)
      });
    } else {
      socket.destroy(); // Reject unrecognised upgrade paths cleanly (인식되지 않는 업그레이드 경로 거절)
    }
  });

  // ── Connection Handler ───────────────────────────────────────────────────────
  // async because we fetch store data from Supabase before registering the message listener.
  // All session initialisation completes here — the message handler is never registered
  // on a failed connection, so there is no need for a pre-init guard inside it.
  // (async 사용 — 메시지 리스너 등록 전 Supabase에서 스토어 데이터 조회.
  //  모든 세션 초기화가 여기서 완료 — 실패한 연결에는 메시지 핸들러가 등록되지 않으므로
  //  내부에 사전 초기화 가드 불필요)
  wss.on('connection', async (ws, req) => {
    // ── Extract agent_id and call_id from the WebSocket URL ─────────────────
    // Retell format: /llm-websocket/<call_id>?agent_id=<agent_id>
    // new URL() requires an absolute base because req.url is path-only.
    // (Retell 형식: /llm-websocket/<call_id>?agent_id=<agent_id>
    //  req.url은 경로만 포함하므로 new URL()에 절대 베이스 URL 필요)
    const { pathname, searchParams } = new URL(req.url, 'http://localhost');
    const agentId = searchParams.get('agent_id');

    // Retell appends the call_id as the path segment after WS_PATH
    // (Retell은 WS_PATH 뒤에 call_id를 경로 세그먼트로 추가)
    const callId = searchParams.get('call_id')
      ?? (pathname.slice(WS_PATH.length).replace(/^\//, '') || null);

    console.log(
      `[WS] New connection | agent: ${agentId ?? 'unknown'} | call: ${callId ?? 'unknown'} | ` +
      `from: ${req.socket.remoteAddress} ` +
      `(새 연결 | 에이전트: ${agentId ?? 'unknown'} | 통화: ${callId ?? 'unknown'})`
    );

    // agent_id is required — reject the connection immediately without it
    // (agent_id 필수 — 없으면 즉시 연결 거절)
    if (!agentId) {
      console.error('[WS] Missing agent_id in WebSocket URL query string — closing (URL 쿼리에 agent_id 없음 — 연결 종료)');
      ws.close(1008, 'Missing agent_id');
      return;
    }

    // ── Fetch store configuration immediately on connect ─────────────────────
    // No setup message needed — agent_id is already known from the URL.
    // (연결 즉시 스토어 설정 조회 — URL에서 agent_id를 이미 알고 있으므로 설정 메시지 불필요)
    const storeData = await fetchStoreData(agentId);

    if (!storeData) {
      console.error(`[DB Error] No store found for agent_id: ${agentId} (에이전트 ID에 스토어 없음 — 연결 종료)`);
      ws.close(1008, `No store found for agent_id: ${agentId}`);
      return;
    }

    // ── Build master prompt and initialise Gemini chat session ───────────────
    // Session is fully ready before the message handler is attached.
    // (메시지 핸들러 부착 전 세션이 완전히 준비됨)
    const masterPrompt = buildMasterPrompt(storeData);
    const chat         = createChatSession(masterPrompt);

    // Immutable session object — captured in the message/close/error closures below
    // (불변 세션 객체 — 아래 message/close/error 클로저에서 캡처)
    const session = {
      agentId,
      callId,
      storeData,
      chat,
    };

    console.log(
      `[WS] Session ready | agent: ${agentId} | store: ${storeData.store_name ?? '(unnamed)'} | ` +
      `master prompt: ${masterPrompt.length} chars ` +
      `(세션 준비 완료 | 에이전트: ${agentId} | 스토어: ${storeData.store_name ?? '(unnamed)'} | ` +
      `마스터 프롬프트: ${masterPrompt.length}자)`
    );

    // ── Proactive Greeting ─────────────────────────────────────────────────
    // Retell expects the custom LLM to speak first. Send an initial greeting
    // immediately after the session is ready using response_id: 0.
    // The prompt is a hidden system turn — it does not appear in the call transcript.
    // (Retell은 커스텀 LLM이 먼저 말하기를 기대. 세션 준비 후 즉시 response_id: 0으로 인사말 전송.
    //  이 프롬프트는 숨겨진 시스템 턴 — 통화 transcript에 나타나지 않음)
    try {
      const greetingTurn = await chat.sendMessage(
        'Greet the caller warmly, introduce yourself by name, and ask how you can help them today. Keep it to one or two sentences.'
      );
      const greetingText = greetingTurn.response.text();
      console.log(`[WS] [${agentId}] Greeting: "${greetingText.slice(0, 80)}…" (인사말 전송)`);
      sendResponse(ws, 0, greetingText); // response_id 0 signals the proactive opening utterance (response_id 0은 선제적 첫 발화를 나타냄)
    } catch (err) {
      console.error(`[WS] [${agentId}] Greeting generation failed: ${err.message} (인사말 생성 실패)`);
      // Fall back to a static greeting so the call never opens with silence
      // (Gemini 실패 시 정적 인사말로 폴백 — 무음으로 시작하지 않도록)
      sendResponse(ws, 0, "Hello! I'm your voice assistant. How can I help you today?");
    }

    // ── Message Handler ────────────────────────────────────────────────────
    // Only reached after successful initialisation — no init guard required.
    // (초기화 성공 후에만 도달 — 초기화 가드 불필요)
    ws.on('message', async (rawData) => {
      // Parse incoming frame — all Retell messages are JSON (수신 프레임 파싱 — 모든 Retell 메시지는 JSON)
      let msg;
      try {
        msg = JSON.parse(rawData.toString());
      } catch {
        console.error('[WS] Received non-JSON frame — closing connection (JSON이 아닌 프레임 수신 — 연결 종료)');
        ws.close(1003, 'Unsupported data: expected JSON');
        return;
      }

      // update_only is a transcript state push — Retell does NOT expect a reply
      // Sending a response here produces a missing/invalid response_id and breaks audio playback
      // (update_only는 transcript 상태 푸시 — Retell이 응답을 기대하지 않음.
      //  여기서 응답을 전송하면 response_id가 없거나 유효하지 않아 오디오 재생이 중단됨)
      if (msg.interaction_type === 'update_only') return;

      // Strict gate: ONLY call Gemini and send audio when Retell explicitly asks for a response
      // Any other interaction_type (ping, call_ended, etc.) is silently ignored
      // (엄격한 게이트: Retell이 명시적으로 응답을 요청할 때만 Gemini 호출 및 오디오 전송.
      //  그 외 interaction_type은 무시 — 예: ping, call_ended)
      if (msg.interaction_type === 'response_required') {
        // response_id must be echoed back in the reply frame — Retell uses it to sequence audio
        // (response_id는 응답 프레임에 그대로 반환해야 함 — Retell이 오디오 순서 지정에 사용)
        const responseId = msg.response_id;
        await handleTranscript(ws, session, msg.transcript ?? [], responseId);
        return;
      }
    });

    // ── Close Handler ──────────────────────────────────────────────────────
    ws.on('close', (code) => {
      console.log(
        `[WS] Connection closed | agent: ${agentId} | call: ${callId ?? 'unknown'} | code: ${code} ` +
        `(연결 종료 | 에이전트: ${agentId} | 통화: ${callId ?? 'unknown'})`
      );
      // session goes out of scope here — let GC clean up (세션이 스코프를 벗어나 GC가 정리)
    });

    // ── Error Handler ──────────────────────────────────────────────────────
    ws.on('error', (err) => {
      // Log but do not rethrow — ws library handles socket cleanup
      // (로깅만 하고 재throw 없음 — ws 라이브러리가 소켓 정리 처리)
      console.error(
        `[WS] Socket error | agent: ${agentId} | ${err.message} ` +
        `(소켓 오류 | 에이전트: ${agentId})`
      );
    });
  });

  console.log(`[WS] WebSocket server ready on path: ${WS_PATH} (WebSocket 서버 준비 완료)`);
  return wss;
}

// ── Transcript Handler ────────────────────────────────────────────────────────

/**
 * Handle a response_required turn from Retell.
 * Passes the latest user transcript to Gemini, handles function calls, and sends the reply.
 * The responseId from the incoming frame MUST be echoed back so Retell can sequence audio.
 * (Retell의 response_required 턴 처리.
 *  최신 사용자 transcript를 Gemini에 전달, 함수 호출 처리, 응답 전송.
 *  수신 프레임의 responseId는 반드시 반환해야 함 — Retell이 오디오 순서 지정에 사용)
 *
 * @param {import('ws').WebSocket} ws
 * @param {object} session    — fully initialised session (초기화 완료된 세션)
 * @param {Array}  transcript — full call transcript array from Retell (Retell의 전체 통화 transcript 배열)
 * @param {number} responseId — Retell's response_id; must be included in the reply frame (응답 프레임에 포함해야 하는 Retell의 response_id)
 */
async function handleTranscript(ws, session, transcript, responseId) {
  // Extract the last user utterance from the transcript array
  // (transcript 배열에서 마지막 사용자 발화 추출)
  const lastUserTurn = transcript.filter((t) => t.role === 'user').at(-1);
  const userText     = lastUserTurn?.content?.trim() ?? '';

  if (!userText) {
    // Empty transcript — send a nudge to prompt the user (빈 transcript — 사용자에게 안내 전송)
    sendResponse(ws, responseId, "I'm listening. How can I help you today?");
    return;
  }

  console.log(
    `[WS] [${session.agentId}] User: "${userText.slice(0, 80)}${userText.length > 80 ? '…' : ''}" ` +
    `(사용자 발화: "${userText.slice(0, 80)}")`
  );

  try {
    // ── Turn 1: send user text to Gemini (턴 1: 사용자 텍스트를 Gemini에 전송) ──
    const turn1 = await session.chat.sendMessage(userText);
    const parts = turn1.response.candidates?.[0]?.content?.parts ?? [];
    const fnPart = parts.find((p) => p.functionCall != null);

    // ── Plain text response — send directly to Retell (일반 텍스트 응답 — Retell에 직접 전송) ──
    if (!fnPart) {
      const text = turn1.response.text();
      console.log(
        `[WS] [${session.agentId}] Gemini text reply: "${text.slice(0, 80)}…" ` +
        `(Gemini 텍스트 응답: "${text.slice(0, 80)}")`
      );
      sendResponse(ws, responseId, text);
      return;
    }

    // ── Function call detected — execute and return result to Gemini ─────────
    const { name: fnName, args: fnArgs } = fnPart.functionCall;

    console.log(
      `[WS] [${session.agentId}] Function call: "${fnName}" | args: ${JSON.stringify(fnArgs)} ` +
      `(함수 호출: "${fnName}" | 인수: ${JSON.stringify(fnArgs)})`
    );

    // Dispatch to the correct handler and get the function result payload
    // (올바른 핸들러로 디스패치하여 함수 결과 페이로드 획득)
    const fnResponse = await executeFunctionCall(fnName, fnArgs, session);

    // ── Turn 2: inject function result back into Gemini to get natural-language reply
    // (턴 2: 함수 결과를 Gemini에 주입하여 자연어 응답 획득)
    const turn2 = await session.chat.sendMessage([
      {
        functionResponse: {
          name:     fnName,
          response: fnResponse,     // SDK wraps this in the correct Content shape (SDK가 올바른 Content 형태로 래핑)
        },
      },
    ]);

    const finalText = turn2.response.text();

    console.log(
      `[WS] [${session.agentId}] Gemini post-function reply: "${finalText.slice(0, 80)}…" ` +
      `(Gemini 함수 후 응답: "${finalText.slice(0, 80)}")`
    );

    sendResponse(ws, responseId, finalText);

  } catch (err) {
    console.error(
      `[WS] [${session.agentId}] Error processing transcript: ${err.message} ` +
      `(transcript 처리 오류: ${err.message})`
    );
    // Send a graceful fallback — voice calls must not go silent
    // (음성 통화는 무음이 되면 안 됨 — 우아한 폴백 전송)
    sendResponse(ws, responseId, "I'm sorry, I had a little trouble. Could you please say that again?");
  }
}

// ── Function Call Executor ────────────────────────────────────────────────────

/**
 * Execute a Gemini function call and return the result payload to inject back into the chat.
 * (Gemini 함수 호출 실행 후 채팅에 다시 주입할 결과 페이로드 반환)
 *
 * @param {string} fnName   — tool name from Gemini (Gemini의 도구명)
 * @param {object} fnArgs   — arguments Gemini extracted (Gemini가 추출한 인수)
 * @param {object} session  — current connection session (현재 연결 세션)
 * @returns {Promise<object>} result payload for functionResponse (functionResponse용 결과 페이로드)
 */
async function executeFunctionCall(fnName, fnArgs, session) {
  // ── get_menu ────────────────────────────────────────────────────────────────
  if (fnName === 'get_menu') {
    // Use the pre-fetched menu_cache from storeData — avoids a live POS round-trip per call
    // (storeData의 사전 조회된 menu_cache 사용 — 통화마다 라이브 POS 왕복 방지)
    const menuContent = session.storeData.menu_cache ?? 'Menu information is currently unavailable.';

    return { menu: menuContent }; // Injected as functionResponse.response (functionResponse.response로 주입)
  }

  // ── create_order ────────────────────────────────────────────────────────────
  if (fnName === 'create_order') {
    const storeContext = buildStoreContext(session.storeData);

    // Normalise Gemini args into the canonical orderData shape the queue worker expects
    // (Gemini 인수를 큐 워커가 기대하는 표준 orderData 형태로 정규화)
    const orderData = extractOrderIntent(
      { type: 'TOOL_CALL', name: fnName, args: fnArgs },
      storeContext
    );

    // Fire-and-forget enqueue — worker handles POS + payment async (fire-and-forget 큐 등록 — 워커가 POS + 결제 비동기 처리)
    enqueueOrder(orderData, storeContext).catch((err) => {
      console.error(
        `[WS] [${session.agentId}] Enqueue failed for order ${orderData.orderId}: ${err.message} ` +
        `(주문 ${orderData.orderId} 큐 등록 실패: ${err.message})`
      );
    });

    const totalStr = `$${(orderData.totalAmountCents / 100).toFixed(2)}`;

    // Return success metadata — Gemini uses this to generate a confirmation utterance
    // (성공 메타데이터 반환 — Gemini가 이를 사용하여 확인 발화 생성)
    return {
      success:  true,
      orderId:  orderData.orderId,
      total:    totalStr,
      items:    orderData.items.length,
    };
  }

  // Unknown function name — return a neutral payload so Gemini can recover gracefully
  // (알 수 없는 함수명 — Gemini가 우아하게 복구할 수 있도록 중립 페이로드 반환)
  console.warn(`[WS] Unknown function call received: "${fnName}" (알 수 없는 함수 호출: "${fnName}")`);
  return { error: `Function "${fnName}" is not implemented.` };
}

// ── Store Data Fetcher ────────────────────────────────────────────────────────

/**
 * Fetch the full store configuration row from Supabase for a given agent_id.
 * Returns null if the agent is not found or is inactive.
 * (agent_id에 대한 전체 스토어 설정 행을 Supabase에서 조회.
 *  에이전트를 찾을 수 없거나 비활성인 경우 null 반환)
 *
 * Falls back to mock data in development when USE_MOCK_TENANT=true.
 * (USE_MOCK_TENANT=true인 개발 환경에서 목 데이터로 폴백)
 *
 * @param {string} agentId
 * @returns {Promise<object|null>}
 */
async function fetchStoreData(agentId) {
  // Development mock path — mirrors the tenantMiddleware mock for consistency
  // (개발 목 경로 — 일관성을 위해 tenantMiddleware 목과 동일)
  if (process.env.NODE_ENV === 'development' && process.env.USE_MOCK_TENANT === 'true') {
    return getMockStoreData(agentId);
  }

  // Debug: confirm the Supabase URL is present before attempting the network call
  // (디버그: 네트워크 호출 전 Supabase URL 존재 여부 확인)
  console.log('[DB Debug] Connecting to Supabase URL:', process.env.SUPABASE_URL ? 'Loaded' : 'MISSING!');

  // Query the stores table matching on retell_agent_id — the actual schema uses 'stores', not 'agents'
  // (실제 스키마는 'agents'가 아닌 'stores' 테이블 사용 — retell_agent_id 컬럼으로 조회)
  // Select all columns — avoids 42703 errors when the schema evolves or column names differ
  // (모든 컬럼 선택 — 스키마 변경이나 컬럼명 불일치로 인한 42703 오류 방지)
  const { data, error } = await supabase
    .from('stores')
    .select('*')
    .eq('retell_agent_id', agentId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Row not found (행 없음)
    console.error(`[WS] Supabase error fetching store data: ${error.message} (스토어 데이터 조회 Supabase 오류)`);
    console.error('[WS] Supabase error detail:', error.cause || error); // Expose fetch/network root cause (fetch/네트워크 근본 원인 노출)
    return null;
  }

  // Strict boolean check — is_active === false rejects; NULL (pre-migration rows) passes through
  // (엄격한 불리언 확인 — is_active가 false면 거절; NULL(마이그레이션 전 행)은 통과)
  if (data.is_active === false) {
    console.warn(`[WS] Agent ${agentId} is inactive — rejecting connection (에이전트 비활성 — 연결 거절)`);
    return null;
  }

  return data;
}

// ── Master Prompt Builder ─────────────────────────────────────────────────────

/**
 * Assemble the Master Prompt by concatenating all store knowledge fields.
 * The ordering puts the core persona first and the menu last (it can be long).
 * (모든 스토어 지식 필드를 연결하여 마스터 프롬프트 조립.
 *  핵심 페르소나를 먼저, 메뉴를 마지막에 배치 — 메뉴가 길 수 있음)
 *
 * @param {object} storeData — raw Supabase agents row (원시 Supabase agents 행)
 * @returns {string}
 */
function buildMasterPrompt(storeData) {
  const sections = [
    // 1. Core persona — who the assistant is and how it behaves (핵심 페르소나 — 어시스턴트 정체와 행동 방식)
    storeData.system_prompt,

    // 2. Operational details — when and where the store operates (운영 세부 사항 — 매장 운영 시간 및 위치)
    storeData.business_hours  && `Business Hours:\n${storeData.business_hours}`,
    storeData.parking_info    && `Parking & Directions:\n${storeData.parking_info}`,

    // 3. Store-specific knowledge — FAQs, policies, special items (매장별 지식 — FAQ, 정책, 특별 항목)
    storeData.custom_knowledge && `Additional Information:\n${storeData.custom_knowledge}`,

    // 4. Menu — placed last because it can be several hundred tokens (메뉴 — 수백 토큰이 될 수 있어 마지막에 배치)
    storeData.menu_cache      && `Current Menu:\n${storeData.menu_cache}`,
  ].filter(Boolean); // Drop null/undefined sections (null/undefined 섹션 제거)

  // Fallback if the store has no prompts configured yet (스토어에 프롬프트가 아직 설정되지 않은 경우 폴백)
  if (sections.length === 0) {
    return (
      `You are a helpful voice ordering assistant for ${storeData.store_name ?? 'this store'}. ` +
      `Help customers browse the menu and place orders clearly and efficiently.`
    );
  }

  return sections.join('\n\n'); // Double newline as section separator (섹션 구분자로 이중 줄바꿈 사용)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Send a Retell-protocol response frame over the WebSocket.
 * response_id MUST be echoed from the triggering request — Retell uses it to sequence audio.
 * No-ops if the socket is not in OPEN state to prevent write-after-close errors.
 * (WebSocket을 통해 Retell 프로토콜 응답 프레임 전송.
 *  response_id는 요청에서 그대로 반환 필수 — Retell이 오디오 순서 지정에 사용.
 *  쓰기 후 닫기 오류 방지를 위해 소켓이 OPEN 상태가 아니면 아무것도 하지 않음)
 *
 * @param {import('ws').WebSocket} ws
 * @param {number}  responseId — echoed from the response_required frame (response_required 프레임에서 반환)
 * @param {string}  content    — text the Retell TTS engine will speak (Retell TTS 엔진이 말할 텍스트)
 * @param {boolean} [endCall]  — true to instruct Retell to hang up (true이면 Retell에 전화 종료 지시)
 */
function sendResponse(ws, responseId, content, endCall = false) {
  if (ws.readyState !== ws.OPEN) return; // Guard: do not write to a closing/closed socket (가드: 닫히는/닫힌 소켓에 쓰기 금지)

  ws.send(
    JSON.stringify({
      response_type:    'response',   // Required by Retell — frames without this field are silently ignored (Retell 필수 — 이 필드 없이는 프레임이 무시됨)
      response_id:      responseId,   // Echoed from the request — Retell uses this to sequence audio (요청에서 반환 — Retell이 오디오 순서 지정에 사용)
      content,
      content_complete: true,         // Signals the complete utterance — no streaming chunks (완전한 발화 신호 — 스트리밍 청크 없음)
      end_call:         endCall,
    })
  );
}

/**
 * Map raw Supabase storeData to the storeContext shape used by extractOrderIntent().
 * (원시 Supabase storeData를 extractOrderIntent()가 사용하는 storeContext 형태로 매핑)
 *
 * @param {object} storeData — agents table row (agents 테이블 행)
 * @returns {object} storeContext
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
 * Mock store data for local development — mirrors tenantMiddleware mock but includes
 * the additional knowledge fields introduced in Step 8.
 * (로컬 개발용 목 스토어 데이터 — tenantMiddleware 목과 동일하지만
 *  Step 8에서 도입된 추가 지식 필드 포함)
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

      // Knowledge fields (지식 필드)
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

      system_prompt:
        'You are Jamie, a friendly voice assistant for JM Boba Tea in Koreatown. ' +
        'Help customers choose and order boba drinks quickly and cheerfully. ' +
        'Always ask about sugar level (25%, 50%, 75%, 100%) and ice level (no ice, less, normal, extra).',

      business_hours:
        'Daily: 10:00 AM – 9:00 PM',

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
