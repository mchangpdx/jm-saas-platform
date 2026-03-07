// Shared analytics calculation utilities — single source of truth for all KPI logic.
// Consumed by both CallStatsWidget (overview) and AnalyticsDashboard to guarantee identical numbers
// regardless of which dashboard the user is viewing.
// (공유 애널리틱스 계산 유틸리티 — 모든 KPI 로직의 단일 진실 소스.
//  사용자가 어느 대시보드를 보더라도 동일한 숫자를 보장하기 위해
//  CallStatsWidget(개요)과 AnalyticsDashboard 모두에서 사용)

// ── Date range type ────────────────────────────────────────────────────────────

// Preset time-window identifiers — all consumers must use this type (모든 소비자가 이 타입을 사용해야 하는 시간 창 식별자)
export type DateRange = 'today' | 'week' | 'month' | 'all';

// ── Date boundary helpers ──────────────────────────────────────────────────────

// Compute the inclusive lower-bound Date for a given range, or null for "all time".
// week and month use ROLLING windows (7 and 30 days back from right now) so the filter
// is always relative to the current moment, not the start of a calendar week or month.
// today uses local midnight so it captures the full current calendar day.
// This is the ONLY place where date range boundaries are computed — do not duplicate.
// (주어진 범위의 포함 하한 Date 계산, "전체 기간"이면 null 반환.
//  week와 month는 달력 기준이 아닌 현재 시각 기준 롤링 창(각 7일, 30일)을 사용.
//  today는 로컬 자정을 사용하여 현재 달력 일 전체를 포함.
//  이 함수가 날짜 범위 경계를 계산하는 유일한 위치 — 중복 금지)
export function getDateBoundary(range: DateRange): Date | null {
  if (range === 'all') return null;

  const now = new Date();

  if (range === 'today') {
    // Midnight of today in local time — includes the full current calendar day (로컬 시간 기준 오늘 자정 — 현재 달력 일 전체 포함)
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  if (range === 'week') {
    // Rolling 7 days — exactly 7 × 24 h ago from right now, not the last Sunday (현재 기준 정확히 7일 전 롤링 창 — 지난 일요일 기준이 아님)
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  // month — rolling 30 days: exactly 30 × 24 h ago from right now, not the 1st of the month (현재 기준 정확히 30일 전 롤링 창 — 이번 달 1일 기준이 아님)
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
}

// Convert a DateRange to an ISO string suitable for Supabase .gte() filters, or null for no filter.
// (Supabase .gte() 필터에 적합한 ISO 문자열로 DateRange를 변환, 필터 없으면 null 반환)
export function boundaryToIso(range: DateRange): string | null {
  const d = getDateBoundary(range);
  return d ? d.toISOString() : null;
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

// Format total call seconds as plain minutes: SUM(duration) / 60 → "42 min".
// Rule: Time Handled is always displayed in minutes, not hours/minutes.
// (총 통화 초를 분으로 포맷: SUM(duration) / 60 → "42 min".
//  규칙: Time Handled는 항상 시간/분이 아닌 분 단위로 표시)
export function formatMinutes(totalSeconds: number): string {
  if (totalSeconds === 0) return '0 min';
  const mins = Math.round(totalSeconds / 60);
  return `${mins.toLocaleString('en-US')} min`;
}

// Format a dollar amount with 2 decimal places — e.g., $1,250.00.
// Used for AI Revenue where total_amount is already stored in USD.
// (소수점 2자리 달러 금액 포맷 — 예: $1,250.00.
//  total_amount가 이미 USD 단위로 저장된 AI Revenue에 사용)
export function formatUsd(dollars: number): string {
  return new Intl.NumberFormat('en-US', {
    style:                 'currency',
    currency:              'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars);
}

// Format a cost value stored in CENTS to a dollar string: SUM(cost) / 100 → "$0.00".
// Only applies to the call_logs.cost column — that column stores cents, not dollars.
// (센트 단위로 저장된 비용 값을 달러 문자열로 포맷: SUM(cost) / 100 → "$0.00".
//  call_logs.cost 컬럼에만 적용 — 해당 컬럼은 달러가 아닌 센트 단위로 저장)
export function formatCostCents(cents: number): string {
  return formatUsd(cents / 100);
}

// ── Minimal data shapes for KPI calculation ───────────────────────────────────

// Minimum call_log fields needed to compute all five KPIs (5개 KPI 계산에 필요한 최소 call_log 필드)
export interface KpiCallLog {
  call_status: string;
  duration:    number | null; // integer seconds (정수 초)
  cost:        number | null; // stored in CENTS — use formatCostCents() to display (센트 단위 저장)
}

// Minimum order fields needed to compute AI Revenue and Estimated Upsell (AI 매출 및 업셀 추정치 계산에 필요한 최소 order 필드)
export interface KpiOrder {
  total_amount: number | null; // stored in USD dollars — do NOT divide by 100 (USD 달러 단위 저장 — 100으로 나누지 말 것)
}

// Result shape returned by calcKpis() — all string fields are already formatted for display (calcKpis()가 반환하는 결과 형태 — 모든 문자열 필드는 이미 표시용으로 포맷됨)
export interface KpiResult {
  totalCalls:   number; // COUNT(*) from call_logs (call_logs에서 COUNT(*))
  successRate:  string; // percentage with one decimal, e.g., "87.5" (소수점 1자리 백분율)
  timeHandled:  string; // SUM(duration)/60 as "X min" (SUM(duration)/60의 "X min" 형식)
  totalCost:    string; // SUM(cost)/100 formatted as "$0.00" ("$0.00" 형식의 SUM(cost)/100)
  aiRevenue:    number; // SUM(total_amount) in USD — raw number for charts (USD 단위 SUM(total_amount) — 차트용 원시 숫자)
  upsellValue:  number; // aiRevenue * 0.15 — for Overview only (에이전시 개요 전용 AI 업셀 추정치)
}

// ── Unified KPI calculator ─────────────────────────────────────────────────────

// Calculate all KPIs from pre-filtered arrays using the single source of truth rules below.
// Callers must filter logs/orders by date BEFORE passing them to this function.
//
//   Rule 1 — Total Calls:       COUNT(*) from call_logs. Never count orders or reservations.
//   Rule 2 — AI Success Rate:   (COUNT(call_status='Successful') / totalCalls) * 100
//   Rule 3 — Time Handled:      SUM(duration) / 60, displayed in minutes via formatMinutes()
//   Rule 4 — Total AI Cost:     SUM(cost) / 100  (cost column is in CENTS)
//   Rule 5 — AI Revenue:        SUM(total_amount) (total_amount column is already in USD)
//   Rule 6 — Estimated Upsell:  aiRevenue * 0.15  (Overview only)
//
// (사전 필터링된 배열에서 아래 단일 진실 소스 규칙을 사용하여 모든 KPI를 계산합니다.
//  호출자는 이 함수에 전달하기 전에 날짜별로 로그/주문을 필터링해야 합니다.)
export function calcKpis(logs: KpiCallLog[], orders: KpiOrder[]): KpiResult {

  // Rule 1 — Total Calls: COUNT(*) from call_logs only (규칙 1 — 총 통화: call_logs에서 COUNT(*)만)
  const totalCalls = logs.length;

  // Rule 2 — AI Success Rate: successful calls divided by total, as a percentage string (규칙 2 — AI 성공률: 성공 통화를 전체로 나눈 백분율 문자열)
  const successfulCalls = logs.filter((l) => l.call_status === 'Successful').length;
  const successRate = totalCalls > 0
    ? ((successfulCalls / totalCalls) * 100).toFixed(1)
    : '0.0';

  // Rule 3 — Time Handled: SUM(duration) / 60, displayed as plain minutes (규칙 3 — 처리 시간: SUM(duration) / 60, 분 단위 표시)
  const totalSeconds = logs.reduce((acc, l) => acc + (l.duration ?? 0), 0);
  const timeHandled  = formatMinutes(totalSeconds);

  // Rule 4 — Total AI Cost: SUM(cost) / 100 — cost column stores CENTS (규칙 4 — 총 AI 비용: SUM(cost) / 100 — cost 컬럼은 센트 단위)
  const totalCostCents = logs.reduce((acc, l) => acc + (l.cost ?? 0), 0);
  const totalCost      = formatCostCents(totalCostCents);

  // Rule 5 — AI Revenue: SUM(total_amount) — total_amount is already in USD, no division needed (규칙 5 — AI 매출: SUM(total_amount) — total_amount는 이미 USD 단위, 나눗셈 불필요)
  const rawRevenue  = orders.reduce((acc, o) => acc + (o.total_amount ?? 0), 0);
  // Round to 2 decimal places to prevent floating-point accumulation drift (부동소수점 누적 오차 방지를 위해 소수점 2자리로 반올림)
  const aiRevenue   = Math.round(rawRevenue * 100) / 100;

  // Rule 6 — Estimated Upsell: aiRevenue * 0.15 (규칙 6 — 예상 업셀: aiRevenue * 0.15)
  const upsellValue = Math.round(aiRevenue * 0.15 * 100) / 100;

  return { totalCalls, successRate, timeHandled, totalCost, aiRevenue, upsellValue };
}
