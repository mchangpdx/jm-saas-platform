// Analytics Dashboard v2 — shared component consumed by agency and store analytics pages.
// Supports mode='agency' (auto-fetches all stores via auth) or mode='store' (uses storeId prop).
// (애널리틱스 대시보드 v2 — 에이전시/매장 애널리틱스 페이지에서 공유하는 컴포넌트.
//  mode='agency'는 auth로 전체 매장 자동 조회, mode='store'는 storeId prop 사용)

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
// Local tooltip props interface — avoids recharts v3 generic TooltipProps type incompatibilities.
// (로컬 툴팁 props 인터페이스 — recharts v3 제네릭 TooltipProps 타입 비호환 문제 회피)
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
import { getSupabaseClient } from '@/shared/api/supabaseClient';

// ── Types ──────────────────────────────────────────────────────────────────────

// Exact column subset fetched from call_logs — must match verified Postgres schema.
// (call_logs에서 조회하는 정확한 컬럼 서브셋 — 검증된 Postgres 스키마와 일치해야 함)
interface CallLog {
  call_id:        string;
  start_time:     string;
  duration:       number | null;  // integer seconds (정수 초)
  sentiment:      string | null;  // 'Positive' | 'Neutral' | 'Negative'
  call_status:    string;         // 'Successful' | 'Unsuccessful'
  cost:           number | null;  // stored in cents — divide by 100 for display (센트 단위 저장)
  customer_phone: string | null;
}

// Order row — used solely to compute AI Revenue KPI and daily revenue series.
// (주문 행 — AI 매출 KPI 및 일별 매출 계열 계산에만 사용)
interface Order {
  created_at:   string;
  total_amount: number | null;  // in cents (센트 단위)
}

// Date range preset options for the control bar (컨트롤 바의 날짜 범위 프리셋 옵션)
type DateRange = 'today' | 'week' | 'month' | 'all';

// ── Pure helpers ───────────────────────────────────────────────────────────────

// Format a raw second count into a compact "Xh Ym" string for the KPI card.
// (KPI 카드를 위해 원시 초를 "Xh Ym" 형식의 컴팩트 문자열로 포맷)
function formatTotalDuration(totalSeconds: number): string {
  if (totalSeconds === 0) return '0m';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// Format a single call duration in seconds to MM:SS for the Needs Attention table.
// (주의 필요 테이블을 위해 단일 통화 시간을 초에서 MM:SS로 포맷)
function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
  const ss = (seconds % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

// Format a numeric cost value (already in dollars) to a dollar string with 2 decimal places.
// (이미 달러 단위인 숫자 비용을 소수점 2자리 달러 문자열로 포맷)
function formatCost(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}

// Return a Date marking the start of the selected date range, or null for "all time".
// (선택된 날짜 범위의 시작 Date를 반환하거나, "전체 기간"인 경우 null 반환)
function getDateBoundary(range: DateRange): Date | null {
  if (range === 'all') return null;
  const d = new Date();
  if (range === 'today') {
    d.setHours(0, 0, 0, 0);
  } else if (range === 'week') {
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
  } else {
    // month — first day of current month (현재 월의 첫째 날)
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

// ── Chart palette ──────────────────────────────────────────────────────────────

// Named color constants keep chart styling consistent and editable in one place.
// (차트 스타일링을 일관되게 유지하고 한 곳에서 수정 가능하도록 색상 상수를 명명)
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

// ── Sub-components ─────────────────────────────────────────────────────────────

// Generic dark-themed Recharts tooltip injected via the `content` prop on <Tooltip>.
// Uses a local interface instead of recharts TooltipProps for v3 compatibility.
// (v3 호환성을 위해 recharts TooltipProps 대신 로컬 인터페이스를 사용하는 범용 다크 테마 툴팁)
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

// Centered empty state rendered inside chart containers when filtered data is empty.
// (필터링된 데이터가 없을 때 차트 컨테이너 내부에 렌더링되는 중앙 정렬 빈 상태)
function ChartEmpty() {
  return (
    <div className="flex flex-col items-center justify-center h-56 gap-2">
      <BarChart3 className="h-7 w-7 text-slate-700" />
      <p className="text-xs text-slate-600 text-center">No data available for this period</p>
    </div>
  );
}

// Animated pulse skeleton used as a placeholder during the initial data load.
// (초기 데이터 로드 중 플레이스홀더로 사용되는 애니메이션 펄스 스켈레톤)
function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-2xl bg-slate-800/60 ${className ?? ''}`} />
  );
}

// KPI summary card: icon badge + label + large numeric value + optional sub-text.
// (KPI 요약 카드: 아이콘 배지 + 레이블 + 대형 숫자 값 + 선택적 보조 텍스트)
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
  // Map accent variant to matching Tailwind color classes (액센트 변형을 Tailwind 색상 클래스에 매핑)
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

// Glassmorphism card wrapper used to group each chart section.
// (각 차트 섹션을 그룹화하는 데 사용되는 글래스모피즘 카드 래퍼)
function ChartCard({
  title,
  children,
  className,
}: {
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
  storeId?:         string | null;  // required when mode='store' (mode='store'일 때 필수)
  emptyStateLabel?: string;         // shown only when mode='store' and storeId is null (mode='store'이고 storeId가 없을 때만 표시)
}

export function AnalyticsDashboard({
  mode,
  storeId,
  emptyStateLabel = 'Select a store to view analytics.',
}: AnalyticsDashboardProps) {

  const router = useRouter();

  // ── State ──────────────────────────────────────────────────────────────────
  const [allLogs,    setAllLogs   ] = useState<CallLog[]>([]);
  const [allOrders,  setAllOrders ] = useState<Order[]>([]);
  const [loading,    setLoading   ] = useState(false);
  const [error,      setError     ] = useState<string | null>(null);
  // Default to 'month' so the dashboard is immediately meaningful on first load.
  // (첫 로드 시 대시보드가 즉시 의미 있게 표시되도록 기본값을 'month'로 설정)
  const [dateRange,  setDateRange ] = useState<DateRange>('month');

  // ── Data fetching ──────────────────────────────────────────────────────────

  // Fetch call_logs and orders — scope depends on mode.
  // Agency: resolves all store IDs via auth.getUser() + stores table.
  // Store: uses the storeId prop directly.
  // (통화 로그 및 주문 조회 — 스코프는 mode에 따라 결정.
  //  에이전시: auth.getUser() + stores 테이블로 전체 매장 ID 확인.
  //  매장: storeId prop 직접 사용)
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const supabase = getSupabaseClient();
    let storeIds: string[] = [];

    if (mode === 'agency') {
      // Resolve all stores owned by the authenticated user (인증된 사용자 소유 전체 매장 확인)
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
        // User has no stores yet — clear data and exit gracefully (매장 없음 — 데이터 초기화 후 종료)
        setAllLogs([]);
        setAllOrders([]);
        setLoading(false);
        return;
      }
    } else {
      // Store mode — storeId is guaranteed non-null at this call site (매장 모드 — 호출 시 storeId는 non-null 보장)
      if (!storeId) {
        setAllLogs([]);
        setAllOrders([]);
        setLoading(false);
        return;
      }
      storeIds = [storeId];
    }

    // Run both queries in parallel to minimize latency (지연 최소화를 위해 두 쿼리를 병렬 실행)
    const [logsResult, ordersResult] = await Promise.all([
      supabase
        .from('call_logs')
        .select('call_id, start_time, duration, sentiment, call_status, cost, customer_phone')
        .in('store_id', storeIds)
        .order('start_time', { ascending: false })
        .limit(1000),
      supabase
        .from('orders')
        .select('created_at, total_amount')
        .in('store_id', storeIds)
        .order('created_at', { ascending: false })
        .limit(1000),
    ]);

    setAllLogs((logsResult.data  as CallLog[] | null) ?? []);
    setAllOrders((ordersResult.data as Order[] | null) ?? []);
    if (logsResult.error)   setError(logsResult.error.message);
    if (ordersResult.error) setError((e) => e ?? ordersResult.error!.message);
    setLoading(false);
  }, [mode, storeId]);

  // Re-fetch when mode or storeId changes (mode 또는 storeId 변경 시 재조회)
  useEffect(() => {
    if (mode === 'agency') {
      fetchData();
    } else if (storeId) {
      fetchData();
    } else {
      setAllLogs([]);
      setAllOrders([]);
    }
  }, [mode, storeId, fetchData]);

  // ── Derived data ──────────────────────────────────────────────────────────

  // Apply the selected date range boundary to the raw log array (원시 로그 배열에 날짜 범위 경계 적용)
  const filteredLogs = useMemo(() => {
    const boundary = getDateBoundary(dateRange);
    if (!boundary) return allLogs;
    return allLogs.filter((l) => new Date(l.start_time) >= boundary);
  }, [allLogs, dateRange]);

  // Apply the same date boundary to orders (동일한 날짜 경계를 주문에 적용)
  const filteredOrders = useMemo(() => {
    const boundary = getDateBoundary(dateRange);
    if (!boundary) return allOrders;
    return allOrders.filter((o) => new Date(o.created_at) >= boundary);
  }, [allOrders, dateRange]);

  // Compute all 5 KPI values from the filtered data sets (필터링된 데이터 세트에서 5개 KPI 값 모두 계산)
  const kpis = useMemo(() => {
    const total          = filteredLogs.length;
    const successful     = filteredLogs.filter((l) => l.call_status === 'Successful').length;
    const totalSecs      = filteredLogs.reduce((acc, l) => acc + (l.duration ?? 0), 0);
    const totalCostCents = filteredLogs.reduce((acc, l) => acc + (l.cost ?? 0), 0);
    // Convert sum from cents to dollars before formatting (합계를 센트에서 달러로 변환 후 포맷)
    const totalCostDollars = totalCostCents / 100;
    const totalRevenueCents = filteredOrders.reduce((acc, o) => acc + (o.total_amount ?? 0), 0);
    const totalRevenueDollars = totalRevenueCents / 100;
    return {
      totalCalls:  total,
      successRate: total > 0 ? ((successful / total) * 100).toFixed(1) : '0.0',
      timeSaved:   formatTotalDuration(totalSecs),
      totalCost:   formatCost(totalCostDollars),
      aiRevenue:   formatCost(totalRevenueDollars),
    };
  }, [filteredLogs, filteredOrders]);

  // Merge daily call counts + revenue into one series for the ComposedChart.
  // Revenue divides by 100 (cents → dollars) before merging.
  // (ComposedChart을 위해 일별 통화 건수와 매출을 하나의 계열로 병합.
  //  매출은 센트→달러 변환 후 병합)
  const composedData = useMemo(() => {
    const byDate: Record<string, { dateKey: string; label: string; calls: number; revenue: number }> = {};

    filteredLogs.forEach((l) => {
      const dateKey = l.start_time.slice(0, 10);
      const label   = new Date(l.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (!byDate[dateKey]) byDate[dateKey] = { dateKey, label, calls: 0, revenue: 0 };
      byDate[dateKey].calls++;
    });

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
        // Divide revenue from cents to dollars for display (센트→달러 변환)
        revenue: parseFloat((revenue / 100).toFixed(2)),
      }));
  }, [filteredLogs, filteredOrders]);

  // Count calls by status for the Donut chart (도넛 차트를 위해 상태별 통화 건수 집계)
  const statusData = useMemo(() => {
    const successful   = filteredLogs.filter((l) => l.call_status === 'Successful').length;
    const unsuccessful = filteredLogs.filter((l) => l.call_status === 'Unsuccessful').length;
    return [
      { name: 'Successful',   value: successful   },
      { name: 'Unsuccessful', value: unsuccessful },
    ].filter((d) => d.value > 0);
  }, [filteredLogs]);

  // Count calls by sentiment category for the BarChart (막대 차트를 위해 감정 카테고리별 건수 집계)
  const sentimentData = useMemo(() => {
    const counts: Record<string, number> = { Positive: 0, Neutral: 0, Negative: 0 };
    filteredLogs.forEach((l) => {
      if (l.sentiment && l.sentiment in counts) counts[l.sentiment]++;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filteredLogs]);

  // Build a 7×14 heatmap matrix [dayOfWeek][hourIndex], Mon-first, hours 9–22.
  // getDay() returns 0=Sun; (getDay()+6)%7 converts to 0=Mon.
  // (요일 Mon 기준 7×14 히트맵 행렬 생성 [요일][시간], 시간 범위 9–22.
  //  getDay()는 0=일을 반환; (getDay()+6)%7로 0=월 변환)
  const heatmapMatrix = useMemo(() => {
    const matrix: number[][] = Array.from({ length: 7 }, () => new Array(14).fill(0));
    filteredLogs.forEach((l) => {
      const d      = new Date(l.start_time);
      const dayIdx = (d.getDay() + 6) % 7;   // 0=Mon … 6=Sun
      const hour   = d.getHours();
      if (hour >= 9 && hour <= 22) {
        matrix[dayIdx][hour - 9]++;
      }
    });
    return matrix;
  }, [filteredLogs]);

  // Max value in the heatmap — used to normalise cell opacity (히트맵 셀 투명도 정규화를 위한 최댓값)
  const maxHeat = useMemo(
    () => Math.max(...heatmapMatrix.flat(), 1),
    [heatmapMatrix],
  );

  // Pick the 5 most recent calls flagged as Negative sentiment or Unsuccessful status.
  // (Negative 감정 또는 Unsuccessful 상태로 표시된 최근 통화 5건 선택)
  const needsAttention = useMemo(() => {
    return filteredLogs
      .filter((l) => l.sentiment === 'Negative' || l.call_status === 'Unsuccessful')
      .slice(0, 5);
  }, [filteredLogs]);

  // ── CSV export ─────────────────────────────────────────────────────────────

  // Build a CSV from filteredLogs and trigger a browser download via a synthetic anchor.
  // (filteredLogs에서 CSV를 생성하고 합성 앵커를 통해 브라우저 다운로드 트리거)
  function downloadCSV() {
    const headers = ['Date', 'Customer Phone', 'Status', 'Sentiment', 'Duration (s)', 'Cost ($)'];
    const rows = filteredLogs.map((l) => [
      new Date(l.start_time).toLocaleString('en-US'),
      l.customer_phone ?? '',
      l.call_status,
      l.sentiment ?? '',
      l.duration  ?? '',
      l.cost != null ? (l.cost / 100).toFixed(4) : '',
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

  // ── Date range button config ────────────────────────────────────────────────
  const DATE_OPTIONS: { label: string; value: DateRange }[] = [
    { label: 'Today', value: 'today' },
    { label: 'Week',  value: 'week'  },
    { label: 'Month', value: 'month' },
    { label: 'All',   value: 'all'   },
  ];

  // ── Render — no store linked (store mode only) ─────────────────────────────
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

      {/* ── Page heading + control bar (페이지 제목 + 컨트롤 바) */}
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
          {/* Segmented date range filter (세그먼트 날짜 범위 필터) */}
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

          {/* CSV export — downloads filtered call_logs as a CSV file (필터링된 통화 로그를 CSV로 다운로드) */}
          <button
            onClick={downloadCSV}
            disabled={loading || filteredLogs.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>

          {/* PDF export — uses browser print dialog to capture the current page (브라우저 인쇄 대화상자로 현재 페이지 캡처) */}
          <button
            onClick={() => window.print()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FileText className="h-3.5 w-3.5" />
            PDF
          </button>

          {/* Refresh button — re-fetches the full data set from Supabase (Supabase에서 전체 데이터 재조회) */}
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

      {/* ── Error banner (오류 배너) */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── KPI Cards — 5-column responsive grid (KPI 카드 — 5열 반응형 그리드) */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Total Calls — raw count of all calls in the filtered period (필터 기간 내 전체 통화 건수) */}
          <KpiCard
            icon={Phone}
            label="Total Calls"
            value={kpis.totalCalls.toLocaleString()}
            sub="in the selected period"
            accent="blue"
          />
          {/* AI Success Rate — percentage of calls with 'Successful' status (성공 상태 통화 비율) */}
          <KpiCard
            icon={CheckCircle2}
            label="AI Success Rate"
            value={`${kpis.successRate}%`}
            sub="resolved successfully"
            accent="emerald"
          />
          {/* Total Time Handled — sum of all call durations (전체 통화 시간 합계) */}
          <KpiCard
            icon={Clock}
            label="Time Handled"
            value={kpis.timeSaved}
            sub="by the AI voice agent"
            accent="amber"
          />
          {/* Total AI Cost — sum of Retell usage costs; stored in cents, divided by 100 (Retell 사용 비용 합계; 센트 저장 후 100으로 나눔) */}
          <KpiCard
            icon={DollarSign}
            label="Total AI Cost"
            value={kpis.totalCost}
            sub="Retell AI usage"
            accent="rose"
          />
          {/* AI Revenue — sum of order total_amount in cents divided by 100 (주문 total_amount 합계를 100으로 나눈 AI 매출) */}
          <KpiCard
            icon={TrendingUp}
            label="AI Revenue"
            value={kpis.aiRevenue}
            sub="from AI-assisted orders"
            accent="indigo"
          />
        </div>
      )}

      {/* ── ComposedChart + Donut (ComposedChart + 도넛) */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="lg:col-span-2 h-80" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Call Volume + Revenue Trend — dual-axis ComposedChart.
              Left Y-axis (emerald Area): daily call count.
              Right Y-axis (indigo Line): daily revenue in dollars.
              (이중 Y축 ComposedChart.
               좌측 Y축(에메랄드 영역): 일별 통화 건수.
               우측 Y축(인디고 선): 일별 매출 달러) */}
          <ChartCard title="Call Volume & Revenue Trend" className="lg:col-span-2">
            {composedData.length === 0 ? (
              <ChartEmpty />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart
                  data={composedData}
                  margin={{ top: 4, right: 16, bottom: 0, left: -20 }}
                >
                  <defs>
                    {/* Emerald gradient fill for the calls area (통화 영역의 에메랄드 그라디언트 채우기) */}
                    <linearGradient id="gradCalls" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C_EMERALD} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={C_EMERALD} stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: C_SLATE }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  {/* Left Y-axis — call volume (좌측 Y축 — 통화량) */}
                  <YAxis
                    yAxisId="left"
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: C_SLATE }}
                    axisLine={false}
                    tickLine={false}
                  />
                  {/* Right Y-axis — revenue in dollars (우측 Y축 — 매출 달러) */}
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10, fill: C_SLATE }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `$${v}`}
                  />
                  {/* Cast required: recharts v3 ContentType generic is overly strict (recharts v3 ContentType 제네릭이 과도하게 엄격하여 캐스트 필요) */}
                  <Tooltip content={ChartTooltip as never} />
                  <Legend
                    iconType="circle"
                    iconSize={7}
                    wrapperStyle={{ paddingTop: '6px' }}
                    formatter={(v) => <span className="text-xs text-slate-400">{v}</span>}
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="calls"
                    name="Calls"
                    stroke={C_EMERALD}
                    strokeWidth={2}
                    fill="url(#gradCalls)"
                    dot={false}
                    activeDot={{ r: 4, fill: C_EMERALD, strokeWidth: 0 }}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue ($)"
                    stroke={C_INDIGO}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: C_INDIGO, strokeWidth: 0 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Call Status Breakdown — Successful (emerald) vs Unsuccessful (rose) donut.
              (통화 상태 분석 — 성공(에메랄드) 대 실패(로즈) 도넛 차트) */}
          <ChartCard title="Status Breakdown">
            {statusData.length === 0 ? (
              <ChartEmpty />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="45%"
                    innerRadius={65}
                    outerRadius={95}
                    paddingAngle={3}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {statusData.map((_, i) => (
                      <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />
                    ))}
                  </Pie>
                  {/* Cast required: recharts v3 ContentType generic is overly strict (캐스트 필요) */}
                  <Tooltip
                    content={((props: RechartsTipProps) => {
                      const { active, payload } = props;
                      if (!active || !payload?.length) return null;
                      const entry = payload[0];
                      const total = statusData.reduce((s, d) => s + d.value, 0);
                      const pct   = total > 0
                        ? ((Number(entry.value) / total) * 100).toFixed(1)
                        : '0';
                      // Show name, count, and percentage in the tooltip (툴팁에 이름·건수·비율 표시)
                      const fill = (entry.payload as { fill?: string } | undefined)?.fill ?? C_EMERALD;
                      return (
                        <div className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 shadow-xl text-xs">
                          <p className="font-semibold" style={{ color: fill }}>
                            {entry.name}: {entry.value} ({pct}%)
                          </p>
                        </div>
                      );
                    }) as never}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ paddingTop: '8px' }}
                    formatter={(v) => <span className="text-xs text-slate-400">{v}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

        </div>
      )}

      {/* ── Sentiment BarChart + Needs Attention (감정 막대 차트 + 주의 필요 테이블) */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Sentiment Analysis — Positive / Neutral / Negative bar chart.
              (감정 분석 — Positive / Neutral / Negative 막대 차트) */}
          <ChartCard title="Sentiment Analysis">
            {sentimentData.every((d) => d.value === 0) ? (
              <ChartEmpty />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={sentimentData}
                  margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
                  barSize={44}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: C_SLATE }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: C_SLATE }}
                    axisLine={false}
                    tickLine={false}
                  />
                  {/* Cast required: recharts v3 ContentType generic is overly strict (캐스트 필요) */}
                  <Tooltip content={ChartTooltip as never} />
                  <Bar dataKey="value" name="Calls" radius={[6, 6, 0, 0]}>
                    {/* Color each bar by its sentiment category (감정 카테고리별 막대 색상 적용) */}
                    {sentimentData.map((entry) => (
                      <Cell key={entry.name} fill={SENTIMENT_COLORS[entry.name] ?? C_SLATE} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Needs Attention — 5 most recent Negative or Unsuccessful calls.
              Clicking a row navigates to Call History filtered by call_id.
              (주의 필요 — 최근 Negative/Unsuccessful 통화 5건.
               행 클릭 시 call_id로 필터링된 통화 기록으로 이동) */}
          <ChartCard title="Needs Attention">
            {needsAttention.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-44 gap-2.5">
                <CheckCircle2 className="h-8 w-8 text-emerald-900" />
                <p className="text-xs text-slate-600 text-center">
                  No flagged calls in this period — great job!
                </p>
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
                      // Click navigates to Call History filtered by call_id (클릭 시 call_id로 통화 기록 필터링 페이지 이동)
                      <tr
                        key={i}
                        onClick={() =>
                          router.push(`/${mode}/call-history?call_id=${log.call_id}`)
                        }
                        className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                      >
                        <td className="py-2.5 text-slate-400">
                          {new Date(log.start_time).toLocaleDateString('en-US', {
                            month: 'short',
                            day:   'numeric',
                          })}
                        </td>
                        <td className="py-2.5 text-slate-300 font-mono">
                          {log.customer_phone ?? '—'}
                        </td>
                        <td className="py-2.5">
                          {/* Status badge — color coded by Successful vs Unsuccessful (상태 배지 — 성공/실패 색상 코딩) */}
                          <span
                            className={[
                              'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset',
                              log.call_status === 'Successful'
                                ? 'bg-emerald-900/40 text-emerald-400 ring-emerald-700'
                                : 'bg-rose-900/40   text-rose-400   ring-rose-700',
                            ].join(' ')}
                          >
                            {log.call_status}
                          </span>
                        </td>
                        <td className="py-2.5">
                          {/* Sentiment badge — color coded by category (감정 배지 — 카테고리별 색상 코딩) */}
                          <span
                            className="text-[10px] font-medium"
                            style={{
                              color: SENTIMENT_COLORS[log.sentiment ?? ''] ?? C_SLATE,
                            }}
                          >
                            {log.sentiment ?? '—'}
                          </span>
                        </td>
                        <td className="py-2.5 text-slate-400 font-mono">
                          {formatDuration(log.duration)}
                        </td>
                        <td className="py-2.5 text-slate-600">
                          <ChevronRight className="h-3.5 w-3.5" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-[10px] text-slate-600 italic leading-relaxed">
                  5 most recent calls flagged as Negative sentiment or Unsuccessful. Click a row to view full details.
                </p>
              </div>
            )}
          </ChartCard>

        </div>
      )}

      {/* ── Peak Hours Heatmap (피크 시간 히트맵) */}
      {loading ? (
        <Skeleton className="h-48" />
      ) : (
        <ChartCard title="Peak Call Hours">
          {filteredLogs.length === 0 ? (
            <ChartEmpty />
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[580px]">
                {/* Hour header row (시간 헤더 행) */}
                <div className="flex gap-1 mb-1 pl-10">
                  {HOUR_LABELS.map((h) => (
                    <div
                      key={h}
                      className="flex-1 text-center text-[9px] text-slate-600 font-medium"
                    >
                      {h}
                    </div>
                  ))}
                </div>
                {/* Day rows — Mon through Sun (요일 행 — 월요일부터 일요일까지) */}
                {DAY_LABELS.map((day, dayIdx) => (
                  <div key={day} className="flex items-center gap-1 mb-1">
                    {/* Day label (요일 레이블) */}
                    <div className="w-9 shrink-0 text-[10px] text-slate-500 font-medium text-right pr-1.5">
                      {day}
                    </div>
                    {HOUR_LABELS.map((_, hourIdx) => {
                      const count     = heatmapMatrix[dayIdx][hourIdx];
                      // Scale intensity 0→1 proportionally to the max cell value (최대 셀 값 기준 강도 0→1 비례 스케일)
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
                {/* Legend bar (범례 막대) */}
                <div className="flex items-center gap-2 mt-2 pl-10">
                  <span className="text-[9px] text-slate-600">Low</span>
                  <div
                    className="flex-1 h-1.5 rounded-full"
                    style={{
                      background: `linear-gradient(to right, rgba(16,185,129,0.12), rgba(16,185,129,0.97))`,
                    }}
                  />
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
