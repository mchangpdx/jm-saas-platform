// LiveCallLog — client component that fetches and displays the latest 10 orders
// for a given store directly from Supabase. Accepts storeId as a prop so the
// parent server component controls which store's data is shown.
// (LiveCallLog — Supabase에서 직접 주어진 매장의 최근 주문 10건을 조회·표시하는 클라이언트 컴포넌트.
//  부모 서버 컴포넌트가 표시할 매장 데이터를 제어하도록 storeId를 prop으로 받음)

'use client';

import { useState, useEffect, useCallback } from 'react';
import { PhoneCall, RefreshCw }             from 'lucide-react';
import { getSupabaseClient }                from '@/shared/api/supabaseClient';
import { Badge, statusVariant }             from '@/shared/components/Badge';
import { Spinner }                          from '@/shared/components/Spinner';
import { ErrorAlert }                       from '@/shared/components/ErrorAlert';

// Shape of an order row selected from Supabase.
// id typed as string | number because Supabase may return either depending on column type.
// (Supabase에서 조회한 주문 행 형태.
//  컬럼 타입에 따라 Supabase가 string 또는 number를 반환할 수 있으므로 id를 유니온 타입으로 선언)
interface OrderRow {
  id:            string | number;
  customer_name: string;
  total_amount:  number;
  status:        string;
  created_at:    string;
}

interface LiveCallLogProps {
  storeId: string;
}

// Format a dollar amount in US locale: $1,234.56 (미국 로케일 달러 형식: $1,234.56)
function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// Format ISO timestamp to US locale: MM/DD/YYYY, h:mm AM/PM
// (ISO 타임스탬프를 미국 로케일 형식으로 변환: MM/DD/YYYY, h:mm AM/PM)
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month:  '2-digit',
      day:    '2-digit',
      year:   'numeric',
      hour:   'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

// Truncate any ID to first 8 chars for a compact Order ID display.
// Accepts string, number, or undefined — converts to string before slicing
// so a numeric or missing id never throws TypeError.
// (간결한 주문 ID 표시를 위해 모든 ID를 앞 8자로 자름.
//  자르기 전 문자열로 변환하여 숫자형이나 undefined id에서 TypeError 방지)
function shortId(id: string | number | undefined): string {
  if (!id) return 'N/A'; // Handle missing ID (누락된 ID 예외 처리)
  return `#${String(id).slice(0, 8).toUpperCase()}`; // Safely convert to string before slicing (자르기 전 문자열로 안전하게 변환)
}

// ── Main component ──────────────────────────────────────────────────────────

export function LiveCallLog({ storeId }: LiveCallLogProps) {
  const [orders,  setOrders ] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError  ] = useState<string | null>(null);

  // Fetch latest 10 orders from Supabase ordered by creation time descending.
  // (생성 시간 내림차순으로 Supabase에서 최근 주문 10건 조회)
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: dbError } = await getSupabaseClient()
      .from('orders')
      .select('id, customer_name, total_amount, status, created_at')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (dbError) {
      setError(dbError.message);
    } else {
      setOrders(data ?? []);
    }

    setLoading(false);
  }, [storeId]);

  // Run fetch on mount and whenever storeId changes (마운트 및 storeId 변경 시 fetch 실행)
  useEffect(() => { load(); }, [load]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">

      {/* Card header with refresh button (새로고침 버튼이 있는 카드 헤더) */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <PhoneCall className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          <div>
            <h3 className="text-base font-semibold">Live Call Orders</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Latest 10 orders placed via the AI voice assistant.
            </p>
          </div>
        </div>

        {/* Refresh button — disabled while loading (로딩 중 비활성화되는 새로고침 버튼) */}
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
          aria-label="Refresh orders"
        >
          {loading
            ? <Spinner className="h-3.5 w-3.5 text-indigo-500" />
            : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </div>

      {/* Error banner — shown when the Supabase query fails (Supabase 쿼리 실패 시 표시되는 오류 배너) */}
      {error && (
        <div className="px-6 pt-4">
          <ErrorAlert message={error} />
        </div>
      )}

      {/* Loading skeleton — only shown on initial load before any data arrives
          (최초 로드 중 데이터 도착 전에만 표시되는 로딩 스켈레톤) */}
      {loading && orders.length === 0 && (
        <div className="flex items-center justify-center py-16">
          <Spinner className="h-6 w-6 text-indigo-500" />
        </div>
      )}

      {/* Empty state — no orders exist yet for this store (이 매장에 아직 주문 없음 — 빈 상태) */}
      {!loading && orders.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-gray-400 dark:text-gray-500">
          <PhoneCall className="mb-3 h-8 w-8 opacity-30" />
          <p className="font-medium">No orders recorded yet.</p>
          <p className="mt-1 text-xs">
            Orders placed via your AI voice assistant will appear here.
          </p>
        </div>
      )}

      {/* Orders data table — visible once at least one order has been fetched
          (최소 하나의 주문 조회 완료 시 표시되는 주문 데이터 테이블) */}
      {orders.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left">

            {/* Table header row (테이블 헤더 행) */}
            <thead>
              <tr className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
                <th className="px-4 py-3">Order ID</th>
                <th className="px-4 py-3">Customer Name</th>
                <th className="px-4 py-3 text-right">Total Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Date</th>
              </tr>
            </thead>

            {/* Table body — one row per order (주문당 한 행으로 구성된 테이블 바디) */}
            <tbody>
              {orders.map((order) => (
                <tr
                  key={order.id}
                  className="border-t border-gray-100 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/40"
                >
                  {/* Truncated UUID displayed as a monospaced order reference (단축 UUID를 모노스페이스 주문 참조로 표시) */}
                  <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">
                    {shortId(order.id)}
                  </td>

                  {/* Customer full name (고객 전체 이름) */}
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                    {order.customer_name}
                  </td>

                  {/* Dollar amount formatted in US locale (미국 로케일로 형식화된 달러 금액) */}
                  <td className="px-4 py-3 text-right text-sm font-semibold text-green-700 dark:text-green-400">
                    {formatUsd(order.total_amount)}
                  </td>

                  {/* Status badge — color-coded by statusVariant helper (statusVariant 헬퍼로 색상 코딩된 상태 배지) */}
                  <td className="px-4 py-3">
                    <Badge label={order.status} variant={statusVariant(order.status)} />
                  </td>

                  {/* Creation timestamp in MM/DD/YYYY format (MM/DD/YYYY 형식의 생성 타임스탬프) */}
                  <td className="px-4 py-3 text-right text-xs text-gray-400 dark:text-gray-500">
                    {formatDate(order.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
