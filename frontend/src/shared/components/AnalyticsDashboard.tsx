// Analytics Dashboard — shared component consumed by both agency and store analytics pages.
// Receives storeId as a prop; the caller supplies the correct ID from Zustand session state.
// All data is fetched from Supabase call_logs using only verified schema column names.
// (애널리틱스 대시보드 — 에이전시 및 매장 애널리틱스 페이지에서 공유하는 컴포넌트.
//  storeId를 prop으로 받으며, 호출자가 Zustand 세션 상태에서 올바른 ID를 전달합니다.
//  모든 데이터는 검증된 스키마 컬럼명만 사용하여 Supabase call_logs에서 조회합니다.)

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AreaChart,
  Area,
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
// Local tooltip props interface — avoids recharts v3 generic TooltipProps type changes.
// (로컬 툴팁 props 인터페이스 — recharts v3 제네릭 TooltipProps 타입 변경을 피함)
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
  RefreshCw,
  AlertTriangle,
  BarChart3,
  Activity,
  CheckCircle2,
} from 'lucide-react';
import { getSupabaseClient } from '@/shared/api/supabaseClient';

// ── Types ──────────────────────────────────────────────────────────────────────

// Exact column subset fetched from call_logs — must match verified Postgres schema.
// (call_logs에서 조회하는 정확한 컬럼 서브셋 — 검증된 Postgres 스키마와 일치해야 함)
interface CallLog {
  start_time:     string;
  duration:       number | null;  // integer seconds (정수 초)
  sentiment:      string | null;  // 'Positive' | 'Neutral' | 'Negative'
  call_status:    string;         // 'Successful' | 'Unsuccessful'
  cost:           number | null;
  customer_phone: string | null;
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

// Format a numeric cost total to a dollar string with 2 decimal places.
// (숫자 비용 합계를 소수점 2자리 달러 문자열로 포맷)
function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
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
const C_ROSE    = '#f43f5e';
const C_AMBER   = '#f59e0b';
const C_SLATE   = '#475569';

const SENTIMENT_COLORS: Record<string, string> = {
  Positive: C_EMERALD,
  Neutral:  C_AMBER,
  Negative: C_ROSE,
};

const STATUS_COLORS = [C_EMERALD, C_ROSE];

// ── Sub-components ─────────────────────────────────────────────────────────────

// Generic dark-themed Recharts tooltip — injected via the `content` prop on <Tooltip>.
// Uses a local interface instead of recharts TooltipProps to stay compatible with v3 type changes.
// (Recharts <Tooltip>의 content prop으로 주입되는 범용 다크 테마 툴팁.
//  v3 타입 변경에 호환되도록 recharts TooltipProps 대신 로컬 인터페이스 사용)
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
  accent?: 'emerald' | 'blue' | 'amber' | 'rose';
}) {
  // Map accent variant to matching Tailwind color classes (액센트 변형을 Tailwind 색상 클래스에 매핑)
  const accentCls: Record<string, string> = {
    emerald: 'text-emerald-400 bg-emerald-900/30',
    blue:    'text-blue-400    bg-blue-900/30',
    amber:   'text-amber-400   bg-amber-900/30',
    rose:    'text-rose-400    bg-rose-900/30',
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
  storeId:          string | null;
  emptyStateLabel?: string; // Text shown when no storeId is provided (storeId가 없을 때 표시할 텍스트)
}

export function AnalyticsDashboard({
  storeId,
  emptyStateLabel = 'Select a store to view analytics.',
}: AnalyticsDashboardProps) {

  // ── State ──────────────────────────────────────────────────────────────────
  const [allLogs,   setAllLogs  ] = useState<CallLog[]>([]);
  const [loading,   setLoading  ] = useState(false);
  const [error,     setError    ] = useState<string | null>(null);
  // Default to 'month' so the dashboard is immediately meaningful on first load.
  // (첫 로드 시 대시보드가 즉시 의미 있게 표시되도록 기본값을 'month'로 설정)
  const [dateRange, setDateRange] = useState<DateRange>('month');

  // ── Data fetching ──────────────────────────────────────────────────────────

  // Fetch the 1000 most recent call_logs for the given store — date filtering is done client-side.
  // Limiting to 1000 rows keeps the response fast while covering all realistic analytics periods.
  // (주어진 매장의 최근 통화 로그 1000건 조회 — 날짜 필터링은 클라이언트에서 수행.
  //  응답을 빠르게 유지하면서 현실적인 분석 기간을 모두 커버하도록 1000행으로 제한)
  const fetchLogs = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await getSupabaseClient()
      .from('call_logs')
      .select('start_time, duration, sentiment, call_status, cost, customer_phone')
      .eq('store_id', id)
      .order('start_time', { ascending: false })
      .limit(1000);

    setAllLogs((data as CallLog[] | null) ?? []);
    if (fetchError) setError(fetchError.message);
    setLoading(false);
  }, []);

  // Re-fetch whenever the active storeId changes (활성 storeId가 변경될 때마다 재조회)
  useEffect(() => {
    if (storeId) {
      fetchLogs(storeId);
    } else {
      setAllLogs([]);
    }
  }, [storeId, fetchLogs]);

  // ── Derived data — all memos recompute when filteredLogs changes ────────────

  // Apply the selected date range boundary to the raw log array (원시 로그 배열에 선택된 날짜 범위 경계 적용)
  const filteredLogs = useMemo(() => {
    const boundary = getDateBoundary(dateRange);
    if (!boundary) return allLogs;
    return allLogs.filter((l) => new Date(l.start_time) >= boundary);
  }, [allLogs, dateRange]);

  // Compute all four KPI values from the filtered data set (필터링된 데이터 세트에서 4개의 KPI 값 모두 계산)
  const kpis = useMemo(() => {
    const total      = filteredLogs.length;
    const successful = filteredLogs.filter((l) => l.call_status === 'Successful').length;
    const totalSecs  = filteredLogs.reduce((acc, l) => acc + (l.duration ?? 0), 0);
    const totalCost  = filteredLogs.reduce((acc, l) => acc + (l.cost ?? 0), 0);
    return {
      totalCalls:  total,
      successRate: total > 0 ? ((successful / total) * 100).toFixed(1) : '0.0',
      timeSaved:   formatTotalDuration(totalSecs),
      totalCost:   formatCost(totalCost),
    };
  }, [filteredLogs]);

  // Aggregate call counts per calendar day for the Area chart x-axis.
  // Uses the YYYY-MM-DD prefix for deterministic sort, then maps to a display label.
  // (영역 차트 X축을 위해 달력 일별 통화 건수를 집계.
  //  정렬을 위해 YYYY-MM-DD 접두사를 사용하고 표시 레이블에 매핑)
  const volumeData = useMemo(() => {
    const byDate: Record<string, { dateKey: string; label: string; calls: number }> = {};
    filteredLogs.forEach((l) => {
      const dateKey = l.start_time.slice(0, 10); // YYYY-MM-DD sort key (정렬 키)
      const label   = new Date(l.start_time).toLocaleDateString('en-US', {
        month: 'short',
        day:   'numeric',
      });
      if (!byDate[dateKey]) byDate[dateKey] = { dateKey, label, calls: 0 };
      byDate[dateKey].calls++;
    });
    return Object.values(byDate)
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
      .map(({ label, calls }) => ({ date: label, calls }));
  }, [filteredLogs]);

  // Count calls by status for the Donut chart — filters out zero-value segments.
  // (도넛 차트를 위해 상태별 통화 건수 집계 — 0 값 세그먼트 필터링)
  const statusData = useMemo(() => {
    const successful   = filteredLogs.filter((l) => l.call_status === 'Successful').length;
    const unsuccessful = filteredLogs.filter((l) => l.call_status === 'Unsuccessful').length;
    return [
      { name: 'Successful',   value: successful   },
      { name: 'Unsuccessful', value: unsuccessful },
    ].filter((d) => d.value > 0);
  }, [filteredLogs]);

  // Count calls by sentiment category for the Bar chart (막대 차트를 위해 감정 카테고리별 통화 건수 집계)
  const sentimentData = useMemo(() => {
    const counts: Record<string, number> = { Positive: 0, Neutral: 0, Negative: 0 };
    filteredLogs.forEach((l) => {
      if (l.sentiment && l.sentiment in counts) counts[l.sentiment]++;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filteredLogs]);

  // Pick the 5 most recent calls flagged as Negative sentiment or Unsuccessful status.
  // The fetch is already sorted desc by start_time, so slice(0, 5) gives recency for free.
  // (감정이 Negative이거나 상태가 Unsuccessful로 표시된 최근 통화 5건 선택.
  //  조회가 이미 start_time 내림차순으로 정렬되어 있으므로 slice(0, 5)로 최신 순서를 바로 얻음)
  const needsAttention = useMemo(() => {
    return filteredLogs
      .filter((l) => l.sentiment === 'Negative' || l.call_status === 'Unsuccessful')
      .slice(0, 5);
  }, [filteredLogs]);

  // ── Date range button config ────────────────────────────────────────────────
  const DATE_OPTIONS: { label: string; value: DateRange }[] = [
    { label: 'Today', value: 'today' },
    { label: 'Week',  value: 'week'  },
    { label: 'Month', value: 'month' },
    { label: 'All',   value: 'all'   },
  ];

  // ── Render — no store linked (렌더링 — 연결된 매장 없음) ──────────────────
  if (!storeId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 text-center py-20">
        <Activity className="h-8 w-8 text-slate-700 mb-3" />
        <p className="text-sm font-medium text-slate-500">{emptyStateLabel}</p>
      </div>
    );
  }

  // ── Render — main dashboard (렌더링 — 메인 대시보드) ─────────────────────
  return (
    <div className="flex flex-col gap-5">

      {/* ── Page heading + control bar (페이지 제목 + 컨트롤 바) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-100">Analytics</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            AI voice agent performance overview for the selected period.
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

          {/* Refresh button — re-fetches the full log set from Supabase (새로고침 버튼 — Supabase에서 전체 로그 세트 재조회) */}
          <button
            onClick={() => fetchLogs(storeId)}
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

      {/* ── KPI Cards — 4-column responsive grid (KPI 카드 — 4열 반응형 그리드) */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total Calls — raw count of all calls in the filtered period (필터 기간 내 전체 통화 건수) */}
          <KpiCard
            icon={Phone}
            label="Total Calls"
            value={kpis.totalCalls.toLocaleString()}
            sub="in the selected period"
            accent="blue"
          />
          {/* AI Success Rate — percentage of calls with 'Successful' status (상태가 'Successful'인 통화의 비율) */}
          <KpiCard
            icon={CheckCircle2}
            label="AI Success Rate"
            value={`${kpis.successRate}%`}
            sub="of calls resolved successfully"
            accent="emerald"
          />
          {/* Total Time Handled — sum of all call durations (모든 통화 시간의 합계) */}
          <KpiCard
            icon={Clock}
            label="Total Time Handled"
            value={kpis.timeSaved}
            sub="by the AI voice agent"
            accent="amber"
          />
          {/* Total AI Cost — sum of Retell usage costs (Retell 사용 비용의 합계) */}
          <KpiCard
            icon={DollarSign}
            label="Total AI Cost"
            value={kpis.totalCost}
            sub="Retell AI usage"
            accent="rose"
          />
        </div>
      )}

      {/* ── Main charts row: Area + Donut (메인 차트 행: 영역 + 도넛) */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="lg:col-span-2 h-80" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Call Volume Trend — daily call count rendered as an emerald AreaChart.
              (통화량 추이 — 일별 통화 건수를 에메랄드 영역 차트로 렌더링) */}
          <ChartCard title="Call Volume Trend" className="lg:col-span-2">
            {volumeData.length === 0 ? (
              <ChartEmpty />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart
                  data={volumeData}
                  margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
                >
                  <defs>
                    {/* Vertical emerald-to-transparent gradient for the area fill (영역 채우기를 위한 에메랄드-투명 수직 그라디언트) */}
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
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: C_SLATE }}
                    axisLine={false}
                    tickLine={false}
                  />
                  {/* Cast required: recharts v3 ContentType generic is overly strict (recharts v3 ContentType 제네릭이 과도하게 엄격하여 캐스트 필요) */}
                  <Tooltip content={ChartTooltip as never} />
                  <Area
                    type="monotone"
                    dataKey="calls"
                    name="Calls"
                    stroke={C_EMERALD}
                    strokeWidth={2}
                    fill="url(#gradCalls)"
                    dot={false}
                    activeDot={{ r: 4, fill: C_EMERALD, strokeWidth: 0 }}
                  />
                </AreaChart>
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
                  {/* Cast required: recharts v3 ContentType generic is overly strict (recharts v3 ContentType 제네릭이 과도하게 엄격하여 캐스트 필요) */}
                  <Tooltip
                    content={((props: RechartsTipProps) => {
                      const { active, payload } = props;
                      if (!active || !payload?.length) return null;
                      const entry = payload[0];
                      const total = statusData.reduce((s, d) => s + d.value, 0);
                      const pct   = total > 0
                        ? ((Number(entry.value) / total) * 100).toFixed(1)
                        : '0';
                      // Show name, count, and percentage in the tooltip (툴팁에 이름, 건수, 비율 표시)
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
                    formatter={(v) => (
                      <span className="text-xs text-slate-400">{v}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

        </div>
      )}

      {/* ── Bottom row: Sentiment BarChart + Needs Attention table
          (하단 행: 감정 막대 차트 + 주의 필요 테이블) */}
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
                  {/* Cast required: recharts v3 ContentType generic is overly strict (recharts v3 ContentType 제네릭이 과도하게 엄격하여 캐스트 필요) */}
                  <Tooltip content={ChartTooltip as never} />
                  <Bar dataKey="value" name="Calls" radius={[6, 6, 0, 0]}>
                    {/* Color each bar by its sentiment category (감정 카테고리별로 각 막대에 색상 적용) */}
                    {sentimentData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={SENTIMENT_COLORS[entry.name] ?? C_SLATE}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Needs Attention — 5 most recent Negative or Unsuccessful calls.
              (주의 필요 — 최근 Negative 또는 Unsuccessful 통화 5건) */}
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
                      <th className="text-left pb-2.5 font-medium">Duration</th>
                      <th className="text-left pb-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {needsAttention.map((log, i) => (
                      <tr
                        key={i}
                        className="hover:bg-slate-800/30 transition-colors"
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
                        <td className="py-2.5 text-slate-400 font-mono">
                          {formatDuration(log.duration)}
                        </td>
                        <td className="py-2.5">
                          {/* Color status badge by Successful vs Unsuccessful (성공/실패에 따른 상태 배지 색상 적용) */}
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
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* Footnote linking user to Call History for full context (전체 컨텍스트를 위해 통화 기록으로 안내하는 각주) */}
                <p className="mt-3 text-[10px] text-slate-600 italic leading-relaxed">
                  Showing the 5 most recent calls flagged as Negative sentiment or Unsuccessful.
                  View full details in <span className="text-slate-500">Call History</span>.
                </p>
              </div>
            )}
          </ChartCard>

        </div>
      )}

    </div>
  );
}
