// Analytics Dashboard v2 — shared component consumed by agency and store analytics pages.
// All KPI calculations are delegated to analyticsCalc.ts — do NOT duplicate logic here.
// mode='agency': auto-fetches all owned stores via auth.getUser().
// mode='store':  fetches a single store using the storeId prop.
// (애널리틱스 대시보드 v2 — 에이전시/매장 페이지에서 공유하는 컴포넌트.
//  모든 KPI 계산은 analyticsCalc.ts에 위임 — 여기서 중복 금지.
//  mode='agency': auth.getUser()로 소유 매장 자동 조회.
//  mode='store': storeId prop으로 단일 매장 조회)

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ComposedChart,
  Area,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
// Local tooltip props interface — avoids recharts v3 generic TooltipProps type incompatibilities (recharts v3 제네릭 TooltipProps 타입 비호환 문제 회피를 위한 로컬 인터페이스)
interface TooltipEntry {
  name?:    string;
  value?:   number | string;
  color?:   string;
  payload?: Record<string, unknown>;
}
interface RechartsTipProps {
  active?:  boolean;
  payload?: TooltipEntry[];
  label?:   string;
}
import {
  Phone,
  Clock,
  DollarSign,
  TrendingUp,
  RefreshCw,
  AlertTriangle,
  BarChart3,
  Activity,
  CheckCircle2,
  Download,
  FileText,
  ChevronRight,
} from 'lucide-react';
import { getSupabaseClient }                      from '@/shared/api/supabaseClient';
import {
  type DateRange,
  type KpiCallLog,
  type KpiOrder,
  getDateBoundary,
  calcKpis,
  formatUsd,
  formatCostCents,
} from '@/shared/utils/analyticsCalc';

// ── Local data shapes ──────────────────────────────────────────────────────────

// Full call_log row fetched from Supabase — superset of KpiCallLog (Supabase에서 조회하는 전체 call_log 행 — KpiCallLog의 슈퍼셋)
interface CallLog extends KpiCallLog {
  call_id:        string;
  start_time:     string;
  customer_phone: string | null;
  // sentiment and call_status inherited from KpiCallLog (sentiment와 call_status는 KpiCallLog에서 상속)
  sentiment:      string | null;
}

// Order row shape — inherits total_amount from KpiOrder (주문 행 형태 — KpiOrder에서 total_amount 상속)
interface Order extends KpiOrder {
  created_at: string;
}

// ── Chart palette ──────────────────────────────────────────────────────────────

// Named color constants keep chart styling consistent and editable in one place (차트 스타일링 일관성 및 단일 수정 포인트를 위한 명명된 색상 상수)
const C_EMERALD = '#10b981';
const C_INDIGO  = '#6366f1';
const C_ROSE    = '#f43f5e';
const C_AMBER   = '#f59e0b';
const C_SLATE   = '#475569';

const SENTIMENT_COLORS: Record<string, string> = {
  Positive: C_EMERALD,
  Neutral:  C_AMBER,
  Negative: C_ROSE,
};
const STATUS_COLORS = [C_EMERALD, C_ROSE];

const DAY_LABELS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_LABELS = ['9am','10am','11am','12pm','1pm','2pm','3pm','4pm','5pm','6pm','7pm','8pm','9pm','10pm'];

// ── Formatting helpers (local — not shared) ────────────────────────────────────

// Format a single call duration (seconds) as MM:SS for the Needs Attention table (Needs Attention 테이블을 위해 단일 통화 시간(초)을 MM:SS로 포맷)
function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
  const ss = (seconds % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

// Generic dark-themed recharts tooltip — cast to `never` at usage to satisfy v3 ContentType generics (v3 ContentType 제네릭을 충족시키기 위해 사용처에서 `never`로 캐스트하는 범용 다크 테마 툴팁)
function ChartTooltip({ active, payload, label }: RechartsTipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 shadow-xl text-xs">
      {label && <p className="text-slate-400 mb-1.5 font-medium">{label}</p>}
      {payload.map((entry: TooltipEntry, i: number) => (
        <p key={i} className="font-semibold" style={{ color: entry.color ?? C_EMERALD }}>
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

// Centered empty state for chart containers when no data exists for the selected period (선택 기간 데이터 없을 때 차트 컨테이너의 중앙 정렬 빈 상태)
function ChartEmpty() {
  return (
    <div className="flex flex-col items-center justify-center h-56 gap-2">
      <BarChart3 className="h-7 w-7 text-slate-700" />
      <p className="text-xs text-slate-600 text-center">No data available for this period</p>
    </div>
  );
}

// Animated pulse skeleton placeholder shown during the initial data fetch (초기 데이터 조회 중 표시되는 애니메이션 펄스 스켈레톤 플레이스홀더)
function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-slate-800/60 ${className ?? ''}`} />;
}

// KPI summary card with icon badge, label, large value, and optional sub-text (아이콘 배지, 레이블, 대형 값, 선택적 보조 텍스트가 있는 KPI 요약 카드)
function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = 'emerald',
}: {
  icon:    React.ElementType;
  label:   string;
  value:   string;
  sub?:    string;
  accent?: 'emerald' | 'blue' | 'amber' | 'rose' | 'indigo';
}) {
  // Map accent name to Tailwind background and text classes (액센트 이름을 Tailwind 배경 및 텍스트 클래스에 매핑)
  const accentCls: Record<string, string> = {
    emerald: 'text-emerald-400 bg-emerald-900/30',
    blue:    'text-blue-400    bg-blue-900/30',
    amber:   'text-amber-400   bg-amber-900/30',
    rose:    'text-rose-400    bg-rose-900/30',
    indigo:  'text-indigo-400  bg-indigo-900/30',
  };
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 flex gap-4 items-start">
      <div className={`mt-0.5 rounded-xl p-2.5 shrink-0 ${accentCls[accent]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-slate-500 mb-1 font-medium uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold text-slate-100 leading-none mb-1">{value}</p>
        {sub && <p className="text-xs text-slate-500">{sub}</p>}
      </div>
    </div>
  );
}

// Glassmorphism card wrapper for grouping chart sections (차트 섹션 그룹화용 글래스모피즘 카드 래퍼)
function ChartCard({ title, children, className }: {
  title:      string;
  children:   React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900/50 p-5 ${className ?? ''}`}>
      <p className="text-sm font-semibold text-slate-300 mb-4">{title}</p>
      {children}
    </div>
  );
}

// ── Main exported component ────────────────────────────────────────────────────

export interface AnalyticsDashboardProps {
  mode:             'agency' | 'store';
  storeId?:         string | null; // required when mode='store', ignored when mode='agency' (mode='store'일 때 필수, mode='agency'일 때 무시)
  emptyStateLabel?: string;        // shown only for mode='store' with no storeId (storeId 없는 mode='store'에서만 표시)
}

export function AnalyticsDashboard({
  mode,
  storeId,
  emptyStateLabel = 'Select a store to view analytics.',
}: AnalyticsDashboardProps) {

  const router = useRouter();

  // ── State ──────────────────────────────────────────────────────────────────
  const [allLogs,   setAllLogs  ] = useState<CallLog[]>([]);
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [loading,   setLoading  ] = useState(false);
  const [error,     setError    ] = useState<string | null>(null);
  // Default to 'month' — matches the Overview widget default period (개요 위젯 기본 기간과 일치시키기 위해 'month'로 기본 설정)
  const [dateRange, setDateRange] = useState<DateRange>('month');

  // ── Data fetching ──────────────────────────────────────────────────────────

  // Fetch call_logs and orders concurrently with server-side date filtering.
  // Date boundaries are applied in the Supabase query (not client-side) so that switching
  // the period selector always re-fetches and the KPIs update correctly.
  // Agency: resolves storeIds via auth.getUser() + stores table lookup.
  // Store: uses storeId prop directly.
  // (서버 사이드 날짜 필터링으로 call_logs와 orders를 동시에 조회.
  //  날짜 경계를 Supabase 쿼리에서 적용(클라이언트가 아님)하므로
  //  기간 선택기를 전환하면 항상 재조회되어 KPI가 올바르게 업데이트됨.
  //  에이전시: auth.getUser() + stores 테이블 조회로 storeIds 확인.
  //  매장: storeId prop 직접 사용)
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const supabase  = getSupabaseClient();
    let   storeIds: string[] = [];

    if (mode === 'agency') {
      // Resolve all stores owned by the authenticated agency user (인증된 에이전시 사용자 소유 전체 매장 확인)
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('Not authenticated.');
        setLoading(false);
        return;
      }
      const { data: stores, error: storesErr } = await supabase
        .from('stores')
        .select('id')
        .eq('owner_id', user.id);
      if (storesErr) {
        setError(storesErr.message);
        setLoading(false);
        return;
      }
      storeIds = (stores ?? []).map((s: { id: string }) => s.id);
      if (storeIds.length === 0) {
        // No stores linked to this account yet (이 계정에 아직 연결된 매장 없음)
        setAllLogs([]);
        setAllOrders([]);
        setLoading(false);
        return;
      }
    } else {
      // Store mode — caller guarantees storeId is non-null at this point (매장 모드 — 호출자가 이 시점에 storeId가 non-null임을 보장)
      if (!storeId) {
        setAllLogs([]);
        setAllOrders([]);
        setLoading(false);
        return;
      }
      storeIds = [storeId];
    }

    // Compute server-side date boundaries from the selected period using the shared utility (공유 유틸리티를 사용하여 선택된 기간에서 서버 사이드 날짜 경계 계산)
    const boundary = getDateBoundary(dateRange);
    const startIso = boundary ? boundary.toISOString() : null;
    // Upper bound is always the current moment — prevents any future-dated rows leaking in (상한은 항상 현재 시각 — 미래 날짜 행이 포함되는 것을 방지)
    const endIso   = new Date().toISOString();

    // Build the call_logs query — apply start_time bounds when a date range is active (날짜 범위가 활성화된 경우 start_time 경계를 적용하는 call_logs 쿼리 구성)
    let logsQuery = supabase
      .from('call_logs')
      .select('call_id, start_time, duration, sentiment, call_status, cost, customer_phone')
      .in('store_id', storeIds)
      .order('start_time', { ascending: false })
      .limit(1000);
    if (startIso) {
      // Filter call_logs by start_time so the date selector actually changes KPI values (날짜 선택기가 KPI 값을 실제로 변경하도록 start_time으로 call_logs 필터링)
      logsQuery = logsQuery.gte('start_time', startIso).lte('start_time', endIso);
    }

    // Build the orders query — restrict to paid orders only and apply the same date window (결제 완료 주문만으로 제한하고 동일한 날짜 창을 적용하는 orders 쿼리 구성)
    let ordersQuery = supabase
      .from('orders')
      .select('created_at, total_amount')
      .in('store_id', storeIds)
      // Fetch only paid orders — unpaid/pending orders must never be included in AI Revenue (결제 완료 주문만 조회 — 미결제/대기 주문은 AI 매출에 포함되어선 안 됨)
      .eq('status', 'paid')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (startIso) {
      // Apply created_at bounds in sync with the call_logs date filter (call_logs 날짜 필터와 동기화하여 created_at 경계 적용)
      ordersQuery = ordersQuery.gte('created_at', startIso).lte('created_at', endIso);
    }

    // Fetch both queries in parallel to minimise total wait time (총 대기 시간 최소화를 위해 두 쿼리를 병렬 실행)
    const [logsResult, ordersResult] = await Promise.all([logsQuery, ordersQuery]);

    setAllLogs((logsResult.data   as CallLog[] | null) ?? []);
    setAllOrders((ordersResult.data as Order[]  | null) ?? []);

    // Surface the first error encountered — second surfaced only if first is absent (첫 번째 오류를 노출 — 첫 번째 오류가 없을 때만 두 번째 오류 노출)
    if (logsResult.error)   setError(logsResult.error.message);
    if (ordersResult.error) setError((prev) => prev ?? ordersResult.error!.message);

    setLoading(false);
  // dateRange added to deps — changing the period triggers a re-fetch with new server-side bounds (dateRange를 의존성에 추가 — 기간 변경 시 새로운 서버 사이드 경계로 재조회 트리거)
  }, [mode, storeId, dateRange]);

  // Re-fetch whenever mode or storeId changes (mode 또는 storeId 변경 시 재조회)
  useEffect(() => {
    if (mode === 'agency' || storeId) {
      fetchData();
    } else {
      // Store mode with no storeId — clear state without fetching (storeId 없는 매장 모드 — 조회 없이 상태 초기화)
      setAllLogs([]);
      setAllOrders([]);
    }
  }, [mode, storeId, fetchData]);

  // ── Derived data ──────────────────────────────────────────────────────────

  // Server-side date filtering is applied inside fetchData — allLogs and allOrders already
  // contain only rows within the selected period. These aliases preserve all downstream
  // references (kpis, composedData, statusData, etc.) without touching any other logic.
  // (서버 사이드 날짜 필터링이 fetchData 내부에서 적용됨 — allLogs와 allOrders는 이미
  //  선택된 기간의 행만 포함. 이 별칭은 다른 로직을 변경하지 않고 모든 다운스트림
  //  참조(kpis, composedData, statusData 등)를 유지)
  const filteredLogs   = allLogs;
  const filteredOrders = allOrders;

  // Compute all 5 KPIs by delegating entirely to calcKpis() — no inline calculation here.
  // This guarantees CallStatsWidget and AnalyticsDashboard always produce identical numbers.
  // (calcKpis()에 완전히 위임하여 5개 KPI 모두 계산 — 여기서 인라인 계산 없음.
  //  이로써 CallStatsWidget과 AnalyticsDashboard가 항상 동일한 숫자를 생성하도록 보장)
  const kpis = useMemo(
    () => calcKpis(filteredLogs, filteredOrders),
    [filteredLogs, filteredOrders],
  );

  // Merge daily call counts and revenue into one series for the ComposedChart dual-axis view.
  // Revenue uses total_amount directly — no /100 conversion (it is already in USD).
  // (ComposedChart 이중 축 뷰를 위해 일별 통화 건수와 매출을 하나의 계열로 병합.
  //  total_amount를 직접 사용 — /100 변환 없음 (이미 USD 단위))
  const composedData = useMemo(() => {
    const byDate: Record<string, { dateKey: string; label: string; calls: number; revenue: number }> = {};

    // Accumulate call counts per calendar day using start_time (start_time으로 달력 일별 통화 건수 누적)
    filteredLogs.forEach((l) => {
      const dateKey = l.start_time.slice(0, 10);
      const label   = new Date(l.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (!byDate[dateKey]) byDate[dateKey] = { dateKey, label, calls: 0, revenue: 0 };
      byDate[dateKey].calls++;
    });

    // Accumulate revenue per calendar day using created_at and raw total_amount (USD) (created_at과 원시 total_amount(USD)로 달력 일별 매출 누적)
    filteredOrders.forEach((o) => {
      const dateKey = o.created_at.slice(0, 10);
      const label   = new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (!byDate[dateKey]) byDate[dateKey] = { dateKey, label, calls: 0, revenue: 0 };
      byDate[dateKey].revenue += (o.total_amount ?? 0);
    });

    return Object.values(byDate)
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
      .map(({ label, calls, revenue }) => ({
        date:    label,
        calls,
        // Round accumulated revenue to 2 decimal places to prevent floating-point drift (부동소수점 오차 방지를 위해 누적 매출을 소수점 2자리로 반올림)
        revenue: Math.round(revenue * 100) / 100,
      }));
  }, [filteredLogs, filteredOrders]);

  // Count calls by status for the Donut chart, excluding zero-value segments (0값 세그먼트를 제외하고 도넛 차트를 위해 상태별 통화 건수 집계)
  const statusData = useMemo(() => {
    const successful   = filteredLogs.filter((l) => l.call_status === 'Successful').length;
    const unsuccessful = filteredLogs.filter((l) => l.call_status === 'Unsuccessful').length;
    return [
      { name: 'Successful',   value: successful   },
      { name: 'Unsuccessful', value: unsuccessful },
    ].filter((d) => d.value > 0);
  }, [filteredLogs]);

  // Count calls by sentiment category for the BarChart (BarChart를 위해 감정 카테고리별 통화 건수 집계)
  const sentimentData = useMemo(() => {
    const counts: Record<string, number> = { Positive: 0, Neutral: 0, Negative: 0 };
    filteredLogs.forEach((l) => {
      if (l.sentiment && l.sentiment in counts) counts[l.sentiment]++;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filteredLogs]);

  // Build 7×14 heatmap matrix [dayIndex][hourIndex] — Mon-first, hours 9–22.
  // JS getDay() returns 0=Sun; (getDay()+6)%7 maps it to 0=Mon for display alignment.
  // (요일 인덱스 0=월 기준 7×14 히트맵 행렬 생성 — JS getDay()는 0=일 반환; (getDay()+6)%7로 0=월 매핑)
  const heatmapMatrix = useMemo(() => {
    const matrix: number[][] = Array.from({ length: 7 }, () => new Array(14).fill(0));
    filteredLogs.forEach((l) => {
      const d      = new Date(l.start_time);
      const dayIdx = (d.getDay() + 6) % 7; // Convert Sun=0 to Mon=0 (일=0을 월=0으로 변환)
      const hour   = d.getHours();
      if (hour >= 9 && hour <= 22) matrix[dayIdx][hour - 9]++;
    });
    return matrix;
  }, [filteredLogs]);

  // Max cell value used to normalise heatmap opacity, floor at 1 to avoid division by zero (0으로 나누기 방지를 위해 최솟값 1로 설정한 히트맵 투명도 정규화용 최댓값)
  const maxHeat = useMemo(() => Math.max(...heatmapMatrix.flat(), 1), [heatmapMatrix]);

  // Pick the 5 most recent Negative-sentiment or Unsuccessful calls for the Needs Attention table (Needs Attention 테이블을 위해 최근 Negative 감정 또는 Unsuccessful 통화 5건 선택)
  const needsAttention = useMemo(
    () => filteredLogs
      .filter((l) => l.sentiment === 'Negative' || l.call_status === 'Unsuccessful')
      .slice(0, 5),
    [filteredLogs],
  );

  // ── CSV export ─────────────────────────────────────────────────────────────

  // Build CSV from filteredLogs using the unified cost formatting (unified formatCostCents) and trigger a browser download (통합된 비용 포맷으로 filteredLogs에서 CSV를 생성하고 브라우저 다운로드 트리거)
  function downloadCSV() {
    const headers = ['Date', 'Customer Phone', 'Status', 'Sentiment', 'Duration (s)', 'Cost (USD)'];
    const rows = filteredLogs.map((l) => [
      new Date(l.start_time).toLocaleString('en-US'),
      l.customer_phone  ?? '',
      l.call_status,
      l.sentiment       ?? '',
      l.duration        ?? '',
      // Format cost as dollars — cost column stores cents (비용을 달러로 포맷 — cost 컬럼은 센트 단위)
      l.cost != null ? formatCostCents(l.cost) : '',
    ]);
    const csv  = [headers, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Date range options config ───────────────────────────────────────────────
  const DATE_OPTIONS: { label: string; value: DateRange }[] = [
    { label: 'Today', value: 'today' },
    { label: 'Week',  value: 'week'  },
    { label: 'Month', value: 'month' },
    { label: 'All',   value: 'all'   },
  ];

  // ── Render — no store linked (store mode with null storeId) ───────────────
  if (mode === 'store' && !storeId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 text-center py-20">
        <Activity className="h-8 w-8 text-slate-700 mb-3" />
        <p className="text-sm font-medium text-slate-500">{emptyStateLabel}</p>
      </div>
    );
  }

  // ── Render — main dashboard ────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">

      {/* Page heading and control bar (페이지 제목 및 컨트롤 바) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-100">Analytics</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {mode === 'agency'
              ? 'Aggregated AI voice agent performance across all your stores.'
              : 'AI voice agent performance overview for the selected period.'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Date range filter — segmented button group (날짜 범위 필터 — 세그먼트 버튼 그룹) */}
          <div className="flex rounded-lg border border-slate-800 overflow-hidden">
            {DATE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDateRange(opt.value)}
                className={[
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  dateRange === opt.value
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200',
                ].join(' ')}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* CSV export — disabled when no data available (데이터 없을 때 비활성화되는 CSV 내보내기) */}
          <button
            onClick={downloadCSV}
            disabled={loading || filteredLogs.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>

          {/* PDF export — triggers browser print dialog (브라우저 인쇄 대화상자를 트리거하는 PDF 내보내기) */}
          <button
            onClick={() => window.print()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FileText className="h-3.5 w-3.5" />
            PDF
          </button>

          {/* Refresh — re-fetches all data from Supabase (Supabase에서 모든 데이터 재조회) */}
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error banner (오류 배너) */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* 5 KPI cards — skeleton during load, then live values (로드 중 스켈레톤, 이후 라이브 값 표시되는 5개 KPI 카드) */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Rule 1: Total Calls — COUNT(*) from call_logs (규칙 1: 총 통화 — call_logs에서 COUNT(*)) */}
          <KpiCard
            icon={Phone}
            label="Total Calls"
            value={kpis.totalCalls.toLocaleString()}
            sub="counted from call_logs"
            accent="blue"
          />
          {/* Rule 2: AI Success Rate — (Successful / Total) * 100 (규칙 2: AI 성공률 — (성공 / 전체) * 100) */}
          <KpiCard
            icon={CheckCircle2}
            label="AI Success Rate"
            value={`${kpis.successRate}%`}
            sub="resolved successfully"
            accent="emerald"
          />
          {/* Rule 3: Time Handled — SUM(duration) / 60, displayed in minutes (규칙 3: 처리 시간 — SUM(duration) / 60, 분 단위 표시) */}
          <KpiCard
            icon={Clock}
            label="Time Handled"
            value={kpis.timeHandled}
            sub="total call minutes"
            accent="amber"
          />
          {/* Rule 4: Total AI Cost — SUM(cost) / 100 (cost is in CENTS) (규칙 4: 총 AI 비용 — SUM(cost) / 100 (cost는 센트 단위)) */}
          <KpiCard
            icon={DollarSign}
            label="Total AI Cost"
            value={kpis.totalCost}
            sub="Retell AI usage"
            accent="rose"
          />
          {/* Rule 5: AI Revenue — SUM(total_amount) from orders, already in USD (규칙 5: AI 매출 — orders의 SUM(total_amount), 이미 USD 단위) */}
          <KpiCard
            icon={TrendingUp}
            label="AI Revenue"
            value={formatUsd(kpis.aiRevenue)}
            sub="from AI-assisted orders"
            accent="indigo"
          />
        </div>
      )}

      {/* ComposedChart (calls Area + revenue Line dual-axis) and Status Donut (통화 영역 + 매출 선 이중 축 ComposedChart와 상태 도넛) */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="lg:col-span-2 h-80" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Left Y-axis — daily call count (emerald Area). Right Y-axis — daily revenue in USD (indigo Line).
              Revenue uses total_amount as-is — no /100 applied (total_amount는 그대로 사용 — /100 적용 없음) */}
          <ChartCard title="Call Volume & Revenue Trend" className="lg:col-span-2">
            {composedData.length === 0 ? <ChartEmpty /> : (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={composedData} margin={{ top: 4, right: 16, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="gradCalls" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C_EMERALD} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={C_EMERALD} stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: C_SLATE }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  {/* Left axis — call count (좌측 축 — 통화 건수) */}
                  <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 10, fill: C_SLATE }} axisLine={false} tickLine={false} />
                  {/* Right axis — revenue in USD (우측 축 — USD 매출) */}
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: C_SLATE }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v}`} />
                  {/* Cast required: recharts v3 ContentType generic is overly strict (recharts v3 ContentType 제네릭이 과도하게 엄격하여 캐스트 필요) */}
                  <Tooltip content={ChartTooltip as never} />
                  <Legend iconType="circle" iconSize={7} wrapperStyle={{ paddingTop: '6px' }} formatter={(v) => <span className="text-xs text-slate-400">{v}</span>} />
                  <Area yAxisId="left" type="monotone" dataKey="calls" name="Calls" stroke={C_EMERALD} strokeWidth={2} fill="url(#gradCalls)" dot={false} activeDot={{ r: 4, fill: C_EMERALD, strokeWidth: 0 }} />
                  <Line yAxisId="right" type="monotone" dataKey="revenue" name="Revenue ($)" stroke={C_INDIGO} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: C_INDIGO, strokeWidth: 0 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Status breakdown donut — Successful (emerald) vs Unsuccessful (rose) (상태 분석 도넛 — 성공(에메랄드) 대 실패(로즈)) */}
          <ChartCard title="Status Breakdown">
            {statusData.length === 0 ? <ChartEmpty /> : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={statusData} cx="50%" cy="45%" innerRadius={65} outerRadius={95} paddingAngle={3} dataKey="value" strokeWidth={0}>
                    {statusData.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />)}
                  </Pie>
                  {/* Cast required: recharts v3 ContentType generic is overly strict (캐스트 필요) */}
                  <Tooltip
                    content={((props: RechartsTipProps) => {
                      const { active, payload } = props;
                      if (!active || !payload?.length) return null;
                      const entry = payload[0];
                      const total = statusData.reduce((s, d) => s + d.value, 0);
                      const pct   = total > 0 ? ((Number(entry.value) / total) * 100).toFixed(1) : '0';
                      const fill  = (entry.payload as { fill?: string } | undefined)?.fill ?? C_EMERALD;
                      return (
                        <div className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 shadow-xl text-xs">
                          <p className="font-semibold" style={{ color: fill }}>
                            {entry.name}: {entry.value} ({pct}%)
                          </p>
                        </div>
                      );
                    }) as never}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ paddingTop: '8px' }} formatter={(v) => <span className="text-xs text-slate-400">{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

        </div>
      )}

      {/* Sentiment BarChart and Needs Attention table (감정 BarChart와 Needs Attention 테이블) */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Sentiment analysis — Positive / Neutral / Negative bar chart (감정 분석 — Positive/Neutral/Negative 막대 차트) */}
          <ChartCard title="Sentiment Analysis">
            {sentimentData.every((d) => d.value === 0) ? <ChartEmpty /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={sentimentData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }} barSize={44}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: C_SLATE }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: C_SLATE }} axisLine={false} tickLine={false} />
                  {/* Cast required: recharts v3 ContentType generic is overly strict (캐스트 필요) */}
                  <Tooltip content={ChartTooltip as never} />
                  <Bar dataKey="value" name="Calls" radius={[6, 6, 0, 0]}>
                    {sentimentData.map((entry) => (
                      <Cell key={entry.name} fill={SENTIMENT_COLORS[entry.name] ?? C_SLATE} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Needs Attention — 5 most recent Negative or Unsuccessful calls, clickable to Call History (주의 필요 — 최근 Negative/Unsuccessful 통화 5건, 통화 기록으로 클릭 가능) */}
          <ChartCard title="Needs Attention">
            {needsAttention.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-44 gap-2.5">
                <CheckCircle2 className="h-8 w-8 text-emerald-900" />
                <p className="text-xs text-slate-600 text-center">No flagged calls in this period — great job!</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-800">
                      <th className="text-left pb-2.5 font-medium">Date</th>
                      <th className="text-left pb-2.5 font-medium">Phone</th>
                      <th className="text-left pb-2.5 font-medium">Status</th>
                      <th className="text-left pb-2.5 font-medium">Sentiment</th>
                      <th className="text-left pb-2.5 font-medium">Dur.</th>
                      <th className="pb-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {needsAttention.map((log, i) => (
                      // Navigate to Call History filtered by call_id on row click (행 클릭 시 call_id로 필터링된 통화 기록으로 이동)
                      <tr
                        key={i}
                        onClick={() => router.push(`/${mode}/call-history?call_id=${log.call_id}`)}
                        className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                      >
                        <td className="py-2.5 text-slate-400">
                          {new Date(log.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </td>
                        <td className="py-2.5 text-slate-300 font-mono">{log.customer_phone ?? '—'}</td>
                        <td className="py-2.5">
                          <span className={[
                            'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset',
                            log.call_status === 'Successful'
                              ? 'bg-emerald-900/40 text-emerald-400 ring-emerald-700'
                              : 'bg-rose-900/40   text-rose-400   ring-rose-700',
                          ].join(' ')}>
                            {log.call_status}
                          </span>
                        </td>
                        <td className="py-2.5">
                          <span className="text-[10px] font-medium" style={{ color: SENTIMENT_COLORS[log.sentiment ?? ''] ?? C_SLATE }}>
                            {log.sentiment ?? '—'}
                          </span>
                        </td>
                        <td className="py-2.5 text-slate-400 font-mono">{formatDuration(log.duration)}</td>
                        <td className="py-2.5 text-slate-600"><ChevronRight className="h-3.5 w-3.5" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-[10px] text-slate-600 italic">
                  5 most recent calls flagged as Negative or Unsuccessful. Click a row to view full details.
                </p>
              </div>
            )}
          </ChartCard>

        </div>
      )}

      {/* Peak Hours Heatmap — 7 days × 14 hours (9am–10pm), Mon-first layout (피크 시간 히트맵 — 7일 × 14시간(오전9시–오후10시), 월요일 기준 레이아웃) */}
      {loading ? <Skeleton className="h-48" /> : (
        <ChartCard title="Peak Call Hours">
          {filteredLogs.length === 0 ? <ChartEmpty /> : (
            <div className="overflow-x-auto">
              <div className="min-w-[580px]">
                {/* Hour header row (시간 헤더 행) */}
                <div className="flex gap-1 mb-1 pl-10">
                  {HOUR_LABELS.map((h) => (
                    <div key={h} className="flex-1 text-center text-[9px] text-slate-600 font-medium">{h}</div>
                  ))}
                </div>
                {/* Day rows Mon–Sun (월–일 요일 행) */}
                {DAY_LABELS.map((day, dayIdx) => (
                  <div key={day} className="flex items-center gap-1 mb-1">
                    <div className="w-9 shrink-0 text-[10px] text-slate-500 font-medium text-right pr-1.5">{day}</div>
                    {HOUR_LABELS.map((_, hourIdx) => {
                      const count     = heatmapMatrix[dayIdx][hourIdx];
                      // Scale intensity 0→1 relative to the busiest cell (가장 바쁜 셀 기준으로 강도 0→1 스케일)
                      const intensity = count / maxHeat;
                      return (
                        <div
                          key={hourIdx}
                          title={`${day} ${HOUR_LABELS[hourIdx]}: ${count} call${count !== 1 ? 's' : ''}`}
                          className="flex-1 h-7 rounded"
                          style={{
                            backgroundColor: count > 0
                              ? `rgba(16, 185, 129, ${0.12 + intensity * 0.85})`
                              : 'rgba(30, 41, 59, 0.6)',
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
                {/* Gradient legend bar (그라디언트 범례 막대) */}
                <div className="flex items-center gap-2 mt-2 pl-10">
                  <span className="text-[9px] text-slate-600">Low</span>
                  <div className="flex-1 h-1.5 rounded-full" style={{ background: 'linear-gradient(to right, rgba(16,185,129,0.12), rgba(16,185,129,0.97))' }} />
                  <span className="text-[9px] text-slate-600">High</span>
                </div>
              </div>
            </div>
          )}
        </ChartCard>
      )}

    </div>
  );
}
