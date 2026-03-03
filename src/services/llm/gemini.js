/**
 * LlmService — Gemini 2.5 Flash integration for voice order processing.
 * Uses Gemini's native function calling to extract structured order intents from conversation.
 * (Gemini 2.5 Flash 음성 주문 처리 서비스 — 함수 호출로 대화에서 구조화된 주문 의도 추출)
 *
 * Flow:
 *   conversationHistory → generateResponse() → LlmResult
 *     ├─ { type: 'TEXT',      text }           → send back to caller as next voice utterance
 *     └─ { type: 'TOOL_CALL', name, args }     → branch by name:
 *          ├─ 'check_menu'       → query menu_items DB, return item_id/name/price/stock_quantity
 *          ├─ 'create_order'    → call extractOrderIntent() → enqueueOrder() in controller
 *          └─ 'make_reservation'→ insert into reservations table, return reservation_id
 *
 * (흐름: conversationHistory → generateResponse() → LlmResult
 *   ├─ TEXT      → 음성 응답으로 반환
 *   └─ TOOL_CALL → name으로 분기:
 *        ├─ check_menu        → menu_items DB 조회, item_id/name/price/stock_quantity 반환
 *        ├─ create_order      → extractOrderIntent() → 컨트롤러에서 enqueueOrder()
 *        └─ make_reservation  → reservations 테이블에 삽입, reservation_id 반환)
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// Model identifier — pinned to Flash for voice latency + cost balance (음성 지연/비용 균형을 위해 Flash 모델 고정)
const GEMINI_MODEL = 'gemini-2.5-flash';

// Singleton API client — constructed once at module load time (모듈 로드 시 한 번 생성되는 싱글톤 클라이언트)
const _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ── Tool (Function Calling) Definitions ───────────────────────────────────────
//
// Gemini decides which tool to call based on the conversation context.
// Tools are declared once here and passed to every model instance.
// (Gemini는 대화 맥락에 따라 호출할 도구 결정. 도구는 여기서 한 번 선언 후 모든 모델 인스턴스에 전달)

export const POS_TOOLS = [
  {
    functionDeclarations: [

      // ── check_menu ──────────────────────────────────────────────────────────
      // Fetch the full menu with live stock quantities — required before taking any order.
      // store_id is resolved server-side from the session; no parameter needed here.
      // (실시간 재고 수량이 포함된 전체 메뉴 조회 — 주문 접수 전 필수 호출.
      //  store_id는 세션에서 서버 측 처리 — 파라미터 불필요)
      {
        name: 'check_menu',
        description:
          'Fetch the full menu, prices, and current stock_quantity for this store. ' +
          'Always use this to check stock before taking an order. ' +
          '(이 매장의 전체 메뉴, 가격, 현재 재고 수량 조회. 주문 접수 전 반드시 호출)',
        parameters: {
          type:       'object',
          properties: {},  // No parameters — store context is resolved server-side from the session (파라미터 없음 — 매장 컨텍스트는 세션에서 서버 측 처리)
          required:   [],
        },
      },

      // ── create_order (ACTIVE) ────────────────────────────────────────────────
      // Place a confirmed order using exact item_ids returned by check_menu.
      // store_id and total_amount are resolved server-side — do NOT pass them as arguments.
      // Requires all five customer fields before calling; server enriches items with names/prices.
      // user_explicit_confirmation is the mechanical lock — Gemini must set it true only after
      // the user has verbally confirmed the full order summary. The server rejects false/missing.
      // (check_menu가 반환한 정확한 item_id를 사용하여 확정된 주문 접수.
      //  store_id와 total_amount는 서버 측 처리 — 인수로 전달하지 말 것.
      //  호출 전 다섯 가지 고객 필드 모두 필요. 서버가 items에 이름/가격 추가.
      //  user_explicit_confirmation은 기계적 잠금 — Gemini는 사용자가 전체 주문 요약을
      //  구두로 확인한 후에만 true로 설정. 서버는 false/누락 시 거부)
      {
        name: 'create_order',
        description:
          'Place a confirmed order. You MUST collect customer_name, customer_phone, customer_email, ' +
          'and all item_ids BEFORE calling this. ' +
          'You MUST also recite the full order summary to the customer and receive explicit verbal ' +
          'confirmation ("Yes") before setting user_explicit_confirmation to true. ' +
          '(확정된 주문 접수. 호출 전 고객 정보 및 item_id 수집 필수. ' +
          '전체 주문 요약 낭독 및 명시적 구두 확인("예") 후에만 user_explicit_confirmation을 true로 설정)',
        parameters: {
          type: 'object',
          properties: {

            user_explicit_confirmation: {
              type:        'boolean',
              description:
                'CRITICAL: You MUST set this to true, but ONLY AFTER you have recited the FULL ' +
                'summary of the order to the user and they have explicitly said "Yes" or agreed. ' +
                'If the user has not verbally confirmed the full summary yet, DO NOT CALL THIS TOOL. ' +
                '(중요: 전체 주문 요약을 사용자에게 낭독하고 명시적으로 "예"라고 동의한 후에만 true로 설정. ' +
                '아직 구두 확인이 없으면 이 도구를 호출하지 말 것)',
            },

            items: {
              type:        'array',
              description: 'List of items — each entry must use the exact item_id from check_menu (주문 항목 목록 — check_menu의 정확한 item_id 사용 필수)',
              items: {
                type: 'object',
                properties: {
                  item_id: {
                    type:        'string',
                    description: 'Exact item_id from the check_menu response — do NOT invent or guess IDs (check_menu 응답의 정확한 item_id — ID를 만들거나 추측하지 말 것)',
                  },
                  quantity: {
                    type:        'number',
                    description: 'Number of units — must be ≥ 1 and within available stock_quantity (주문 수량 — 최소 1 이상이고 재고 수량 이내여야 함)',
                  },
                },
                required: ['item_id', 'quantity'],
              },
            },

            customer_name: {
              type:        'string',
              description: 'Full name of the customer as provided during the call (통화 중 고객이 제공한 성명)',
            },

            customer_phone: {
              type:        'string',
              description: 'Customer phone number for order confirmation and payment link delivery (주문 확인 및 결제 링크 전송용 고객 전화번호)',
            },

            customer_email: {
              type:        'string',
              description: 'Customer email address for order confirmation receipt (주문 확인 영수증 전송용 고객 이메일 주소)',
            },

          },
          required: ['user_explicit_confirmation', 'items', 'customer_name', 'customer_phone', 'customer_email'],
        },
      },

      // ── make_reservation (ACTIVE) ────────────────────────────────────────────
      // Place a table reservation for a customer.
      // All six data fields are required before calling — the server saves customer_name to the DB.
      // store_id is resolved server-side from the session; do NOT pass it as an argument.
      // user_explicit_confirmation is the mechanical lock — Gemini must set it true only after
      // the user has verbally confirmed the full reservation summary. Server rejects false/missing.
      // (고객 테이블 예약 접수. 호출 전 6개 데이터 필드 모두 필요 — 서버가 customer_name을 DB에 저장.
      //  store_id는 세션에서 서버 측 처리 — 인수로 전달하지 말 것.
      //  user_explicit_confirmation은 기계적 잠금 — Gemini는 사용자가 전체 예약 요약을
      //  구두로 확인한 후에만 true로 설정. 서버는 false/누락 시 거부)
      {
        name: 'make_reservation',
        description:
          'Place a confirmed table reservation. You MUST collect all 6 data fields BEFORE calling this. ' +
          'You MUST also recite the full reservation summary to the customer and receive explicit verbal ' +
          'confirmation ("Yes") before setting user_explicit_confirmation to true. ' +
          '(확정된 테이블 예약 접수. 호출 전 6개 데이터 필드 수집 필수. ' +
          '전체 예약 요약 낭독 및 명시적 구두 확인("예") 후에만 user_explicit_confirmation을 true로 설정)',
        parameters: {
          type: 'object',
          properties: {

            user_explicit_confirmation: {
              type:        'boolean',
              description:
                'CRITICAL: You MUST set this to true, but ONLY AFTER you have recited the FULL ' +
                'summary of the reservation to the user and they have explicitly said "Yes" or agreed. ' +
                'If the user has not verbally confirmed the full summary yet, DO NOT CALL THIS TOOL. ' +
                '(중요: 전체 예약 요약을 사용자에게 낭독하고 명시적으로 "예"라고 동의한 후에만 true로 설정. ' +
                '아직 구두 확인이 없으면 이 도구를 호출하지 말 것)',
            },

            customer_name: {
              type:        'string',
              description: 'Full name of the customer making the reservation (예약자 성명)',
            },

            customer_phone: {
              type:        'string',
              description: 'Customer phone number for reservation confirmation (예약 확인용 고객 전화번호)',
            },

            customer_email: {
              type:        'string',
              description: 'Customer email address for reservation confirmation receipt (예약 확인 영수증 전송용 이메일)',
            },

            reservation_date: {
              type:        'string',
              description: 'Date of the reservation in YYYY-MM-DD format (예약 날짜 — YYYY-MM-DD 형식)',
            },

            reservation_time: {
              type:        'string',
              description: 'Time of the reservation in HH:MM 24-hour format (예약 시간 — HH:MM 24시간 형식)',
            },

            party_size: {
              type:        'number',
              description: 'Number of guests in the party — must be ≥ 1 (파티 인원 수 — 최소 1 이상)',
            },

          },
          required: ['user_explicit_confirmation', 'customer_name', 'customer_phone', 'customer_email', 'reservation_date', 'reservation_time', 'party_size'],
        },
      },

      // ── save_customer_consent (ACTIVE) ────────────────────────────────────────
      // Persist a customer's details to the CRM and POS only after the customer
      // has explicitly said "Yes" to the consent question asked in the RETENTION LOOP.
      // The server resolves store_id from the session — never pass it as an argument.
      // Calling this tool without a preceding verbal "Yes" is a protocol violation.
      // (고객이 보존 루프 동의 질문에 명시적으로 "예"라고 한 후에만 CRM 및 POS에 정보 저장.
      //  store_id는 세션에서 서버 측 처리 — 인수로 전달하지 말 것.
      //  구두 "예" 없이 이 도구를 호출하는 것은 프로토콜 위반)
      {
        name: 'save_customer_consent',
        description:
          'Save the customer\'s contact details to the CRM and POS after they have EXPLICITLY ' +
          'agreed to save their information. ' +
          'ONLY call this tool after the customer has verbally said "Yes" to the question: ' +
          '"Would you like me to save your details for a faster experience next time?" ' +
          'Do NOT call this tool if the customer declines, is silent, or changes the subject. ' +
          'Do NOT call this automatically — always wait for the customer\'s explicit verbal "Yes". ' +
          '(고객이 "다음에 더 빠른 서비스를 위해 정보를 저장해드릴까요?" 질문에 명시적으로 "예"라고 한 후에만 호출. ' +
          '거절, 침묵, 주제 변경 시 절대 호출하지 말 것. 자동 호출 금지 — 항상 명시적 구두 동의 대기)',
        parameters: {
          type: 'object',
          properties: {

            customer_name: {
              type:        'string',
              description: 'Full name of the customer to save — use the value already collected during the order or reservation (저장할 고객 성명 — 주문 또는 예약 중 수집된 값 사용)',
            },

            customer_phone: {
              type:        'string',
              description: 'Customer phone number to save — use the value already collected (저장할 고객 전화번호 — 이미 수집된 값 사용)',
            },

            customer_email: {
              type:        'string',
              description: 'Customer email address to save — use the value already collected (저장할 고객 이메일 주소 — 이미 수집된 값 사용)',
            },

          },
          required: ['customer_name', 'customer_phone', 'customer_email'],
        },
      },

    ],
  },
];

// ── LlmService ────────────────────────────────────────────────────────────────

export class LlmService {
  /**
   * Generate a response for the current conversation turn.
   *
   * Returns a discriminated LlmResult union — callers branch on `type`
   * without coupling to Gemini SDK internals.
   * (현재 대화 턴에 대한 응답 생성. 호출자가 Gemini SDK 내부와 결합하지 않고 `type`으로 분기)
   *
   * @param {Array<{role: 'user'|'model', parts: Array<{text: string}>}>} conversationHistory
   *   Full conversation so far — the LAST entry must be the new user message to respond to.
   *   (전체 대화 히스토리 — 마지막 항목이 응답할 새 사용자 메시지여야 함)
   *
   * @param {object} storeConfig   — tenant storeContext from req.storeContext (테넌트 스토어 컨텍스트)
   * @returns {Promise<LlmResult>}
   */
  async generateResponse(conversationHistory, storeConfig) {
    if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) {
      // Guard: callers must always provide at least one user turn (가드: 호출자는 최소 하나의 사용자 턴을 제공해야 함)
      throw new LlmError(
        '[LlmService] conversationHistory must be a non-empty array. ' +
        '(conversationHistory는 비어 있지 않은 배열이어야 합니다.)',
        'LlmService',
        'EMPTY_HISTORY'
      );
    }

    // Build per-tenant system instruction so the model knows which store it serves
    // (모델이 어느 매장을 담당하는지 알 수 있도록 테넌트별 시스템 지시문 구성)
    const systemInstruction = buildSystemInstruction(storeConfig);

    // Create a model instance per call — needed to apply per-tenant system instructions.
    // getGenerativeModel() is cheap (no network call); it just configures a request builder.
    // (호출마다 모델 인스턴스 생성 — 테넌트별 시스템 지시문 적용에 필요.
    //  getGenerativeModel()은 네트워크 호출 없음 — 단순 요청 빌더 설정)
    const model = _client.getGenerativeModel({
      model:             GEMINI_MODEL,
      tools:             POS_TOOLS,
      systemInstruction: { parts: [{ text: systemInstruction }] },
    });

    // Split history: prior turns feed the chat context; the last turn is the new user message.
    // (히스토리 분리: 이전 턴 → 채팅 컨텍스트, 마지막 턴 → 현재 전송 메시지)
    const priorHistory = conversationHistory.slice(0, -1);
    const latestTurn   = conversationHistory.at(-1);

    // Flatten the latest turn's parts into a single string for sendMessage()
    // (최신 턴의 parts 배열을 sendMessage() 단일 문자열로 평탄화)
    const userMessage = latestTurn.parts
      .filter((p) => typeof p.text === 'string')
      .map((p) => p.text)
      .join(' ')
      .trim();

    console.log(
      `[LlmService] → ${GEMINI_MODEL} | store: ${storeConfig.storeName} | ` +
      `history: ${priorHistory.length} turns | message: "${userMessage.slice(0, 60)}…" ` +
      `(${GEMINI_MODEL}에 메시지 전송 | 스토어: ${storeConfig.storeName} | ` +
      `히스토리: ${priorHistory.length}턴)`
    );

    try {
      // startChat() is stateless — Gemini manages context entirely via the history array.
      // (startChat()은 무상태 — Gemini는 히스토리 배열로만 컨텍스트 관리)
      const chat   = model.startChat({ history: priorHistory });
      const result = await chat.sendMessage(userMessage);

      // Inspect the first candidate's content parts for a functionCall part
      // (첫 번째 후보의 content parts에서 functionCall 파트 탐색)
      const parts      = result.response.candidates?.[0]?.content?.parts ?? [];
      const fnCallPart = parts.find((p) => p.functionCall != null);

      if (fnCallPart) {
        const { name, args } = fnCallPart.functionCall;

        console.log(
          `[LlmService] ↩ Tool call: "${name}" | args: ${JSON.stringify(args)} ` +
          `(도구 호출: "${name}" | 인수: ${JSON.stringify(args)})`
        );

        // Return a TOOL_CALL result — the controller decides the next action
        // (TOOL_CALL 반환 — 다음 동작은 컨트롤러가 결정)
        return { type: 'TOOL_CALL', name, args: args ?? {} };
      }

      // No function call — plain text to continue the voice conversation
      // (함수 호출 없음 — 음성 대화를 이어가는 일반 텍스트 응답)
      const text = result.response.text();

      console.log(
        `[LlmService] ↩ Text response (${text.length} chars) for ${storeConfig.storeName} ` +
        `(텍스트 응답 ${text.length}자 — 스토어: ${storeConfig.storeName})`
      );

      return { type: 'TEXT', text };

    } catch (err) {
      // Wrap raw SDK errors so callers only deal with LlmError (원시 SDK 오류 래핑 — 호출자는 LlmError만 처리)
      const code = err.status ? `GEMINI_HTTP_${err.status}` : 'GEMINI_ERROR';
      throw new LlmError(
        `[LlmService] Gemini API call failed: ${err.message} ` +
        `(Gemini API 호출 실패: ${err.message})`,
        'LlmService',
        code,
        err
      );
    }
  }
}

// ── Order Intent Extraction ───────────────────────────────────────────────────

/**
 * Extracts a normalized orderData object from a create_order TOOL_CALL result.
 * This is the hand-off point between the LLM layer and the BullMQ queue.
 *
 * Usage in a controller:
 *   const llmResult = await llmService.generateResponse(history, storeContext);
 *   if (llmResult.type === 'TOOL_CALL' && llmResult.name === 'create_order') {
 *     const orderData = extractOrderIntent(llmResult, storeContext);
 *     await enqueueOrder(orderData, storeContext);   // ← Step 4 producer
 *   }
 *
 * (LLM 레이어와 BullMQ 큐 사이의 전달 지점.
 *  컨트롤러에서: llmResult.type === 'TOOL_CALL' && llmResult.name === 'create_order'
 *  → extractOrderIntent() → enqueueOrder())
 *
 * @param {LlmResult} llmResult    — must be a TOOL_CALL result for create_order (create_order TOOL_CALL 결과여야 함)
 * @param {object}    storeContext — tenant context from req.storeContext (테넌트 스토어 컨텍스트)
 * @returns {object} orderData shape expected by the queue worker (큐 워커가 기대하는 orderData 형태)
 * @throws  {LlmError} if called with a non-create_order result (create_order 결과가 아니면 LlmError)
 */
export function extractOrderIntent(llmResult, storeContext) {
  if (llmResult.type !== 'TOOL_CALL' || llmResult.name !== 'create_order') {
    // Guard: caller should check before calling this helper (가드: 호출자는 이 함수 호출 전 확인해야 함)
    throw new LlmError(
      `[LlmService] extractOrderIntent called with non-create_order result: ` +
      `type="${llmResult.type}" name="${llmResult.name ?? 'n/a'}" ` +
      `(extractOrderIntent는 create_order TOOL_CALL에서만 호출 가능)`,
      'LlmService',
      'INVALID_INTENT_EXTRACTION'
    );
  }

  const { items, totalAmountCents, specialInstructions } = llmResult.args;

  // Build a canonical orderId — combines agentId + timestamp for uniqueness
  // (에이전트 ID + 타임스탬프 조합으로 고유 주문 ID 생성)
  const orderId = `llm-${storeContext.agentId}-${Date.now()}`;

  // Normalize Gemini args into the orderData shape the queue worker expects
  // (Gemini 인수를 큐 워커가 기대하는 orderData 형태로 정규화)
  return {
    orderId,
    items:               Array.isArray(items) ? items : [],
    totalAmountCents:    typeof totalAmountCents === 'number' ? totalAmountCents : 0,
    specialInstructions: specialInstructions ?? '',

    // Source metadata so the worker can distinguish LLM vs. Retell voice orders
    // (워커가 LLM 주문과 Retell 음성 주문을 구분하기 위한 소스 메타데이터)
    source:      'gemini_llm',
    agentId:     storeContext.agentId,
    storeName:   storeContext.storeName,
    receivedAt:  new Date().toISOString(),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a per-tenant system instruction string.
 * Injects the store name so the model greets customers with the correct brand.
 * (테넌트별 시스템 지시문 생성 — 매장명 주입으로 올바른 브랜드 페르소나 적용)
 *
 * @param {object} storeConfig
 * @returns {string}
 */
function buildSystemInstruction(storeConfig) {
  return (
    `You are a friendly and efficient voice ordering assistant for ${storeConfig.storeName}. ` +
    `Help customers browse the menu and place orders clearly. ` +
    `Always call check_menu before listing available items or taking any order. ` +
    `Verify stock_quantity before accepting each item — refuse gracefully if stock is insufficient. ` +
    `Call create_order only after the customer has confirmed every item and the total price. ` +
    `Keep all responses concise and natural — this is a voice interface, not a chat UI. ` +
    `(${storeConfig.storeName}의 친절하고 효율적인 음성 주문 도우미. ` +
    `항목 나열 또는 주문 접수 전 반드시 check_menu 호출. 재고 확인 후 부족 시 정중히 거절. ` +
    `고객이 항목·총 금액을 확인한 후에만 create_order 호출. 음성 인터페이스이므로 짧고 자연스러운 응답 유지)`
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * LlmResult — discriminated union returned by generateResponse().
 * Controllers branch on `type` to determine whether to reply, fetch menu, or enqueue an order.
 * (generateResponse()가 반환하는 판별 유니온.
 *  컨트롤러는 `type`으로 응답·메뉴 조회·주문 큐 등록 여부 결정)
 *
 * @typedef  {object}  LlmResult
 * @property {'TEXT' | 'TOOL_CALL'} type
 * @property {string}  [text]   — voice reply text when type === 'TEXT' (텍스트 응답)
 * @property {string}  [name]   — tool name when type === 'TOOL_CALL': 'check_menu' | 'create_order' | 'make_reservation' (도구명)
 * @property {object}  [args]   — Gemini-extracted tool arguments when type === 'TOOL_CALL' (도구 인수)
 */

/**
 * LlmError — structured error for Gemini API and service-layer failures.
 * Follows the same pattern as PaymentError and PosError.
 * (Gemini API 및 서비스 레이어 실패 구조화 오류 — PaymentError/PosError와 동일 패턴)
 */
export class LlmError extends Error {
  /**
   * @param {string} message   — human-readable description (오류 설명)
   * @param {string} service   — service that threw (오류 발생 서비스)
   * @param {string} [code]    — error code (오류 코드)
   * @param {Error}  [cause]   — original underlying error (원인 오류)
   */
  constructor(message, service, code = 'LLM_ERROR', cause = null) {
    super(message);
    this.name       = 'LlmError';
    this.service    = service;  // Service that threw (오류 발생 서비스)
    this.code       = code;     // Machine-readable code (머신 가독 코드)
    this.cause      = cause;    // Original error for stack traces (스택 추적용 원인 오류)
    this.statusCode = 502;      // Upstream AI service failure maps to 502 (AI 서비스 실패 → 502)
  }
}

// Singleton export — one LlmService instance per process (프로세스당 하나의 LlmService 인스턴스)
export const llmService = new LlmService();

// ── Stateful Chat Session Factory (legacy — kept for backward compatibility) ──

/**
 * Create a persistent Gemini chat session for a long-lived WebSocket connection.
 * NOTE: Prefer createGenerationModel() for new WebSocket connections — it gives full
 * control over history management, abort signals, and freeze prevention.
 * (장기 WebSocket 연결용 영구 Gemini 채팅 세션 생성.
 *  신규 WebSocket 연결에는 createGenerationModel() 사용 권장 — 히스토리 관리, abort 신호,
 *  동결 방지에 대한 완전한 제어 제공)
 *
 * @param {string} systemPrompt
 * @returns {import('@google/generative-ai').ChatSession}
 */
export function createChatSession(systemPrompt) {
  const model = _client.getGenerativeModel({
    model:             GEMINI_MODEL,
    tools:             POS_TOOLS,
    systemInstruction: { parts: [{ text: systemPrompt }] },
  });
  return model.startChat({ history: [] });
}

// ── Streaming Model Factory ───────────────────────────────────────────────────

/**
 * Create a pre-configured GenerativeModel for a WebSocket session.
 *
 * Unlike createChatSession() — which returns a stateful ChatSession that manages
 * history internally — this returns the raw model so the caller manages history
 * as a plain array. Use with model.generateContentStream({ contents: history })
 * for full control over abort signals, timeouts, and history rollback on barge-in.
 *
 * This is the correct primitive for freeze-free, interruptible voice streaming:
 *   - Each call is an independent HTTP request — no shared SDK state to corrupt.
 *   - History is committed only after a clean (non-aborted) generation completes.
 *   - An AbortController can reject the pending await before any history is written.
 *
 * (WebSocket 세션을 위한 사전 설정된 GenerativeModel 생성.
 *  내부적으로 히스토리를 관리하는 stateful ChatSession을 반환하는 createChatSession()과 달리,
 *  호출자가 히스토리를 일반 배열로 직접 관리하도록 원시 모델 반환.
 *  abort 신호, 타임아웃, 끼어들기 시 히스토리 롤백을 완전히 제어 가능.
 *  각 호출은 독립적인 HTTP 요청 — 공유 SDK 상태 손상 없음.
 *  히스토리는 정상(비중단) 생성 완료 후에만 커밋됨)
 *
 * @param {string} systemPrompt — Master prompt assembled from storeData (storeData로 조립된 마스터 프롬프트)
 * @returns {import('@google/generative-ai').GenerativeModel}
 */
export function createGenerationModel(systemPrompt) {
  return _client.getGenerativeModel({
    model:             GEMINI_MODEL,
    tools:             POS_TOOLS,
    systemInstruction: { parts: [{ text: systemPrompt }] },
  });
}
