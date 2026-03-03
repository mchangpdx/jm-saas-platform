// Agency overview page — landing page after login for agency-role users.
// Fetches real today-scoped stats from Supabase: total orders, reservations, and revenue.
// Re-fetches whenever selectedStoreId changes via the sidebar dropdown.
// Active Voice Calls is left as '—' because it requires a live WebSocket count.
// (에이전시 개요 페이지 — 에이전시 역할 사용자 로그인 후 랜딩 페이지.
//  Supabase에서 오늘 기준 실제 통계(총 주문, 예약, 매출)를 조회.
//  사이드바 드롭다운으로 selectedStoreId 변경 시 재조회.
//  활성 음성 통화는 실시간 WebSocket 카운트가 필요하여 '—'로 유지)

'use client';

import { useState, useEffect }              from 'react';
import Link                                 from 'next/link';
import { Mic, CalendarCheck, ShoppingCart, TrendingUp } from 'lucide-react';
import { useSessionStore }                  from '@/shared/stores/sessionStore';
import { getSupabaseClient }               from '@/shared/api/supabaseClient';
import { Spinner }                         from '@/shared/components/Spinner';

// Shape of today's fetched stats (오늘 조회된 통계 형태)
interface TodayStats {
  ordersToday:       number;
  reservationsToday: number;
  revenueTodayCents: number;
}

// Build an ISO start/end range for "today" in the local timezone.
// (로컬 타임존 기준 "오늘" ISO 시작/종료 범위 생성)
function getTodayRange(): { start: string; end: string } {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  return { start, end };
}

// Build today's date string in YYYY-MM-DD format for the reservation_date column.
// (reservation_date 열을 위한 YYYY-MM-DD 형식의 오늘 날짜 문자열 생성)
function getTodayDateStr(): string {
  const now  = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const dd   = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Format revenue from cents to a US dollar string (센트에서 미국 달러 문자열로 변환)
function formatRevenue(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AgencyOverviewPage() {
  const selectedStoreId = useSessionStore((s) => s.selectedStoreId);
  const storeName       = useSessionStore((s) => s.storeName);

  const [stats,        setStats       ] = useState<TodayStats>({ ordersToday: 0, reservationsToday: 0, revenueTodayCents: 0 });
  const [statsLoading, setStatsLoading] = useState(false);

  // Fetch today's stats from Supabase whenever the selected store changes.
  // Uses Promise.allSettled so a partial failure does not block the other fetch.
  // (선택된 매장이 변경될 때마다 Supabase에서 오늘 통계 조회.
  //  Promise.allSettled 사용으로 부분 실패 시에도 다른 조회 차단 방지)
  useEffect(() => {
    if (!selectedStoreId) {
      setStats({ ordersToday: 0, reservationsToday: 0, revenueTodayCents: 0 });
      return;
    }

    async function fetchTodayStats() {
      setStatsLoading(true);

      const { start, end } = getTodayRange();
      const todayDate      = getTodayDateStr();
      const supabase       = getSupabaseClient();

      // Parallel fetch — orders (with amount) and reservations for today.
      // (병렬 조회 — 오늘의 주문(금액 포함)과 예약)
      const [ordersRes, reservationsRes] = await Promise.allSettled([
        supabase
          .from('orders')
          .select('id, total_amount_cents')
          .eq('store_id', selectedStoreId)
          .gte('created_at', start)
          .lt('created_at', end),
        supabase
          .from('reservations')
          .select('id')
          .eq('store_id', selectedStoreId)
          .eq('reservation_date', todayDate),
      ]);

      let ordersToday       = 0;
      let revenueTodayCents = 0;
      let reservationsToday = 0;

      // Accumulate orders count and revenue sum from today's order rows.
      // (오늘 주문 행에서 주문 수와 매출 합계 누적)
      if (ordersRes.status === 'fulfilled' && !ordersRes.value.error) {
        const rows = ordersRes.value.data ?? [];
        ordersToday = rows.length;
        revenueTodayCents = rows.reduce(
          (sum, row) => sum + ((row as { total_amount_cents?: number }).total_amount_cents ?? 0),
          0,
        );
      }

      // Count today's reservations from the result set.
      // (결과 집합에서 오늘 예약 수 계산)
      if (reservationsRes.status === 'fulfilled' && !reservationsRes.value.error) {
        reservationsToday = (reservationsRes.value.data ?? []).length;
      }

      setStats({ ordersToday, reservationsToday, revenueTodayCents });
      setStatsLoading(false);
    }

    fetchTodayStats();
  }, [selectedStoreId]);

  // Build the stat card array using live data.
  // Active Voice Calls remains '—' — no real-time WebSocket count available.
  // (라이브 데이터를 사용하여 통계 카드 배열 구성.
  //  활성 음성 통화는 '—'로 유지 — 실시간 WebSocket 카운트 미구현)
  const statCards = [
    {
      label: 'Total Orders Today',
      value: statsLoading ? null : String(stats.ordersToday),
      icon:  ShoppingCart,
      color: 'text-green-600  dark:text-green-400',
    },
    {
      label: 'Reservations Today',
      value: statsLoading ? null : String(stats.reservationsToday),
      icon:  CalendarCheck,
      color: 'text-blue-600   dark:text-blue-400',
    },
    {
      label: 'Active Voice Calls',
      value: '—',                   // Real-time WebSocket count not yet implemented (실시간 WebSocket 카운트 미구현)
      icon:  Mic,
      color: 'text-indigo-600 dark:text-indigo-400',
    },
    {
      label: 'Revenue Today',
      value: statsLoading ? null : formatRevenue(stats.revenueTodayCents),
      icon:  TrendingUp,
      color: 'text-amber-600  dark:text-amber-400',
    },
  ];

  return (
    <div className="space-y-6">

      {/* Page heading (페이지 제목) */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          {storeName ? `Welcome — ${storeName}` : 'Dashboard Overview'}
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Manage your AI voice assistant, reservations, and POS integrations.
        </p>
      </div>

      {/* Quick-stats cards — live data from Supabase (Supabase에서 조회한 라이브 데이터 통계 카드) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</span>
              <Icon className={`h-5 w-5 ${color}`} />
            </div>

            {/* Show spinner while loading, then the resolved value (로딩 중 스피너, 이후 조회된 값 표시) */}
            <div className="mt-3">
              {value === null
                ? <Spinner className="h-5 w-5 text-gray-400" />
                : <p className="text-3xl font-bold">{value}</p>
              }
            </div>
          </div>
        ))}
      </div>

      {/* Module shortcuts (모듈 바로가기) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/agency/ai-voice-bot"
          className="flex items-start gap-4 rounded-xl border border-indigo-100 bg-indigo-50 p-5 transition hover:border-indigo-200 hover:bg-indigo-100 dark:border-indigo-900/40 dark:bg-indigo-900/20 dark:hover:bg-indigo-900/30"
        >
          <Mic className="mt-0.5 h-6 w-6 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <div>
            <p className="font-semibold text-indigo-900 dark:text-indigo-200">AI Voice Bot</p>
            <p className="mt-0.5 text-sm text-indigo-700 dark:text-indigo-400">
              Manage system prompts and review call logs.
            </p>
          </div>
        </Link>

        <Link
          href="/agency/reservations"
          className="flex items-start gap-4 rounded-xl border border-blue-100 bg-blue-50 p-5 transition hover:border-blue-200 hover:bg-blue-100 dark:border-blue-900/40 dark:bg-blue-900/20 dark:hover:bg-blue-900/30"
        >
          <CalendarCheck className="mt-0.5 h-6 w-6 shrink-0 text-blue-600 dark:text-blue-400" />
          <div>
            <p className="font-semibold text-blue-900 dark:text-blue-200">Reservations</p>
            <p className="mt-0.5 text-sm text-blue-700 dark:text-blue-400">
              View and manage upcoming guest reservations.
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}
