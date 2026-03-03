/**
 * Real-time WebSocket server for Retell AI Custom LLM integration.
 * Attaches to the existing Express HTTP server — no separate port needed.
 * (Retell AI 커스텀 LLM 연동을 위한 실시간 WebSocket 서버.
 *  기존 Express HTTP 서버에 부착 — 별도 포트 불필요)
 *
 * ── Retell Custom LLM WebSocket Protocol ──────────────────────────────────────
 *
 * Phone number acquisition — REST API, not WebSocket events:
 *   On connection the server immediately calls Retell's REST API
 *   (GET /v2/get-call/{callId}) to retrieve the caller's from_number.
 *   This eliminates the fragile dependency on the call_started WebSocket event,
 *   which Retell may fire AFTER response_required — or not at all — causing the
 *   previous "brain-dead / unresponsive" bug where every message was gated behind
 *   an event that never arrived, leaving Gemini permanently uninitialized.
 *
 * Initialization sequence:
 *   1. WS connection opens → _initSession fires immediately via _enqueueGeneration.
 *   2. REST API call retrieves from_number — no race condition with WS events.
 *   3. Any response_required frames that arrive during the ~300ms init window are
 *      buffered in session.messageQueue and replayed after init completes.
 *   4. After greeting, the buffer is drained in arrival order.
 *
 * The agent_id is passed by Retell as a URL query parameter:
 *   wss://host/llm-websocket/<call_id>?agent_id=<agent_id>
 * (전화번호 REST API 취득 — WebSocket 이벤트 의존 제거.
 *  연결 시 REST API(GET /v2/get-call/{callId})를 즉시 호출하여 from_number 취득.
 *  call_started가 response_required보다 늦거나 아예 오지 않는 경쟁 조건으로 인한
 *  "무반응" 버그 해결. 초기화 중 도착한 response_required는 messageQueue에 버퍼링,
 *  초기화 완료 후 순서대로 처리)
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

// Belt-and-suspenders dotenv load — ensures process.env is populated even when
// llmServer.js is evaluated before app.js's env.js import (e.g. during isolated tests).
// env.js is idempotent: dotenv/config is a no-op if the vars are already present.
// (방어적 dotenv 로드 — llmServer.js가 app.js의 env.js 임포트 이전에 평가될 때에도
//  process.env가 채워지도록 보장. dotenv/config는 이미 로드된 경우 no-op)
import '../config/env.js';
import { WebSocketServer }      from 'ws';
import { Retell }               from 'retell-sdk';
import { supabase }             from '../config/supabase.js';
import axios                    from 'axios';                        // HTTP client for Loyverse customer API (Loyverse 고객 API용 HTTP 클라이언트)
import { createGenerationModel } from '../services/llm/gemini.js';
import {
  sendOrderConfirmationEmail,
  sendReservationConfirmationEmail,
} from '../utils/mailer.js';

// WebSocket path — must match the path configured in Retell's agent dashboard
// (WebSocket 경로 — Retell 에이전트 대시보드에 설정된 경로와 일치해야 함)
const WS_PATH = '/llm-websocket';

// Gemini request timeout — abort any call that hasn't started streaming within this window
// (Gemini 요청 타임아웃 — 이 시간 내에 스트리밍이 시작되지 않으면 중단)
const GEMINI_TIMEOUT_MS = 15_000;

// Phone detection retry constants — Retell's database often takes ~1s after WS connect
// to populate customer_number, so 4 retries × 500ms gives up to 2s of polling headroom.
// Gemini initialisation is blocked until this loop finishes or all retries are exhausted.
// (전화번호 감지 재시도 상수 — Retell DB는 WS 연결 후 ~1초 지연으로 customer_number 기록.
//  4회×500ms = 최대 2초 폴링. Gemini 초기화는 이 루프가 완료되거나 소진될 때까지 대기)
const PHONE_RETRIES  = 4;
const PHONE_RETRY_MS = 500;

// Retell REST API key — used to fetch call details (from_number) on every new connection.
// Without this key the phone lookup returns null and CRM personalisation is skipped,
// but the call still connects and the AI responds normally.
// (연결 시 통화 상세 정보(from_number) 조회에 사용되는 Retell REST API 키.
//  미설정 시 전화번호 조회 실패 → CRM 개인화 생략, 통화 및 AI 응답은 정상 진행)
const RETELL_API_KEY = process.env.RETELL_API_KEY ?? '';

// Retell SDK client — instantiated once at module load when the API key is present.
// retellClient.call.retrieve(callId) is the officially supported way to fetch call
// metadata and is more reliable than a raw axios GET because the SDK handles auth
// headers, retryable HTTP errors, and typed response parsing internally.
// Set to null when RETELL_API_KEY is absent so _detectPhone can skip REST entirely.
// (모듈 로드 시 한 번 생성되는 Retell SDK 클라이언트.
//  call.retrieve()가 공식 지원 메서드 — 인증 헤더·재시도·타입 파싱을 SDK가 처리.
//  RETELL_API_KEY 미설정 시 null → _detectPhone이 REST를 건너뜀)
const retellClient = RETELL_API_KEY ? new Retell({ apiKey: RETELL_API_KEY }) : null;

// Boot-time guard — fires once when the module is first imported (server start).
// Without RETELL_API_KEY the phone lookup is permanently disabled for every call,
// so log a CRITICAL ERROR immediately rather than silently producing "phone: none" logs.
// (서버 시작 시 모듈 임포트 순간 한 번 실행되는 부팅 검증.
//  RETELL_API_KEY 없으면 모든 통화의 전화번호 조회가 영구 비활성화 — 즉시 치명 오류 로깅)
if (!RETELL_API_KEY) {
  console.error(
    '!!! CRITICAL ERROR: RETELL_API_KEY IS MISSING IN BACKEND .ENV !!! ' +
    'Phone lookup and CRM personalisation are DISABLED for ALL calls. ' +
    'Set RETELL_API_KEY in your .env file and restart the server. ' +
    '(치명 오류: .env에 RETELL_API_KEY 누락. 모든 통화의 전화번호 조회 및 CRM 개인화 비활성화. ' +
    '.env에 RETELL_API_KEY를 설정하고 서버를 재시작하세요)'
  );
}

// Greeting prompt — sent verbatim to chat.sendMessage() inside _initSession.
// This is the "silence breaker": it forces the AI to open the call without waiting
// for the user to speak. The 5-tier system instruction already contains CRM data,
// the store persona, and today's temporary instructions, giving the model everything
// it needs to produce a fully personalised, upsell-aware, schedule-aware greeting.
//
// Three-part greeting sequence (order matters for TTS naturalness):
//   1. GREET    — address the customer by name if CRM has one; warm generic otherwise.
//   2. UPSELL   — if a past order exists, offer their usual as a natural follow-up.
//   3. INFORM   — if today's temporary instructions are non-empty, announce them immediately.
//
// (chat.sendMessage()로 _initSession 내부에서 그대로 전송되는 인사말 프롬프트.
//  "침묵 타파자": AI가 사용자를 기다리지 않고 통화를 열도록 강제.
//  3단계 인사말: 이름 인사 → 이전 주문 업셀 → 오늘 임시 지시사항 안내)
const GREETING_PROMPT =
  'System: The call has just connected. Execute the three-part greeting sequence immediately — ' +
  'do NOT wait for the customer to speak first. ' +

  // Step 1 — personalised name greeting (이름 개인화 인사말)
  '(1) GREET: Check [CRM DATA]. If a Customer Name is present, open with a warm, natural greeting ' +
  'using their name (e.g., "Hi Sarah, welcome back!"). ' +
  'If no name is available, use a friendly generic opening (e.g., "Hi there, thanks for calling!"). ' +

  // Step 2 — last-order upsell offer (이전 주문 업셀 제안)
  '(2) UPSELL: If [CRM DATA] contains a Past Order, immediately follow up with a natural upsell offer ' +
  '(e.g., "Would you like your usual 2x Americano today?"). ' +
  'If no past order exists, skip this step silently. ' +

  // Step 3 — today's temporary instructions announcement (오늘의 임시 지시사항 안내)
  '(3) INFORM: Check [TODAY\'S TEMPORARY INSTRUCTIONS]. ' +
  'If the content is NOT "No special instructions for today.", announce it naturally right after the greeting ' +
  '(e.g., "Also, just so you know, our happy hour runs from 2pm to 5pm today!"). ' +
  'If the temporary instructions are empty or say "No special instructions for today.", skip this step silently. ' +

  'Deliver all applicable steps in one warm, flowing, conversational sentence or two. ' +
  'Never sound robotic or list-like. Do NOT use bullet points, numbers, or Markdown.';

// ── Global System Prompt ──────────────────────────────────────────────────────
//
// Defined at module level — shared across ALL tenant connections.
// Contains non-negotiable operational rules that every store must follow,
// regardless of the local persona configured in storeData.system_prompt.
// Placed as the first section in every finalSystemInstruction so it is the
// highest-priority instruction in the model's context window.
//
// Five rule groups:
//   STRICT RULES       — tool call gates (check_menu, create_order, make_reservation).
//   VOICE & OUTPUT     — TTS quality rules that ban Markdown and enforce conversational prose.
//                        Prevents asterisks, bullet points, and colon-separated lists from
//                        reaching the TTS engine and causing filler noises or awkward pauses.
//   CANCELLATION RULE  — graceful mid-conversation cancellation without executing any tools.
//   ERROR RECOVERY     — friendly retry guidance when a tool returns an error response.
//   RETENTION LOOP     — new-customer consent prompt after every successful order or reservation.
//
// (모듈 레벨에서 정의 — 모든 테넌트 연결에 공유.
//  storeData.system_prompt에 설정된 로컬 페르소나에 관계없이
//  모든 매장이 따라야 하는 비협상적 운영 규칙 포함.
//  모든 finalSystemInstruction의 첫 번째 섹션으로 배치하여
//  모델 컨텍스트 창에서 가장 높은 우선순위의 지시문으로 기능.
//  STRICT RULES: 도구 호출 게이트. VOICE & OUTPUT: 마크다운 금지 및 자연스러운 구어체 강제.
//  CANCELLATION RULE: 취소 처리. ERROR RECOVERY: 도구 오류 복구 안내.
//  RETENTION LOOP: 신규 고객 성공 후 개인정보 저장 동의 프롬프트.
//  TTS 엔진에 마크다운이 전달되어 발생하는 잡음 및 어색한 정지 방지)
const GLOBAL_SYSTEM_PROMPT =
  'You are an AI assistant. ' +

  // ── Tool call gates — when and how to invoke each tool ────────────────────
  // Rules updated for CRM-aware efficiency:
  //   - Known fields (name, phone, email) are read from [CRM DATA] automatically.
  //   - Only genuinely missing fields are collected from the caller.
  //   - A single "Is this correct?" confirmation is required before ANY tool call.
  //   - Every tool must be called EXACTLY ONCE after that confirmation.
  // (도구 호출 게이트 — CRM 인식 효율성 규칙 업데이트:
  //  알려진 필드는 [CRM DATA]에서 자동 사용. 누락된 필드만 수집.
  //  모든 도구 호출 전 단일 확인. 확인 후 도구는 정확히 한 번만 호출)
  'STRICT RULES: ' +

  // ── CRM pre-fill rule — do not re-ask for known information ───────────────
  // This rule has the highest priority within STRICT RULES.
  // (CRM pre-fill 규칙 — 알려진 정보를 다시 묻지 않음 — 최고 우선순위)
  'CRM PRE-FILL RULE (HIGHEST PRIORITY): Before collecting any customer details, ' +
  'check [CRM DATA] first. If Customer Name, Phone Number, or Email Address are already ' +
  'present in [CRM DATA], use them automatically — NEVER ask the customer to repeat them. ' +
  'Only ask for details that are genuinely missing from [CRM DATA]. ' +

  '1. Always use `check_menu` to verify stock before discussing any item or accepting any order. ' +

  // ── create_order gate ──────────────────────────────────────────────────────
  // (create_order 도구 호출 게이트)
  '2. For `create_order`: Apply CRM PRE-FILL RULE first. ' +
  'Collect ONLY the missing details from the customer: Items ordered (with quantities) and Total Amount are always required. ' +
  'Customer Name, Phone Number, and Email Address may already be in [CRM DATA] — do not ask for them if so. ' +
  'ONCE all details are assembled, read back a complete summary and ask "Is this correct?" exactly once. ' +
  'Call `create_order` ONCE and ONLY ONCE immediately after the customer explicitly confirms with "Yes". ' +
  'Never call `create_order` again for the same transaction. ' +

  // ── make_reservation gate ──────────────────────────────────────────────────
  // (make_reservation 도구 호출 게이트)
  '3. For `make_reservation`: Apply CRM PRE-FILL RULE first. ' +
  'You need 6 details total: Customer Name, Phone Number, Email Address, Date, Time, and Party Size. ' +
  'Use any values already in [CRM DATA] automatically — only ask for what is missing. ' +
  'ONCE all 6 details are confirmed, recite EXACTLY: ' +
  '"Let me confirm your reservation. [Name], for [Party Size] people on [Date] at [Time]. ' +
  'Phone [Phone], Email [Email]. Is this correct?" ' +
  'Call `make_reservation` ONCE and ONLY ONCE after they explicitly say "Yes". ' +
  'Never call `make_reservation` again for the same transaction. ' +

  // ── Universal confirmation and single-execution rules ─────────────────────
  // (범용 확인 및 단일 실행 규칙)
  'CONFIRMATION RULE: NEVER execute any tool without first summarizing ALL collected details ' +
  'and receiving an explicit "Yes" from the customer. ' +
  'SINGLE EXECUTION RULE: Once a tool has been called and returned a success response, ' +
  'the transaction is COMPLETE. Do NOT call the same tool again. ' +
  'Never call any tool based on assumed or unconfirmed information. ' +

  // ── Date/time calculation rule — prevents asking users for ISO format strings ─
  // The store's current local time is already injected in [STORE CONTEXT].
  // The AI must derive exact calendar dates internally from natural language like
  // "tomorrow" or "next Friday" — never expose ISO format requirements to the user.
  // (날짜/시간 계산 규칙 — ISO 형식 문자열을 사용자에게 요청하는 것을 방지.
  //  매장의 현재 현지 시각은 [STORE CONTEXT]에 이미 주입되어 있음.
  //  AI는 "내일", "다음 주 금요일" 같은 자연어에서 내부적으로 정확한 날짜를 계산해야 함.
  //  사용자에게 ISO 형식을 노출하면 안 됨)
  'CRITICAL DATE RULE: You MUST calculate the exact calendar date (YYYY-MM-DD) and time (HH:MM) ' +
  'INTERNALLY based on the Current Local Time in the STORE CONTEXT and the user\'s natural input ' +
  '(e.g., "tomorrow", "next Friday", "7pm"). ' +
  'NEVER, EVER ask the user to provide the date or time in YYYY-MM-DD or HH:MM formats. ' +
  'Always resolve the date yourself and confirm it back to the user in natural language ' +
  '(e.g., "Thursday, February 27th at 7 in the evening"). ' +

  // ── Voice output rules — critical for TTS call quality ────────────────────
  // Markdown syntax (asterisks, bullet points, colons) causes the TTS engine to
  // produce filler noises, robotic pauses, and unnatural character names like
  // "asterisk" or "dash". Every response must be clean, spoken-word prose.
  // Rule 3 addresses the deeper problem: even grammatically valid sentences can
  // sound robotic if information is presented as enumerated data rather than
  // woven into warm, human conversation. The example in rule 3 shows the target
  // speech pattern that avoids TTS artifacts on stores with no local persona.
  // (음성 출력 규칙 — TTS 통화 품질에 매우 중요.
  //  마크다운 문법(별표·불릿·콜론)은 TTS 엔진이 잡음, 로봇 같은 정지,
  //  "asterisk" 같은 부자연스러운 문자 이름을 출력하게 만듦.
  //  규칙 3은 더 근본적인 문제를 해결 — 문법적으로 올바른 문장도 데이터를 나열하면
  //  로봇처럼 들릴 수 있음. 규칙 3의 예시가 목표 발화 패턴을 보여줌)
  '[VOICE & OUTPUT FORMATTING RULES] ' +
  '1. NEVER use Markdown formatting. NO asterisks (**), NO bullet points (- or *), NO bold text. ' +
  '2. NEVER use vertical lists or colons for presenting data. ' +
  'For example, do NOT say "Name: John" — say "Your name is John" instead. ' +
  '3. CRITICAL VOICE RULE: You are a human-like voice assistant. ' +
  'NEVER speak in lists, bullet points, or raw data formats. ' +
  'ALWAYS synthesize information into warm, continuous, and natural conversational sentences. ' +
  'When reading back details, weave them together smoothly — for example: ' +
  '"Okay Michael, I have you down for 4 people tomorrow at 7 PM. Your number is 555-1234 and your email is michael@example.com." ' +
  'Do not use robotic phrasing. ' +
  '4. When confirming details, weave them into a single flowing sentence. ' +
  'For example: "Let me confirm. Your name is John, your phone number is 123-4567, and your email is john@example.com. Is that correct?" ' +
  '5. Use commas and periods for natural breathing pauses. Never use special characters as pauses. ' +

  // ── Phone number speaking rule — prevents country-code prefix and digit-cluster reading ─
  // TTS engines often read "5037079566" as a single large number or pause at unexpected
  // points. Digit-by-digit speech with natural grouping produces clear, human-sounding
  // telephone number recitation that callers can easily write down or repeat back.
  // (TTS 엔진이 전화번호를 큰 숫자로 읽거나 예상치 못한 위치에서 멈추는 것 방지.
  //  자연스러운 그룹 단위 숫자 낭독으로 발신자가 쉽게 받아쓰고 확인할 수 있게 함)
  '6. PHONE NUMBER RULE: When reciting any phone number, always speak it digit by digit naturally. ' +
  'Group the digits as area code, then exchange, then subscriber number — for example, say ' +
  '"five oh three, seven oh seven, nine five six six" — never "fifty oh three" or any other grouping. ' +
  'NEVER include country codes. Do NOT say "+1" or "one" before the number. ' +

  // ── Cancellation handling — prevents ghost tool calls when the user backs out ─────
  // If the user says "never mind", "forget it", "cancel that", or equivalent, the AI must
  // respond immediately and warmly WITHOUT invoking any pending tool call. Without this rule
  // the model may still fire create_order or make_reservation because an earlier confirmation
  // existed in the turn history. This rule takes priority over the STRICT RULES confirmation gates.
  // (취소 처리 — 사용자가 취소할 때 유령 도구 호출 방지.
  //  "됐어", "취소해줘" 같은 취소 신호 시 AI는 즉시 따뜻하게 응답하고 도구 호출 금지.
  //  이 규칙이 없으면 앞선 확인 기록을 근거로 도구를 계속 호출할 수 있음.
  //  이 규칙은 STRICT RULES 확인 게이트보다 우선 적용됨)
  'CANCELLATION RULE: If the user changes their mind or cancels an order or reservation halfway, ' +
  'acknowledge it immediately with a friendly tone — for example: ' +
  '"No problem, I\'ve canceled that. How else can I help you today?" ' +
  'DO NOT execute any tools after a cancellation. ' +
  'Never call `create_order` or `make_reservation` once the user has indicated they want to cancel or stop. ' +

  // ── Error recovery — shields the caller from raw system error messages ─────────────
  // executeFunctionCall returns { error: true, message: '...' } for unexpected failures
  // such as DB timeouts, network errors, or SDK crashes. This rule ensures the AI converts
  // that structured error payload into a natural, apologetic spoken response rather than
  // reading out a JSON field name or a raw error string to the caller.
  // (오류 복구 — 원시 시스템 오류 메시지를 사용자에게 노출하지 않도록 보호.
  //  executeFunctionCall은 DB 타임아웃, 네트워크 오류, SDK 충돌 등
  //  예상치 못한 실패에 대해 { error: true, message: '...' }를 반환.
  //  이 규칙은 AI가 그 페이로드를 자연스럽고 사과하는 음성 응답으로 변환하도록 보장.
  //  JSON 필드명이나 기술적 오류 문자열을 그대로 사용자에게 읽지 않도록 함)
  'ERROR RECOVERY: If a tool returns an "error" field in its response, ' +
  'do NOT expose technical details, error codes, or raw error messages to the user. ' +
  'Instead, gently apologize and say the system is experiencing a slight delay — for example: ' +
  '"I\'m sorry, the system is taking just a moment. Could you hold on briefly while I sort that out?" ' +
  'Then ask the user to wait a moment or try again. ' +

  // ── Retention Loop — consent-gated CRM save after successful tool execution ─────────────
  //
  // Fires ONLY when [CRM DATA] shows "New caller — no prior order history on file".
  //
  // PRIVACY / CONSENT RULE — this is a two-step sequence:
  //   Step 1: Ask for consent BEFORE saving anything.
  //   Step 2: Call `save_customer_consent` ONLY if the customer explicitly says "Yes".
  //
  // The save does NOT happen automatically — the `save_customer_consent` tool call is the
  // single gate that writes to the CRM and POS. Never skip Step 1. Never call the tool
  // without an explicit verbal "Yes" in Step 2.
  //
  // (리텐션 루프 — 동의 후에만 CRM 저장이 실행되는 2단계 프로세스.
  //  CRM DATA가 "New caller" 상태일 때만 발동.
  //  개인정보 보호 준수: 동의 없이 자동 저장 절대 금지.
  //  save_customer_consent 도구 호출이 유일한 저장 게이트 — 명시적 "예" 없이 호출 금지)
  'RETENTION LOOP (PRIVACY-COMPLIANT — TWO STEPS REQUIRED): ' +
  'After EVERY successful create_order or make_reservation for a NEW CUSTOMER ' +
  '(when [CRM DATA] shows "New caller — no prior order history on file"), proceed as follows: ' +

  // Step 1 — ask for consent (do not save yet)
  // (단계 1 — 동의 질문, 아직 저장하지 않음)
  'STEP 1 — ASK: Immediately follow the transaction confirmation with this warm, one-sentence ask: ' +
  '"Since it\'s your first time with us, would you like me to save your details for a faster experience next time?" ' +
  'Deliver it conversationally — benefit-focused, never robotic. Then WAIT for the customer\'s reply. ' +

  // Step 2 — act on the customer's answer
  // (단계 2 — 고객 답변에 따른 행동)
  'STEP 2 — ACT: ' +
  'If the customer says YES (or "sure", "please", "go ahead", or any affirmative): ' +
  'call `save_customer_consent` with their customer_name, customer_phone, and customer_email. ' +
  'After the tool returns success, respond warmly — for example: ' +
  '"Wonderful! You\'re all saved. Next time you call I\'ll know exactly who you are!" ' +
  'If the customer says NO (or "no thanks", "that\'s okay", or any decline): ' +
  'do NOT call `save_customer_consent`. Acknowledge warmly — for example: ' +
  '"Of course, no problem at all! It was truly a pleasure having you today." ' +
  'CRITICAL: NEVER call `save_customer_consent` without an explicit verbal "Yes" in Step 2. ' +
  'NEVER skip Step 1 for a new customer after a successful transaction. ' +
  'NEVER invent or assume consent — always wait for the customer\'s actual words.';

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
  //
  // REST-first initialization — no dependency on any WebSocket event ordering.
  //
  // Previous approach waited for a call_started WebSocket event to get the caller's
  // phone number. Root cause of the "brain-dead / unresponsive" bug:
  //   Retell fires response_required BEFORE call_started (or call_started may not
  //   arrive at all). All messages were gated behind session.initialized === true,
  //   which was set only in the call_started handler — so Gemini was never
  //   initialized and every incoming message was silently dropped.
  //
  // Fix: on connection, immediately call Retell's REST API to get from_number, then
  // run _initSession via _enqueueGeneration. Any response_required that arrives
  // during the ~300ms init window is buffered in session.messageQueue and drained
  // after init completes. No event ordering assumption is required.
  //
  // (REST 우선 초기화 — WebSocket 이벤트 순서에 대한 의존성 없음.
  //  이전 방식은 call_started WebSocket 이벤트를 기다려 전화번호를 취득함.
  //  근본 원인: Retell이 call_started보다 response_required를 먼저 발화하거나
  //  call_started가 아예 오지 않아 Gemini가 영구적으로 초기화되지 않는 버그.
  //  수정: 연결 즉시 REST API로 from_number를 취득하고 _initSession 즉시 실행.
  //  초기화 중 도착한 response_required는 messageQueue에 버퍼링 후 드레인)
  wss.on('connection', (ws, req) => {

    // ── Extract agent_id and call_id from URL ──────────────────────────────
    // Retell format: /llm-websocket/<call_id>?agent_id=<agent_id>
    // (Retell 형식: /llm-websocket/<call_id>?agent_id=<agent_id>)
    // Extract agent_id from query string and call_id from query string first,
    // falling back to the URL path segment (Retell embeds call_id in the path).
    // Both are logged immediately so we can confirm the correct call_id is captured
    // before any REST or CRM work begins.
    // (agent_id는 쿼리 문자열에서, call_id는 쿼리 문자열 우선 후 URL 경로 폴백으로 추출.
    //  REST/CRM 작업 전 올바른 call_id 캡처 확인을 위해 즉시 로깅)
    const { pathname, searchParams } = new URL(req.url, 'http://localhost');
    const agentId = searchParams.get('agent_id');
    const callId  = searchParams.get('call_id')
      ?? (pathname.slice(WS_PATH.length).replace(/^\//, '') || null);

    // Log call_id explicitly — this is the key used for all subsequent REST lookups.
    // If this shows 'none' or 'unknown', Retell is not sending call_id in the URL.
    // (call_id 명시 로깅 — 이후 모든 REST 조회의 키값.
    //  'none' 또는 'unknown' 표시 시 Retell이 URL에 call_id를 포함하지 않는 것)
    console.log('[Init] Connection established for Call ID:', callId ?? 'MISSING');
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

    // ── Session state ──────────────────────────────────────────────────────
    //
    // model / storeData — null until _initSession completes.
    //
    // initialized — set to true by _initSession just before it drains the buffer.
    //   While false, incoming response_required frames go into messageQueue instead
    //   of the generation queue, preventing handleTranscript from running before
    //   session.model exists.
    //
    // messageQueue — holds response_required frames that arrive during the ~300ms
    //   REST + CRM + model init window. Drained in order at the end of _initSession.
    //
    // callerPhone / crmData — written by _initSession after REST + CRM lookups.
    //
    // (model/storeData: _initSession 완료까지 null.
    //  initialized: _initSession이 버퍼 드레인 직전 true로 설정.
    //   false 동안 response_required는 messageQueue에 버퍼링 → session.model 없이
    //   handleTranscript 실행 방지.
    //  messageQueue: REST+CRM+모델 초기화 ~300ms 동안 도착한 response_required 보관.
    //  callerPhone/crmData: REST+CRM 조회 후 _initSession이 설정)
    const session = {
      agentId,
      callId,
      storeData:        null,
      model:            null,
      history:          [],
      isGenerating:     false,
      abortController:  null,
      generationQueue:  Promise.resolve(),
      initialized:      false,
      messageQueue:     [],
      callerPhone:      null,
      crmData:          null,
      // Layer 1 phone detection — populated by _extractPhoneFromPayload in the message handler.
      // _detectPhone checks this before every REST attempt so a WS-provided number is
      // used immediately without waiting for the REST round-trip to complete.
      // (레이어 1 전화번호 감지 — 메시지 핸들러에서 _extractPhoneFromPayload로 설정.
      //  _detectPhone이 REST 시도 전마다 확인, WS 제공 번호를 즉시 사용)
      wsPhone:          null,
      // Debug flag — set after the first WS frame is logged to avoid repeated full-payload dumps.
      // (디버그 플래그 — 첫 WS 프레임 로깅 후 true, 반복 전체 페이로드 덤프 방지)
      _firstMsgLogged:  false,
    };

    // ── Message Handler ────────────────────────────────────────────────────
    //
    // Registered synchronously so no messages are lost between connection and
    // the first event loop tick.
    //
    // While session.initialized is false (i.e., _initSession is still running),
    // response_required frames are buffered into session.messageQueue so the
    // user's first words are never dropped. They are replayed after init completes.
    // update_only and other types are discarded during init — nothing to abort yet.
    //
    // (동기적으로 등록 — 연결과 첫 이벤트 루프 사이에 메시지 유실 없음.
    //  session.initialized가 false인 동안 response_required는 messageQueue에 버퍼링.
    //  사용자의 첫 마디가 유실되지 않도록 초기화 완료 후 재처리.
    //  update_only 등은 초기화 중 폐기 — 아직 중단할 생성 없음)
    ws.on('message', (rawData) => {
      let msg;
      try {
        msg = JSON.parse(rawData.toString());
      } catch {
        console.error('[WS] Non-JSON frame — closing (JSON이 아닌 프레임 — 연결 종료)');
        ws.close(1003, 'Expected JSON');
        return;
      }

      // ── Layer 1: WS payload phone scan — runs on EVERY message ──────────
      // Log the very first Retell frame in full so we can see exactly what fields
      // Retell is sending (carrier config, from_number presence, call metadata).
      // Then deep-scan the object for from_number / customer_number regardless of
      // nesting depth, and store the first hit in session.wsPhone.
      // _detectPhone checks session.wsPhone before every REST attempt, so a number
      // found here short-circuits the REST call entirely.
      // (레이어 1: 모든 메시지에서 WS 페이로드 전화번호 스캔.
      //  첫 프레임 전체 로깅 — Retell이 전송하는 필드 확인.
      //  from_number/customer_number를 중첩 깊이 무관하게 스캔,
      //  첫 번째 결과를 session.wsPhone에 저장.
      //  _detectPhone이 REST 전에 session.wsPhone을 확인 → REST 불필요 시 단락 처리)
      if (!session._firstMsgLogged) {
        session._firstMsgLogged = true;
        console.log('[WS] Initial Payload:', JSON.stringify(msg, null, 2));
      }
      if (!session.wsPhone) {
        const wsFound = _extractPhoneFromPayload(msg);
        if (wsFound) {
          session.wsPhone = wsFound;
          console.log(
            `[WS] [${agentId}] Layer 1 (WS payload) detected phone: ${wsFound} ` +
            `(레이어 1 WS 페이로드 전화번호 감지: ${wsFound})`
          );
        }
      }

      // ── Pre-init buffer gate ──────────────────────────────────────────────
      // _initSession is still running (REST fetch + CRM + model creation ~300ms).
      // Buffer response_required so the user's first utterance is not dropped.
      // Discard everything else — barge-in has nothing to abort, other types are noise.
      // (초기화 진행 중 버퍼 게이트.
      //  response_required는 버퍼링 — 사용자의 첫 발화 유실 방지.
      //  나머지는 폐기 — 아직 중단할 생성 없음)
      if (!session.initialized) {
        if (msg.interaction_type === 'response_required') {
          session.messageQueue.push(msg);
          console.log(
            `[WS] [${agentId}] Buffered response_required (response_id: ${msg.response_id}) ` +
            `during init — will replay after greeting ` +
            `(초기화 중 response_required 버퍼링 — 인사말 후 재처리)`
          );
        }
        return;
      }

      // ── Post-init: update_only — barge-in check only ──────────────────────
      // Only abort when turntaking === 'user_turn': explicit signal the user is speaking
      // mid-response. Routine transcript state pushes must NOT abort active generation.
      // (초기화 후 update_only — 끼어들기 확인만.
      //  turntaking === 'user_turn'일 때만 중단 — 사용자가 응답 도중 말하는 명시적 신호.
      //  일반 transcript 상태 업데이트는 활성 생성을 중단하면 안 됨)
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

      // ── Post-init: response_required — enqueue a generation turn ─────────
      // The generationQueue serialises calls so no two turns run concurrently.
      // (response_required — 생성 턴 큐에 추가.
      //  generationQueue가 직렬화 — 두 턴이 동시에 실행되지 않음)
      if (msg.interaction_type === 'response_required') {
        const responseId = msg.response_id;
        const transcript = msg.transcript ?? [];

        // Create a fresh AbortController for this generation turn.
        // Captured in the closure so the queue entry can verify it hasn't been superseded.
        // (이번 생성 턴을 위한 새 AbortController 생성.
        //  클로저에서 캡처 — 더 새로운 response_required로 추월됐는지 큐 항목이 확인 가능)
        const controller = new AbortController();
        session.abortController = controller;

        _enqueueGeneration(session, agentId, () => {
          // Stale-generation check: skip if a newer response_required replaced our controller.
          // (추월 확인: 더 새로운 response_required가 컨트롤러를 교체한 경우 건너뜀)
          if (session.abortController !== controller) return Promise.resolve();
          return handleTranscript(ws, session, transcript, responseId, controller.signal);
        });

        return;
      }

      // All other types (call_started, call_ended, ping, etc.) — silently ignored
      // (그 외 타입 — 무시)
    });

    // ── Kick off initialization immediately ────────────────────────────────
    // _initSession is the first task enqueued, so it always runs before any
    // response_required that arrives during the ~300ms init window.
    // Those early frames are buffered above and replayed at the end of _initSession.
    // (_initSession이 첫 번째로 큐에 추가됨 — 초기화 중 도착한 response_required보다
    //  항상 먼저 실행. 초기 프레임은 위에서 버퍼링되어 _initSession 종료 시 재처리)
    _enqueueGeneration(session, agentId, () => _initSession(ws, session));

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
 * @param {object}   session
 * @param {string}   agentId    — for error logging (오류 로깅용)
 * @param {Function} taskFn     — () => Promise<void> (generation work to serialise)
 */
function _enqueueGeneration(session, agentId, taskFn) {
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

// ── Triple-Layer Phone Detection ──────────────────────────────────────────────
//
// Three escalating layers resolve the caller's phone number:
//
//   Layer 1 — WS payload scan (session.wsPhone):
//     The message handler deep-scans every Retell frame for from_number /
//     customer_number and stores the first hit in session.wsPhone. Checked at
//     the top of every _detectPhone retry so a WS-provided number is used
//     immediately, skipping the REST call entirely.
//
//   Layer 2 — REST API with retry (up to 3 attempts, 200ms apart):
//     Retell's call record sometimes populates from_number with a slight delay
//     after the WebSocket connects. Three retries with a 200ms pause compensate
//     for this race condition without adding a fixed up-front penalty.
//
//   Layer 3 — Normalisation:
//     Strips country code, spaces, dashes, and parentheses; validates that the
//     result is a 10-digit NANP number before returning it.
//
// (3단계 에스컬레이션으로 발신자 전화번호 취득.
//  레이어 1: WS 페이로드 스캔 (session.wsPhone) — REST 불필요 시 즉시 반환.
//  레이어 2: REST API 최대 3회 재시도 (200ms 간격) — Retell 메타데이터 지연 보상.
//  레이어 3: 국가 코드·공백·대시 제거, 10자리 NANP 검증)

/**
 * Recursively scan any Retell WebSocket payload for a phone number field.
 *
 * Field priority (Retell V2 API):
 *   1. customer_number — the primary caller phone field in Retell V2 (발신자 번호 주 필드)
 *   2. from_number     — legacy / fallback field kept for compatibility (구 필드, 호환성 폴백)
 *
 * At each object level, customer_number is checked before from_number before recursing
 * into child objects. Maximum nesting depth: 6.
 *
 * Called by the message handler on every incoming Retell frame to populate session.wsPhone.
 *
 * (Retell WebSocket 페이로드를 재귀적으로 스캔하여 전화번호 필드를 찾음.
 *  필드 우선순위: customer_number(Retell V2 주 필드) → from_number(구 호환 필드).
 *  각 객체 레벨에서 customer_number를 먼저 확인, 없으면 from_number, 없으면 자식 객체 재귀.
 *  메시지 핸들러가 모든 수신 프레임에서 호출하여 session.wsPhone을 설정. 최대 깊이 6)
 *
 * @param {unknown} obj
 * @param {number}  [depth=0]
 * @returns {string|null}
 */
function _extractPhoneFromPayload(obj, depth = 0) {
  if (depth > 6 || obj === null || typeof obj !== 'object') return null;

  // Check customer_number first — Retell V2 primary caller phone field.
  // (customer_number 먼저 확인 — Retell V2 발신자 번호 주 필드)
  if (obj.customer_number) return String(obj.customer_number);

  // Fall back to from_number for older Retell payloads / edge cases.
  // (from_number 폴백 — 구 Retell 페이로드 또는 예외 케이스)
  if (obj.from_number) return String(obj.from_number);

  // Neither field at this level — recurse into child objects.
  // (현재 레벨에 필드 없음 — 자식 객체 재귀 탐색)
  for (const key of Object.keys(obj)) {
    const nested = _extractPhoneFromPayload(obj[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

/**
 * Layer 3 — Aggressive phone normalisation.
 * Strips all non-digit characters, takes the last 10 digits (removes +1 country prefix),
 * and returns the original trimmed string if it yields exactly 10 digits.
 * Returns null if the input is absent or yields fewer than 10 digits.
 * (레이어 3 — 공격적 전화번호 정규화.
 *  비숫자 문자 제거 후 마지막 10자리 추출 (+1 국가 코드 제거).
 *  정확히 10자리이면 원본 트리밍 문자열 반환, 10자리 미만이면 null)
 *
 * @param {string|null} raw
 * @returns {string|null}
 */
function _normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '').slice(-10);
  return digits.length === 10 ? raw.trim() : null;
}

/**
 * Format a validated NANP phone number as the human-readable XXX-XXX-XXXX string.
 *
 * Strips any leading '+1' or '1' country code and all non-numeric characters,
 * then inserts dashes at standard NANP positions (area code, exchange, subscriber).
 * This format is used for CRM queries (wildcard matching), the AI prompt, and logs.
 *
 * Returns null if the result does not contain exactly 10 digits after stripping.
 *
 * Examples:
 *   "+15037079566"   → "503-707-9566"
 *   "15037079566"    → "503-707-9566"
 *   "(503) 707-9566" → "503-707-9566"
 *   "5037079566"     → "503-707-9566"
 *
 * (NANP 전화번호를 사람이 읽기 쉬운 XXX-XXX-XXXX 형식으로 변환.
 *  +1 또는 1 국가 코드 및 비숫자 문자 제거 후 표준 위치에 대시 삽입.
 *  CRM 조회, AI 프롬프트, 로그에 이 형식 사용. 10자리 아니면 null 반환)
 *
 * @param {string|null} rawNumber
 * @returns {string|null}
 */
function formatPhoneNumber(rawNumber) {
  if (!rawNumber) return null;
  // Strip all non-digit characters, then take the last 10 digits to remove country code.
  // (비숫자 문자 제거 후 마지막 10자리 추출 — 국가 코드 제거)
  const digits = String(rawNumber).replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return null;
  // Insert dashes: NXX-NXX-XXXX (NANP standard dash-separated format)
  // (대시 삽입 — NANP 표준 XXX-XXX-XXXX 형식)
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Layer 2 helper — single SDK attempt to retrieve the caller's phone from Retell.
 *
 * Uses the official `retell-sdk` client (`retellClient.call.retrieve`) instead of
 * raw axios so that SDK-level auth, typed response parsing, and built-in error
 * normalisation are handled transparently.
 *
 * Field priority mirrors _extractPhoneFromPayload:
 *   1. customer_number — Retell V2 primary caller phone field (발신자 번호 주 필드)
 *   2. from_number     — legacy fallback field (구 필드 폴백)
 *
 * Returns the raw phone string, or null on SDK error or missing fields.
 * Errors are caught and logged — never thrown; fetchRealPhoneNumber drives retries.
 *
 * (레이어 2 헬퍼 — 공식 retell-sdk 클라이언트로 발신자 번호 단일 시도.
 *  raw axios 대신 SDK 사용 — 인증·타입 파싱·오류 정규화를 SDK가 처리.
 *  필드 우선순위: customer_number → from_number.
 *  오류 시 catch 후 로깅, null 반환. throw 안 함 — fetchRealPhoneNumber가 재시도 처리)
 *
 * @param {string} callId
 * @returns {Promise<string|null>}
 */
async function _restFetchPhone(callId) {
  try {
    // retellClient.call.retrieve() is the official Retell SDK method for fetching
    // a single call record by ID — equivalent to GET /v2/get-call/{callId}.
    // (retellClient.call.retrieve()는 통화 레코드를 ID로 조회하는 공식 SDK 메서드.
    //  GET /v2/get-call/{callId}와 동일)
    const call = await retellClient.call.retrieve(callId);

    // Log both fields so we can see exactly what Retell returns on every attempt.
    // This is the primary diagnostic for "phone: none" issues.
    // (두 필드 모두 로깅 — Retell이 정확히 무엇을 반환하는지 확인.
    //  "phone: none" 문제의 핵심 진단 로그)
    console.log(
      `[Init] SDK call.retrieve — customer_number: ${call.customer_number ?? 'none'} | ` +
      `from_number: ${call.from_number ?? 'none'} ` +
      `(SDK 응답 — customer_number: ${call.customer_number ?? 'none'} | from_number: ${call.from_number ?? 'none'})`
    );

    // customer_number is the Retell V2 primary field for the caller's phone number.
    // from_number is retained as a fallback for older Retell API versions or edge cases.
    // (customer_number가 Retell V2 발신자 번호 주 필드.
    //  from_number는 구 API 버전 또는 예외 케이스를 위한 폴백)
    return call.customer_number ?? call.from_number ?? null;
  } catch (err) {
    console.error(
      `[Init] SDK call.retrieve(${callId}) failed (SDK 호출 실패):`, err.message
    );
    return null;
  }
}

/**
 * Aggressive retry loop for Retell phone acquisition.
 *
 * Retell's database often takes ~800ms after the WebSocket opens to populate
 * customer_number. This function polls up to PHONE_RETRIES times with PHONE_RETRY_MS
 * gaps, logging every attempt via [CRM Trace] so the latency can be measured.
 *
 * Field priority (mirrors _extractPhoneFromPayload and _restFetchPhone):
 *   1. customer_number — Retell V2 primary field (V2 발신자 번호 주 필드)
 *   2. from_number     — legacy fallback (구 필드 폴백)
 *
 * Returns the first non-null raw phone string, or null after all retries are exhausted.
 * Does NOT normalise — the caller must pass the result through _normalizePhone.
 *
 * (공격적 재시도 전화번호 취득 함수.
 *  최대 PHONE_RETRIES회, PHONE_RETRY_MS 간격으로 REST 폴링.
 *  각 시도마다 [CRM Trace] 로그. 정규화는 호출자 책임)
 *
 * @param {string} callId
 * @returns {Promise<string|null>}
 */
async function fetchRealPhoneNumber(callId) {
  for (let n = 1; n <= PHONE_RETRIES; n++) {
    // Single REST attempt — returns raw customer_number ?? from_number ?? null.
    // (단일 REST 시도 — raw customer_number ?? from_number ?? null 반환)
    const raw = await _restFetchPhone(callId);
    console.log(
      `[CRM Trace] Retry #${n} for Call ID ${callId}... Result: ${raw ?? 'none'} ` +
      `(재시도 #${n} — 결과: ${raw ?? 'none'})`
    );

    if (raw && raw !== 'none') {
      // Found a non-empty phone — report success and return immediately.
      // (비어있지 않은 전화번호 획득 — 즉시 성공 로그 출력 후 반환)
      console.log(
        `[CRM Trace] SUCCESS! Captured Real Phone: ${raw} ` +
        `(성공! 실제 전화번호 획득: ${raw})`
      );
      return raw;
    }

    if (n < PHONE_RETRIES) {
      // Retell DB not yet populated — wait before next attempt.
      // (Retell DB 미기록 — 다음 시도 전 대기)
      await new Promise((resolve) => setTimeout(resolve, PHONE_RETRY_MS));
    }
  }

  // All retries exhausted — return null, caller handles anonymous fallback.
  // (모든 재시도 소진 — null 반환, 호출자가 익명 처리)
  return null;
}

/**
 * Triple-Layer phone detection — orchestrates Layer 1 (WS), Layer 2 (REST + retry),
 * and Layer 3 (normalisation) to resolve the caller's phone number reliably.
 *
 * Layer 1 is checked at the TOP of every retry iteration so a WS-provided phone
 * that arrives between REST attempts is captured without waiting for the next call.
 *
 * (3단계 전화번호 감지 오케스트레이션.
 *  레이어 1(WS), 레이어 2(REST+재시도), 레이어 3(정규화)으로 안정적인 전화번호 취득.
 *  각 재시도 반복 시작 시 레이어 1 재확인 — REST 사이에 도착한 WS 번호를 즉시 반환)
 *
 * @param {object} session  — live session (wsPhone may be populated by message handler)
 * @param {string} callId
 * @returns {Promise<string|null>}
 */
async function _detectPhone(session, callId) {
  if (!callId) {
    console.warn('[Init] callId missing — cannot detect phone (callId 없음 — 전화번호 감지 불가)');
    return null;
  }

  // No REST key: still check Layer 1 in case the WS payload already provided the number.
  // (REST 키 없음: WS 페이로드에서 제공된 번호가 있으면 레이어 1에서 반환)
  if (!RETELL_API_KEY) {
    console.warn('[Init] RETELL_API_KEY not set — REST skipped, checking WS payload only (RETELL_API_KEY 미설정 — REST 생략, WS 페이로드만 확인)');
    const normalized = _normalizePhone(session.wsPhone);
    if (normalized) {
      console.log(`[Init] Layer 1 (WS payload, no API key) phone: ${normalized} (레이어 1 전화번호 사용)`);
    }
    return normalized;
  }

  // Layer 1 — check WS payload first (populated by message handler's deep scan).
  // Fastest path: if the very first WS frame already carried customer_number, use it now.
  // (레이어 1 — 메시지 핸들러 딥 스캔으로 WS 페이로드 먼저 확인.
  //  가장 빠른 경로: 첫 WS 프레임에 customer_number 포함 시 즉시 반환)
  if (session.wsPhone) {
    const normalized = _normalizePhone(session.wsPhone);
    if (normalized) {
      console.log(
        `[Init] [${new Date().toISOString()}] Layer 1 (WS payload) provided phone: ${normalized} ` +
        `(레이어 1 WS 페이로드 전화번호 감지)`
      );
      return normalized;
    }
  }

  // Layer 2 — aggressive REST polling via fetchRealPhoneNumber.
  // Retell's DB may take ~800ms after WS connect to populate customer_number;
  // fetchRealPhoneNumber polls up to PHONE_RETRIES × PHONE_RETRY_MS to compensate.
  // (레이어 2 — fetchRealPhoneNumber 공격적 REST 폴링.
  //  Retell DB가 WS 연결 후 ~800ms 지연될 수 있음 — PHONE_RETRIES×PHONE_RETRY_MS 폴링으로 보완)
  console.log(
    `[Init] [${new Date().toISOString()}] Layer 2 (REST) starting ${PHONE_RETRIES}-attempt poll ` +
    `for call: ${callId} (레이어 2 REST — ${PHONE_RETRIES}회 폴링 시작)`
  );
  const raw = await fetchRealPhoneNumber(callId);
  if (raw) {
    const normalized = _normalizePhone(raw);
    if (normalized) {
      console.log(
        `[Init] [${new Date().toISOString()}] Layer 2 (REST) resolved phone: ${normalized} ` +
        `(레이어 2 REST 전화번호 취득 완료)`
      );
      return normalized;
    }
  }

  // All layers exhausted — log critical warning and return null.
  // The call still connects; the AI treats the caller as anonymous.
  // (모든 레이어 소진 — 치명 경고 기록 후 null 반환.
  //  통화는 정상 연결, AI는 발신자를 익명으로 처리)
  console.error(
    `[CRITICAL] Phone number still missing after ${PHONE_RETRIES} REST retries. ` +
    'This might be a carrier/telephony config issue. ' +
    `(${PHONE_RETRIES}회 REST 재시도 후에도 전화번호 없음. 통신사/전화 설정 문제일 수 있음)`
  );
  return null;
}

// ── Session Initialiser ───────────────────────────────────────────────────────

/**
 * Initialise the per-call Gemini session immediately on WebSocket connection.
 *
 * Called exactly once per call via _enqueueGeneration so it is the first task
 * in the serialised generation queue. Any response_required that arrives during
 * init is buffered in session.messageQueue and drained at the end of this function.
 *
 * Sequential steps (order is required — storeId needed before CRM lookup):
 *   1. _detectPhone        — Triple-Layer detection (WS scan + REST retry + normalisation).
 *   2. fetchStoreData      — loads tenant config; storeData.id is the storeId for step 3.
 *   3. getCustomerCrmData  — CRM lookup using caller phone + resolved storeId.
 *   4. buildMasterPrompt   — assembles the 5-tier system instruction with CRM data.
 *   5. createGenerationModel — initialises the Gemini model with the full prompt.
 *   6. chat.sendMessage()  — fires the proactive greeting via a disposable ChatSession.
 *   7. Drain messageQueue  — replay any response_required frames that arrived during init.
 *
 * (WebSocket 연결 즉시 통화별 Gemini 세션 초기화.
 *  _enqueueGeneration을 통해 직렬화된 생성 큐의 첫 번째 작업으로 실행.
 *  초기화 중 도착한 response_required는 messageQueue에 버퍼링되어 함수 종료 시 드레인.
 *  순차 단계: REST 전화번호 취득 → 스토어 설정 → CRM 조회 → 5단계 프롬프트 → 모델 초기화 → 인사말 → 버퍼 드레인)
 *
 * @param {import('ws').WebSocket} ws
 * @param {object} session
 */
async function _initSession(ws, session) {
  const { agentId } = session;

  // Step 1: Triple-Layer phone detection — resolves the caller's real from_number.
  //
  // Layer 1 (WS payload): session.wsPhone may already be populated by the message
  //   handler if a Retell frame carrying from_number/customer_number arrived while
  //   this function was waiting to be picked up from the generation queue.
  //
  // Layer 2 (REST + retry): Retell's call record sometimes populates from_number with
  //   a slight delay after the WebSocket opens. Up to 3 REST attempts with 200ms gaps
  //   compensate for this race condition. Layer 1 is re-checked before each attempt.
  //
  // Layer 3 (normalisation): strips country code, validates 10-digit NANP.
  //
  // Web dashboard / test-chat calls will exhaust all layers and return null — that is
  // expected. The call still connects; the AI treats the caller as anonymous.
  //
  // (단계 1: 3단계 전화번호 감지 + XXX-XXX-XXXX 형식 변환.
  //  레이어 1: session.wsPhone 확인 (메시지 핸들러 WS 스캔).
  //  레이어 2: REST API 최대 4회 재시도 (500ms 간격), 각 시도마다 [CRM Trace] 로그.
  //  레이어 3: 국가 코드 제거, 10자리 NANP 검증.
  //  포맷팅: 감지 즉시 XXX-XXX-XXXX 변환 — CRM 조회 및 AI 프롬프트에 사용.
  //  웹 대시보드/테스트 채팅은 모든 레이어 소진 후 null 반환 — 정상 동작)
  const rawPhone = await _detectPhone(session, session.callId);
  // Format to XXX-XXX-XXXX immediately after detection — before CRM and prompt use.
  // formatPhoneNumber strips country code and returns the dash-separated NANP string.
  // (감지 즉시 XXX-XXX-XXXX 형식 변환 — CRM 조회 및 프롬프트 조립 전.
  //  formatPhoneNumber가 국가 코드를 제거하고 대시 구분 NANP 문자열 반환)
  const phone = formatPhoneNumber(rawPhone);
  session.callerPhone = phone;

  // Step 2: Fetch store config — provides storeId required for the CRM query below.
  // (단계 2: 스토어 설정 조회 — 아래 CRM 조회에 필요한 storeId 제공)
  const storeData = await fetchStoreData(agentId);
  if (!storeData) {
    console.error(
      `[WS] [${agentId}] No store found for agent — closing connection ` +
      `(에이전트에 대한 매장 없음 — 연결 종료)`
    );
    ws.close(1008, `No store found for agent_id: ${agentId}`);
    return;
  }
  session.storeData = storeData;

  // Log the raw temporary_prompt value loaded from the DB so its presence or absence
  // is visible in the server output before the master prompt is assembled.
  // (DB에서 불러온 temporary_prompt 값을 마스터 프롬프트 조립 전에 서버 출력에 기록.
  //  값이 있는지 없는지 즉시 확인 가능)
  console.log('[Prompt Debug] Loaded Temporary Prompt: ', storeData.temporary_prompt);

  // Step 3: CRM lookup — only attempted when a real Caller ID was received.
  // Web dashboard calls (phone === null) skip this entirely — no fake number substitution.
  // Soft failure: null on DB error; call proceeds normally without personalisation.
  // (단계 3: 실제 발신자 번호가 있을 때만 CRM 조회 실행.
  //  웹 대시보드 통화(phone === null)는 완전 생략 — 가짜 번호 대체 없음.
  //  DB 오류 시 null 반환; 통화는 개인화 없이 정상 진행)
  let crm = null;
  if (phone) {
    console.log(
      `[WS] REAL Caller ID received from Retell: ${phone} — running CRM lookup ` +
      `(Retell로부터 실제 발신자 번호 수신 — CRM 조회 실행)`
    );
    crm = await getCustomerCrmData(phone, storeData.id);
  } else {
    console.log(
      '[WS] No Caller ID detected (web / dashboard call) — skipping CRM lookup ' +
      '(발신자 번호 없음 — 웹/대시보드 통화로 판단, CRM 조회 생략)'
    );
  }
  session.crmData = crm;

  // Steps 4 + 5: Assemble 5-tier master prompt then create the Gemini model.
  // CRM data is now available so the greeting can reference returning customers by name.
  // (단계 4 + 5: 5단계 마스터 프롬프트 조립 후 Gemini 모델 생성.
  //  CRM 데이터가 이제 가용 — 인사말이 재방문 고객을 이름으로 참조 가능)
  const masterPrompt = buildMasterPrompt(storeData, crm, phone);
  session.model = createGenerationModel(masterPrompt);

  // Surveillance logs — confirm CRM hit and inspect the exact prompt sent to Gemini.
  // (감시 로그 — CRM 히트 확인 및 Gemini에 전송되는 정확한 프롬프트 검사)
  console.log('[CRM DATA FOUND]:', crm);
  console.log(
    '========== [FINAL SYSTEM PROMPT TO GEMINI] ==========\n',
    masterPrompt,
    '\n====================================================='
  );
  console.log(
    `[WS] [${agentId}] Init complete | store: ${storeData.name ?? '(unnamed)'} | ` +
    `phone: ${phone ?? 'none'} | returning customer: ${!!crm} | ` +
    `name: ${crm?.customerName ?? 'unknown'} ` +
    `(초기화 완료 | 재방문 고객: ${!!crm} | 이름: ${crm?.customerName ?? 'unknown'})`
  );

  // Step 6: Force the proactive greeting via chat.sendMessage() — the silence breaker.
  //
  // A disposable ChatSession is created from session.model. The greeting exchange is NOT
  // added to session.history so it does not pollute the ongoing conversation context.
  //
  // Why chat.sendMessage() instead of generateContentStream():
  //   The greeting is a single short utterance (1-2 sentences). Non-streaming is
  //   acceptable at this stage and eliminates AbortController complexity.
  //
  // (단계 6: chat.sendMessage()를 통한 선제적 인사말 강제 발화 — 침묵 타파.
  //  session.model로 일회성 ChatSession 생성. 인사말 교환은 session.history에 추가되지 않아
  //  진행 중인 대화 컨텍스트를 오염시키지 않음.
  //  인사말은 짧은 단일 발화(1-2문장)이므로 비스트리밍이 허용됨)
  session.isGenerating = true;
  try {
    const chat = session.model.startChat({ history: [] });
    const result = await chat.sendMessage([{ text: GREETING_PROMPT }]);
    const greetingText = result.response.text();
    if (greetingText && ws.readyState === ws.OPEN) {
      sendChunk(ws, 0, greetingText, true); // Deliver greeting as a single complete utterance (인사말을 단일 완성 발화로 전달)
    }
    console.log(
      `[WS] [${agentId}] Initialization complete. Proactive greeting sent. ` +
      `(초기화 완료. 선제적 인사말 발화)`
    );
  } catch (err) {
    console.error(`[WS] [${agentId}] Greeting error (인사말 오류):`, err);
    // Send static fallback so Retell's TTS pipeline is not left hanging (Retell TTS 파이프라인이 대기 상태로 남지 않도록 정적 폴백 전송)
    if (ws.readyState === ws.OPEN) {
      sendChunk(ws, 0, "Hello! I'm your voice assistant. How can I help you today?", true);
    }
  } finally {
    session.isGenerating = false; // ALWAYS released — cannot be skipped (항상 해제 — 건너뛸 수 없음)
  }

  // Step 7: Open the gate and drain buffered messages.
  //
  // Set initialized BEFORE draining so the live message handler stops buffering
  // and routes new response_required frames directly into the generation queue.
  // Then replay any frames that arrived during the init window in arrival order.
  // Each replayed response_required is enqueued — the generation queue ensures
  // they run sequentially after the greeting.
  //
  // (단계 7: 게이트 열고 버퍼 드레인.
  //  드레인 전에 initialized = true 설정 — 이후 도착하는 response_required는
  //  직접 생성 큐에 추가됨. 초기화 중 버퍼링된 프레임을 도착 순서대로 재처리.
  //  생성 큐가 직렬화 보장 — 인사말 이후 순차 실행)
  session.initialized = true;

  const buffered = session.messageQueue.splice(0);
  if (buffered.length > 0) {
    console.log(
      `[WS] [${agentId}] Draining ${buffered.length} buffered message(s) from init window ` +
      `(초기화 창에서 버퍼링된 메시지 ${buffered.length}개 드레인)`
    );
    for (const qMsg of buffered) {
      if (qMsg.interaction_type === 'response_required') {
        const controller = new AbortController();
        session.abortController = controller;
        const responseId  = qMsg.response_id;
        const transcript  = qMsg.transcript ?? [];
        _enqueueGeneration(session, agentId, () => {
          if (session.abortController !== controller) return Promise.resolve();
          return handleTranscript(ws, session, transcript, responseId, controller.signal);
        });
      }
    }
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

  // ── check_menu ─────────────────────────────────────────────────────────────
  // Query menu_items live from the DB using the session's resolved store_id.
  // Returns item_id (variant_id), name, price, and stock_quantity for every item.
  // Gemini uses this data to verify stock before offering items to the caller.
  // (세션의 store_id로 DB에서 menu_items 실시간 조회.
  //  모든 항목의 item_id, name, price, stock_quantity 반환.
  //  Gemini는 이 데이터로 주문 접수 전 재고 확인)
  if (fnName === 'check_menu') {
    // Error boundary — catches unexpected thrown exceptions (network timeout, SDK crash, etc.)
    // that are not handled by the explicit Supabase error check below.
    // Never throws from executeFunctionCall: the outer finally in handleTranscript must
    // always release isGenerating regardless of what happens inside this function.
    // (오류 경계 — 아래 명시적 Supabase 오류 확인에서 처리되지 않는 예상치 못한 예외 캐치.
    //  executeFunctionCall에서 절대 throw 금지 — handleTranscript의 외부 finally가
    //  이 함수 내부에서 발생하는 일에 관계없이 항상 isGenerating을 해제해야 함)
    try {
      console.log(
        `[WS] [${session.agentId}] check_menu | store_id: ${session.storeData.id} ` +
        `(메뉴 조회 | 매장: ${session.storeData.id})`
      );

      const { data: rows, error } = await supabase
        .from('menu_items')
        .select('variant_id, name, price, stock_quantity')
        .eq('store_id', session.storeData.id);

      if (error) {
        console.error(`[WS] [${session.agentId}] check_menu DB error (메뉴 조회 DB 오류):`, error);
        return { error: 'Menu is temporarily unavailable. Please try again shortly.' };
      }

      // Map variant_id to item_id — consistent with the AI endpoint convention
      // (variant_id를 item_id로 매핑 — AI 엔드포인트 규칙과 일치)
      const menu = (rows ?? []).map((row) => ({
        item_id:        row.variant_id,
        name:           row.name,
        price:          row.price,
        stock_quantity: row.stock_quantity ?? 0,
      }));

      console.log(
        `[WS] [${session.agentId}] check_menu success | items: ${menu.length} ` +
        `(메뉴 조회 성공 | 항목 수: ${menu.length})`
      );

      return { menu };

    } catch (err) {
      // Unexpected error — log with full stack and return a standardised recovery payload.
      // Gemini will convert this into an apologetic spoken sentence per the ERROR RECOVERY rule.
      // (예상치 못한 오류 — 전체 스택 로깅 후 표준 복구 페이로드 반환.
      //  ERROR RECOVERY 규칙에 따라 Gemini가 이를 사과 음성 문장으로 변환)
      console.error(
        `[WS] [${session.agentId}] check_menu unexpected error (check_menu 예상치 못한 오류):`, err
      );
      return {
        error:   true,
        message: 'System timeout or API failure. Please ask the user to wait a moment and try again.',
      };
    }
  }

  // ── create_order (ACTIVE) ──────────────────────────────────────────────────
  // Insert a confirmed order row using exact item_ids returned by check_menu.
  // store_id comes from the session — Gemini must NOT pass it as an argument.
  // Pipeline: DB insert → build mock payment URL → return result to Gemini.
  // (check_menu가 반환한 정확한 item_id를 사용하여 확정된 주문 삽입.
  //  store_id는 세션에서 가져옴 — Gemini가 인수로 전달하면 안 됨.
  //  DB 삽입 → 목 결제 URL 생성 → Gemini에 결과 반환)
  if (fnName === 'create_order') {
    // Error boundary — catches unexpected thrown exceptions (network timeout, SDK crash, etc.)
    // that slip past the explicit Supabase error checks in each pipeline step below.
    // Never throws from executeFunctionCall: the outer finally in handleTranscript must
    // always release isGenerating regardless of what happens inside this function.
    // (오류 경계 — 아래 각 파이프라인 단계의 명시적 Supabase 오류 확인을 통과하는
    //  예상치 못한 예외(네트워크 타임아웃, SDK 충돌 등) 캐치.
    //  executeFunctionCall에서 절대 throw 금지 — handleTranscript의 외부 finally가
    //  이 함수 내부에서 발생하는 일에 관계없이 항상 isGenerating을 해제해야 함)
    try {
    console.log(
      `[WS] [${session.agentId}] create_order | name: ${fnArgs.customer_name} | ` +
      `phone: ${fnArgs.customer_phone} | email: ${fnArgs.customer_email} | ` +
      `items: ${JSON.stringify(fnArgs.items)} (주문 접수 시도)`
    );

    // ── Mechanical Lock — second fence: block if customer confirmation is not set ─
    // The schema description is the first fence — instructs Gemini not to call this tool
    // until user_explicit_confirmation is true. This guard is the second fence: it
    // protects against model hallucination, schema drift, and future API surface changes
    // that could allow the tool to fire before the customer has verbally confirmed.
    // Returning a structured error (not throwing) so executeFunctionCall never propagates
    // to the outer catch and the isGenerating lock is always released by the outer finally.
    // (기계적 잠금 두 번째 방어선: 고객 확인이 설정되지 않은 경우 차단.
    //  스키마 설명이 첫 번째 방어선 — user_explicit_confirmation이 true가 될 때까지 도구 호출 금지 지시.
    //  이 가드는 두 번째 방어선 — 모델 환각, 스키마 드리프트, API 변경으로 인한 우회 방지.
    //  구조화된 오류 반환(throw 아님) — executeFunctionCall이 외부 catch로 전파되지 않도록 하고
    //  isGenerating 잠금이 항상 외부 finally로 해제되도록 보장)
    if (fnArgs.user_explicit_confirmation !== true) {
      console.warn(
        `[WS] [${session.agentId}] create_order blocked — user_explicit_confirmation not true ` +
        `(주문 차단 — 사용자 명시적 확인 없음)`
      );
      return {
        error: "REJECTED. You must recite the FULL summary and ask 'Is this correct?'. Do NOT call this tool until the user says YES.",
      };
    }

    // ── Step 1: Validate that Gemini provided all required customer fields ────
    // Reject early so Gemini gets a clear error message it can voice to the caller.
    // (모든 필수 고객 필드 제공 여부 검증 — Gemini가 고객에게 안내할 명확한 오류 메시지 반환)
    if (!fnArgs.customer_name || !fnArgs.customer_phone || !fnArgs.customer_email) {
      console.warn(
        `[WS] [${session.agentId}] create_order rejected — missing customer fields ` +
        `(주문 거부 — 고객 필드 누락)`
      );
      return {
        success: false,
        error:   'Missing customer details. Please collect the customer\'s name, phone number, and email address before placing the order.',
      };
    }

    // ── Step 2: Fetch menu records to enrich items with names and prices ─────
    // Batch-fetch all requested item_ids in a single query to avoid N+1 round-trips.
    // The server is the source of truth for prices — Gemini's calculated total is not trusted.
    // (단일 쿼리로 요청된 모든 item_id 일괄 조회 — N+1 왕복 방지.
    //  가격의 신뢰 출처는 서버 — Gemini가 계산한 총액을 신뢰하지 않음)
    const itemIds = (fnArgs.items ?? []).map((i) => i.item_id);

    const { data: menuRecords, error: menuError } = await supabase
      .from('menu_items')
      .select('variant_id, name, price')
      .eq('store_id', session.storeData.id)
      .in('variant_id', itemIds);

    if (menuError) {
      console.error(
        `[WS] [${session.agentId}] create_order menu lookup failed (메뉴 조회 실패):`,
        menuError
      );
      return {
        success: false,
        error:   'We could not verify the menu items. Please try again.',
      };
    }

    // Build a variant_id → menu record map for O(1) lookup per line item (라인 항목당 O(1) 조회를 위한 variant_id → 메뉴 레코드 맵 생성)
    const menuMap = new Map((menuRecords ?? []).map((r) => [r.variant_id, r]));

    // ── Step 3: Enrich items and calculate server-authoritative total_amount ─
    // If any item_id is not found in this store's menu, reject the whole order.
    // This prevents ghost items and price tampering from Gemini's args.
    // (item_id가 이 매장 메뉴에 없으면 전체 주문 거부.
    //  유령 항목 방지 및 Gemini 인수의 가격 조작 방지)
    let totalAmount = 0;
    const enrichedItems = [];

    for (const reqItem of fnArgs.items ?? []) {
      const record = menuMap.get(reqItem.item_id);

      if (!record) {
        console.warn(
          `[WS] [${session.agentId}] create_order — unknown item_id: ${reqItem.item_id} ` +
          `(알 수 없는 item_id — 주문 거부)`
        );
        return {
          success: false,
          error:   `Item ID "${reqItem.item_id}" was not found in this store's menu. Please call check_menu again to get valid item IDs.`,
        };
      }

      const qty = Math.max(1, parseInt(reqItem.quantity, 10) || 1);
      totalAmount += record.price * qty;

      // Enrich each line item with the DB-sourced name and unit price (DB 출처의 이름과 단가로 각 라인 항목 보강)
      enrichedItems.push({
        item_id:    reqItem.item_id,
        name:       record.name,        // DB name — authoritative source (DB 이름 — 권위적 출처)
        quantity:   qty,
        unit_price: record.price,       // DB price — authoritative source (DB 가격 — 권위적 출처)
      });
    }

    // Round to 2 decimal places to avoid floating-point drift (부동 소수점 오차 방지를 위해 소수점 2자리로 반올림)
    totalAmount = parseFloat(totalAmount.toFixed(2));

    // ── Step 4: Insert the enriched order row into Supabase ──────────────────
    // store_id and total_amount come from the session/server — never from Gemini args.
    // created_at is omitted so the DB default (now()) applies automatically.
    // (store_id와 total_amount는 세션/서버에서 가져옴 — Gemini 인수 사용 금지.
    //  created_at은 생략 — DB 기본값 now() 자동 적용)
    const { data: newOrder, error: insertError } = await supabase
      .from('orders')
      .insert({
        store_id:       session.storeData.id,    // Authoritative from session (세션에서 권위적으로 결정)
        agent_id:       session.agentId,          // Retell agent ID for call tracing (통화 추적용 Retell 에이전트 ID)
        customer_name:  fnArgs.customer_name,
        customer_phone: fnArgs.customer_phone,
        customer_email: fnArgs.customer_email,
        items:          enrichedItems,            // Enriched with DB-sourced names and unit prices (DB 출처의 이름과 단가로 보강됨)
        total_amount:   totalAmount,              // Server-calculated — not trusted from Gemini (서버 계산 총액 — Gemini 값 불신)
        status:         'pending',               // Lifecycle starts pending — updated to paid after payment (생명주기는 pending으로 시작 — 결제 후 paid로 변경)
      })
      .select('id')
      .single();

    if (insertError) {
      // Log the full Supabase error so schema mismatches are visible in server output (스키마 불일치가 서버 출력에서 보이도록 전체 Supabase 오류 기록)
      console.error(
        `[WS] [${session.agentId}] create_order DB insert failed (주문 DB 삽입 실패):`,
        insertError
      );
      return {
        success: false,
        error:   'We were unable to place your order right now. Please try again or call us directly.',
      };
    }

    // ── Step 5: Build mock payment URL from the real DB-generated order ID ───
    // SERVER_URL is the authoritative public base URL — set to the Ngrok HTTPS URL in dev,
    // production domain in prod. Never falls back to localhost so the link is always clickable.
    // Replace the entire path with a real payment gateway checkout URL before going to production.
    // (SERVER_URL이 권위 있는 공개 기본 URL — 개발 시 Ngrok HTTPS URL, 프로덕션에서는 프로덕션 도메인으로 설정.
    //  localhost로 폴백하지 않아 링크가 항상 클릭 가능.
    //  프로덕션 전 경로 전체를 실제 결제 게이트웨이 체크아웃 URL로 교체 필요)
    const baseUrl    = process.env.SERVER_URL;
    const paymentUrl = `${baseUrl}/api/payment/mock/${newOrder.id}`;

    // ── Step 6: Fire-and-forget order confirmation email ─────────────────────
    // Email is dispatched after the DB insert succeeds — never awaited here so it
    // cannot delay or block the response Gemini sends to the caller.
    // Failures are caught and logged inside sendOrderConfirmationEmail.
    // (DB 삽입 성공 후 이메일 발송 — 여기서 await하지 않아 Gemini 응답을 지연하거나 차단하지 않음.
    //  실패는 sendOrderConfirmationEmail 내부에서 캐치 후 로깅)
    sendOrderConfirmationEmail({
      to:           fnArgs.customer_email,
      customerName: fnArgs.customer_name,
      orderId:      newOrder.id,
      items:        enrichedItems,
      totalAmount,
      paymentUrl,
      storeName:    session.storeData.name ?? 'Our Restaurant',
    }).catch((err) => {
      // Extra safety net — sendOrderConfirmationEmail already catches internally
      // (추가 안전망 — sendOrderConfirmationEmail이 이미 내부적으로 캐치함)
      console.error(
        `[WS] [${session.agentId}] Unhandled mailer error | orderId: ${newOrder.id} | ${err.message} ` +
        `(처리되지 않은 메일러 오류 | 주문: ${newOrder.id} | 오류: ${err.message})`
      );
    });

    // CRM + POS injection is intentionally NOT called here.
    // It is gated behind the RETENTION LOOP consent question — the AI asks the caller
    // for permission AFTER order confirmation. If they say Yes, the AI calls
    // `save_customer_consent`, which triggers injectCustomerToCrmAndPos.
    // This ensures no personal data is saved without explicit verbal consent.
    // (CRM + POS 주입은 여기서 의도적으로 실행하지 않음.
    //  리텐션 루프 동의 질문 뒤에 게이팅됨 — AI가 주문 확인 후 발신자에게 동의를 구함.
    //  "예" 응답 시 AI가 save_customer_consent를 호출하여 injectCustomerToCrmAndPos 실행.
    //  명시적 구두 동의 없이 개인 정보가 저장되지 않도록 보장)

    console.log(
      `[WS] [${session.agentId}] create_order success | order_id: ${newOrder.id} | ` +
      `total: ${totalAmount} | items: ${enrichedItems.length} | ` +
      `payment_url: ${paymentUrl} (주문 접수 성공 | DB에 저장됨)`
    );

    // Return a structured result — Gemini converts this into a natural spoken confirmation
    // (구조화된 결과 반환 — Gemini가 자연스러운 음성 확인으로 변환)
    return {
      success:      true,
      order_id:     newOrder.id,
      total_amount: totalAmount,
      payment_url:  paymentUrl,
      message:      `Order placed successfully. Total is $${totalAmount}. Share the payment link with the customer to complete payment.`,
    };

    } catch (err) {
      // Unexpected error — log with full stack and return a standardised recovery payload.
      // Gemini will convert this into an apologetic spoken sentence per the ERROR RECOVERY rule.
      // (예상치 못한 오류 — 전체 스택 로깅 후 표준 복구 페이로드 반환.
      //  ERROR RECOVERY 규칙에 따라 Gemini가 이를 사과 음성 문장으로 변환)
      console.error(
        `[WS] [${session.agentId}] create_order unexpected error (create_order 예상치 못한 오류):`, err
      );
      return {
        error:   true,
        message: 'System timeout or API failure. Please ask the user to wait a moment and try again.',
      };
    }
  }

  // ── make_reservation (ACTIVE) ─────────────────────────────────────────────
  // Insert a confirmed reservation row into the reservations table.
  // All six required fields must be present — validated before the DB write.
  // store_id comes from the session; Gemini must NOT pass it as an argument.
  // (확정된 예약 행을 reservations 테이블에 삽입.
  //  6개 필수 필드 모두 존재해야 함 — DB 쓰기 전 검증.
  //  store_id는 세션에서 가져옴 — Gemini가 인수로 전달하면 안 됨)
  if (fnName === 'make_reservation') {
    // Error boundary — catches unexpected thrown exceptions (network timeout, SDK crash, etc.)
    // that slip past the explicit Supabase error checks in the pipeline below.
    // Never throws from executeFunctionCall: the outer finally in handleTranscript must
    // always release isGenerating regardless of what happens inside this function.
    // (오류 경계 — 아래 파이프라인의 명시적 Supabase 오류 확인을 통과하는
    //  예상치 못한 예외(네트워크 타임아웃, SDK 충돌 등) 캐치.
    //  executeFunctionCall에서 절대 throw 금지 — handleTranscript의 외부 finally가
    //  이 함수 내부에서 발생하는 일에 관계없이 항상 isGenerating을 해제해야 함)
    try {
    console.log(
      `[WS] [${session.agentId}] make_reservation | ` +
      `name: ${fnArgs.customer_name} | phone: ${fnArgs.customer_phone} | ` +
      `email: ${fnArgs.customer_email} | date: ${fnArgs.reservation_date} | ` +
      `time: ${fnArgs.reservation_time} | party: ${fnArgs.party_size} ` +
      `(예약 접수 시도)`
    );

    // ── Mechanical Lock — second fence: block if customer confirmation is not set ─
    // The schema description is the first fence — instructs Gemini not to call this tool
    // until user_explicit_confirmation is true. This guard is the second fence: it
    // protects against model hallucination, schema drift, and future API surface changes
    // that could allow the reservation to be inserted before the caller says "Yes".
    // Returning a structured error (not throwing) so executeFunctionCall never propagates
    // to the outer catch and the isGenerating lock is always released by the outer finally.
    // (기계적 잠금 두 번째 방어선: 고객 확인이 설정되지 않은 경우 차단.
    //  스키마 설명이 첫 번째 방어선 — user_explicit_confirmation이 true가 될 때까지 도구 호출 금지 지시.
    //  이 가드는 두 번째 방어선 — 모델 환각, 스키마 드리프트, API 변경으로 인한 우회 방지.
    //  구조화된 오류 반환(throw 아님) — executeFunctionCall이 외부 catch로 전파되지 않도록 하고
    //  isGenerating 잠금이 항상 외부 finally로 해제되도록 보장)
    if (fnArgs.user_explicit_confirmation !== true) {
      console.warn(
        `[WS] [${session.agentId}] make_reservation blocked — user_explicit_confirmation not true ` +
        `(예약 차단 — 사용자 명시적 확인 없음)`
      );
      return {
        error: "REJECTED. You must recite the FULL summary and ask 'Is this correct?'. Do NOT call this tool until the user says YES.",
      };
    }

    // Validate that all required reservation fields are present before touching the DB.
    // Return a descriptive error so Gemini can voice exactly what is missing.
    // (DB 접근 전 모든 필수 예약 필드 존재 여부 검증.
    //  Gemini가 누락된 내용을 정확히 안내할 수 있도록 설명적인 오류 반환)
    const missingFields = [];
    if (!fnArgs.customer_name)     missingFields.push('customer name');
    if (!fnArgs.customer_phone)    missingFields.push('phone number');
    if (!fnArgs.customer_email)    missingFields.push('email address');
    if (!fnArgs.reservation_date)  missingFields.push('reservation date (YYYY-MM-DD)');
    if (!fnArgs.reservation_time)  missingFields.push('reservation time (HH:MM)');
    if (!fnArgs.party_size)        missingFields.push('party size');

    if (missingFields.length > 0) {
      console.warn(
        `[WS] [${session.agentId}] make_reservation rejected — missing: ${missingFields.join(', ')} ` +
        `(예약 거부 — 누락 필드: ${missingFields.join(', ')})`
      );
      return {
        success: false,
        error:   `Missing required reservation details: ${missingFields.join(', ')}. Please collect all required information before placing the reservation.`,
      };
    }

    // Insert the reservation row — store_id, agent_id, and customer_name are always server-sourced.
    // agent_id is the Retell agent identifier for call tracing and tenant attribution.
    // created_at is omitted so the DB default (now()) applies automatically.
    // (예약 행 삽입 — store_id, agent_id, customer_name은 항상 서버에서 결정.
    //  agent_id는 통화 추적 및 테넌트 귀속을 위한 Retell 에이전트 식별자.
    //  created_at 생략 — DB 기본값 now() 자동 적용)
    const partySize = parseInt(fnArgs.party_size, 10) || 1;

    const { data: newReservation, error: insertError } = await supabase
      .from('reservations')
      .insert({
        store_id:         session.storeData.id,   // Authoritative from session (세션에서 권위적으로 결정)
        agent_id:         session.agentId,         // Retell agent ID — must not be null (Retell 에이전트 ID — null 불가)
        customer_name:    fnArgs.customer_name,    // Required — always saved to DB (필수 — 항상 DB에 저장)
        customer_phone:   fnArgs.customer_phone,
        customer_email:   fnArgs.customer_email,
        reservation_date: fnArgs.reservation_date,
        reservation_time: fnArgs.reservation_time,
        party_size:       partySize,
        status:           'pending',              // Lifecycle starts pending (생명주기는 pending으로 시작)
      })
      .select('id')
      .single();

    if (insertError) {
      console.error(
        `[WS] [${session.agentId}] make_reservation DB insert failed (예약 DB 삽입 실패):`,
        insertError
      );
      return {
        success: false,
        error:   'We were unable to confirm your reservation right now. Please try again or call us directly.',
      };
    }

    // Fire-and-forget reservation confirmation email — never awaited so it cannot block the response.
    // Failures are caught and logged inside sendReservationConfirmationEmail.
    // (예약 확인 이메일 fire-and-forget 발송 — await하지 않아 응답을 차단하지 않음.
    //  실패는 sendReservationConfirmationEmail 내부에서 캐치 후 로깅)
    sendReservationConfirmationEmail({
      to:              fnArgs.customer_email,
      customerName:    fnArgs.customer_name,
      reservationId:   newReservation.id,
      reservationDate: fnArgs.reservation_date,
      reservationTime: fnArgs.reservation_time,
      partySize,
      storeName:       session.storeData.name ?? 'Our Restaurant',
    }).catch((err) => {
      // Extra safety net — sendReservationConfirmationEmail already catches internally
      // (추가 안전망 — sendReservationConfirmationEmail이 이미 내부적으로 캐치함)
      console.error(
        `[WS] [${session.agentId}] Unhandled reservation mailer error | ` +
        `reservationId: ${newReservation.id} | ${err.message} ` +
        `(처리되지 않은 예약 메일러 오류 | 예약: ${newReservation.id} | 오류: ${err.message})`
      );
    });

    // CRM + POS injection is intentionally NOT called here.
    // It is gated behind the RETENTION LOOP consent question — the AI asks the caller
    // for permission AFTER reservation confirmation. If they say Yes, the AI calls
    // `save_customer_consent`, which triggers injectCustomerToCrmAndPos.
    // This ensures no personal data is saved without explicit verbal consent.
    // (CRM + POS 주입은 여기서 의도적으로 실행하지 않음.
    //  리텐션 루프 동의 질문 뒤에 게이팅됨 — AI가 예약 확인 후 발신자에게 동의를 구함.
    //  "예" 응답 시 AI가 save_customer_consent를 호출하여 injectCustomerToCrmAndPos 실행.
    //  명시적 구두 동의 없이 개인 정보가 저장되지 않도록 보장)

    console.log(
      `[WS] [${session.agentId}] make_reservation success | ` +
      `reservation_id: ${newReservation.id} | ` +
      `${fnArgs.reservation_date} ${fnArgs.reservation_time} | party: ${partySize} ` +
      `(예약 접수 성공 | DB에 저장됨)`
    );

    return {
      success:        true,
      reservation_id: newReservation.id,
      message:        `Reservation confirmed for ${fnArgs.customer_name}, party of ${partySize} on ${fnArgs.reservation_date} at ${fnArgs.reservation_time}. A confirmation will be sent to ${fnArgs.customer_email}.`,
    };

    } catch (err) {
      // Unexpected error — log with full stack and return a standardised recovery payload.
      // Gemini will convert this into an apologetic spoken sentence per the ERROR RECOVERY rule.
      // (예상치 못한 오류 — 전체 스택 로깅 후 표준 복구 페이로드 반환.
      //  ERROR RECOVERY 규칙에 따라 Gemini가 이를 사과 음성 문장으로 변환)
      console.error(
        `[WS] [${session.agentId}] make_reservation unexpected error (make_reservation 예상치 못한 오류):`, err
      );
      return {
        error:   true,
        message: 'System timeout or API failure. Please ask the user to wait a moment and try again.',
      };
    }
  }

  // ── save_customer_consent (ACTIVE) ────────────────────────────────────────
  //
  // Called by Gemini ONLY after the customer has explicitly said "Yes" to the
  // RETENTION LOOP consent question ("Would you like me to save your details?").
  //
  // This function is the single gate for writing personal data to the CRM and POS.
  // It delegates immediately to injectCustomerToCrmAndPos (fire-and-forget) so the
  // AI's spoken confirmation ("Wonderful! You're all saved.") is never delayed.
  //
  // Pipeline (파이프라인):
  //   1. Validate required args — reject cleanly if any field is missing.
  //      (필수 인수 검증 — 누락 시 명확한 거부)
  //   2. Fire-and-forget injectCustomerToCrmAndPos:
  //        a. Supabase customers upsert — new: INSERT total_orders=1; existing: total_orders++.
  //        b. Loyverse POST /v1.0/customers — new customers only, prevents duplicates.
  //      (fire-and-forget injectCustomerToCrmAndPos:
  //       a. Supabase 고객 upsert — 신규: total_orders=1 삽입; 기존: total_orders 증가.
  //       b. Loyverse 신규 고객만 POST — 중복 방지)
  //   3. Return { success: true } immediately — Gemini generates the warm spoken reply.
  //      (즉시 { success: true } 반환 — Gemini가 따뜻한 음성 확인 발화 생성)
  //
  // (Gemini가 리텐션 루프 동의 질문에 고객이 명시적으로 "예"라고 답한 후에만 호출.
  //  개인 정보를 CRM 및 POS에 쓰는 단일 게이트 — 응답 지연 없는 fire-and-forget.
  //  save_customer_consent 도구는 명시적 구두 동의 없이 절대 호출되면 안 됨)
  if (fnName === 'save_customer_consent') {
    try {
      console.log(
        `[WS] [${session.agentId}] save_customer_consent | ` +
        `name: ${fnArgs.customer_name} | phone: ${fnArgs.customer_phone} ` +
        `(고객 동의 저장 시작)`
      );

      // Validate required fields — reject with a clear message so Gemini can ask
      // the caller to confirm their details rather than silently failing.
      // (필수 필드 검증 — Gemini가 조용히 실패하지 않고 발신자에게 정보 확인 요청 가능)
      if (!fnArgs.customer_name || !fnArgs.customer_phone || !fnArgs.customer_email) {
        console.warn(
          `[WS] [${session.agentId}] save_customer_consent rejected — missing fields ` +
          `(고객 동의 저장 거부 — 필드 누락)`
        );
        return {
          success: false,
          error:   'Missing customer details. Please collect the customer\'s name, phone number, and email address before saving.',
        };
      }

      // Fire-and-forget — the spoken confirmation must never be blocked by this write.
      // injectCustomerToCrmAndPos is fully wrapped in try/catch so it cannot throw.
      // (fire-and-forget — 음성 확인이 이 쓰기로 절대 차단되어서는 안 됨.
      //  injectCustomerToCrmAndPos는 완전히 try/catch로 감싸여 throw 불가)
      injectCustomerToCrmAndPos(
        {
          customerName:  fnArgs.customer_name,
          customerPhone: fnArgs.customer_phone,
          customerEmail: fnArgs.customer_email,
        },
        session.storeData,
        session.agentId
      ).catch((err) => {
        // Belt-and-suspenders catch — injectCustomerToCrmAndPos already catches internally.
        // (방어적 catch — injectCustomerToCrmAndPos가 이미 내부적으로 캐치함)
        console.error(
          `[CRM Inject] Unhandled outer error in save_customer_consent | ${err.message} ` +
          `(save_customer_consent 외부 처리되지 않은 오류)`
        );
      });

      console.log(
        `[WS] [${session.agentId}] save_customer_consent queued | phone: ${fnArgs.customer_phone} ` +
        `(고객 동의 저장 큐에 추가 — 백그라운드 실행 중)`
      );

      // Return success immediately — Gemini uses this to generate the warm spoken reply.
      // The actual DB + POS write completes in the background after this return.
      // (즉시 성공 반환 — Gemini가 이를 사용하여 따뜻한 음성 응답 생성.
      //  실제 DB + POS 쓰기는 이 반환 이후 백그라운드에서 완료)
      return {
        success: true,
        message: `Customer details saved successfully for ${fnArgs.customer_name}. They are now registered for personalised service on future calls.`,
      };

    } catch (err) {
      // Unexpected error — log and return a structured recovery payload.
      // The ERROR RECOVERY rule converts this into a gentle spoken apology.
      // (예상치 못한 오류 — 로깅 후 구조화된 복구 페이로드 반환.
      //  ERROR RECOVERY 규칙이 이를 부드러운 음성 사과로 변환)
      console.error(
        `[WS] [${session.agentId}] save_customer_consent unexpected error (예상치 못한 오류):`, err
      );
      return {
        error:   true,
        message: 'System timeout or API failure. Please ask the user to wait a moment and try again.',
      };
    }
  }

  // ── Unknown function — neutral fallback ───────────────────────────────────
  // Should not occur — Gemini is constrained to the declared tools.
  // (발생하면 안 됨 — Gemini는 선언된 도구만 호출 가능)
  console.warn(`[WS] [${session.agentId}] Unknown function call: "${fnName}" (알 수 없는 함수 호출: "${fnName}")`);
  return { error: `Function "${fnName}" is not implemented.` };
}

// ── Async CRM + POS Customer Injection ───────────────────────────────────────

/**
 * Background task — upsert customer into Supabase and Loyverse after a successful tool call.
 *
 * Called fire-and-forget (NO await at call site) so the AI's spoken response to the caller
 * is NEVER delayed by this function. Wrapped in a top-level try/catch so errors are logged
 * silently and never propagated to handleTranscript.
 *
 * Pipeline:
 *   a) Normalise phone to XXX-XXX-XXXX for consistent storage across all writes.
 *   b) Supabase customers table — if customer exists: increment total_orders + refresh metadata.
 *      If new: insert with total_orders = 1.
 *   c) Loyverse API — POST /v1.0/customers only for genuinely new customers (no prior record),
 *      preventing duplicate profiles for returning callers.
 *
 * Security notes:
 *   - The entire function is wrapped in try/catch — no error can surface to the caller.
 *   - pos_api_key comes from the server-side session, never from Gemini args.
 *   - All Supabase writes use the server-resolved store_id from session.storeData.
 *
 * (도구 성공 후 Supabase 및 Loyverse에 고객 upsert 백그라운드 작업.
 *  fire-and-forget 호출 — AI 응답 절대 지연 없음. 최상위 try/catch — 오류 전파 금지.
 *  파이프라인: 전화번호 정규화 → Supabase upsert(기존: 증가 / 신규: 삽입) → Loyverse 신규 생성.
 *  보안: pos_api_key는 서버 세션에서, store_id는 session.storeData에서 — Gemini 인수 미사용)
 *
 * @param {{ customerName: string, customerPhone: string, customerEmail: string }} data
 * @param {object} storeData  — full store row from session (세션의 전체 스토어 행)
 * @param {string} agentId    — Retell agent ID for diagnostic logging (진단 로깅용 에이전트 ID)
 * @returns {Promise<void>}
 */
async function injectCustomerToCrmAndPos(data, storeData, agentId) {
  try {
    // Step a: Normalise phone to XXX-XXX-XXXX — consistent with CRM lookup format.
    // Falls back to raw value if normalisation yields null (e.g. non-NANP number).
    // (XXX-XXX-XXXX 형식으로 정규화 — CRM 조회 형식과 일관성 유지.
    //  정규화 실패 시 원시 값 폴백 — 예: 비NANP 번호)
    const phone = formatPhoneNumber(data.customerPhone) ?? data.customerPhone;

    // Step b: Upsert into Supabase customers table.
    // First check whether this customer already has a record for this store.
    // This allows an atomic name/email refresh + total_orders increment on conflict,
    // and a clean insert (total_orders = 1) for a genuinely new customer.
    // Column names match the actual customers table schema: phone / name / email —
    // NOT customer_phone / customer_name / customer_email (those columns do not exist).
    // (Supabase customers 테이블 upsert.
    //  먼저 이 매장의 해당 고객 레코드 존재 여부 확인.
    //  충돌 시 이름/이메일 갱신 + total_orders 증가, 신규 시 total_orders=1로 삽입.
    //  컬럼명은 실제 customers 테이블 스키마와 일치: phone/name/email —
    //  customer_phone/customer_name/customer_email은 존재하지 않는 컬럼)
    const { data: existing, error: lookupError } = await supabase
      .from('customers')
      .select('id, total_orders')
      .eq('store_id', storeData.id)
      .eq('phone', phone)                  // Correct column name — 'phone' not 'customer_phone' (정확한 컬럼명 — customer_phone 아닌 phone)
      .maybeSingle();

    if (lookupError) {
      console.error(
        `[CRM Inject] [${agentId}] Customer lookup failed | phone: ${phone} | ` +
        `${lookupError.message} (고객 조회 실패)`
      );
    } else if (existing) {
      // Returning customer — refresh metadata and increment total_orders.
      // (재방문 고객 — 메타데이터 갱신 및 total_orders 증가)
      const newTotal = (existing.total_orders ?? 0) + 1;
      const { error: updateError } = await supabase
        .from('customers')
        .update({
          name:         data.customerName,   // Correct column name — 'name' not 'customer_name' (정확한 컬럼명 — customer_name 아닌 name)
          email:        data.customerEmail,  // Correct column name — 'email' not 'customer_email' (정확한 컬럼명 — customer_email 아닌 email)
          total_orders: newTotal,
        })
        .eq('id', existing.id);

      if (updateError) {
        console.error(
          `[CRM Inject] [${agentId}] total_orders increment failed | id: ${existing.id} | ` +
          `${updateError.message} (total_orders 증가 실패)`
        );
      } else {
        console.log(
          `[CRM Inject] [${agentId}] total_orders updated | id: ${existing.id} | ` +
          `new total: ${newTotal} (total_orders 업데이트 완료)`
        );
      }

    } else {
      // New customer — insert with total_orders = 1.
      // Column names match the actual customers table schema exactly.
      // (신규 고객 — total_orders=1로 삽입. 컬럼명은 실제 customers 테이블 스키마와 정확히 일치)
      const { error: insertError } = await supabase
        .from('customers')
        .insert({
          store_id:     storeData.id,
          name:         data.customerName,   // Correct column name — 'name' not 'customer_name' (정확한 컬럼명 — customer_name 아닌 name)
          phone:        phone,               // Correct column name — 'phone' not 'customer_phone' (정확한 컬럼명 — customer_phone 아닌 phone)
          email:        data.customerEmail,  // Correct column name — 'email' not 'customer_email' (정확한 컬럼명 — customer_email 아닌 email)
          total_orders: 1,
        });

      if (insertError) {
        console.error(
          `[CRM Inject] [${agentId}] New customer insert failed | phone: ${phone} | ` +
          `${insertError.message} (신규 고객 삽입 실패)`
        );
      } else {
        console.log(
          `[CRM Inject] [${agentId}] New customer inserted | phone: ${phone} | ` +
          `store: ${storeData.id} (신규 고객 삽입 완료)`
        );

        // Step c: Push new customer to Loyverse — only for genuinely new customers.
        // Skipped for returning callers (existing !== null) to prevent duplicate Loyverse profiles.
        // Also skipped when the store is not on Loyverse or pos_api_key is absent.
        // (신규 고객만 Loyverse에 푸시 — 재방문 시 Loyverse 중복 프로필 방지.
        //  Loyverse POS가 아니거나 pos_api_key 없으면 생략)
        if (
          (storeData.pos_system ?? '').toUpperCase() === 'LOYVERSE' &&
          storeData.pos_api_key
        ) {
          // Sanitize the API key before use in the Authorization header.
          // Keys fetched from Supabase or env vars can contain hidden newline or
          // carriage-return characters that Node's http module rejects with
          // "Invalid character in header content ['Authorization']".
          // Strip all \r and \n variants, then trim surrounding whitespace.
          // (Authorization 헤더 사용 전 API 키 정제.
          //  Supabase나 환경 변수에서 가져온 키에 숨겨진 개행·캐리지 리턴 문자가 포함될 수 있음.
          //  Node의 http 모듈이 이를 "Invalid character in header content" 오류로 거부.
          //  모든 \r·\n 변형 제거 후 앞뒤 공백 트리밍)
          const cleanApiKey = storeData.pos_api_key.replace(/\r?\n|\r/g, '').trim();

          // Wrap the Loyverse POST in its own try/catch so a 400/409 from Loyverse
          // (duplicate email, duplicate phone, or invalid field) is caught and logged
          // without aborting the rest of injectCustomerToCrmAndPos.
          // The outer try/catch remains as the last-resort safety net.
          // (Loyverse POST를 별도 try/catch로 감싸 400/409 응답을 독립적으로 처리.
          //  중복 이메일·전화번호·필드 오류가 발생해도 함수 나머지 로직에 영향 없음.
          //  외부 try/catch는 최후 안전망으로 유지)
          try {
            // Strip every character except digits and '+' before sending to Loyverse.
            // Our internal format is XXX-XXX-XXXX (hyphens included); Loyverse rejects
            // anything other than digits and an optional leading '+' country-code prefix,
            // returning {"code":"INVALID_VALUE","details":"The value of 'phone_number' is invalid."}.
            // (Loyverse 전송 전 숫자와 '+' 외 모든 문자 제거.
            //  내부 형식은 XXX-XXX-XXXX(하이픈 포함); Loyverse는 숫자와 선택적 '+' 국가 코드 외 형식 거부.
            //  {"code":"INVALID_VALUE","details":"The value of 'phone_number' is invalid."} 오류 방지)
            const sanitizedPhone = phone.replace(/[^0-9+]/g, '');

            const loyverseRes = await axios.post(
              'https://api.loyverse.com/v1.0/customers',
              {
                // Loyverse v1.0 required field names — do NOT rename these keys.
                // "phone" alone is rejected; the API strictly requires "phone_number".
                // (Loyverse v1.0 필수 필드명 — 절대 변경 금지.
                //  "phone" 단독 사용 시 거부됨; API는 "phone_number"를 요구)
                name:         data.customerName,
                phone_number: sanitizedPhone,
                email:        data.customerEmail,
              },
              {
                headers: {
                  Authorization:  `Bearer ${cleanApiKey}`,
                  'Content-Type': 'application/json',
                },
                timeout: 8_000,   // 8-second hard cap — never holds up the queue (8초 하드 캡 — 큐 차단 없음)
              }
            );

            const loyverseCustomerId = loyverseRes.data?.id ?? null;
            console.log(
              `[CRM Inject] [${agentId}] Loyverse customer created | ` +
              `loyverse_id: ${loyverseCustomerId ?? 'unknown'} | phone: ${phone} ` +
              `(Loyverse 고객 프로필 생성 완료)`
            );

            // Write the Loyverse-assigned customer ID back to our customers row.
            // This is critical: the delete webhook filters by (store_id, pos_customer_id).
            // If pos_customer_id stays NULL the delete webhook can never find the row,
            // so POS-side deletions are silently ignored and the stale record persists.
            // (Loyverse가 부여한 고객 ID를 customers 행에 다시 기록.
            //  삭제 웹훅이 (store_id, pos_customer_id)로 필터링하기 때문에 이 쓰기가 필수.
            //  pos_customer_id가 NULL로 남아 있으면 삭제 웹훅이 행을 찾지 못해
            //  POS에서 삭제해도 우리 DB에 오래된 레코드가 계속 남음)
            if (loyverseCustomerId) {
              const { error: pidUpdateErr } = await supabase
                .from('customers')
                .update({ pos_customer_id: loyverseCustomerId })
                .eq('store_id', storeData.id)
                .eq('phone', phone);

              if (pidUpdateErr) {
                console.error(
                  `[CRM Inject] [${agentId}] pos_customer_id write-back failed | ` +
                  `loyverse_id: ${loyverseCustomerId} | phone: ${phone} | ` +
                  `${pidUpdateErr.message} ` +
                  `(pos_customer_id 역기록 실패 — 삭제 웹훅이 이 행을 찾지 못할 수 있음)`
                );
              } else {
                console.log(
                  `[CRM Inject] [${agentId}] pos_customer_id written back | ` +
                  `loyverse_id: ${loyverseCustomerId} | phone: ${phone} ` +
                  `(pos_customer_id 역기록 완료 — 삭제 웹훅 연결됨)`
                );
              }
            }
          } catch (posErr) {
            const status  = posErr.response?.status;
            const posBody = posErr.response?.data;

            // Loyverse returns 400 or 422 when the email or phone already exists.
            // Treat any 4xx response as a possible duplicate — log and continue
            // without re-throwing so the Supabase insert result is preserved.
            // (Loyverse는 이메일·전화번호 중복 시 400 또는 422를 반환.
            //  모든 4xx를 잠재적 중복으로 처리 — 로그 후 Supabase 결과 보존하며 계속 진행)
            if (status >= 400 && status < 500) {
              console.warn(
                `[CRM Inject] [${agentId}] Loyverse customer already exists or payload rejected | ` +
                `status: ${status} | response: ${JSON.stringify(posBody)} | phone: ${phone} ` +
                `(Loyverse 고객 이미 존재하거나 페이로드 거부 — CRM 삽입 결과는 유지됨)`
              );
            } else {
              // Non-4xx (network timeout, 5xx) — log full details but still do not throw.
              // (4xx 외 오류 — 네트워크 타임아웃, 5xx — 상세 정보 기록 후 throw 않음)
              console.error(
                `[CRM Inject] [${agentId}] Loyverse POST failed | ` +
                `status: ${status ?? 'N/A'} | response: ${JSON.stringify(posBody)} | ` +
                `message: ${posErr.message} | phone: ${phone} ` +
                `(Loyverse POST 실패 — 네트워크 오류 또는 5xx)`
              );
            }
          }
        }
      }
    }

  } catch (err) {
    // Top-level catch — background errors must NEVER propagate to handleTranscript.
    // The AI's spoken response has already been delivered before this function even starts.
    // Log both err.message and err.response?.data so Axios HTTP errors expose the
    // full Loyverse response body rather than just the generic status text.
    // (최상위 캐치 — 백그라운드 오류는 절대 handleTranscript로 전파 금지.
    //  AI 음성 응답은 이 함수가 시작되기 전에 이미 전달됨.
    //  err.response?.data도 함께 기록해 Loyverse 응답 바디 전체 노출)
    const responseBody = err.response?.data;
    console.error(
      `[CRM Inject] [${agentId}] Background injection failed | ${err.message}` +
      (responseBody ? ` | response: ${JSON.stringify(responseBody)}` : '') +
      ` (백그라운드 CRM + POS 주입 실패 — AI 응답에 영향 없음)`
    );
  }
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

  // Select only the columns required by the session — explicit list prevents unexpected column drift.
  // system_prompt is the core AI persona; temporary_prompt holds daily operational overrides.
  // Both are fetched so buildMasterPrompt can assemble the full layered instruction.
  // (세션에 필요한 컬럼만 명시적으로 선택 — 예상치 못한 컬럼 변동 방지.
  //  system_prompt는 핵심 AI 페르소나; temporary_prompt는 일일 운영 오버라이드.
  //  buildMasterPrompt가 전체 계층형 지시문을 조립할 수 있도록 두 컬럼 모두 조회)
  const { data, error } = await supabase
    .from('stores')
    .select(
      'id, name, retell_agent_id, pos_system, pos_api_key, payment_gateway, stripe_secret_key, ' +
      'system_prompt, temporary_prompt, timezone, is_active, ' +
      'business_hours, parking_info, custom_knowledge, menu_cache'
    )
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

// ── Customer CRM Lookup ───────────────────────────────────────────────────────

/**
 * Look up the most recent order for a caller's phone number at a specific store.
 * Returns a lightweight CRM summary when a match is found, null for first-time callers.
 * Called once per call from the call_started handler — the result is injected into the
 * [CUSTOMER CRM DATA] section of the master prompt BEFORE the greeting fires,
 * so the AI can greet returning customers by name on the very first utterance.
 * (발신자 전화번호로 매장의 가장 최근 주문 조회. 일치 시 경량 CRM 요약 반환,
 *  첫 발신자는 null. call_started 핸들러에서 통화당 한 번 호출 —
 *  인사말 발화 전 마스터 프롬프트의 [CUSTOMER CRM DATA] 섹션에 주입.
 *  AI가 첫 발화에서 재방문 고객을 이름으로 인사할 수 있도록 보장)
 *
 * @param {string|null} phoneNumber — caller's E.164 or local phone number (발신자 전화번호)
 * @param {string}      storeId    — UUID of the store being called (호출 중인 매장 UUID)
 * @returns {Promise<{customerName: string|null, customerEmail: string|null, lastOrderItems: string}|null>}
 */
async function getCustomerCrmData(phoneNumber, storeId) {
  if (!phoneNumber || !storeId) return null;

  // Extract exactly 10 digits from the incoming number (strips country code, spaces, dashes, parens).
  // E.g.: "+15031234567" → "5031234567", "(503) 123-4567" → "5031234567".
  // Require exactly 10 digits — shorter strings are not a valid NANP number.
  // (수신 번호에서 정확히 10자리 추출 — 국가 코드·공백·대시·괄호 제거.
  //  예: "+15031234567" → "5031234567". 10자리 미만은 유효한 번호 아님 → null 반환)
  const digits = phoneNumber.replace(/\D/g, '').slice(-10);
  if (digits.length < 10) {
    console.warn(
      `[CRM Debug] Phone "${phoneNumber}" yielded fewer than 10 digits — skipping CRM lookup ` +
      `(전화번호에서 10자리 미만 추출 — CRM 조회 생략)`
    );
    return null;
  }

  // Aggressive wildcard pattern: "%503%123%4567%"
  // Matches any separator style stored in the DB:
  //   "5031234567"    "503-123-4567"    "(503) 123-4567"    "503.123.4567"
  // Using ilike (case-insensitive) for robustness across mixed-case storage.
  // (공격적 와일드카드 패턴: DB에 저장된 구분자 형식에 무관하게 매칭.
  //  ilike로 대소문자 무관 매칭)
  const wildcardPhone = `%${digits.slice(0, 3)}%${digits.slice(3, 6)}%${digits.slice(6, 10)}%`;

  // ── Strategy A — Step 1: customers table existence gate ────────────────────
  // Query the customers table first. This is the single source of truth for
  // "do we know this person?". If no row exists here, the caller is new —
  // return null immediately and never touch the orders table.
  // Deleting a customer from the customers table (via POS sync or webhook)
  // is the correct mechanism to remove AI personalisation for that caller.
  // (전략 A — 1단계: customers 테이블 존재 여부 게이팅.
  //  customers 테이블을 먼저 조회. 고객 인식 여부의 유일한 진실 원천.
  //  해당 행이 없으면 신규 발신자 → 즉시 null 반환, orders 테이블 조회 생략.
  //  POS 동기화 또는 웹훅으로 customers 테이블에서 행 삭제 시 AI 개인화 해제)
  console.log(
    `[CRM Debug] Step 1 — checking customers table for phone "${wildcardPhone}" ` +
    `(store: ${storeId}) (1단계 — customers 테이블 조회)`
  );

  const { data: customerRow, error: customerError } = await supabase
    .from('customers')
    .select('name, email, pos_customer_id')
    .eq('store_id', storeId)
    .ilike('phone', wildcardPhone)
    .maybeSingle();

  if (customerError) {
    // Soft failure — log warning but do not block the call (소프트 실패 — 경고 기록 후 통화 차단 않음)
    console.warn(
      `[CRM Debug] customers table lookup failed for phone "${phoneNumber}": ` +
      `${customerError.message} (customers 테이블 조회 실패)`
    );
    return null;
  }

  if (!customerRow) {
    // No row in customers table — treat as new caller, skip orders lookup entirely.
    // (customers 테이블에 행 없음 — 신규 발신자로 처리, orders 조회 완전 생략)
    console.log(
      `[CRM Debug] Step 1 result: not found in customers — returning null (new caller) ` +
      `(1단계 결과: customers에 없음 — null 반환, 신규 발신자)`
    );
    return null;
  }

  console.log(
    `[CRM Debug] Step 1 result: found customer "${customerRow.name}" — proceeding to orders lookup ` +
    `(1단계 결과: 고객 "${customerRow.name}" 발견 — orders 조회 진행)`
  );

  // ── Strategy A — Step 2: orders table for most recent transaction ──────────
  // Customer exists in the customers table — now fetch their most recent order
  // to surface "last order" context to the LLM. orders is queried only after
  // customers gate passes, never for unknown callers.
  // (전략 A — 2단계: orders 테이블에서 최근 거래 조회.
  //  customers 게이팅 통과 후에만 orders 조회 — 미확인 발신자에게는 절대 조회 않음)
  const { data: orderRow, error: orderError } = await supabase
    .from('orders')
    .select('items')
    .eq('store_id', storeId)
    .ilike('customer_phone', wildcardPhone)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (orderError) {
    // Soft failure — return customer profile without order history (소프트 실패 — 주문 이력 없이 고객 프로필 반환)
    console.warn(
      `[CRM Debug] orders table lookup failed for phone "${phoneNumber}": ` +
      `${orderError.message} — returning customer profile only (orders 조회 실패 — 고객 프로필만 반환)`
    );
  }

  // Summarise the most recent order items as a comma-separated readable string.
  // items is expected to be a JSON array of { name, quantity } objects stored by create_order.
  // Falls back to a generic string when no order row exists or the shape is unexpected.
  // (최근 주문 항목을 읽기 쉬운 쉼표 구분 문자열로 요약.
  //  items는 create_order가 저장한 { name, quantity } 객체 배열 예상.
  //  주문 행 없거나 형태가 예상과 다를 경우 범용 문자열 폴백)
  let lastOrderItems = null;
  if (orderRow) {
    try {
      const parsed = Array.isArray(orderRow.items)
        ? orderRow.items
        : JSON.parse(orderRow.items ?? '[]');
      if (parsed.length > 0) {
        lastOrderItems = parsed
          .map((item) => `${item.quantity ?? 1}x ${item.name ?? String(item)}`)
          .join(', ');
      }
    } catch {
      lastOrderItems = String(orderRow.items ?? null);
    }
  }

  return {
    // Primary source: customers table row (프라이머리 소스: customers 테이블 행)
    customerName:  customerRow.name  ?? null,
    customerEmail: customerRow.email ?? null,
    // Secondary source: most recent order (세컨더리 소스: 최근 주문)
    lastOrderItems,
  };
}

// ── Master Prompt Builder ─────────────────────────────────────────────────────

/**
 * Assemble the final system instruction from five ordered sections:
 *
 *   [1. GLOBAL RULES]                — non-negotiable operating rules shared by every tenant.
 *                                      Sourced from the module-level GLOBAL_SYSTEM_PROMPT constant.
 *   [2. STORE CONTEXT]               — per-connection facts: store name, current local time in the
 *                                      store's timezone, and optional supplemental knowledge (hours,
 *                                      parking, custom knowledge, menu cache).
 *   [3. ESSENTIAL PERSONA]           — core AI identity set by the agency. Uses system_prompt when
 *                                      configured; falls back to a generic friendly assistant string.
 *                                      Store owners cannot overwrite this section.
 *   [4. TODAY'S TEMPORARY INSTRUCTIONS] — daily operational overrides set by the store owner.
 *                                      Injected here so it carries high immediate situational
 *                                      priority (sold-out items, specials, event notes, etc.).
 *                                      Falls back to "None" when empty.
 *   [5. CRM DATA]                    — hyper-personalisation context from the CRM lookup.
 *                                      Placed last so the model processes it closest to generation,
 *                                      maximising its influence on the greeting and upsell language.
 *                                      Format: "Customer Phone: X. Past Order: Y. Greet them by
 *                                      name and mention their last order if applicable."
 *                                      Falls back to a "new caller" notice when no history exists.
 *
 * Ordering rationale: Global Rules first → hard constraints before persona.
 * Temporary Instructions (tier 4) → store-owner overrides without touching core persona.
 * CRM Data last (tier 5) → closest to generation; highest influence on greeting and upsell.
 *
 * (다섯 가지 순서 섹션으로 최종 시스템 지시문 조립:
 *  [1. GLOBAL RULES]                    — 모든 테넌트가 공유하는 비협상적 운영 규칙.
 *  [2. STORE CONTEXT]                   — 연결별 사실: 매장명, 매장 시간대 현지 시각, 보완 지식.
 *  [3. ESSENTIAL PERSONA]               — 에이전시가 설정한 핵심 AI 정체성.
 *  [4. TODAY'S TEMPORARY INSTRUCTIONS]  — 매장 소유자 일일 운영 오버라이드. 비어 있으면 "None".
 *  [5. CRM DATA]                        — CRM 조회 개인화 컨텍스트. 생성에 가장 가까이 배치 →
 *                                         인사말 및 업셀 언어에 최고 영향력. 이력 없으면 새 발신자 안내.
 *  순서 근거: 글로벌 규칙 먼저 → 제약 확립. CRM 마지막 → 생성에 가장 가까워 영향력 최대화)
 *
 * @param {object}                                                   storeData   — full store row from Supabase or mock (Supabase 또는 목의 전체 스토어 행)
 * @param {{customerName: string|null, lastOrderItems: string}|null} crmData     — CRM lookup result, or null for new callers (CRM 조회 결과 또는 새 발신자의 null)
 * @param {string|null}                                              callerPhone — raw phone number from Retell call_started, for the CRM DATA section (Retell call_started의 원시 전화번호 — CRM DATA 섹션용)
 * @returns {string}
 */
function buildMasterPrompt(storeData, crmData = null, callerPhone = null) {
  // Fallback to Los Angeles time if the store's timezone is not set in the DB.
  // Supports any IANA timezone string (e.g., "America/New_York", "America/Chicago").
  // (DB에 매장 시간대가 설정되지 않은 경우 로스앤젤레스 시간으로 폴백.
  //  모든 IANA 시간대 문자열 지원 — 예: "America/New_York", "America/Chicago")
  const storeTimezone = storeData.timezone || 'America/Los_Angeles';

  // Format the current time in the store's specific timezone at session-start.
  // Short-form weekday and month keep the string concise while remaining unambiguous.
  // (세션 시작 시점의 매장 현지 시간대로 현재 시각 포맷.
  //  짧은 형식의 요일·월로 문자열을 간결하게 유지하면서도 명확성 보장)
  const currentLocalTime = new Date().toLocaleString('en-US', {
    timeZone: storeTimezone,
    weekday:  'short',
    month:    'short',
    day:      'numeric',
    hour:     'numeric',
    minute:   'numeric',
    hour12:   true,
  });

  // ── [STORE CONTEXT] section ───────────────────────────────────────────────
  // Provides per-connection facts the AI needs without changing the global rules.
  // Supplemental fields are appended when present so stores can enrich the context
  // with hours, parking directions, custom knowledge, and a pre-loaded menu cache.
  // (연결별 사실 제공 — 글로벌 규칙 변경 없이 AI에게 필요한 정보 전달.
  //  보완 필드는 존재할 때 추가 — 매장이 영업시간·주차·지식·메뉴 캐시로 컨텍스트 보강 가능)
  const supplementalLines = [
    storeData.business_hours   && `Business Hours: ${storeData.business_hours}`,
    storeData.parking_info     && `Parking & Directions: ${storeData.parking_info}`,
    storeData.custom_knowledge && `Additional Information: ${storeData.custom_knowledge}`,
    storeData.menu_cache       && `Menu Cache: ${storeData.menu_cache}`,
  ].filter(Boolean);

  const storeContextBlock = [
    `Store: ${storeData.name ?? 'this store'}`,
    `Local Time: ${currentLocalTime} (${storeTimezone})`,
    ...supplementalLines,
  ].join('\n');

  // ── [ESSENTIAL PERSONA] section ───────────────────────────────────────────
  // Core AI identity set by the agency — loaded from system_prompt in the DB.
  // Store owners cannot edit this field; it protects the foundational persona.
  // Falls back to a generic assistant description when the column is empty.
  // (에이전시가 설정한 핵심 AI 정체성 — DB의 system_prompt에서 로드.
  //  매장 소유자는 이 필드를 편집할 수 없어 기본 페르소나를 보호함.
  //  컬럼이 비어 있으면 일반 어시스턴트 설명으로 폴백)
  const essentialPrompt = storeData.system_prompt?.trim()
    || `You are a friendly assistant for ${storeData.name ?? 'this store'}.`;

  // ── [4. TODAY'S TEMPORARY INSTRUCTIONS] section ──────────────────────────
  // Daily operational overrides written by the store owner each day.
  // Placed as tier 4 — high situational priority for today's context without
  // permanently modifying the core persona. Sold-out items, live specials, and
  // event notes here take effect for this session only.
  // Falls back to "No special instructions for today." when the column is empty.
  // The sentence form is intentional — it reads as natural spoken text inside the
  // prompt rather than a raw placeholder token the model might echo aloud.
  // (매장 소유자가 매일 작성하는 일일 운영 오버라이드. 4번째 섹션으로 배치 —
  //  핵심 페르소나 영구 수정 없이 오늘의 높은 상황별 우선순위 확보.
  //  품절 항목, 실시간 특가, 이벤트 메모는 현재 세션에만 적용됨.
  //  컬럼이 비어 있으면 "No special instructions for today." 사용 — 자연스러운 음성 텍스트로 폴백)
  const temporaryBlock = storeData.temporary_prompt?.trim() || 'No special instructions for today.';

  // ── [5. CRM DATA] section ─────────────────────────────────────────────────
  // Hyper-personalisation context placed LAST — closest to generation, so it has
  // the highest influence on the greeting and upsell language.
  //
  // Three possible states:
  //   a) Returning caller — phone + name + past order → personalised greeting.
  //   b) New caller (phone known, no order history) → polite first-timer greeting.
  //   c) Anonymous (no Caller ID, e.g. web/dashboard call) → generic new-customer greeting.
  //
  // The model must see an explicit label for state (c) so it never attempts to recall
  // a name or order history that simply does not exist for this session.
  //
  // (하이퍼 개인화 컨텍스트를 마지막에 배치 — 생성에 가장 가까워 인사말과 업셀 언어에 최고 영향력.
  //  세 가지 상태:
  //   a) 재방문 — 전화번호+이름+이전 주문 → 개인화 인사말.
  //   b) 첫 방문(번호 있음, 주문 이력 없음) → 정중한 첫 방문 인사말.
  //   c) 익명(발신자 번호 없음, 웹/대시보드) → 일반 신규 고객 인사말.
  //  모델이 (c) 상태를 명시적으로 인식해야 존재하지 않는 이름/주문을 참조하지 않음)
  const phoneDisplay = callerPhone ?? null;
  let crmBlock;
  if (crmData) {
    // State (a): returning caller — name, email, and order history all available.
    // All three fields are exposed so the AI can pre-fill orders/reservations without
    // asking the customer to repeat information they have already provided before.
    // (재방문 고객 — 이름·이메일·주문 이력 모두 가용.
    //  AI가 고객에게 이미 알려진 정보를 반복해서 묻지 않도록 세 필드 모두 노출)
    crmBlock =
      `Customer Phone: ${phoneDisplay}.` +
      (crmData.customerName  ? ` Customer Name: ${crmData.customerName}.`   : '') +
      (crmData.customerEmail ? ` Customer Email: ${crmData.customerEmail}.` : '') +
      ` Past Order: ${crmData.lastOrderItems}.` +
      ' This is a returning customer. Greet them by name, offer their usual order, ' +
      'and use their saved Name, Phone, and Email automatically for any new order or reservation.';
  } else if (phoneDisplay) {
    // State (b): phone known but no prior orders found (전화번호 있으나 이전 주문 없음)
    crmBlock =
      `Customer Phone: ${phoneDisplay}. ` +
      'New caller — no prior order history on file. ' +
      'Greet them warmly as a new customer. ' +
      'Their phone number is already known; collect Name and Email if an order or reservation is placed.';
  } else {
    // State (c): no Caller ID — web dashboard or anonymous call (발신자 번호 없음 — 익명 통화)
    crmBlock =
      'Anonymous caller (No Caller ID). Treat as a new customer. ' +
      'Do not reference any name or past order. ' +
      'Collect Name, Phone, and Email if an order or reservation is placed.';
  }

  // Assemble the five sections in order — [1] through [5] as documented above.
  // Each numbered header lets the model clearly identify the boundary between
  // non-negotiable rules and session-specific contextual data.
  // CRM DATA is placed last (tier 5) so it is processed closest to generation,
  // maximising its influence on the personalised opening utterance.
  // (다섯 섹션을 [1]~[5] 순서대로 조립.
  //  번호 붙은 헤더로 모델이 규칙과 세션별 컨텍스트 경계를 명확히 식별.
  //  CRM DATA는 마지막(5번째)에 배치 — 생성에 가장 가깝게 처리되어 개인화 발화에 최대 영향)
  return (
    `[GLOBAL RULES]\n${GLOBAL_SYSTEM_PROMPT}\n\n` +
    `[STORE CONTEXT]\n${storeContextBlock}\n\n` +
    `[ESSENTIAL PERSONA]\n${essentialPrompt}\n\n` +
    `[TODAY'S TEMPORARY INSTRUCTIONS]\n${temporaryBlock}\n\n` +
    `[CRM DATA]\n${crmBlock}`
  );
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
      name:             'JM Korean BBQ — Downtown',
      pos_system:       'LOYVERSE',       // Correct column name — mirrors stores.pos_system (올바른 컬럼명 — stores.pos_system 반영)
      pos_api_key:      'mock-loyverse-key-001',
      payment_gateway:  'stripe',         // Correct column name — mirrors stores.payment_gateway (올바른 컬럼명 — stores.payment_gateway 반영)
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
      name:             'JM Boba Tea — Koreatown',
      pos_system:       'QUANTIC',        // Correct column name — mirrors stores.pos_system (올바른 컬럼명 — stores.pos_system 반영)
      pos_api_key:      'mock-quantic-key-002',
      payment_gateway:  'toss',           // Correct column name — mirrors stores.payment_gateway (올바른 컬럼명 — stores.payment_gateway 반영)
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
