// CallStatsWidget — KPI card trio for the store Overview page (current calendar month).
// All calculations are delegated to analyticsCalc.ts to guarantee numbers match AnalyticsDashboard.
//
//   "Total Calls"           — COUNT(*) from call_logs  (NOT orders + reservations)
//   "Total AI Revenue"      — SUM(total_amount) from orders  (total_amount is already in USD)
//   "Estimated Upsell"      — AI Revenue × 0.15
//
// Date range defaults to 'month' so it aligns with the Analytics dashboard's default period.
// Switching the segmented filter here will always produce the same numbers as Analytics when
// the same period is selected — both use getDateBoundary() from analyticsCalc.ts.
//
// (CallStatsWidget — 매장 개요 페이지의 KPI 카드 트리오 (현재 달력 월).
//  AnalyticsDashboard와 동일한 숫자를 보장하기 위해 analyticsCalc.ts에 모든 계산 위임.
//  날짜 범위는 Analytics 대시보드 기본 기간과 일치하도록 'month'로 기본 설정.
//  동일한 기간 선택 시 항상 Analytics와 동일한 숫자 — 모두 analyticsCalc.ts의 getDateBoundary() 사용)

'use client';

import { useState, useEffect, useCallback }        from 'react';
import { Phone, DollarSign, TrendingUp }           from 'lucide-react';
import { getSupabaseClient }                       from '@/shared/api/supabaseClient';
import { Spinner }                                 from '@/shared/components/Spinner';
import {
  type DateRange,
  type KpiCallLog,
  type KpiOrder,
  getDateBoundary,
  calcKpis,
  formatUsd,
} from '@/shared/utils/analyticsCalc';

interface CallStatsWidgetProps {
  storeId: string;
}

// Display format per card — determines the value renderer (카드별 표시 형식 — 값 렌더러를 결정)
type CardFormat = 'count' | 'currency';

interface StatCard {
  label:  string;
  value:  string;
  icon:   React.ElementType;
  color:  string;
  bg:     string;
  format: CardFormat;
  note:   string;
}

// ── Main component ────────────────────────────────────────────────────────────

export function CallStatsWidget({ storeId }: CallStatsWidgetProps) {
  const [loading, setLoading] = useState(true);
  const [error,   setError  ] = useState<string | null>(null);

  // Computed values passed to card definitions below (아래 카드 정의에 전달되는 계산된 값)
  const [totalCalls,  setTotalCalls ] = useState(0);
  const [aiRevenue,   setAiRevenue  ] = useState(0);
  const [upsellValue, setUpsellValue] = useState(0);

  // Date range filter — defaults to 'month' to match Analytics dashboard default (Analytics 대시보드 기본값과 일치하도록 'month'로 기본 설정)
  const [dateRange, setDateRange] = useState<DateRange>('month');

  // Fetch call_logs and orders for the given storeId, filter client-side by dateRange,
  // then compute KPIs via calcKpis() — the single source of truth.
  // (주어진 storeId에 대해 call_logs와 orders 조회, 클라이언트에서 dateRange로 필터링,
  //  단일 진실 소스인 calcKpis()로 KPI 계산)
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const supabase  = getSupabaseClient();
    // Compute the lower-bound date using the shared utility — guarantees alignment with Analytics (공유 유틸리티로 하한 날짜 계산 — Analytics와의 정렬 보장)
    const boundary  = getDateBoundary(dateRange);
    const boundaryIso = boundary ? boundary.toISOString() : null;

    // Fetch call_logs (for Total Calls, success rate, cost) and orders (for AI Revenue) in parallel (Total Calls·성공률·비용을 위한 call_logs와 AI 매출을 위한 orders를 병렬 조회)
    const [logsRes, ordersRes] = await Promise.allSettled([
      // Rule 1: Total Calls — COUNT(*) from call_logs filtered by start_time (규칙 1: 총 통화 — start_time으로 필터링된 call_logs에서 COUNT(*))
      boundaryIso
        ? supabase
            .from('call_logs')
            .select('call_status, duration, cost')
            .eq('store_id', storeId)
            .gte('start_time', boundaryIso)
        : supabase
            .from('call_logs')
            .select('call_status, duration, cost')
            .eq('store_id', storeId),

      // Rule 5: AI Revenue — SUM(total_amount) from orders filtered by created_at (규칙 5: AI 매출 — created_at으로 필터링된 orders에서 SUM(total_amount))
      boundaryIso
        ? supabase
            .from('orders')
            .select('total_amount')
            .eq('store_id', storeId)
            .gte('created_at', boundaryIso)
        : supabase
            .from('orders')
            .select('total_amount')
            .eq('store_id', storeId),
    ]);

    const errs: string[] = [];

    // Extract call_logs rows — these are used as KpiCallLog inputs to calcKpis() (calcKpis()의 KpiCallLog 입력으로 사용되는 call_logs 행 추출)
    let logs: KpiCallLog[] = [];
    if (logsRes.status === 'fulfilled' && !logsRes.value.error) {
      logs = (logsRes.value.data ?? []) as KpiCallLog[];
    } else {
      errs.push(
        logsRes.status === 'rejected'
          ? String(logsRes.reason)
          : (logsRes.value.error?.message ?? 'call_logs fetch failed'),
      );
    }

    // Extract orders rows — these are used as KpiOrder inputs to calcKpis() (calcKpis()의 KpiOrder 입력으로 사용되는 orders 행 추출)
    let orders: KpiOrder[] = [];
    if (ordersRes.status === 'fulfilled' && !ordersRes.value.error) {
      orders = (ordersRes.value.data ?? []) as KpiOrder[];
    } else {
      errs.push(
        ordersRes.status === 'rejected'
          ? String(ordersRes.reason)
          : (ordersRes.value.error?.message ?? 'orders fetch failed'),
      );
    }

    // Delegate all KPI arithmetic to calcKpis() — the single source of truth (단일 진실 소스인 calcKpis()에 모든 KPI 산술 위임)
    const result = calcKpis(logs, orders);

    setTotalCalls(result.totalCalls);
    setAiRevenue(result.aiRevenue);
    setUpsellValue(result.upsellValue);
    setError(errs.filter(Boolean).join(' | ') || null);
    setLoading(false);
  }, [storeId, dateRange]);

  // Re-fetch whenever storeId or dateRange changes (storeId 또는 dateRange 변경 시 재조회)
  useEffect(() => { load(); }, [load]);

  // ── Date range options ──────────────────────────────────────────────────────
  const DATE_OPTIONS: { label: string; value: DateRange }[] = [
    { label: 'Today', value: 'today' },
    { label: 'Week',  value: 'week'  },
    { label: 'Month', value: 'month' },
    { label: 'All',   value: 'all'   },
  ];

  // ── Card definitions — built from calculated state (계산된 상태로 구성된 카드 정의) ──
  const CARDS: StatCard[] = [
    {
      // Rule 1: Total Calls — COUNT(*) from call_logs, never orders + reservations (규칙 1: 총 통화 — call_logs에서 COUNT(*), orders + reservations 합산 금지)
      label:  'Total Calls Handled',
      value:  totalCalls.toLocaleString('en-US'),
      icon:   Phone,
      color:  'text-indigo-600 dark:text-indigo-400',
      bg:     'bg-indigo-50 dark:bg-indigo-900/20',
      format: 'count',
      note:   'AI calls from call_logs this period',
    },
    {
      // Rule 5: AI Revenue — SUM(total_amount) from orders; total_amount is already in USD (규칙 5: AI 매출 — orders의 SUM(total_amount); total_amount는 이미 USD 단위)
      label:  'Total AI Revenue',
      value:  formatUsd(aiRevenue),
      icon:   DollarSign,
      color:  'text-green-600 dark:text-green-400',
      bg:     'bg-green-50 dark:bg-green-900/20',
      format: 'currency',
      note:   'From AI-processed orders this period',
    },
    {
      // Rule 6: Estimated Upsell — AI Revenue × 0.15 (규칙 6: 예상 업셀 — AI 매출 × 0.15)
      label:  'Estimated Upsell Value',
      value:  formatUsd(upsellValue),
      icon:   TrendingUp,
      color:  'text-emerald-600 dark:text-emerald-400',
      bg:     'bg-emerald-50 dark:bg-emerald-900/20',
      format: 'currency',
      note:   '15% of revenue — AI upselling impact',
    },
  ];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">

      {/* Date range filter — same preset options as AnalyticsDashboard for aligned comparison (AnalyticsDashboard와 정렬된 비교를 위한 동일한 프리셋 옵션의 날짜 범위 필터) */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Period:</span>
        <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          {DATE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDateRange(opt.value)}
              className={[
                'px-3 py-1.5 text-xs font-medium transition-colors',
                dateRange === opt.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800',
              ].join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI card grid (KPI 카드 그리드) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {CARDS.map(({ label, value, icon: Icon, color, bg, note }) => (
          <div
            key={label}
            className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
          >
            {/* Card header — label and icon badge (카드 헤더 — 레이블과 아이콘 배지) */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
              <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${bg}`}>
                <Icon className={`h-5 w-5 ${color}`} />
              </span>
            </div>

            {/* Value — spinner during load, formatted string when resolved (값 — 로드 중 스피너, 완료 시 포맷된 문자열) */}
            {loading ? (
              <div className="mt-4">
                <Spinner className="h-5 w-5 text-indigo-400" />
              </div>
            ) : (
              <p className="mt-4 text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
                {value}
              </p>
            )}

            {/* Sub-label describing the metric source (지표 출처를 설명하는 보조 레이블) */}
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{note}</p>

            {/* Per-card error indicator shown only on partial fetch failure (부분 조회 실패 시에만 표시되는 카드별 오류 표시기) */}
            {!loading && error && (
              <p className="mt-1 text-xs text-red-500 dark:text-red-400">Failed to load</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
