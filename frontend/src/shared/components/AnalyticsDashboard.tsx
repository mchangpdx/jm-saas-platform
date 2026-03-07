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
import { getSupabaseClient } from '@/shared/api/supabaseClient';
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
const C_INDIGO   = '#6366f1';
const C_ROSE     = '#f43f5e';
const C_AMBER    = '#f59e0b';
const C_BLUE     = '#3b82f6';
const C_AXIS     = '#94a3b8'; // slate-400 — legible on dark charts (다크 차트에서 가독성 있는 색상)
const C_GRID     = 'rgba(148,163,184,0.08)'; // near-invisible guide lines (거의 보이지 않는 가이드 선)

const SENTIMENT_COLORS: Record<string, string> = {
  Positive: C_EMERALD,
  Neutral:  C_AMBER,
  Negative: C_ROSE,
};
const STATUS_COLORS = [C_EMERALD, C_ROSE];
const DAY_LABELS    = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_LABELS   = ['9am','10am','11am','12pm','1pm','2pm','3pm','4pm','5pm','6pm','7pm','8pm','9pm','10pm'];

// Glassmorphism card base class reused on every panel (모든 패널에서 재사용하는 글래스모피즘 카드 기본 클래스)
const GLASS = 'bg-slate-900/60 backdrop-blur-md border border-slate-800/50 rounded-2xl';

// ── Pure helpers ───────────────────────────────────────────────────────────────

// Format a single call's seconds as MM:SS for the Needs Attention table (Needs Attention 테이블을 위해 단일 통화 초를 MM:SS로 포맷)
function fmtMmSs(seconds: number | null): string {
  if (seconds == null) return '—';
  const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
  const ss = (seconds % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

// Dark glassmorphism tooltip for all Recharts charts (모든 Recharts 차트용 다크 글래스모피즘 툴팁)
function DarkTip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl bg-slate-800/95 border border-slate-700/60 px-3.5 py-2.5 shadow-2xl text-xs backdrop-blur-sm">
      {label && <p className="text-slate-400 mb-1.5 font-medium">{label}</p>}
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
      <BarChart3 className="h-8 w-8 text-slate-700" />
      <p className="text-xs text-slate-600">No data for this period</p>
    </div>
  );
}

// Pulse skeleton block displayed while data is loading (데이터 로딩 중 표시되는 펄스 스켈레톤 블록)
function Skel({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-slate-800/50 ${className ?? ''}`} />;
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
        <p className="text-[11px] text-slate-400 mb-1.5 font-medium uppercase tracking-widest">{label}</p>
        <p className="text-2xl font-bold text-white leading-none mb-1">{value}</p>
        {sub && <p className="text-xs text-slate-500">{sub}</p>}
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
      <p className="text-sm font-semibold text-slate-400 mb-5 uppercase tracking-wider">{title}</p>
      {children}
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────────

export interface AnalyticsDashboardProps {
  mode: 'agency' | 'store';
  id:   string; // storeId when mode='store' — agencyId when mode='agency' (mode='store'일 때 storeId, mode='agency'일 때 agencyId)
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AnalyticsDashboard({ mode, id }: AnalyticsDashboardProps) {
  const router = useRouter();

  // ── State ──────────────────────────────────────────────────────────────────
  const [logs,      setLogs     ] = useState<CallLog[]>([]);
  const [orders,    setOrders   ] = useState<Order[]>([]);
  const [loading,   setLoading  ] = useState(true);
  const [error,     setError    ] = useState<string | null>(null);
  const [noStores,  setNoStores ] = useState(false); // agency has zero stores linked (에이전시에 연결된 매장 없음)
  // Default period matches the Overview widget for consistent cross-page numbers (개요 위젯과 일관된 크로스 페이지 숫자를 위해 기본 기간 일치)
  const [dateRange, setDateRange] = useState<DateRange>('month');

  // ── Data fetching ──────────────────────────────────────────────────────────

  // Single fetch function that serves both modes — re-runs whenever mode, id, or dateRange change.
  // All date and status filters are applied server-side so every chart and KPI card is always
  // driven by the exact same Supabase result sets.
  // (mode, id, dateRange가 변경될 때마다 재실행되는 단일 조회 함수.
  //  모든 날짜 및 상태 필터를 서버 사이드에서 적용하므로
  //  모든 차트와 KPI 카드가 항상 동일한 Supabase 결과셋으로 구동됨)
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNoStores(false);

    const supabase = getSupabaseClient();
    let   storeIds: string[] = [];

    if (mode === 'agency') {
      // Fetch all stores that belong to this agency via the agency_id column (agency_id 컬럼을 통해 이 에이전시에 속한 모든 매장 조회)
      const { data: storeRows, error: storesErr } = await supabase
        .from('stores')
        .select('id')
        .eq('agency_id', id);

      if (storesErr) {
        setError(storesErr.message);
        setLoading(false);
        return;
      }

      storeIds = (storeRows ?? []).map((r: { id: string }) => r.id);

      if (storeIds.length === 0) {
        // Agency exists but has no stores attached yet — show empty state (에이전시는 존재하나 아직 연결된 매장 없음 — 빈 상태 표시)
        setNoStores(true);
        setLogs([]);
        setOrders([]);
        setLoading(false);
        return;
      }
    } else {
      // Store mode — use id directly as the single store scope (매장 모드 — id를 단일 매장 스코프로 직접 사용)
      storeIds = [id];
    }

    // Compute server-side date boundaries from the selected period (선택된 기간에서 서버 사이드 날짜 경계 계산)
    const boundary = getDateBoundary(dateRange);
    const startIso = boundary ? boundary.toISOString() : null;
    // Upper bound is always "now" — prevents any future-dated rows from leaking in (상한은 항상 "현재" — 미래 날짜 행이 포함되는 것을 방지)
    const endIso   = new Date().toISOString();

    // [X-Ray] Log the exact ISO strings being sent to Supabase so we can verify the filter is applied (Supabase로 전송되는 정확한 ISO 문자열을 로그에 출력하여 필터 적용 여부 확인)
    console.log('[X-Ray] Date filter applied:', {
      mode,
      storeIds,
      range:       dateRange,
      start:       startIso ?? '(none — All time)',
      end:         endIso,
      filterActive: startIso !== null,
    });

    // Build the call_logs query — apply start_time bounds when a date range is active (날짜 범위가 활성화된 경우 start_time 경계를 적용하는 call_logs 쿼리 구성)
    let logsQ = supabase
      .from('call_logs')
      .select('call_id, start_time, duration, sentiment, call_status, cost, customer_phone')
      .in('store_id', storeIds)
      .order('start_time', { ascending: false })
      .limit(1000);

    if (startIso) {
      // Apply gte + lte on start_time so the period selector actually changes Total Calls / Cost (기간 선택기가 실제로 Total Calls/Cost를 변경하도록 start_time에 gte + lte 적용)
      logsQ = logsQ.gte('start_time', startIso).lte('start_time', endIso);
    }

    // Build the orders query — ONLY paid orders, within the same date window (동일한 날짜 창 내의 결제 완료 주문만 포함하는 orders 쿼리 구성)
    let ordersQ = supabase
      .from('orders')
      .select('created_at, total_amount')
      .in('store_id', storeIds)
      // Strictly filter to paid status — pending/cancelled orders must never inflate AI Revenue (결제 완료 상태로 엄격하게 필터링 — 대기/취소 주문은 AI 매출을 절대 부풀려선 안 됨)
      .eq('status', 'paid')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (startIso) {
      // Apply created_at bounds in exact sync with the call_logs date filter (call_logs 날짜 필터와 정확히 동기화하여 created_at 경계 적용)
      ordersQ = ordersQ.gte('created_at', startIso).lte('created_at', endIso);
    }

    // Execute both queries in parallel to minimise total round-trip time (총 왕복 시간 최소화를 위해 두 쿼리를 병렬 실행)
    const [logsRes, ordersRes] = await Promise.all([logsQ, ordersQ]);

    // [X-Ray] Log the exact row counts returned by Supabase so we can confirm the filter is working (필터 적용 여부를 확인하기 위해 Supabase가 반환한 정확한 행 수를 로그에 출력)
    console.log('[X-Ray] Raw call_logs fetched:', logsRes.data?.length ?? 0, 'records');
    console.log('[X-Ray] Raw orders fetched (paid only):', ordersRes.data?.length ?? 0, 'records');

    // [X-Ray] Log Supabase errors so we can catch silent query failures (자동으로 실패하는 쿼리를 잡기 위해 Supabase 오류를 로그에 출력)
    if (logsRes.error) {
      console.error('[X-Ray] call_logs query error:', logsRes.error.message, logsRes.error);
    }
    if (ordersRes.error) {
      console.error('[X-Ray] orders query error:', ordersRes.error.message, ordersRes.error);
    }

    // [X-Ray] Log the first 3 call_log rows so we can verify start_time values against the filter (필터 대비 start_time 값을 확인하기 위해 call_log의 첫 3행을 로그에 출력)
    console.log('[X-Ray] call_logs sample (first 3):', (logsRes.data ?? []).slice(0, 3).map((r) => ({
      call_id:    (r as { call_id?: string }).call_id,
      start_time: (r as { start_time?: string }).start_time,
      status:     (r as { call_status?: string }).call_status,
    })));

    // [X-Ray] Log the first 3 order rows so we can verify created_at and total_amount values (created_at과 total_amount 값을 확인하기 위해 order의 첫 3행을 로그에 출력)
    console.log('[X-Ray] orders sample (first 3):', (ordersRes.data ?? []).slice(0, 3).map((r) => ({
      created_at:   (r as { created_at?: string }).created_at,
      total_amount: (r as { total_amount?: number }).total_amount,
    })));

    setLogs((logsRes.data     as CallLog[] | null) ?? []);
    setOrders((ordersRes.data as Order[]   | null) ?? []);

    // Surface errors — second error appended only when first is absent (오류 노출 — 두 번째 오류는 첫 번째가 없을 때만 추가)
    if (logsRes.error)   setError(logsRes.error.message);
    if (ordersRes.error) setError((p) => p ?? ordersRes.error!.message);

    setLoading(false);
  // dateRange is a dep so changing the period fires a fresh server-side query (기간 변경이 새로운 서버 사이드 쿼리를 실행하도록 dateRange를 의존성으로 추가)
  }, [mode, id, dateRange]);

  // Trigger fetchData whenever mode, id, or dateRange changes (mode, id, dateRange 변경 시 fetchData 실행)
  useEffect(() => { fetchData(); }, [fetchData]);

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

  // Daily series merging call counts (start_time) and paid revenue (created_at) for the ComposedChart (ComposedChart용 통화 건수와 결제 매출을 병합한 일별 계열)
  const composedData = useMemo(() => {
    const byDate: Record<string, { key: string; label: string; calls: number; revenue: number }> = {};

    // Accumulate one call per log row using start_time date prefix (start_time 날짜 접두사로 각 로그 행의 통화 1건 누적)
    logs.forEach((l) => {
      const key   = l.start_time.slice(0, 10);
      const label = new Date(l.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (!byDate[key]) byDate[key] = { key, label, calls: 0, revenue: 0 };
      byDate[key].calls++;
    });

    // Accumulate paid revenue per day — total_amount is already in USD, no division needed (일별 결제 매출 누적 — total_amount는 이미 USD 단위, 나눗셈 불필요)
    orders.forEach((o) => {
      const key   = o.created_at.slice(0, 10);
      const label = new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (!byDate[key]) byDate[key] = { key, label, calls: 0, revenue: 0 };
      byDate[key].revenue += (o.total_amount ?? 0);
    });

    return Object.values(byDate)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(({ label, calls, revenue }) => ({
        date:    label,
        calls,
        // Round to 2 dp to eliminate floating-point accumulation drift (부동소수점 누적 오차 제거를 위해 소수점 2자리로 반올림)
        revenue: Math.round(revenue * 100) / 100,
      }));
  }, [logs, orders]);

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
        <div className="h-16 w-16 rounded-2xl bg-slate-800/60 flex items-center justify-center mb-5">
          <Store className="h-8 w-8 text-slate-600" />
        </div>
        <p className="text-base font-semibold text-slate-400">No stores linked to this agency yet.</p>
        <p className="mt-1 text-sm text-slate-600">Add a store with this agency's ID to start seeing data.</p>
      </div>
    );
  }

  // ── Render — main dashboard ────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">

      {/* ── Control bar: heading + period picker + export (제목 + 기간 선택기 + 내보내기) */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Analytics</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {mode === 'agency'
              ? 'Aggregated AI voice performance across all stores.'
              : 'AI voice agent performance for this store.'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Period selector — each click triggers a fresh server-side fetch (각 클릭이 새로운 서버 사이드 조회를 트리거하는 기간 선택기) */}
          <div className="flex rounded-xl border border-slate-800/70 overflow-hidden">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setDateRange(p.value)}
                className={[
                  'px-3.5 py-1.5 text-xs font-semibold transition-colors',
                  dateRange === p.value
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-900/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200',
                ].join(' ')}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* CSV export button — disabled when no data is loaded (데이터가 없을 때 비활성화되는 CSV 내보내기 버튼) */}
          <button
            onClick={downloadCSV}
            disabled={loading || logs.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-slate-800/70 bg-slate-900/60 text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>

          {/* PDF export via browser print dialog (브라우저 인쇄 대화상자를 통한 PDF 내보내기) */}
          <button
            onClick={() => window.print()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-slate-800/70 bg-slate-900/60 text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FileText className="h-3.5 w-3.5" />
            PDF
          </button>

          {/* Refresh — re-runs fetchData with the current period (현재 기간으로 fetchData를 재실행하는 새로고침) */}
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-slate-800/70 bg-slate-900/60 text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Error banner (오류 배너) */}
      {error && (
        <div className="flex items-center gap-2.5 rounded-xl border border-red-800/60 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
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
                  <Line yAxisId="right" type="monotone" dataKey="revenue" name="Revenue ($)" stroke={C_INDIGO} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: C_INDIGO, strokeWidth: 0 }} />
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
                        <div className="rounded-xl bg-slate-800/95 border border-slate-700/60 px-3.5 py-2.5 shadow-2xl text-xs">
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
                <div className="h-12 w-12 rounded-2xl bg-emerald-900/30 flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                </div>
                <p className="text-xs text-slate-500 text-center">No flagged calls this period — great work!</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800/60">
                      {['Date', 'Phone', 'Status', 'Sentiment', 'Dur.', ''].map((h) => (
                        <th key={h} className="text-left pb-3 font-medium text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {flagged.map((log, i) => (
                      // Row click navigates to Call History filtered by call_id (행 클릭으로 call_id로 필터링된 통화 기록으로 이동)
                      <tr
                        key={i}
                        onClick={() => router.push(`/${mode}/call-history?call_id=${log.call_id}`)}
                        className="hover:bg-slate-800/30 cursor-pointer transition-colors"
                      >
                        <td className="py-3 text-slate-400">
                          {new Date(log.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </td>
                        <td className="py-3 text-slate-300 font-mono">{log.customer_phone ?? '—'}</td>
                        <td className="py-3">
                          <span className={[
                            'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
                            log.call_status === 'Successful'
                              ? 'bg-emerald-900/40 text-emerald-400 ring-emerald-700/50'
                              : 'bg-rose-900/40   text-rose-400   ring-rose-700/50',
                          ].join(' ')}>
                            {log.call_status}
                          </span>
                        </td>
                        <td className="py-3">
                          <span className="text-[11px] font-semibold" style={{ color: SENTIMENT_COLORS[log.sentiment ?? ''] ?? C_AXIS }}>
                            {log.sentiment ?? '—'}
                          </span>
                        </td>
                        <td className="py-3 text-slate-400 font-mono">{fmtMmSs(log.duration)}</td>
                        <td className="py-3 text-slate-600"><ChevronRight className="h-3.5 w-3.5" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-[10px] text-slate-600 italic">
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
                {/* Hour header (시간 헤더) */}
                <div className="flex gap-1 mb-1.5 pl-11">
                  {HOUR_LABELS.map((h) => (
                    <div key={h} className="flex-1 text-center text-[9px] text-slate-600 font-medium">{h}</div>
                  ))}
                </div>
                {/* Day rows Mon–Sun (월–일 요일 행) */}
                {DAY_LABELS.map((day, di) => (
                  <div key={day} className="flex items-center gap-1 mb-1">
                    <div className="w-10 shrink-0 text-[10px] text-slate-500 font-semibold text-right pr-2">{day}</div>
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
                              ? `rgba(16,185,129,${alpha})`        // emerald with variable opacity (가변 투명도 에메랄드)
                              : 'rgba(15,23,42,0.6)',               // near-black for zero cells (0 셀은 거의 검정)
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
                {/* Legend bar (범례 막대) */}
                <div className="flex items-center gap-2.5 mt-3 pl-11">
                  <span className="text-[9px] text-slate-600 font-medium">Low</span>
                  <div className="flex-1 h-1.5 rounded-full" style={{ background: 'linear-gradient(to right,rgba(16,185,129,0.10),rgba(16,185,129,0.95))' }} />
                  <span className="text-[9px] text-slate-600 font-medium">High</span>
                </div>
              </div>
            </div>
          )}
        </Panel>
      )}

    </div>
  );
}
