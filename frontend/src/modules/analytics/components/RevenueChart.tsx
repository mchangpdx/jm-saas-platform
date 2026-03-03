// RevenueChart — client component that fetches the last 7 days of paid orders for a given store
// from Supabase, groups them by date, and renders a professional AreaChart via recharts.
// Dark mode is detected at runtime by watching the 'dark' class on the root html element,
// so chart element colors (grid, axes, tooltip) automatically follow the active theme.
// Gradient SVG ID is stabilised with useId() to avoid conflicts when multiple charts exist.
// (RevenueChart — Supabase에서 주어진 매장의 최근 7일간 결제 주문을 조회하고
//  날짜별로 그룹화한 뒤 recharts AreaChart로 렌더링하는 클라이언트 컴포넌트.
//  다크 모드는 html 루트 요소의 'dark' 클래스를 실시간 감시하여 감지하므로
//  차트 요소 색상(그리드, 축, 툴팁)이 활성 테마를 자동으로 따름.
//  그라디언트 SVG ID는 useId()로 안정화 — 여러 차트 공존 시 충돌 방지)

'use client';

import { useState, useEffect, useCallback, useId } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  TooltipProps,
} from 'recharts';
import { TrendingUp, RefreshCw } from 'lucide-react';
import { getSupabaseClient }     from '@/shared/api/supabaseClient';
import { Spinner }               from '@/shared/components/Spinner';
import { ErrorAlert }            from '@/shared/components/ErrorAlert';

// One data point per day for the chart (차트에서 하루를 나타내는 데이터 포인트)
interface DayRevenue {
  label:   string; // MM/DD axis label (X축 레이블)
  revenue: number; // sum of total_amount for that day in USD (해당일 total_amount 합계, USD)
}

interface RevenueChartProps {
  storeId: string;
}

// Build the last 7 calendar days as YYYY-MM-DD strings, oldest → newest.
// (오래된 순으로 최근 7일 달력 날짜를 YYYY-MM-DD 문자열로 생성)
function buildDateRange(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// Convert YYYY-MM-DD to MM/DD for display on the X axis.
// (X축 표시를 위해 YYYY-MM-DD를 MM/DD로 변환)
function toAxisLabel(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${month}/${day}`;
}

// Format a number as US dollar currency — e.g., $1,250.00 (숫자를 미국 달러 통화 형식으로 변환)
function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// ── Custom Tooltip ────────────────────────────────────────────────────────────

// Fully custom recharts Tooltip so the dollar amount uses the US currency formatter.
// Adapts its background and border to the active light/dark theme.
// (달러 금액이 미국 통화 형식을 사용하도록 완전 맞춤 recharts 툴팁.
//  활성 라이트/다크 테마에 맞게 배경과 테두리 조정)
function CustomTooltip({ active, payload, label, isDark }: TooltipProps<number, string> & { isDark: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background:   isDark ? '#1f2937' : '#ffffff',
        border:       `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
        borderRadius: '8px',
        padding:      '8px 12px',
        fontSize:     '12px',
        boxShadow:    '0 2px 8px rgba(0,0,0,.12)',
      }}
    >
      {/* Date label (날짜 레이블) */}
      <p style={{ fontWeight: 600, color: isDark ? '#f9fafb' : '#111827', marginBottom: 2 }}>
        {label}
      </p>
      {/* Revenue value formatted as USD (USD 형식으로 포맷된 매출 값) */}
      <p style={{ color: '#6366f1' }}>
        {formatUsd(payload[0].value ?? 0)}
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function RevenueChart({ storeId }: RevenueChartProps) {
  const [chartData,    setChartData   ] = useState<DayRevenue[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [loading,      setLoading     ] = useState(true);
  const [error,        setError       ] = useState<string | null>(null);

  // Detect dark mode by watching the 'dark' class on the root html element.
  // MutationObserver fires on every Tailwind theme toggle — no polling needed.
  // (html 루트 요소의 'dark' 클래스를 감시하여 다크 모드 감지.
  //  MutationObserver가 Tailwind 테마 전환 시마다 실행 — 폴링 불필요)
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'));
    check(); // Read current state on mount (마운트 시 현재 상태 읽기)
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Stable unique ID for the SVG linearGradient — prevents id conflicts if multiple
  // RevenueChart instances exist on the same page.
  // (SVG linearGradient의 안정적인 고유 ID — 같은 페이지에 여러 RevenueChart가 있을 때 id 충돌 방지)
  const rawId  = useId();
  const gradId = `rev${rawId.replace(/:/g, '')}`;

  // Theme-aware chart element colors — switch between dark and light palette.
  // (테마별 차트 요소 색상 — 다크/라이트 팔레트 간 전환)
  const gridColor   = isDark ? '#374151' : '#e5e7eb'; // dark:gray-700 / gray-200
  const tickColor   = isDark ? '#6b7280' : '#9ca3af'; // dark:gray-500 / gray-400
  const gradOpacity = isDark ? 0.35 : 0.2;            // stronger fill in dark mode (다크 모드에서 채우기 강화)

  // Fetch paid orders for the last 7 days and group by calendar date.
  // (최근 7일간 결제 완료 주문을 조회하고 달력 날짜별로 그룹화)
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Start of the 7-day window at midnight local time (7일 창의 로컬 자정 시작)
    const since = new Date();
    since.setDate(since.getDate() - 6);
    since.setHours(0, 0, 0, 0);

    const { data, error: dbError } = await getSupabaseClient()
      .from('orders')
      .select('total_amount, created_at')
      .eq('store_id', storeId)
      .eq('status', 'paid')
      .gte('created_at', since.toISOString());

    if (dbError) {
      setError(dbError.message);
      setLoading(false);
      return;
    }

    // Initialize every day in the range to $0 so gaps render as flat, not missing.
    // (갭이 누락이 아닌 평탄하게 표시되도록 모든 날짜를 $0으로 초기화)
    const dayMap: Record<string, number> = {};
    buildDateRange().forEach((d) => { dayMap[d] = 0; });

    // Accumulate revenue into the matching calendar day bucket.
    // (일치하는 달력 날짜 버킷에 매출 누적)
    (data ?? []).forEach((row: { total_amount: unknown; created_at: unknown }) => {
      const day = String(row.created_at).slice(0, 10); // YYYY-MM-DD prefix (YYYY-MM-DD 접두사)
      if (day in dayMap) dayMap[day] += Number(row.total_amount);
    });

    // Convert the map to a sorted array and round each value to 2 decimal places.
    // (맵을 정렬된 배열로 변환하고 각 값을 소수점 2자리로 반올림)
    const chart: DayRevenue[] = Object.entries(dayMap).map(([d, rev]) => ({
      label:   toAxisLabel(d),
      revenue: Math.round(rev * 100) / 100,
    }));

    const total = Math.round(chart.reduce((s, d) => s + d.revenue, 0) * 100) / 100;

    setChartData(chart);
    setTotalRevenue(total);
    setLoading(false);
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">

      {/* Card header — title on left, 7-day total on right (카드 헤더 — 왼쪽 제목, 오른쪽 7일 합계) */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 px-6 py-4 dark:border-gray-800">

        <div className="flex items-center gap-3">
          <TrendingUp className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          <div>
            <h3 className="text-base font-semibold">AI Revenue — Last 7 Days</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Daily revenue from paid orders processed by the AI voice assistant.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4">
          {/* Prominent 7-day total revenue figure (두드러진 7일 총 매출 수치) */}
          {!loading && !error && (
            <div className="text-right">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                7-Day Total
              </p>
              <p className="text-3xl font-bold tracking-tight text-green-700 dark:text-green-400">
                {formatUsd(totalRevenue)}
              </p>
            </div>
          )}

          {/* Refresh button (새로고침 버튼) */}
          <button
            onClick={load}
            disabled={loading}
            className="mt-0.5 flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            {loading
              ? <Spinner className="h-3.5 w-3.5 text-indigo-500" />
              : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>
      </div>

      <div className="p-6">

        {/* Loading state (로딩 상태) */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6 text-indigo-500" />
          </div>
        )}

        {/* Error state (오류 상태) */}
        {!loading && error && <ErrorAlert message={error} />}

        {/* Empty state — no paid orders in the 7-day window yet (7일 창 내 결제 주문 없음 — 빈 상태) */}
        {!loading && !error && totalRevenue === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <TrendingUp className="mb-3 h-8 w-8 text-gray-300 opacity-60 dark:text-gray-600" />
            <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">
              No data available for this period.
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Let the AI handle more calls!
            </p>
          </div>
        )}

        {/* AreaChart — rendered only when at least one paid order exists in the window
            (창 내 결제 주문 최소 1건 존재 시에만 렌더링되는 AreaChart) */}
        {!loading && !error && totalRevenue > 0 && (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart
              data={chartData}
              margin={{ top: 10, right: 4, bottom: 0, left: 8 }}
            >
              {/* Theme-adaptive gradient fill beneath the area curve
                  (테마에 맞게 적응하는 AreaChart 곡선 아래 그라디언트 채우기) */}
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={gradOpacity} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0}           />
                </linearGradient>
              </defs>

              {/* Horizontal grid lines only — vertical lines add visual noise
                  (수평 그리드 선만 — 수직선은 시각적 노이즈를 더함) */}
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={gridColor}
                vertical={false}
              />

              {/* X axis — MM/DD date labels, no axis line or tick marks
                  (X축 — MM/DD 날짜 레이블, 축 선 및 눈금 없음) */}
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: tickColor }}
                axisLine={false}
                tickLine={false}
              />

              {/* Y axis — abbreviated dollar values, no axis line
                  (Y축 — 축약된 달러 값, 축 선 없음) */}
              <YAxis
                tick={{ fontSize: 11, fill: tickColor }}
                axisLine={false}
                tickLine={false}
                width={56}
                tickFormatter={(v: number) =>
                  v >= 1000
                    ? `$${(v / 1000).toFixed(1)}k`  // Compact thousands — e.g., $1.2k (천 단위 축약)
                    : `$${v}`
                }
              />

              {/* Custom Tooltip renders the full $x,xxx.xx formatted amount on hover
                  (호버 시 $x,xxx.xx 형식의 전체 금액을 표시하는 맞춤 툴팁) */}
              <Tooltip
                content={(props) => <CustomTooltip {...props} isDark={isDark} />}
                cursor={{ stroke: isDark ? '#4b5563' : '#d1d5db', strokeWidth: 1 }}
              />

              {/* Area with indigo stroke and gradient fill — dots on data points
                  (인디고 선과 그라디언트 채우기를 가진 Area — 데이터 포인트에 점 표시) */}
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#6366f1"
                strokeWidth={2}
                fill={`url(#${gradId})`}
                dot={{ r: 3, fill: '#6366f1', strokeWidth: 0 }}
                activeDot={{ r: 5, fill: '#6366f1' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
