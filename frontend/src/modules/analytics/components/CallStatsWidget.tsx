// CallStatsWidget — client component that shows three KPI cards for the current calendar month:
//   "Total Calls Handled"    — combined count of orders + reservations this month.
//   "Total AI Revenue"       — sum of total_amount (USD) from orders this month.
//   "Estimated Upsell Value" — 15% of total revenue, quantifying the AI dynamic upselling impact.
// Orders and reservations are fetched in parallel; partial failure still renders available data.
// Revenue is formatted as US dollars ($x,xxx.xx) throughout the component.
// (CallStatsWidget — 이번 달 세 가지 KPI 카드를 표시하는 클라이언트 컴포넌트:
//   "총 통화 처리"     — 이번 달 주문 + 예약 합산 카운트.
//   "총 AI 매출"       — 이번 달 주문의 total_amount 합계 (USD).
//   "예상 업셀 가치"   — 총 매출의 15% — AI 동적 업셀링 영향 정량화.
//  병렬 조회; 부분 실패 시에도 가용 데이터 렌더링. 매출은 전체적으로 미국 달러 형식 사용)

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Phone, DollarSign, TrendingUp }    from 'lucide-react';
import { getSupabaseClient }               from '@/shared/api/supabaseClient';
import { Spinner }                         from '@/shared/components/Spinner';

interface CallStatsWidgetProps {
  storeId: string;
}

// Computed KPI values for the current calendar month (이번 달 KPI 연산 결과)
interface Stats {
  totalCalls:   number; // orders + reservations count this month (이번 달 주문 + 예약 카운트)
  totalRevenue: number; // sum of total_amount from orders in USD (주문 total_amount 합계, USD)
  upsellValue:  number; // 15% of totalRevenue — AI upsell estimate (총 매출의 15% — AI 업셀 추정)
}

// Display format per card — 'count' renders as an integer, 'currency' renders as $x,xxx.xx.
// (카드별 표시 형식 — 'count'는 정수, 'currency'는 $x,xxx.xx로 렌더링)
type CardFormat = 'count' | 'currency';

interface StatCard {
  label:  string;
  value:  number;
  icon:   React.ElementType;
  color:  string;
  bg:     string;
  format: CardFormat;
  note:   string; // sub-label describing the metric (지표를 설명하는 보조 레이블)
}

// Format a number as US dollar currency — e.g., $1,250.00 (숫자를 미국 달러 통화 형식으로 변환)
function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// Return the ISO timestamp for the first moment of the current local calendar month.
// Local time is used so the filter aligns with the store's day boundaries, not UTC.
// (현재 로컬 달력 월의 첫 순간 ISO 타임스탬프 반환.
//  UTC가 아닌 매장의 일자 경계에 맞추기 위해 로컬 시간 사용)
function getMonthStartIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

// Return the YYYY-MM-01 date string for filtering the reservation_date DATE column.
// (reservation_date DATE 컬럼 필터링을 위해 YYYY-MM-01 날짜 문자열 반환)
function getMonthStartDate(): string {
  const now = new Date();
  const y   = now.getFullYear();
  const m   = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

// ── Main component ────────────────────────────────────────────────────────────

export function CallStatsWidget({ storeId }: CallStatsWidgetProps) {
  const [stats,   setStats  ] = useState<Stats>({ totalCalls: 0, totalRevenue: 0, upsellValue: 0 });
  const [loading, setLoading] = useState(true);
  const [error,   setError  ] = useState<string | null>(null);

  // Fetch orders (revenue + count) and reservation count in parallel for the current month.
  // Orders query returns rows so we can sum total_amount in JS, plus the server-side count.
  // Reservations query is head-only — only the count is needed, no rows transferred.
  // (이번 달 주문(매출+카운트)과 예약 카운트를 병렬 조회.
  //  주문 쿼리는 total_amount 합산을 위해 행을 반환하고 서버 사이드 카운트도 함께 제공.
  //  예약 쿼리는 head 전용 — 카운트만 필요, 행 전송 없음)
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const supabase       = getSupabaseClient();
    const monthStartIso  = getMonthStartIso();
    const monthStartDate = getMonthStartDate();

    const [ordersRes, resvRes] = await Promise.allSettled([
      // Fetch total_amount for every order this month — count is returned alongside.
      // (이번 달 모든 주문의 total_amount 조회 — count도 함께 반환)
      supabase
        .from('orders')
        .select('total_amount', { count: 'exact' })
        .eq('store_id', storeId)
        .gte('created_at', monthStartIso),

      // Head-only count of reservations whose reservation_date falls in the current month.
      // reservation_date is a DATE column — compare against YYYY-MM-DD string directly.
      // (이번 달에 해당하는 예약의 head 전용 카운트.
      //  reservation_date는 DATE 컬럼 — YYYY-MM-DD 문자열과 직접 비교)
      supabase
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('store_id', storeId)
        .gte('reservation_date', monthStartDate),
    ]);

    const errs: string[] = [];

    // Extract orders data — sum total_amount and read the server-side count.
    // (주문 데이터 추출 — total_amount 합산 및 서버 사이드 카운트 읽기)
    let ordersCount  = 0;
    let totalRevenue = 0;
    if (ordersRes.status === 'fulfilled' && !ordersRes.value.error) {
      ordersCount  = ordersRes.value.count ?? 0;
      totalRevenue = (ordersRes.value.data ?? []).reduce(
        (sum: number, row: { total_amount: unknown }) => sum + Number(row.total_amount ?? 0),
        0,
      );
    } else {
      errs.push(
        ordersRes.status === 'rejected'
          ? String(ordersRes.reason)
          : (ordersRes.value.error?.message ?? 'Orders fetch failed'),
      );
    }

    // Extract reservation count or record the error (예약 카운트 추출 또는 오류 기록)
    let resvCount = 0;
    if (resvRes.status === 'fulfilled' && !resvRes.value.error) {
      resvCount = resvRes.value.count ?? 0;
    } else {
      errs.push(
        resvRes.status === 'rejected'
          ? String(resvRes.reason)
          : (resvRes.value.error?.message ?? 'Reservations fetch failed'),
      );
    }

    // Round revenue to 2 decimal places then derive the 15% upsell estimate.
    // (매출을 소수점 2자리로 반올림한 뒤 15% 업셀 추정치 도출)
    const revenue = Math.round(totalRevenue * 100) / 100;
    const upsell  = Math.round(revenue * 0.15 * 100) / 100;

    setStats({ totalCalls: ordersCount + resvCount, totalRevenue: revenue, upsellValue: upsell });
    setError(errs.filter(Boolean).join(' | ') || null);
    setLoading(false);
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  // ── KPI card definitions — order sets left-to-right render in the grid ──────
  // (KPI 카드 정의 — 순서가 그리드의 왼쪽→오른쪽 렌더 순서를 결정)
  const CARDS: StatCard[] = [
    {
      label:  'Total Calls Handled',
      value:  stats.totalCalls,
      icon:   Phone,
      color:  'text-indigo-600 dark:text-indigo-400',
      bg:     'bg-indigo-50 dark:bg-indigo-900/20',
      format: 'count',
      note:   'Orders + reservations this month',
    },
    {
      label:  'Total AI Revenue',
      value:  stats.totalRevenue,
      icon:   DollarSign,
      color:  'text-green-600 dark:text-green-400',
      bg:     'bg-green-50 dark:bg-green-900/20',
      format: 'currency',
      note:   'From AI-processed orders this month',
    },
    {
      label:  'Estimated Upsell Value',
      value:  stats.upsellValue,
      icon:   TrendingUp,
      color:  'text-emerald-600 dark:text-emerald-400',
      bg:     'bg-emerald-50 dark:bg-emerald-900/20',
      format: 'currency',
      note:   '15% of revenue — AI upselling impact',
    },
  ];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {CARDS.map(({ label, value, icon: Icon, color, bg, format, note }) => (
        <div
          key={label}
          className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
        >
          {/* Card top row — label text and icon badge (카드 상단 행 — 레이블과 아이콘 배지) */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
            <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${bg}`}>
              <Icon className={`h-5 w-5 ${color}`} />
            </span>
          </div>

          {/* Metric value — spinner while loading, formatted value once resolved
              (로딩 중 스피너, 완료 후 포맷된 값으로 전환되는 지표 값) */}
          {loading ? (
            <div className="mt-4">
              <Spinner className="h-5 w-5 text-indigo-400" />
            </div>
          ) : (
            <p className="mt-4 text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
              {format === 'currency'
                ? formatUsd(value)
                : value.toLocaleString('en-US')}
            </p>
          )}

          {/* Sub-label note describing the metric source (지표 출처를 설명하는 보조 레이블) */}
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{note}</p>

          {/* Per-card error indicator — only shown when the fetch partially failed
              (부분 실패 시에만 표시되는 카드별 오류 표시기) */}
          {!loading && error && (
            <p className="mt-1 text-xs text-red-500 dark:text-red-400">Failed to load</p>
          )}
        </div>
      ))}
    </div>
  );
}
