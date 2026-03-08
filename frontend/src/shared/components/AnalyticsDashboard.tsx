// Analytics Dashboard — single source of truth for both agency and store analytics views.
// Props: { mode: 'agency' | 'store', id: string }
//   mode='store'  → fetches call_logs and orders where store_id = id
//   mode='agency' → first fetches stores where agency_id = id, then aggregates across all storeIds
// Date range selector triggers a full server-side re-fetch — KPI cards and every chart
// are always driven by the exact same filtered dataset.
// (에이전시 및 매장 애널리틱스 뷰를 위한 단일 진실 소스.
//  props: { mode, id }. 날짜 선택기는 서버 사이드 재조회를 유발 —
//  KPI 카드와 모든 차트는 항상 동일한 필터링된 데이터셋으로 구동됨)

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter }                                  from 'next/navigation';
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
import {
  Phone,
  Clock,
  DollarSign,
  TrendingUp,
  RefreshCw,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Download,
  FileText,
  ChevronRight,
  Store,
} from 'lucide-react';
import { getSupabaseClient }  from '@/shared/api/supabaseClient';
import { useSessionStore }    from '@/shared/stores/sessionStore';
import {
  type DateRange,
  type KpiCallLog,
  type KpiOrder,
  getDateBoundary,
  calcKpis,
  formatUsd,
  formatCostCents,
} from '@/shared/utils/analyticsCalc';

// ── Recharts v3 local tooltip interface ───────────────────────────────────────
// Avoids the overly-strict ContentType<V,N> generic — cast usage sites with `as never` (과도하게 엄격한 ContentType 제네릭 회피 — 사용처에서 `as never` 캐스트)
interface TipEntry {
  name?:    string;
  value?:   number | string;
  color?:   string;
  payload?: Record<string, unknown>;
}
interface TipProps {
  active?:  boolean;
  payload?: TipEntry[];
  label?:   string;
}

// ── Data shapes ────────────────────────────────────────────────────────────────

// Full call_log row — superset of KpiCallLog for UI fields (UI 필드를 포함하는 KpiCallLog의 슈퍼셋)
interface CallLog extends KpiCallLog {
  call_id:        string;
  start_time:     string;
  sentiment:      string | null;
  customer_phone: string | null;
}

// Order row — inherits total_amount (USD) from KpiOrder (KpiOrder에서 total_amount(USD)를 상속하는 주문 행)
interface Order extends KpiOrder {
  created_at: string;
}

// ── Design tokens ──────────────────────────────────────────────────────────────
// Centralised palette keeps every chart and badge colour consistent (모든 차트와 배지 색상의 일관성을 유지하는 중앙화된 팔레트)
const C_EMERALD  = '#10b981';
const C_ROSE     = '#f43f5e';
const C_AMBER    = '#f59e0b';
const C_BLUE     = '#3b82f6';
const C_AXIS     = '#9ca3af'; // gray-400 — legible on white chart backgrounds (흰색 차트 배경에서 가독성 있는 색상)
const C_GRID     = 'rgba(156,163,175,0.25)'; // light gray guide lines visible on white (흰색 배경에서 보이는 연한 회색 가이드 선)

const SENTIMENT_COLORS: Record<string, string> = {
  Positive: C_EMERALD,
  Neutral:  C_AMBER,
  Negative: C_ROSE,
};
const STATUS_COLORS = [C_EMERALD, C_ROSE];
const DAY_LABELS    = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_LABELS   = ['9am','10am','11am','12pm','1pm','2pm','3pm','4pm','5pm','6pm','7pm','8pm','9pm','10pm'];

// Light theme card base class reused on every panel — white bg, subtle gray border, soft shadow (모든 패널에서 재사용하는 라이트 테마 카드 기본 클래스 — 흰색 배경, 연한 회색 테두리, 부드러운 그림자)
const GLASS = 'bg-white border border-gray-200 shadow-sm rounded-xl';

// ── Sub-components ─────────────────────────────────────────────────────────────

// Light theme tooltip for all Recharts charts — white card with gray border (모든 Recharts 차트용 라이트 테마 툴팁 — 회색 테두리의 흰색 카드)
function DarkTip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl bg-white border border-gray-200 px-3.5 py-2.5 shadow-lg text-xs">
      {label && <p className="text-gray-500 mb-1.5 font-medium">{label}</p>}
      {payload.map((e: TipEntry, i: number) => (
        <p key={i} className="font-semibold leading-5" style={{ color: e.color ?? C_EMERALD }}>
          {e.name}: {e.value}
        </p>
      ))}
    </div>
  );
}

// Empty state shown inside chart containers when the dataset is empty (데이터셋이 비어있을 때 차트 컨테이너 내부에 표시되는 빈 상태)
function ChartEmpty({ height = 'h-52' }: { height?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center ${height} gap-2`}>
      <BarChart3 className="h-8 w-8 text-gray-300" />
      <p className="text-xs text-gray-400">No data for this period</p>
    </div>
  );
}

// Pulse skeleton block displayed while data is loading — gray-100 matches light page background (데이터 로딩 중 표시되는 펄스 스켈레톤 블록 — gray-100이 라이트 페이지 배경과 어울림)
function Skel({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-gray-100 ${className ?? ''}`} />;
}

// KPI summary card with glassmorphism styling (글래스모피즘 스타일의 KPI 요약 카드)
function KpiCard({
  icon: Icon, label, value, sub, accentColor, iconBg,
}: {
  icon:        React.ElementType;
  label:       string;
  value:       string;
  sub?:        string;
  accentColor: string; // tailwind text-* class (Tailwind text-* 클래스)
  iconBg:      string; // tailwind bg-* class  (Tailwind bg-* 클래스)
}) {
  return (
    <div className={`${GLASS} p-6 flex gap-4 items-start`}>
      {/* Coloured icon badge (색상 아이콘 배지) */}
      <div className={`mt-0.5 rounded-xl p-2.5 shrink-0 ${iconBg}`}>
        <Icon className={`h-5 w-5 ${accentColor}`} />
      </div>
      <div className="min-w-0 flex-1">
        {/* KPI label — text-gray-500 keeps hierarchy below the bold value (굵은 값 아래의 계층을 유지하는 text-gray-500) */}
        <p className="text-[11px] text-gray-500 mb-1.5 font-medium uppercase tracking-widest">{label}</p>
        {/* KPI value — text-gray-900 on white background for maximum contrast (최대 대비를 위한 흰색 배경의 text-gray-900) */}
        <p className="text-3xl font-bold text-gray-900 leading-none mb-1">{value}</p>
        {sub && <p className="text-xs text-gray-400">{sub}</p>}
      </div>
    </div>
  );
}

// Titled glassmorphism panel used to frame every chart section (모든 차트 섹션을 감싸는 제목 있는 글래스모피즘 패널)
function Panel({ title, children, className }: {
  title:      string;
  children:   React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`${GLASS} p-6 ${className ?? ''}`}>
      {/* Panel title — text-gray-500 on white for readable but subdued section label (읽기 쉽지만 차분한 섹션 레이블을 위한 흰색 배경의 text-gray-500) */}
      <p className="text-sm font-medium text-gray-500 mb-5 uppercase tracking-wider">{title}</p>
      {children}
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface AnalyticsDashboardProps {
  mode: 'agency' | 'store';
  id: string;
  forceAggregation?: boolean;
}

// 🚨 --- 👇 여기서부터 증발했던 머리통 복구 👇 --- 🚨
export function AnalyticsDashboard({ mode, id, forceAggregation = false }: AnalyticsDashboardProps) {
  const router = useRouter();
  const [dateRange, setDateRange] = useState<DateRange>('month');
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noStores, setNoStores] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('all');
// 🚨 --- 👆 여기까지 복구 끝 👆 --- 🚨

const fetchData = useCallback(async () => {
    // 1. UUID 400 에러 원천 차단
    if (!id || id === '') {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setNoStores(false);

    const supabase = getSupabaseClient();

    try {
      let targetStoreIds: string[] = [];

      // 2. 에이전시 및 스토어 컨텍스트 분리
      if (mode === 'agency') {
        if (forceAggregation) {
          const { data: storeRows, error: storesErr } = await supabase.from('stores').select('id').eq('agency_id', id);
          if (storesErr) throw storesErr;
          targetStoreIds = (storeRows ?? []).map((s: { id: string }) => s.id);
        } else if (selectedStoreId && selectedStoreId !== 'all') {
          targetStoreIds = [selectedStoreId];
        } else {
          const { data: storeRows, error: storesErr } = await supabase.from('stores').select('id').eq('agency_id', id);
          if (storesErr) throw storesErr;
          targetStoreIds = (storeRows ?? []).map((s: { id: string }) => s.id);
        }
      } else {
        targetStoreIds = [id];
      }

      if (targetStoreIds.length === 0) {
        setNoStores(true);
        setLogs([]);
        setOrders([]);
        return;
      }

      // 3. 🚨 팩트 기반 근본 해결: 가장 단순하고 절대 고장나지 않는 날짜 추출 🚨
      const boundary = getDateBoundary(dateRange) || {};
      
      const rawStart = boundary.startDate || boundary.start || boundary[0];
      const rawEnd   = boundary.endDate   || boundary.end   || boundary[1];

      // 복잡한 조건 싹 빼고, 직관적인 4단계 안전 변환기
      function toSafeIsoString(val: any): string | null {
        if (!val) return null;                                      // 1. 없으면 null (예: 'All' 선택 시)
        if (typeof val === 'string') return val;                    // 2. 이미 문자열이면 그대로 통과
        if (typeof val.toISOString === 'function') return val.toISOString(); // 3. Date 객체면 ISO 변환
        return String(val);                                         // 4. 그 외 특이 케이스는 무조건 문자열 강제 변환
      }

      const startStr = toSafeIsoString(rawStart);
      const endStr   = toSafeIsoString(rawEnd);

      console.log('[X-Ray] Date Filter Engine:', { dateRange, startStr, endStr });

      // 4. 안전한 쿼리 빌드 (startStr, endStr이 존재할 때만 작동)
      let callsQuery = supabase.from('call_logs').select('*').in('store_id', targetStoreIds);
      if (startStr) callsQuery = callsQuery.gte('start_time', startStr);
      if (endStr)   callsQuery = callsQuery.lte('start_time', endStr);

      const { data: callsData, error: callsError } = await callsQuery;
      if (callsError) throw callsError;

      let ordersQuery = supabase.from('orders').select('*').in('store_id', targetStoreIds).eq('status', 'paid');
      if (startStr) ordersQuery = ordersQuery.gte('created_at', startStr);
      if (endStr)   ordersQuery = ordersQuery.lte('created_at', endStr);

      const { data: ordersData, error: ordersError } = await ordersQuery;
      if (ordersError) throw ordersError;

      setLogs(callsData || []);
      setOrders(ordersData || []);

    } catch (err: any) {
      console.error('[X-Ray] Fetch Error:', err);
      setError(err?.message || (typeof err === 'string' ? err : '데이터를 불러오는 중 오류가 발생했습니다.'));
    } finally {
      setLoading(false);
    }
  }, [mode, id, dateRange, selectedStoreId, forceAggregation]);

  // 🚨 --- 👇 사라졌던 시동 키 복구 👇 --- 🚨
  useEffect(() => { fetchData(); }, [fetchData]);
  // 🚨 --- 👆 복구 끝 👆 --- 🚨

  // ── Derived data — all computed from the same `logs` + `orders` arrays ─────
  // Because logs/orders are already server-filtered, these memos are pure aggregations
  // with no further date logic — the single source of truth is the fetch, not the memo.
  // (logs/orders는 이미 서버 필터링되어 있으므로 이 메모는 순수 집계 —
  //  단일 진실 소스는 메모가 아닌 조회)

  // All 5 KPIs via the shared calcKpis utility — logs the exact math before returning so
  // we can confirm the numbers match what the UI displays (공유 calcKpis 유틸리티를 통한 5개 KPI 모두
  // — UI에 표시되는 숫자와 일치하는지 확인하기 위해 반환 전 정확한 수식을 로그에 출력)
  const kpis = useMemo(() => {
    // [X-Ray] Log the input array lengths so we can verify the correct dataset reaches KPI math (올바른 데이터셋이 KPI 수식에 도달하는지 확인하기 위해 입력 배열 길이를 로그에 출력)
    console.log('[X-Ray] KPI Math input arrays:', {
      dateRange,
      logsCount:   logs.length,
      ordersCount: orders.length,
    });

    // [X-Ray] Log Total Calls — must equal the call_logs row count above (위의 call_logs 행 수와 일치해야 하는 Total Calls를 로그에 출력)
    console.log('[X-Ray] KPI Math -> Total Calls:', logs.length);

    // [X-Ray] Log success rate numerator and denominator to catch miscounts (잘못된 집계를 잡기 위해 성공률의 분자와 분모를 로그에 출력)
    const successfulCount = logs.filter((l) => l.call_status === 'Successful').length;
    console.log('[X-Ray] KPI Math -> Successful calls:', successfulCount, '/', logs.length);

    // [X-Ray] Log raw duration sum in seconds before dividing by 60 (60으로 나누기 전 초 단위의 원시 duration 합계를 로그에 출력)
    const rawDurationSecs = logs.reduce((acc, l) => acc + (l.duration ?? 0), 0);
    console.log('[X-Ray] KPI Math -> Raw duration sum (seconds):', rawDurationSecs, '→', Math.round(rawDurationSecs / 60), 'min');

    // [X-Ray] Log raw cost sum in cents before dividing by 100 (100으로 나누기 전 센트 단위의 원시 cost 합계를 로그에 출력)
    const rawCostCents = logs.reduce((acc, l) => acc + (l.cost ?? 0), 0);
    console.log('[X-Ray] KPI Math -> Raw cost sum (cents):', rawCostCents, '→ $', (rawCostCents / 100).toFixed(2));

    // [X-Ray] Log total revenue sum — total_amount is already USD, no division (total_amount는 이미 USD 단위로 나눗셈 없음 — 총 매출 합계를 로그에 출력)
    const sumOfRevenue = orders.reduce((acc, o) => acc + (o.total_amount ?? 0), 0);
    console.log('[X-Ray] KPI Math -> Total Revenue (paid orders only):', sumOfRevenue.toFixed(2));

    // Delegate the actual calculation to the shared utility as the single source of truth (단일 진실 소스인 공유 유틸리티에 실제 계산 위임)
    const result = calcKpis(logs, orders);

    // [X-Ray] Log the final formatted KPI values that will appear in the UI (UI에 표시될 최종 포맷된 KPI 값을 로그에 출력)
    console.log('[X-Ray] KPI Final values:', {
      totalCalls:  result.totalCalls,
      successRate: result.successRate + '%',
      timeHandled: result.timeHandled,
      totalCost:   result.totalCost,
      aiRevenue:   result.aiRevenue,
    });

    return result;
  }, [logs, orders, dateRange]);

  // Build the ComposedChart dataset — one entry per calendar day.
  // PASS 1: iterate call_logs → increment `calls` keyed by start_time local date.
  // PASS 2: iterate paid orders → accumulate `revenue` keyed by created_at local date.
  // The two passes are completely independent so neither can contaminate the other's series.
  // <Area dataKey="calls">  strictly reads the calls field (call_logs only).
  // <Line dataKey="revenue"> strictly reads the revenue field (paid orders only).
  // (ComposedChart 데이터셋 구성 — 달력 일별 항목 1개.
  //  패스 1: call_logs 순회 → start_time 로컬 날짜 기준 calls 증가.
  //  패스 2: 결제 주문 순회 → created_at 로컬 날짜 기준 revenue 누적.
  //  두 패스는 완전히 독립적으로 서로의 계열을 오염시킬 수 없음)
  const composedData = useMemo(() => {

    // Convert any ISO timestamp to a local-timezone YYYY-MM-DD sort key.
    // Using getFullYear/Month/Date avoids the UTC-slice bug where a UTC date like
    // "2026-03-07T01:00:00Z" maps to "2026-03-06" in UTC-5 local time.
    // (UTC 슬라이스 버그를 피하기 위해 로컬 시간대 기준 YYYY-MM-DD 정렬 키로 변환.
    //  "2026-03-07T01:00:00Z"가 UTC-5 로컬에서 "2026-03-06"으로 매핑되는 문제 방지)
    function toSortKey(isoString: string): string {
      const d = new Date(isoString);
      return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
      ].join('-');
    }

    // Convert any ISO timestamp to the "MMM D" display label shown on the chart x-axis (차트 X축에 표시되는 "MMM D" 표시 레이블로 변환)
    function toLabel(isoString: string): string {
      return new Date(isoString).toLocaleDateString('en-US', {
        month: 'short',
        day:   'numeric',
      });
    }

    // Unified day bucket — every day with at least one log OR one order gets an entry (최소 하나의 로그 또는 주문이 있는 날에 항목 생성)
    const byDay: Record<string, { sortKey: string; label: string; calls: number; revenue: number }> = {};

    // ── PASS 1: call_logs → `calls` field only (패스 1: call_logs → calls 필드만)
    // Each log row represents exactly one call — always increment calls, never touch revenue.
    // (각 로그 행은 정확히 하나의 통화를 나타냄 — 항상 calls 증가, revenue는 절대 건드리지 않음)
    logs.forEach((l) => {
      const sortKey = toSortKey(l.start_time);
      const label   = toLabel(l.start_time);
      if (!byDay[sortKey]) byDay[sortKey] = { sortKey, label, calls: 0, revenue: 0 };
      byDay[sortKey].calls += 1; // explicit +1 to make the intent unambiguous (의도를 명확히 하기 위해 명시적 +1)
    });

    // ── PASS 2: paid orders → `revenue` field only (패스 2: 결제 주문 → revenue 필드만)
    // Only orders with status='paid' reach this array (enforced by the Supabase query).
    // Accumulate total_amount (already in USD) — never touch calls.
    // (status='paid' 주문만 이 배열에 도달함(Supabase 쿼리로 강제).
    //  total_amount(이미 USD 단위) 누적 — calls는 절대 건드리지 않음)
    orders.forEach((o) => {
      const sortKey = toSortKey(o.created_at);
      const label   = toLabel(o.created_at);
      if (!byDay[sortKey]) byDay[sortKey] = { sortKey, label, calls: 0, revenue: 0 };
      byDay[sortKey].revenue += (o.total_amount ?? 0); // USD, no /100 needed (USD, /100 불필요)
    });

    // Sort chronologically by the YYYY-MM-DD sort key, then shape for Recharts (YYYY-MM-DD 정렬 키 기준 시간순 정렬 후 Recharts 형식으로 변환)
    const series = Object.values(byDay)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .map(({ label, calls, revenue }) => ({
        date:    label,                             // x-axis label "Mar 7" (X축 레이블 "Mar 7")
        calls,                                     // → <Area dataKey="calls">
        revenue: Math.round(revenue * 100) / 100,  // → <Line dataKey="revenue"> (부동소수점 오차 방지)
      }));

    // [X-Ray] Log chart series so we can verify calls and revenue map to the correct series (calls와 revenue가 올바른 계열에 매핑되는지 확인하기 위해 차트 계열을 로그에 출력)
    console.log('[X-Ray] composedData series (' + series.length + ' days):', {
      dateRange,
      firstEntry: series[0]  ?? null,
      lastEntry:  series[series.length - 1] ?? null,
      totalCalls:   series.reduce((s, d) => s + d.calls, 0),
      totalRevenue: series.reduce((s, d) => s + d.revenue, 0).toFixed(2),
    });

    return series;
  }, [logs, orders, dateRange]);

  // Call count by status for the Donut chart — zero-value segments excluded (0값 세그먼트를 제외한 도넛 차트용 상태별 통화 건수)
  const statusData = useMemo(() => [
    { name: 'Successful',   value: logs.filter((l) => l.call_status === 'Successful').length   },
    { name: 'Unsuccessful', value: logs.filter((l) => l.call_status === 'Unsuccessful').length },
  ].filter((d) => d.value > 0), [logs]);

  // Call count by sentiment category for the BarChart (BarChart용 감정 카테고리별 통화 건수)
  const sentimentData = useMemo(() => {
    const c: Record<string, number> = { Positive: 0, Neutral: 0, Negative: 0 };
    logs.forEach((l) => { if (l.sentiment && l.sentiment in c) c[l.sentiment]++; });
    return Object.entries(c).map(([name, value]) => ({ name, value }));
  }, [logs]);

  // 7×14 heatmap [dayIndex 0=Mon][hourIndex 9am=0] — (getDay()+6)%7 converts JS Sunday-zero to Monday-zero (JS 일요일 기준을 월요일 기준으로 변환하는 7×14 히트맵)
  const heatmap = useMemo(() => {
    const m: number[][] = Array.from({ length: 7 }, () => new Array(14).fill(0));
    logs.forEach((l) => {
      const d = new Date(l.start_time);
      const day  = (d.getDay() + 6) % 7; // 0=Mon … 6=Sun
      const hour = d.getHours();
      if (hour >= 9 && hour <= 22) m[day][hour - 9]++;
    });
    return m;
  }, [logs]);

  // Max heatmap cell value — floored at 1 to prevent division-by-zero (0 나눗셈 방지를 위해 최솟값 1로 설정한 히트맵 최댓값)
  const maxHeat = useMemo(() => Math.max(...heatmap.flat(), 1), [heatmap]);

  // 5 most recent Negative-sentiment or Unsuccessful calls for the Needs Attention table (Needs Attention 테이블용 최근 Negative 감정 또는 Unsuccessful 통화 5건)
  const flagged = useMemo(
    () => logs.filter((l) => l.sentiment === 'Negative' || l.call_status === 'Unsuccessful').slice(0, 5),
    [logs],
  );

  // ── CSV export ─────────────────────────────────────────────────────────────

  // Build a CSV file from current logs and trigger a browser download (현재 로그에서 CSV 파일을 생성하고 브라우저 다운로드 트리거)
  function downloadCSV() {
    const headers = ['Date', 'Phone', 'Status', 'Sentiment', 'Duration (s)', 'Cost (USD)'];
    const rows = logs.map((l) => [
      new Date(l.start_time).toLocaleString('en-US'),
      l.customer_phone ?? '',
      l.call_status,
      l.sentiment       ?? '',
      l.duration        ?? '',
      l.cost != null ? formatCostCents(l.cost) : '',
    ]);
    const csv  = [headers, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href:     url,
      download: `analytics-${new Date().toISOString().slice(0, 10)}.csv`,
    });
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Date range button config ────────────────────────────────────────────────
  const PERIODS: { label: string; value: DateRange }[] = [
    { label: 'Today', value: 'today' },
    { label: 'Week',  value: 'week'  },
    { label: 'Month', value: 'month' },
    { label: 'All',   value: 'all'   },
  ];

  // ── Render — agency with no stores ────────────────────────────────────────
  if (!loading && noStores) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 py-24 text-center">
        {/* Empty state icon badge — gray-100 bg matches light page (라이트 페이지와 어울리는 gray-100 배경 아이콘 배지) */}
      <div className="h-16 w-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-5">
          <Store className="h-8 w-8 text-gray-400" />
        </div>
        <p className="text-base font-semibold text-gray-600">No stores linked to this agency yet.</p>
        <p className="mt-1 text-sm text-gray-400">Add a store with this agency's ID to start seeing data.</p>
      </div>
    );
  }

  // ── Render — main dashboard ────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">

      {/* ── Control bar: heading + period picker + export (제목 + 기간 선택기 + 내보내기) */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {/* Page heading — text-gray-900 for strong presence on white background (흰색 배경에서 강한 존재감을 위한 text-gray-900) */}
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Analytics</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {mode === 'agency'
              // forceAggregation overrides the dropdown — always show the aggregated subtitle (forceAggregation은 드롭다운을 재정의 — 항상 집계 자막 표시)
              ? ((!forceAggregation && selectedStoreId)
                  ? 'Showing data for selected store — change the sidebar dropdown to switch or aggregate all.'
                  : 'Aggregated across all stores.')
              : 'AI voice agent performance for this store.'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Period selector — light theme segmented control with gray border (회색 테두리의 라이트 테마 세그먼트 컨트롤) */}
          <div className="flex rounded-xl border border-gray-200 overflow-hidden">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setDateRange(p.value)}
                className={[
                  'px-3.5 py-1.5 text-xs font-semibold transition-all',
                  dateRange === p.value
                    ? 'bg-indigo-600 text-white shadow-inner'
                    : 'bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700',
                ].join(' ')}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* CSV export — light theme button with gray border and hover (회색 테두리와 호버 효과가 있는 라이트 테마 버튼) */}
          <button
            onClick={downloadCSV}
            disabled={loading || logs.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>

          {/* PDF export via browser print dialog (브라우저 인쇄 대화상자를 통한 PDF 내보내기) */}
          <button
            onClick={() => window.print()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <FileText className="h-3.5 w-3.5" />
            PDF
          </button>

          {/* Refresh — re-runs fetchData with the current rolling window (현재 롤링 창으로 fetchData를 재실행) */}
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Error banner (오류 배너) */}
      {error && (
        <>
    {/* Error banner - light red tones consistent with light theme (라이트 테마와 일관된 연한 빨간색 톤) */}
    <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {error}
    </div>
      </>
    )}

      {/* ── 5 KPI cards (5개 KPI 카드) */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => <Skel key={i} className="h-[104px]" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* KPI 1 — Total Calls: COUNT(*) from call_logs (KPI 1 — 총 통화: call_logs에서 COUNT(*)) */}
          <KpiCard
            icon={Phone}
            label="Total Calls"
            value={kpis.totalCalls.toLocaleString()}
            sub="from call_logs"
            accentColor="text-blue-400"
            iconBg="bg-blue-500/10"
          />
          {/* KPI 2 — AI Success Rate: Successful / Total × 100 (KPI 2 — AI 성공률: 성공 / 전체 × 100) */}
          <KpiCard
            icon={CheckCircle2}
            label="Success Rate"
            value={`${kpis.successRate}%`}
            sub="resolved successfully"
            accentColor="text-emerald-400"
            iconBg="bg-emerald-500/10"
          />
          {/* KPI 3 — Time Handled: SUM(duration) / 60 in minutes (KPI 3 — 처리 시간: SUM(duration) / 60 분 단위) */}
          <KpiCard
            icon={Clock}
            label="Time Handled"
            value={kpis.timeHandled}
            sub="total call minutes"
            accentColor="text-amber-400"
            iconBg="bg-amber-500/10"
          />
          {/* KPI 4 — Total AI Cost: SUM(cost) / 100 — cost column stores CENTS (KPI 4 — 총 AI 비용: SUM(cost) / 100 — cost 컬럼은 센트 단위) */}
          <KpiCard
            icon={DollarSign}
            label="Total AI Cost"
            value={kpis.totalCost}
            sub="Retell usage"
            accentColor="text-rose-400"
            iconBg="bg-rose-500/10"
          />
          {/* KPI 5 — AI Revenue: SUM(total_amount) from paid orders only — total_amount is already USD (KPI 5 — AI 매출: 결제 완료 주문의 SUM(total_amount) — 이미 USD 단위) */}
          <KpiCard
            icon={TrendingUp}
            label="AI Revenue"
            value={formatUsd(kpis.aiRevenue)}
            sub="paid orders only"
            accentColor="text-indigo-400"
            iconBg="bg-indigo-500/10"
          />
        </div>
      )}

      {/* ── ComposedChart (calls + revenue) and Status Donut (통화+매출 ComposedChart와 상태 도넛) */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skel className="lg:col-span-2 h-80" />
          <Skel className="h-80" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Left Y-axis: calls (emerald Area). Right Y-axis: paid revenue in USD (indigo Line).
              Both series driven by the same filtered logs + orders arrays.
              (좌측 Y축: 통화(에메랄드 영역). 우측 Y축: 결제 매출 USD(인디고 선). 동일한 필터링된 배열 사용) */}
          <Panel title="Call Volume & Revenue" className="lg:col-span-2">
            {composedData.length === 0 ? <ChartEmpty /> : (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={composedData} margin={{ top: 4, right: 20, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="gCalls" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C_EMERALD} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={C_EMERALD} stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C_GRID} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: C_AXIS }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  {/* Left axis — call volume (좌측 축 — 통화량) */}
                  <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 10, fill: C_AXIS }} axisLine={false} tickLine={false} />
                  {/* Right axis — revenue in USD (우측 축 — USD 매출) */}
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: C_AXIS }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v}`} />
                  <Tooltip content={DarkTip as never} />
                  <Legend iconType="circle" iconSize={7} wrapperStyle={{ paddingTop: '8px' }} formatter={(v) => <span className="text-[11px] text-slate-400">{v}</span>} />
                  <Area yAxisId="left" type="monotone" dataKey="calls" name="Calls" stroke={C_EMERALD} strokeWidth={2} fill="url(#gCalls)" dot={false} activeDot={{ r: 4, fill: C_EMERALD, strokeWidth: 0 }} />
                  {/* Revenue line — C_BLUE (#3b82f6) distinguishes it clearly from the emerald calls area (에메랄드 통화 영역과 명확히 구별하기 위해 C_BLUE(#3b82f6) 사용) */}
                  <Line yAxisId="right" type="monotone" dataKey="revenue" name="Revenue ($)" stroke={C_BLUE} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: C_BLUE, strokeWidth: 0 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Panel>

          {/* Status breakdown donut — Successful (emerald) vs Unsuccessful (rose) (상태 분석 도넛 — 성공(에메랄드) 대 실패(로즈)) */}
          <Panel title="Call Status">
            {statusData.length === 0 ? <ChartEmpty /> : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={statusData} cx="50%" cy="44%" innerRadius={62} outerRadius={92} paddingAngle={3} dataKey="value" strokeWidth={0}>
                    {statusData.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />)}
                  </Pie>
                  <Tooltip
                    content={((props: TipProps) => {
                      const { active, payload } = props;
                      if (!active || !payload?.length) return null;
                      const e     = payload[0];
                      const total = statusData.reduce((s, d) => s + d.value, 0);
                      const pct   = total > 0 ? ((Number(e.value) / total) * 100).toFixed(1) : '0';
                      const fill  = (e.payload as { fill?: string } | undefined)?.fill ?? C_EMERALD;
                      return (
                        // Donut tooltip — white card matching light theme (라이트 테마와 일치하는 흰색 카드 도넛 툴팁)
                        <div className="rounded-xl bg-white border border-gray-200 px-3.5 py-2.5 shadow-lg text-xs">
                          <p className="font-semibold" style={{ color: fill }}>
                            {e.name}: {e.value} ({pct}%)
                          </p>
                        </div>
                      );
                    }) as never}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ paddingTop: '10px' }} formatter={(v) => <span className="text-[11px] text-slate-400">{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Panel>

        </div>
      )}

      {/* ── Sentiment BarChart + Needs Attention table (감정 BarChart와 Needs Attention 테이블) */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skel className="h-72" />
          <Skel className="h-72" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Positive / Neutral / Negative bar chart (Positive / Neutral / Negative 막대 차트) */}
          <Panel title="Sentiment Analysis">
            {sentimentData.every((d) => d.value === 0) ? <ChartEmpty height="h-[200px]" /> : (
              <ResponsiveContainer width="100%" height={215}>
                <BarChart data={sentimentData} margin={{ top: 4, right: 4, bottom: 0, left: -18 }} barSize={48}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C_GRID} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: C_AXIS }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: C_AXIS }} axisLine={false} tickLine={false} />
                  <Tooltip content={DarkTip as never} />
                  <Bar dataKey="value" name="Calls" radius={[6, 6, 0, 0]}>
                    {sentimentData.map((e) => <Cell key={e.name} fill={SENTIMENT_COLORS[e.name] ?? C_AXIS} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          {/* 5 most recent flagged calls — click a row to open in Call History (클릭으로 통화 기록 열기 — 5건의 최근 표시된 통화) */}
          <Panel title="Needs Attention">
            {flagged.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-44 gap-3">
                {/* Positive empty state — light emerald badge consistent with light theme (라이트 테마와 일관된 연한 에메랄드 배지) */}
                <div className="h-12 w-12 rounded-2xl bg-emerald-50 flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                </div>
                <p className="text-xs text-gray-400 text-center">No flagged calls this period — great work!</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    {/* Table header row — border-gray-100 for a soft light divider (부드러운 라이트 구분선을 위한 border-gray-100) */}
                    <tr className="border-b border-gray-100">
                      {/* Table headers — text-gray-500 matches panel titles for consistent light hierarchy (일관된 라이트 계층 구조를 위한 패널 제목과 동일한 text-gray-500) */}
                      {['Date', 'Phone', 'Status', 'Sentiment', 'Dur.', ''].map((h) => (
                        <th key={h} className="text-left pb-3 font-medium text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  {/* Table body — each row routes to Call History on click (각 행이 클릭 시 통화 기록으로 이동) */}
                  <tbody>
                    {flagged.map((log, i) => (
                      <tr
                        key={i}
                        // Route to specific call details on click (클릭 시 특정 통화 상세 내역으로 이동)
                        onClick={() => router.push(`/${mode}/call-history?call_id=${log.call_id}`)}
                        className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        {/* Date cell — local short format "MMM D" (로컬 짧은 형식 "MMM D"의 날짜 셀) */}
                        <td className="py-3 px-4 text-sm text-gray-500">
                          {new Date(log.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </td>
                        {/* Phone cell — fallback to "Unknown" when absent (없을 때 "Unknown"으로 폴백하는 전화번호 셀) */}
                        <td className="py-3 px-4 text-sm text-gray-900 font-medium">
                          {log.customer_phone ?? 'Unknown'}
                        </td>
                        {/* Status badge — emerald for Successful, red for Unsuccessful (성공 시 에메랄드, 실패 시 빨간색 상태 배지) */}
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            log.call_status === 'Successful'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {log.call_status}
                          </span>
                        </td>
                        {/* Sentiment cell — colour driven by SENTIMENT_COLORS map (SENTIMENT_COLORS 맵으로 색상이 결정되는 감정 셀) */}
                        <td className="py-3 px-4 text-sm" style={{ color: SENTIMENT_COLORS[log.sentiment ?? ''] ?? C_AXIS }}>
                          {log.sentiment ?? '—'}
                        </td>
                        {/* Duration + chevron — MM:SS format with right-aligned navigate arrow (오른쪽 정렬 이동 화살표가 있는 MM:SS 형식의 지속시간) */}
                        <td className="py-3 px-4 text-sm text-gray-500 text-right">
                          <span className="inline-flex items-center justify-end gap-1 font-mono">
                            {log.duration != null
                              ? `${Math.floor(log.duration / 60)}:${String(log.duration % 60).padStart(2, '0')}`
                              : '—'}
                            <ChevronRight className="h-4 w-4 text-gray-400" />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-[10px] text-gray-400 italic">
                  5 most recent Negative or Unsuccessful calls. Click a row to view full details.
                </p>
              </div>
            )}
          </Panel>

        </div>
      )}

      {/* ── Peak Hours Heatmap: 7 days × 14 hours (9am–10pm), Mon-first (피크 시간 히트맵: 7일 × 14시간, 월요일 기준) */}
      {loading ? <Skel className="h-52" /> : (
        <Panel title="Peak Call Hours">
          {logs.length === 0 ? <ChartEmpty height="h-36" /> : (
            <div className="overflow-x-auto">
              <div className="min-w-[600px]">
                {/* Hour header — gray-400 labels visible against white background (흰색 배경에서 보이는 gray-400 레이블) */}
                <div className="flex gap-1 mb-1.5 pl-11">
                  {HOUR_LABELS.map((h) => (
                    <div key={h} className="flex-1 text-center text-[9px] text-gray-400 font-medium">{h}</div>
                  ))}
                </div>
                {/* Day rows Mon–Sun (월–일 요일 행) */}
                {DAY_LABELS.map((day, di) => (
                  <div key={day} className="flex items-center gap-1 mb-1">
                    {/* Day label — text-gray-500 for soft contrast on light background (라이트 배경의 부드러운 대비를 위한 text-gray-500) */}
                    <div className="w-10 shrink-0 text-[10px] text-gray-500 font-semibold text-right pr-2">{day}</div>
                    {HOUR_LABELS.map((_, hi) => {
                      const count = heatmap[di][hi];
                      // Intensity scale 0.10→0.95 proportional to busiest cell (가장 바쁜 셀에 비례한 강도 스케일 0.10→0.95)
                      const alpha = count > 0 ? 0.10 + (count / maxHeat) * 0.85 : 0;
                      return (
                        <div
                          key={hi}
                          title={`${day} ${HOUR_LABELS[hi]}: ${count} call${count !== 1 ? 's' : ''}`}
                          className="flex-1 h-7 rounded-md transition-colors"
                          style={{
                            backgroundColor: count > 0
                              ? `rgba(16,185,129,${alpha})`  // emerald with variable opacity (가변 투명도 에메랄드)
                              : 'rgb(243,244,246)',           // gray-100 for zero cells on light background (라이트 배경의 0 셀에 gray-100)
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
                {/* Legend bar — gray-400 labels match hour/day label tone (시간/요일 레이블 톤과 일치하는 gray-400 레이블) */}
                <div className="flex items-center gap-2.5 mt-3 pl-11">
                  <span className="text-[9px] text-gray-400 font-medium">Low</span>
                  <div className="flex-1 h-1.5 rounded-full" style={{ background: 'linear-gradient(to right,rgba(16,185,129,0.10),rgba(16,185,129,0.95))' }} />
                  <span className="text-[9px] text-gray-400 font-medium">High</span>
                </div>
              </div>
            </div>
          )}
        </Panel>
      )}

    </div>
  );
}
