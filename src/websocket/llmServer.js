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
 * ── Three-Pillar Architecture: Streaming + Barge-in + Freeze Prevention ───────
 *
 * PILLAR 1 — Ultra-Fast Streaming
 *   model.generateContentStream({ contents: history }) streams tokens as they arrive.
 *   Each chunk is forwarded to Retell immediately via sendChunk(..., false).
 *   A final sendChunk(..., true) signals utterance completion to Retell's TTS engine.
 *   (토큰이 도착하는 즉시 Retell에 스트리밍. 최종 프레임으로 TTS 완료 신호 전송)
 *
 * PILLAR 2 — Interruption / Barge-in via AbortController
 *   Every generation owns an AbortController. On update_only or a new response_required,
 *   session.abortController.abort() fires immediately — BEFORE any queue work starts.
 *   generateWithAbort() races the Gemini call against the abort signal: the moment abort()
 *   is called, the pending await rejects with AbortError, exiting handleTranscript instantly
 *   without waiting for the next chunk boundary. The finally block then runs and the queue
 *   advances to the next generation.
 *   (모든 생성은 AbortController를 소유. 끼어들기 시 abort() 즉시 호출.
 *    generateWithAbort()가 abort 신호에 대해 경쟁 — await 즉시 거절, finally 즉시 실행)
 *
 * PILLAR 3 — Absolute Freeze Prevention
 *   isGenerating is set to true BEFORE the first await and ALWAYS reset to false in a
 *   finally block — no execution path can skip it, including AbortError, network errors,
 *   and function-call chain failures. This guarantees the generationQueue always advances.
 *   Manual history[] management replaces ChatSession: history is committed only after a
 *   clean (non-aborted) generation completes. On abort or error, history.length is
 *   restored to the pre-turn checkpoint — no partial responses contaminate future turns.
 *   (isGenerating은 finally로 항상 해제 — 어떤 실행 경로도 건너뛸 수 없음.
 *    수동 history[] 관리: 비중단 생성 완료 후에만 커밋. 중단 시 체크포인트로 롤백)
 *
 * Why model.generateContentStream() instead of ChatSession.sendMessageStream()?
 *   ChatSession holds opaque internal state. If a call hangs (slow first token, network
 *   stall), there is no way to abort the pending await — the generationQueue deadlocks
 *   and every subsequent response_required piles up unreachable. With generateContentStream
 *   and a manually managed history array, each call is a fully independent HTTP request.
 *   The abort signal can reject the await before the request even starts, guaranteeing
 *   the finally block runs and the queue always advances.
 *   (ChatSession은 불투명한 내부 상태 보유. 호출이 중단되면 await를 중단할 방법이 없어
 *    generationQueue 교착 발생. generateContentStream + 수동 history로 완전히 독립된 HTTP 요청.
 *    abort 신호가 요청 시작 전에 await를 거절 → finally 항상 실행 → 큐 항상 진행)
 */

import { WebSocketServer }      from 'ws';
import { supabase }             from '../config/supabase.js';
import { createGenerationModel } from '../services/llm/gemini.js';

// WebSocket path — must match the path configured in Retell's agent dashboard
// (WebSocket 경로 — Retell 에이전트 대시보드에 설정된 경로와 일치해야 함)
const WS_PATH = '/llm-websocket';

// Gemini request timeout — abort any call that hasn't started streaming within this window
// (Gemini 요청 타임아웃 — 이 시간 내에 스트리밍이 시작되지 않으면 중단)
const GEMINI_TIMEOUT_MS = 15_000;

// Greeting prompt — injected as a hidden first turn to seed the LLM persona
// (인사말 프롬프트 — LLM 페르소나를 시작하기 위한 숨겨진 첫 번째 턴으로 주입)
const GREETING_PROMPT =
  'Greet the caller warmly, introduce yourself by name, and ask how you can help them today. ' +
  'Keep it to one or two natural sentences suitable for a voice call.';

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
      console.error(`[WS] No store found for agent_id: ${agentId} — closing (스토어 없음 — 연결 종료)`);
      ws.close(1008, `No store found for agent_id: ${agentId}`);
      return;
    }

    // ── Initialise Gemini model with store master prompt ───────────────────
    // createGenerationModel() returns a raw GenerativeModel — NOT a ChatSession.
    // We call model.generateContentStream({ contents: history }) on every turn,
    // passing the full history array each time. This makes every call fully
    // independent and trivially abortable via AbortController.
    // (createGenerationModel()은 원시 GenerativeModel 반환 — ChatSession 아님.
    //  매 턴마다 model.generateContentStream({ contents: history }) 호출.
    //  전체 history 배열을 매번 전달 — 각 호출이 완전히 독립적이고 AbortController로 중단 가능)
    const masterPrompt = buildMasterPrompt(storeData);
    const model        = createGenerationModel(masterPrompt);

    // ── Per-connection session state ───────────────────────────────────────
    //
    //  model          — GenerativeModel configured with the store's master prompt.
    //  history        — Plain JS array of { role, parts } turns. Manually managed:
    //                   pushed BEFORE generation, rolled back on abort or error.
    //  isGenerating   — Boolean lock. Set true BEFORE any await; always released in
    //                   a finally block. Lets the message handler know whether to call abort().
    //  abortController— Owned by the current generation. Replaced atomically on each new turn.
    //                   Calling .abort() races against the pending generateContentStream await
    //                   and rejects it via generateWithAbort(), triggering the finally block.
    //  generationQueue— Promise chain. Serialises history writes so two concurrent calls
    //                   never mutate the history array at the same time.
    //                   Because abort() unblocks the current await immediately, the queue
    //                   advances with near-zero latency after a barge-in.
    //
    // (model: 마스터 프롬프트로 설정된 GenerativeModel.
    //  history: { role, parts } 턴의 일반 JS 배열. 생성 전 추가, 중단/오류 시 롤백.
    //  isGenerating: finally로 항상 해제되는 불리언 잠금.
    //  abortController: 현재 생성이 소유. 새 턴마다 원자적으로 교체.
    //  generationQueue: 히스토리 쓰기 직렬화 Promise 체인.
    //  abort()가 await를 즉시 해제하므로 끼어들기 후 거의 지연 없이 큐 진행)
    const session = {
      agentId,
      callId,
      storeData,
      model,
      history:         [],
      isGenerating:    false,
      abortController: null,
      generationQueue: Promise.resolve(),
    };

    console.log(
      `[WS] Session ready | agent: ${agentId} | store: ${storeData.store_name ?? '(unnamed)'} | ` +
      `prompt: ${masterPrompt.length} chars ` +
      `(세션 준비 완료 | 에이전트: ${agentId} | 프롬프트: ${masterPrompt.length}자)`
    );

    // ── Proactive Greeting (response_id: 0) ───────────────────────────────
    // Stream the opening utterance before the caller says anything.
    // Uses a one-shot generateContentStream call that is NOT added to session.history —
    // the greeting is a persona seed, not a real user turn.
    // Runs through generationQueue so any early response_required waits for it to finish.
    // (발신자가 말하기 전 여는 발화 스트리밍.
    //  session.history에 추가되지 않는 일회성 generateContentStream 호출 — 인사말은 페르소나 시드.
    //  early response_required가 완료를 기다리도록 generationQueue를 통해 실행)
    _enqueueGeneration(ws, session, agentId, () => handleGreeting(ws, session));

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

      // update_only — transcript state push from Retell.
      // Retell sends these continuously as the user's speech is transcribed.
      // Most are routine updates and must NOT abort the active generation.
      // Only abort when turntaking === 'user_turn': that is the explicit signal that
      // the user has started speaking mid-response — a genuine barge-in.
      // (update_only — Retell의 transcript 상태 업데이트.
      //  사용자 발화 중 지속적으로 수신됨 — 대부분은 일반 업데이트.
      //  turntaking === 'user_turn'일 때만 진짜 끼어들기로 처리하여 중단)
      if (msg.interaction_type === 'update_only') {
        if (session.isGenerating && session.abortController && msg.turntaking === 'user_turn') {
          console.log(
            `[WS] [${agentId}] Barge-in (user_turn) — aborting active generation ` +
            `(끼어들기 감지 — 활성 생성 중단)`
          );
          session.abortController.abort();
        }
        return;
      }

      // response_required — Retell needs a spoken reply.
      // This is a START trigger — DO NOT abort any in-flight generation here.
      // The generationQueue serialises calls: if the previous generation is still
      // running, this one waits behind it then starts cleanly.
      // Only a genuine barge-in (update_only + user_turn) should abort a generation.
      // (response_required — Retell이 발화 응답 요청.
      //  이것은 시작 트리거 — 진행 중인 생성을 중단하지 않음.
      //  generationQueue가 직렬화: 이전 생성이 완료된 후 시작.
      //  진짜 끼어들기(update_only + user_turn)만 생성을 중단해야 함)
      if (msg.interaction_type === 'response_required') {
        const responseId = msg.response_id;
        const transcript = msg.transcript ?? [];

        // Create a fresh AbortController for this generation turn.
        // The reference is captured in the closure so the queue entry can verify
        // it hasn't been superseded by a later response_required before it runs.
        // (이번 생성 턴을 위한 새 AbortController 생성.
        //  참조는 클로저에서 캡처 — 큐 항목이 Gemini 호출 전에 더 새로운 response_required로
        //  추월됐는지 확인하여 조용히 건너뜀)
        const controller = new AbortController();
        session.abortController = controller;

        _enqueueGeneration(ws, session, agentId, () => {
          // Stale-generation check: skip if a newer response_required replaced our controller.
          // (추월 확인: 더 새로운 response_required가 컨트롤러를 교체한 경우 건너뜀)
          if (session.abortController !== controller) return Promise.resolve();
          return handleTranscript(ws, session, transcript, responseId, controller.signal);
        });

        return;
      }

      // All other types (ping, call_ended, etc.) — silently ignored
      // (그 외 타입 — 무시)
    });

    // ── Close Handler ──────────────────────────────────────────────────────
    ws.on('close', (code) => {
      // Abort any pending stream so the queue drains cleanly (보류 중인 스트림 중단 — 큐 정리)
      if (session.abortController) session.abortController.abort();
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

// ── Internal Queue Helper ─────────────────────────────────────────────────────

/**
 * Append a generation task to the session's generationQueue.
 * The queue serialises all history writes — two generateContentStream() calls
 * never overlap on the same history array.
 * Errors inside the task are caught here so the queue always advances.
 * (세션의 generationQueue에 생성 작업 추가.
 *  큐는 모든 히스토리 쓰기를 직렬화 — 동일 history 배열에서 두 generateContentStream() 호출이 겹치지 않음.
 *  작업 내부 오류는 여기서 처리 — 큐 항상 진행)
 *
 * @param {import('ws').WebSocket} ws
 * @param {object}   session
 * @param {string}   agentId    — for error logging (오류 로깅용)
 * @param {Function} taskFn     — () => Promise<void> (generation work to serialise)
 */
function _enqueueGeneration(ws, session, agentId, taskFn) {
  session.generationQueue = session.generationQueue
    .then(() => taskFn())
    .catch((err) => {
      // Safety net: reset isGenerating if it somehow wasn't cleared by a finally block.
      // This should not happen in practice, but guards against unforeseen code paths.
      // (안전망: finally 블록에서 해제되지 않은 경우 isGenerating 재설정.
      //  실제로 발생하지 않아야 하지만 예상치 못한 코드 경로에 대한 보호)
      session.isGenerating = false;
      console.error(`[WS] [${agentId}] Unhandled queue error (처리되지 않은 큐 오류):`, err);
    });
}

// ── Greeting Handler ──────────────────────────────────────────────────────────

/**
 * Stream the proactive greeting for response_id 0 using a one-shot generation.
 * The greeting prompt is NOT added to session.history — it is ephemeral persona seeding.
 * Uses its own AbortController so it can be interrupted by an early response_required.
 * (response_id 0에 대한 선제적 인사말을 일회성 생성으로 스트리밍.
 *  인사말 프롬프트는 session.history에 추가되지 않음 — 임시 페르소나 시드.
 *  자체 AbortController로 초기 response_required에 의해 중단 가능)
 *
 * @param {import('ws').WebSocket} ws
 * @param {object} session
 */
async function handleGreeting(ws, session) {
  const controller = new AbortController();
  session.abortController = controller; // Allow early barge-in to abort the greeting (초기 끼어들기로 인사말 중단 허용)
  session.isGenerating = true;          // Set BEFORE any await (모든 await 전에 설정)

  // Greeting uses a fresh single-turn contents array — not session.history
  // (인사말은 신선한 단일 턴 contents 배열 사용 — session.history 아님)
  const greetContents = [
    { role: 'user', parts: [{ text: GREETING_PROMPT }] },
  ];

  try {
    const stream = await generateWithAbort(
      session.model, greetContents, controller.signal
    );

    for await (const chunk of stream.stream) {
      if (controller.signal.aborted) break; // Stop sending if interrupted (중단 시 전송 중지)
      const text = textFromChunk(chunk);
      if (text) sendChunk(ws, 0, text, false);
    }

    if (!controller.signal.aborted) {
      sendChunk(ws, 0, '', true); // Final frame — closes the utterance (최종 프레임 — 발화 완료)
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      console.log(`[WS] [${session.agentId}] Greeting aborted (인사말 중단)`);
    } else {
      console.error(`[WS] [${session.agentId}] Greeting error (인사말 오류):`, err);
      // Send static fallback so Retell isn't left waiting (Retell이 기다리지 않도록 정적 폴백 전송)
      sendChunk(ws, 0, "Hello! I'm your voice assistant. How can I help you today?", true);
    }
  } finally {
    session.isGenerating = false; // ALWAYS released — cannot be skipped (항상 해제 — 건너뛸 수 없음)
  }
}

// ── Transcript Handler (Streaming) ────────────────────────────────────────────

/**
 * Stream a response_required turn through Gemini and forward every chunk to Retell.
 *
 * Three-pillar implementation:
 *   1. Streaming  — generateContentStream() + per-chunk sendChunk(..., false),
 *                   final sendChunk(..., true).
 *   2. Barge-in   — signal.aborted checked before every sendChunk(); if true the loop
 *                   breaks, history is rolled back, and the finally block fires.
 *                   generateWithAbort() also rejects immediately when abort() is called,
 *                   so even the initial await is unblocked without waiting for Gemini.
 *   3. Freeze prevention — isGenerating set BEFORE the first await and reset in finally
 *                   for every exit path: clean completion, abort, error, function-call chain.
 *
 * (스트리밍 + 끼어들기 + 동결 방지 3중 구현:
 *  1. 스트리밍: generateContentStream() + 청크별 sendChunk(..., false) + 최종 true.
 *  2. 끼어들기: 각 sendChunk 전 signal.aborted 확인, 히스토리 롤백, finally 즉시 실행.
 *  3. 동결 방지: 첫 await 전 isGenerating 설정, 모든 종료 경로에서 finally로 해제)
 *
 * @param {import('ws').WebSocket} ws
 * @param {object}      session     — live session state (라이브 세션 상태)
 * @param {Array}       transcript  — Retell transcript array (Retell transcript 배열)
 * @param {number}      responseId  — echoed in every outbound frame (모든 출력 프레임에 반환)
 * @param {AbortSignal} signal      — abort signal for this generation (이번 생성의 abort 신호)
 */
async function handleTranscript(ws, session, transcript, responseId, signal) {
  // ── Set lock BEFORE any await — MUST match the finally below ──────────
  // (모든 await 전에 잠금 설정 — 아래 finally와 반드시 쌍을 이뤄야 함)
  session.isGenerating = true;

  const lastUserTurn = transcript.filter((t) => t.role === 'user').at(-1);
  const userText     = lastUserTurn?.content?.trim() ?? '';

  if (!userText) {
    // Empty transcript — nudge the caller without touching history (빈 transcript — 히스토리 수정 없이 안내)
    sendChunk(ws, responseId, "I'm listening. How can I help you today?", true);
    session.isGenerating = false;
    return;
  }

  console.log(
    `[WS] [${session.agentId}] User: "${userText.slice(0, 80)}${userText.length > 80 ? '…' : ''}" ` +
    `(사용자 발화) | response_id: ${responseId}`
  );

  // Snapshot history length — used to roll back all writes if this turn is aborted or errors.
  // Because generationQueue serialises calls, no other turn can write between checkpoint
  // and rollback, so the truncation is always safe.
  // (히스토리 길이 스냅샷 — 이 턴이 중단되거나 오류 발생 시 모든 쓰기 롤백.
  //  generationQueue가 호출을 직렬화하므로 체크포인트와 롤백 사이에 다른 턴이 쓸 수 없음)
  const historyCheckpoint = session.history.length;

  // Add user turn to history BEFORE calling Gemini so the model sees it.
  // Rolled back in catch/abort paths to keep history clean for future turns.
  // (Gemini 호출 전 사용자 턴을 히스토리에 추가 — 모델이 볼 수 있도록.
  //  미래 턴을 위해 히스토리를 깨끗하게 유지하도록 catch/abort 경로에서 롤백)
  session.history.push({ role: 'user', parts: [{ text: userText }] });

  try {
    // ── Turn 1: stream the user utterance to Gemini ────────────────────────
    const turn1 = await generateWithAbort(session.model, session.history, signal);
    let   turn1Text = '';

    for await (const chunk of turn1.stream) {
      if (signal.aborted) break; // Barge-in guard — stop sending stale chunks (끼어들기 보호 — 오래된 청크 전송 중지)
      const text = textFromChunk(chunk);
      if (text) {
        turn1Text += text;
        sendChunk(ws, responseId, text, false); // Partial chunk — TTS starts immediately (부분 청크 — TTS 즉시 시작)
      }
    }

    if (signal.aborted) {
      session.history.length = historyCheckpoint; // Rollback user turn (사용자 턴 롤백)
      return;
    }

    // Await the aggregated response to check for a function call.
    // The stream is already complete at this point — this is a resolved promise.
    // (함수 호출 확인을 위해 집계된 응답 대기.
    //  스트림이 이미 완료된 시점 — 이미 resolved된 promise)
    const turn1Response = await turn1.response;

    if (signal.aborted) {
      session.history.length = historyCheckpoint;
      return;
    }

    const turn1Parts = turn1Response.candidates?.[0]?.content?.parts ?? [];
    const fnPart     = turn1Parts.find((p) => p.functionCall != null);

    // ── Pure text response — commit history and close the utterance ────────
    if (!fnPart) {
      session.history.push({ role: 'model', parts: [{ text: turn1Text }] });
      sendChunk(ws, responseId, '', true); // Final frame — signals TTS completion (최종 프레임 — TTS 완료 신호)
      return;
    }

    // ── Function call detected ─────────────────────────────────────────────
    const { name: fnName, args: fnArgs } = fnPart.functionCall;
    console.log(
      `[WS] [${session.agentId}] Function call: "${fnName}" | args: ${JSON.stringify(fnArgs)} ` +
      `(함수 호출: "${fnName}")`
    );

    // Commit the model's function-call turn to history (모델의 함수 호출 턴을 히스토리에 커밋)
    session.history.push({ role: 'model', parts: [{ functionCall: { name: fnName, args: fnArgs } }] });

    const fnResponse = await executeFunctionCall(fnName, fnArgs, session);

    if (signal.aborted) {
      session.history.length = historyCheckpoint; // Rollback user + model turns (사용자 + 모델 턴 롤백)
      return;
    }

    // Add function result as a user-role turn — required by Gemini's multi-turn protocol
    // (함수 결과를 사용자 역할 턴으로 추가 — Gemini 멀티턴 프로토콜 요구사항)
    session.history.push({
      role:  'user',
      parts: [{ functionResponse: { name: fnName, response: fnResponse } }],
    });

    // ── Turn 2: stream Gemini's function-informed reply ────────────────────
    const turn2 = await generateWithAbort(session.model, session.history, signal);
    let   turn2Text = '';

    for await (const chunk of turn2.stream) {
      if (signal.aborted) break;
      const text = textFromChunk(chunk);
      if (text) {
        turn2Text += text;
        sendChunk(ws, responseId, text, false);
      }
    }

    if (signal.aborted) {
      session.history.length = historyCheckpoint; // Rollback all (전체 롤백)
      return;
    }

    // Commit model's reply and close the utterance (모델 응답 커밋 및 발화 완료)
    session.history.push({ role: 'model', parts: [{ text: turn2Text }] });
    sendChunk(ws, responseId, '', true);

    console.log(
      `[WS] [${session.agentId}] Turn complete | fn: "${fnName}" | response_id: ${responseId} ` +
      `(턴 완료 | 함수: "${fnName}")`
    );

  } catch (err) {
    // Always rollback history so future turns start from a clean state
    // (항상 히스토리 롤백 — 미래 턴이 깨끗한 상태에서 시작)
    session.history.length = historyCheckpoint;

    if (err.name === 'AbortError') {
      // Barge-in or timeout — expected, not an error (끼어들기 또는 타임아웃 — 예상된 상황, 오류 아님)
      console.log(
        `[WS] [${session.agentId}] Generation aborted (생성 중단) | response_id: ${responseId} | reason: ${err.message}`
      );
    } else {
      console.error(`[WS] [${session.agentId}] Streaming error (스트리밍 오류):`, err);
      // Only send fallback if the socket is still open and not mid-barge-in
      // (소켓이 열려 있고 끼어들기 중이 아닌 경우에만 폴백 전송)
      if (!signal.aborted && ws.readyState === ws.OPEN) {
        sendChunk(ws, responseId, "I'm sorry, I had a little trouble. Could you please say that again?", true);
      }
    }

  } finally {
    // ── PILLAR 3: Absolute Freeze Prevention ──────────────────────────────
    // This block executes for EVERY exit path:
    //   ✓ Clean text response         ✓ Clean function-call chain
    //   ✓ AbortError (barge-in)       ✓ Network / Gemini API error
    //   ✓ Timeout                     ✓ Empty transcript early return
    // The generationQueue's next .then() will not run until this resolves,
    // so resetting isGenerating here guarantees the queue always advances.
    // (이 블록은 모든 종료 경로에서 실행됨:
    //  모든 정상 경로, AbortError, 네트워크/Gemini 오류, 타임아웃.
    //  generationQueue의 다음 .then()은 이것이 resolved될 때까지 실행되지 않음.
    //  isGenerating 재설정으로 큐가 항상 진행됨을 보장)
    session.isGenerating = false;
  }
}

// ── generateWithAbort ─────────────────────────────────────────────────────────

/**
 * Wrap model.generateContentStream() with an AbortController and timeout.
 *
 * Why this is necessary:
 *   model.generateContentStream() returns a Promise. If Gemini is slow (network stall,
 *   cold start, rate limiting), this await can block for many seconds. Without a way to
 *   reject it early, the generationQueue deadlocks: new response_required events pile up,
 *   session.isGenerating stays true, and the voice agent freezes completely.
 *
 *   This function races the Gemini call against two rejection sources:
 *     a) abort()   — fired by the message handler on barge-in or new response_required.
 *                    The abort event listener rejects synchronously, so the await in
 *                    handleTranscript resolves (to a rejection) in the same JS tick.
 *     b) timeout   — a 15-second safety net for network failures or Gemini cold starts.
 *
 *   When either fires, handleTranscript's catch block runs, history is rolled back,
 *   and the finally block resets isGenerating — the queue advances.
 *
 *   Note: calling abort() does NOT cancel the underlying HTTP request to Gemini
 *   (the SDK does not support AbortSignal natively). The request runs to completion
 *   in the background, but its result is discarded because we manage history manually
 *   and only commit after a non-aborted generation.
 *
 * (왜 필요한가: model.generateContentStream()이 느린 경우 await가 수 초간 블록.
 *  이 함수는 Gemini 호출을 두 가지 거절 소스에 대해 경쟁:
 *  a) abort() — 끼어들기나 새 response_required 시 메시지 핸들러가 즉시 호출.
 *  b) 타임아웃 — 네트워크 장애나 Gemini 콜드 스타트에 대한 15초 안전망.
 *  어느 쪽이 먼저 발생해도 catch 블록 실행, 히스토리 롤백, finally로 잠금 해제.)
 *
 * @param {import('@google/generative-ai').GenerativeModel} model
 * @param {Array}       contents    — full history to send (전송할 전체 히스토리)
 * @param {AbortSignal} signal      — abort signal for this generation (이번 생성의 abort 신호)
 * @param {number}      [timeoutMs] — max wait for Gemini to start streaming (스트리밍 시작 대기 최대 시간)
 * @returns {Promise<import('@google/generative-ai').GenerateContentStreamResult>}
 * @throws  {Error} with name 'AbortError' if aborted or timed out (중단 또는 타임아웃 시 AbortError)
 */
function generateWithAbort(model, contents, signal, timeoutMs = GEMINI_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    // Reject immediately if already aborted before the call (호출 전에 이미 중단된 경우 즉시 거절)
    if (signal.aborted) {
      reject(makeAbortError('Aborted before Gemini call (Gemini 호출 전 이미 중단됨)'));
      return;
    }

    // Safety-net timeout — rejects if Gemini hasn't responded within GEMINI_TIMEOUT_MS
    // (안전망 타임아웃 — GEMINI_TIMEOUT_MS 내에 Gemini가 응답하지 않으면 거절)
    const timer = setTimeout(() => {
      reject(makeAbortError(`Gemini request timed out after ${timeoutMs}ms (Gemini 요청 ${timeoutMs}ms 후 타임아웃)`));
    }, timeoutMs);

    // Abort listener — fires synchronously when abort() is called on the signal.
    // This rejects the promise in the same JS tick as abort(), giving instant unblock.
    // (Abort 리스너 — 신호에서 abort() 호출 시 동기적으로 발생.
    //  abort()와 동일한 JS 틱에서 promise를 거절 — 즉각적인 차단 해제)
    const onAbort = () => {
      clearTimeout(timer);
      reject(makeAbortError('Aborted during Gemini call (Gemini 호출 중 중단됨)'));
    };
    signal.addEventListener('abort', onAbort, { once: true });

    // Issue the actual Gemini streaming request (실제 Gemini 스트리밍 요청 발행)
    model.generateContentStream({ contents })
      .then((result) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(err);
      });
  });
}

/** Create an Error with name='AbortError' for consistent catch-block detection. (AbortError 이름의 Error 생성) */
function makeAbortError(message) {
  return Object.assign(new Error(message), { name: 'AbortError' });
}

// ── Function Call Executor ────────────────────────────────────────────────────

/**
 * Execute a Gemini-requested function call and return a result payload.
 * The payload is injected back into the conversation as a functionResponse part,
 * allowing Gemini to formulate a natural spoken reply for the caller.
 *
 * Active functions perform real database writes and return success/failure.
 * Stub functions skip the DB entirely and return a holding message so Gemini
 * can gracefully inform the caller that the feature is under construction.
 *
 * All errors are caught and returned as structured failure payloads — never thrown —
 * so the isGenerating lock in handleTranscript is always released by the outer finally.
 *
 * (Gemini가 요청한 함수를 실행하고 결과 페이로드 반환.
 *  페이로드는 functionResponse 파트로 대화에 주입 — Gemini가 자연스러운 음성 응답 생성.
 *  활성 함수: 실제 DB 쓰기 후 성공/실패 반환.
 *  스텁 함수: DB 접근 없이 안내 메시지 반환 — Gemini가 고객에게 정중히 안내.
 *  오류는 항상 구조화된 실패 페이로드로 반환 — 절대 throw 안 함.
 *  handleTranscript의 isGenerating 잠금이 항상 finally로 해제되도록 보장)
 *
 * @param {string} fnName   — Gemini-chosen function name (Gemini가 선택한 함수명)
 * @param {object} fnArgs   — Gemini-extracted arguments (Gemini가 추출한 인수)
 * @param {object} session  — live WebSocket session (라이브 WebSocket 세션)
 * @returns {Promise<object>} payload injected into Gemini as functionResponse (functionResponse로 주입되는 페이로드)
 */
async function executeFunctionCall(fnName, fnArgs, session) {

  // ── get_menu ───────────────────────────────────────────────────────────────
  // Return pre-cached menu text — no network call needed (사전 캐시된 메뉴 텍스트 반환 — 네트워크 호출 불필요)
  if (fnName === 'get_menu') {
    const menuContent = session.storeData.menu_cache ?? 'Menu information is currently unavailable.';
    return { menu: menuContent };
  }

  // ── place_order (ACTIVE) ───────────────────────────────────────────────────
  // Insert a confirmed order row into the orders table.
  // Returns success with order_id, or a failure message Gemini can voice to the caller.
  // (확정된 주문을 orders 테이블에 삽입.
  //  성공 시 order_id 반환, 실패 시 Gemini가 고객에게 안내할 실패 메시지 반환)
  if (fnName === 'place_order') {
    console.log(
      `[WS] [${session.agentId}] place_order | phone: ${fnArgs.customer_phone} | ` +
      `email: ${fnArgs.customer_email} | items: ${JSON.stringify(fnArgs.items)} (주문 접수 시도)`
    );

    const { data, error } = await supabase
      .from('orders')
      .insert({
        store_id:       session.storeData.id,  // Primary store identifier from schema (스키마의 기본 매장 식별자)
        agent_id:       session.agentId,        // Retell agent ID retained for call tracing (통화 추적용 Retell 에이전트 ID 보존)
        customer_phone: fnArgs.customer_phone,
        customer_email: fnArgs.customer_email,  // Email for order confirmation receipt (주문 확인 영수증 전송용 이메일)
        items:          fnArgs.items,           // JSON array of { name, quantity } (항목 배열)
        status:         'pending',
        created_at:     new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      // Log the raw error but return a clean message Gemini can speak (원시 오류 기록, Gemini용 안내 메시지 반환)
      console.error(`[WS] [${session.agentId}] place_order DB error (주문 DB 오류):`, error);
      return {
        success: false,
        error:   'We were unable to place your order right now. Please try again or call us directly.',
      };
    }

    console.log(`[WS] [${session.agentId}] place_order success | order_id: ${data.id} (주문 성공)`);
    return {
      success:  true,
      order_id: data.id,
      message:  `Order confirmed! Your order ID is ${data.id}. We will have it ready for you shortly.`,
    };
  }

  // ── make_reservation (ACTIVE) ──────────────────────────────────────────────
  // Insert a confirmed reservation row into the reservations table.
  // Returns success with reservation_id, or a failure message Gemini can voice.
  // (확정된 예약을 reservations 테이블에 삽입.
  //  성공 시 reservation_id 반환, 실패 시 Gemini용 안내 메시지 반환)
  if (fnName === 'make_reservation') {
    console.log(
      `[WS] [${session.agentId}] make_reservation | phone: ${fnArgs.customer_phone} | ` +
      `email: ${fnArgs.customer_email} | ${fnArgs.date} ${fnArgs.time} | party: ${fnArgs.party_size} (예약 접수 시도)`
    );

    const { data, error } = await supabase
      .from('reservations')
      .insert({
        store_id:         session.storeData.id,  // Primary store identifier from schema (스키마의 기본 매장 식별자)
        agent_id:         session.agentId,        // Retell agent ID retained for call tracing (통화 추적용 Retell 에이전트 ID 보존)
        customer_phone:   fnArgs.customer_phone,
        customer_email:   fnArgs.customer_email,  // Email for reservation confirmation receipt (예약 확인 영수증 전송용 이메일)
        reservation_date: fnArgs.date,
        reservation_time: fnArgs.time,
        party_size:       fnArgs.party_size,
        status:           'pending',
        created_at:       new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      // Log the raw error but return a clean message Gemini can speak (원시 오류 기록, Gemini용 안내 메시지 반환)
      console.error(`[WS] [${session.agentId}] make_reservation DB error (예약 DB 오류):`, error);
      return {
        success: false,
        error:   'We were unable to process your reservation right now. Please call us directly to book.',
      };
    }

    console.log(`[WS] [${session.agentId}] make_reservation success | reservation_id: ${data.id} (예약 성공)`);
    return {
      success:        true,
      reservation_id: data.id,
      message:        `Reservation confirmed for ${fnArgs.party_size} on ${fnArgs.date} at ${fnArgs.time}. ` +
                      `Your confirmation ID is ${data.id}. See you then!`,
    };
  }

  // ── check_order_status (STUB) ──────────────────────────────────────────────
  // Feature under construction — return a graceful holding message to Gemini.
  // Gemini will speak this to the caller naturally.
  // (개발 중 기능 — Gemini에 정중한 안내 메시지 반환. Gemini가 고객에게 자연스럽게 안내)
  if (fnName === 'check_order_status') {
    console.log(`[WS] [${session.agentId}] check_order_status called (stub) (주문 상태 확인 호출 — 스텁)`);
    return {
      status:  'under_construction',
      message: 'Order status lookup is not yet available through this line. ' +
               'Please call our main number and a staff member will check your order for you.',
    };
  }

  // ── cancel_or_modify (STUB) ────────────────────────────────────────────────
  // Feature under construction — return a graceful holding message to Gemini.
  // (개발 중 기능 — Gemini에 정중한 안내 메시지 반환)
  if (fnName === 'cancel_or_modify') {
    console.log(`[WS] [${session.agentId}] cancel_or_modify called (stub) (취소/변경 호출 — 스텁)`);
    return {
      status:  'under_construction',
      message: 'Order changes and cancellations are not yet available through this line. ' +
               'Please call our main number and a staff member will assist you right away.',
    };
  }

  // ── transfer_to_human (STUB) ───────────────────────────────────────────────
  // Signal that this call should be escalated — return a message Gemini voices before transfer.
  // (통화 에스컬레이션 신호 — 이관 전 Gemini가 발화할 메시지 반환)
  if (fnName === 'transfer_to_human') {
    console.log(
      `[WS] [${session.agentId}] transfer_to_human called | reason: ${fnArgs.reason} ` +
      `(사람 직원 이관 호출 | 이유: ${fnArgs.reason})`
    );
    return {
      status:  'transferring',
      message: 'Of course! Let me transfer you to one of our staff members right now. ' +
               'Please hold for just a moment.',
    };
  }

  // ── Unknown function — neutral fallback ───────────────────────────────────
  // Should not occur in production; Gemini is constrained to the declared tools.
  // (프로덕션에서 발생하면 안 됨 — Gemini는 선언된 도구만 호출 가능)
  console.warn(`[WS] [${session.agentId}] Unknown function call: "${fnName}" (알 수 없는 함수 호출: "${fnName}")`);
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

  // Debug: confirm the Supabase URL is present before making the request
  // (요청 전 Supabase URL 존재 확인 디버그 로그)
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

  // Strict boolean check — is_active === false rejects; NULL or true passes through
  // (엄격한 불리언 확인 — is_active가 false면 거절; NULL 또는 true는 통과)
  if (data.is_active === false) {
    console.warn(`[WS] Agent ${agentId} is inactive — rejecting connection (에이전트 비활성 — 연결 거절)`);
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
    storeData.business_hours   && `Business Hours:\n${storeData.business_hours}`,
    storeData.parking_info     && `Parking & Directions:\n${storeData.parking_info}`,
    storeData.custom_knowledge && `Additional Information:\n${storeData.custom_knowledge}`,
    storeData.menu_cache       && `Current Menu:\n${storeData.menu_cache}`,
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
 * Filters out function-call parts so we never call .text on a non-text response.
 * (스트리밍 Gemini 청크에서 일반 텍스트 안전 추출.
 *  비텍스트 응답에서 .text 호출을 방지하도록 함수 호출 파트 필터링)
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
 * Send a Retell-protocol streaming frame over the WebSocket.
 * contentComplete=false → partial chunk; Retell's TTS engine starts speaking immediately.
 * contentComplete=true  → final frame; signals the complete utterance to Retell.
 * No-ops silently if the socket is not OPEN — safe to call after barge-in.
 * (WebSocket을 통해 Retell 프로토콜 스트리밍 프레임 전송.
 *  contentComplete=false → 부분 청크; Retell TTS 엔진이 즉시 말하기 시작.
 *  contentComplete=true → 최종 프레임; 완전한 발화 신호.
 *  소켓이 OPEN이 아니면 조용히 무시 — 끼어들기 후 안전하게 호출 가능)
 *
 * @param {import('ws').WebSocket} ws
 * @param {number}  responseId      — echoed from response_required (response_required에서 반환)
 * @param {string}  content         — text for Retell TTS (Retell TTS용 텍스트)
 * @param {boolean} contentComplete — true signals utterance end (true는 발화 종료 신호)
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
