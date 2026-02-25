// AI-specific routes — clean, simplified endpoints designed for LLM tool/function calling
// (AI 전용 라우트 — LLM 도구/함수 호출을 위해 설계된 간결한 엔드포인트)
//
// Mounted at /api/ai in app.js.
// Responses are intentionally minimal — only fields the AI needs, no internal metadata.
// (app.js에서 /api/ai에 마운트.
//  응답은 의도적으로 최소화 — AI에 필요한 필드만 포함, 내부 메타데이터 없음)

import { Router } from 'express';
import { supabase } from '../config/supabase.js';

export const aiRouter = Router();

// ── GET /menu ─────────────────────────────────────────────────────────────────

/**
 * Return a simplified, AI-friendly menu for a given store.
 *
 * Query params (쿼리 파라미터):
 *   store_id {string} — required; UUID of the store to fetch menu items for
 *                       (필수 — 메뉴 항목을 조회할 매장 UUID)
 *
 * Response shape (응답 형태):
 *   200 { items: [{ item_id, name, price, stock_quantity, available }] }
 *   400 { error: "store_id query param is required" }
 *   500 { error: "..." }
 *
 * The `available` flag is false when stock_quantity is 0 or null so the AI
 * can skip sold-out items without needing to interpret numeric stock values.
 * (stock_quantity가 0이거나 null일 때 available이 false — AI가 품절 항목을 숫자 해석 없이 건너뜀)
 */
aiRouter.get('/menu', async (req, res) => {
  const { store_id } = req.query;

  // Validate required query param — return immediately so the AI gets a clear error
  // (필수 쿼리 파라미터 검증 — AI가 명확한 오류를 받도록 즉시 반환)
  if (!store_id) {
    return res.status(400).json({ error: 'store_id query param is required (store_id 쿼리 파라미터 필수)' });
  }

  console.log(
    `[AiRoute] GET /menu | store_id: ${store_id} ` +
    `(AI 메뉴 조회 | 매장: ${store_id})`
  );

  // Fetch only the columns the AI needs — no internal UUIDs or raw DB metadata
  // (AI에 필요한 컬럼만 조회 — 내부 UUID 및 원시 DB 메타데이터 제외)
  const { data: menuItems, error } = await supabase
    .from('menu_items')
    .select('variant_id, name, price, stock_quantity')
    .eq('store_id', store_id);

  if (error) {
    console.error(
      `[AiRoute] GET /menu failed | store_id: ${store_id} | ${error.message} ` +
      `(AI 메뉴 조회 실패 | 매장: ${store_id} | 오류: ${error.message})`
    );
    return res.status(500).json({ error: error.message });
  }

  // Map to a simplified shape; flag sold-out items for the AI rather than exposing raw stock numbers
  // (간소화된 형태로 매핑 — 원시 재고 수치 대신 AI를 위한 품절 플래그 설정)
  const items = (menuItems ?? []).map((row) => ({
    item_id:        row.variant_id,                              // Expose variant_id as item_id — stable identifier for order creation (주문 생성을 위한 안정적인 식별자로 variant_id를 item_id로 노출)
    name:           row.name,
    price:          row.price,
    stock_quantity: row.stock_quantity ?? 0,
    available:      (row.stock_quantity ?? 0) > 0,              // false when sold out — AI should not offer this item (품절 시 false — AI가 이 항목을 제안하면 안 됨)
  }));

  console.log(
    `[AiRoute] GET /menu success | store_id: ${store_id} | total: ${items.length} | ` +
    `available: ${items.filter((i) => i.available).length} ` +
    `(AI 메뉴 조회 성공 | 매장: ${store_id} | 전체: ${items.length} | 판매 가능: ${items.filter((i) => i.available).length})`
  );

  return res.status(200).json({ items });
});

// ── POST /order ───────────────────────────────────────────────────────────────

/**
 * Create a new pending order and return a mock payment link for the customer.
 *
 * Body params (바디 파라미터):
 *   store_id       {string}  — required; UUID of the store (필수 — 매장 UUID)
 *   items          {Array}   — required; [{ item_id, quantity }] (필수 — 주문 항목 배열)
 *   customer_phone {string}  — optional; for SMS delivery of the payment link (선택 — 결제 링크 SMS 전송용)
 *
 * Pipeline (파이프라인):
 *   1. Validate required fields (필수 필드 검증)
 *   2. Look up each item_id in menu_items to verify price and availability
 *      (menu_items에서 각 item_id 조회 — 가격 및 판매 가능 여부 확인)
 *   3. Calculate total_amount from DB prices — prevents client-side price tampering
 *      (DB 가격으로 total_amount 계산 — 클라이언트 측 가격 조작 방지)
 *   4. Insert order row with status 'pending'
 *      (status 'pending'으로 주문 행 삽입)
 *   5. Return order_id and a mock payment URL
 *      (order_id와 목 결제 URL 반환)
 *
 * Response shape (응답 형태):
 *   200 { success: true, order_id, payment_url, message }
 *   400 { error: "..." }
 *   500 { error: "..." }
 */
aiRouter.post('/order', async (req, res) => {
  const { store_id, items, customer_phone } = req.body;

  // Validate required fields — AI callers must always provide store_id and a non-empty items array
  // (필수 필드 검증 — AI 호출자는 항상 store_id와 비어있지 않은 items 배열을 제공해야 함)
  if (!store_id) {
    return res.status(400).json({ error: 'store_id is required (store_id 필수)' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array (items는 비어있지 않은 배열이어야 함)' });
  }

  console.log(
    `[AiRoute] POST /order | store_id: ${store_id} | items: ${items.length} | ` +
    `customer_phone: ${customer_phone ?? 'none'} ` +
    `(AI 주문 생성 | 매장: ${store_id} | 항목 수: ${items.length} | 전화번호: ${customer_phone ?? '없음'})`
  );

  // ── Step 1: Resolve prices from menu_items (DB is the source of truth) ──────
  // Fetch all requested variant_ids in a single query to avoid N+1 round-trips
  // (N+1 왕복 방지를 위해 단일 쿼리로 요청된 모든 variant_id 조회)
  const itemIds = items.map((i) => i.item_id);

  const { data: menuRecords, error: menuError } = await supabase
    .from('menu_items')
    .select('variant_id, name, price, stock_quantity')
    .eq('store_id', store_id)
    .in('variant_id', itemIds);

  if (menuError) {
    console.error(
      `[AiRoute] POST /order menu lookup failed | store_id: ${store_id} | ${menuError.message} ` +
      `(AI 주문 메뉴 조회 실패 | 매장: ${store_id} | 오류: ${menuError.message})`
    );
    return res.status(500).json({ error: menuError.message });
  }

  // Build a variant_id → menu record map for O(1) price lookup per line item
  // (라인 항목당 O(1) 가격 조회를 위한 variant_id → 메뉴 레코드 맵 생성)
  const menuMap = new Map((menuRecords ?? []).map((r) => [r.variant_id, r]));

  // ── Step 2: Validate each requested item and calculate total_amount ─────────
  let totalAmount = 0;
  const resolvedItems = [];

  for (const reqItem of items) {
    const record = menuMap.get(reqItem.item_id);

    if (!record) {
      // Item not found in this store's menu — reject the order to avoid ghost items
      // (이 매장의 메뉴에 없는 항목 — 유령 항목 방지를 위해 주문 거부)
      return res.status(400).json({
        error: `Item not found in store menu | item_id: ${reqItem.item_id} (매장 메뉴에 없는 항목 | item_id: ${reqItem.item_id})`,
      });
    }

    const qty = parseInt(reqItem.quantity ?? 1, 10);
    totalAmount += record.price * qty;

    // Carry the resolved name for the stored items payload (저장될 items 페이로드에 확인된 이름 포함)
    resolvedItems.push({ item_id: reqItem.item_id, name: record.name, quantity: qty, unit_price: record.price });
  }

  totalAmount = parseFloat(totalAmount.toFixed(2));

  // ── Step 3: Insert order row into Supabase ──────────────────────────────────
  const { data: newOrder, error: insertError } = await supabase
    .from('orders')
    .insert({
      store_id,
      status:         'pending',                     // Order lifecycle starts as pending — updated to 'paid' after payment (주문 생명주기는 pending으로 시작 — 결제 후 'paid'로 업데이트)
      items:          resolvedItems,                 // Full resolved line items with names and unit prices (이름·단가가 포함된 전체 확인 라인 항목)
      total_amount:   totalAmount,                   // Server-calculated total — not trusted from the client (서버에서 계산한 총액 — 클라이언트 값 불신)
      customer_phone: customer_phone ?? null,        // Optional — used for SMS payment link delivery (선택적 — SMS 결제 링크 전송에 사용)
    })
    .select('id')
    .single();

  if (insertError || !newOrder) {
    console.error(
      `[AiRoute] POST /order insert failed | store_id: ${store_id} | ` +
      `${insertError?.message ?? 'no row returned'} ` +
      `(AI 주문 삽입 실패 | 매장: ${store_id} | 오류: ${insertError?.message ?? '행 없음'})`
    );
    return res.status(500).json({ error: insertError?.message ?? 'Failed to create order' });
  }

  // ── Step 4: Build mock payment URL and return to the AI ────────────────────
  // In production replace with a real payment gateway checkout URL.
  // LOYVERSE_REDIRECT_URI is the public base URL (ngrok or production domain).
  // (프로덕션에서는 실제 결제 게이트웨이 체크아웃 URL로 교체.
  //  LOYVERSE_REDIRECT_URI는 공개 기본 URL — ngrok 또는 프로덕션 도메인)
  const baseUrl    = process.env.LOYVERSE_REDIRECT_URI ?? 'http://localhost:3000';
  const paymentUrl = `${baseUrl}/api/payment/mock/${newOrder.id}`;

  console.log(
    `[AiRoute] POST /order success | order_id: ${newOrder.id} | total: ${totalAmount} | ` +
    `payment_url: ${paymentUrl} ` +
    `(AI 주문 생성 성공 | 주문: ${newOrder.id} | 총액: ${totalAmount} | 결제 링크: ${paymentUrl})`
  );

  return res.status(200).json({
    success:     true,
    order_id:    newOrder.id,
    payment_url: paymentUrl,
    message:     'Order created. Send this link to the customer.',
  });
});
