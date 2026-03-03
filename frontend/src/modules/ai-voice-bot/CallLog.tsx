// CallLog — table of recent orders and reservations for the active store.
// Merges both record types into one date-sorted list via useCallLog.
// (CallLog — 활성 매장의 최근 주문 및 예약 테이블.
//  useCallLog를 통해 두 레코드 유형을 하나의 날짜 정렬 목록으로 병합)

'use client';

import { RefreshCw, PhoneCall, ShoppingCart, CalendarCheck } from 'lucide-react';
import { useCallLog }   from '@/shared/hooks/useCallLog';
import { Badge, statusVariant } from '@/shared/components/Badge';
import { Spinner }      from '@/shared/components/Spinner';
import { ErrorAlert }   from '@/shared/components/ErrorAlert';
import type { CallLogEntry } from '@/shared/api/calllog';

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

// Format dollar amount in US locale (미국 로케일로 달러 금액 형식화)
function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// Single row renderer — handles both order and reservation entries
// (단일 행 렌더러 — 주문과 예약 항목 모두 처리)
function CallLogRow({ entry }: { entry: CallLogEntry }) {
  if (entry.kind === 'order') {
    const o = entry.data;
    return (
      <tr className="border-t border-gray-100 dark:border-gray-800">
        <td className="px-4 py-3">
          <span className="flex items-center gap-2 text-sm">
            <ShoppingCart className="h-3.5 w-3.5 shrink-0 text-green-500" />
            Order
          </span>
        </td>
        <td className="px-4 py-3 text-sm font-medium">{o.customer_name}</td>
        <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
          {o.customer_phone ?? '—'}
        </td>
        <td className="px-4 py-3">
          <Badge label={o.status} variant={statusVariant(o.status)} />
        </td>
        <td className="px-4 py-3 text-right text-sm font-semibold text-green-700 dark:text-green-400">
          {formatUsd(o.total_amount)}
        </td>
        <td className="px-4 py-3 text-right text-xs text-gray-400 dark:text-gray-500">
          {formatDate(o.created_at)}
        </td>
      </tr>
    );
  }

  // Reservation row (예약 행)
  const r = entry.data;
  const dateLabel = `${r.reservation_date} ${r.reservation_time}`;

  return (
    <tr className="border-t border-gray-100 dark:border-gray-800">
      <td className="px-4 py-3">
        <span className="flex items-center gap-2 text-sm">
          <CalendarCheck className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          Reservation
        </span>
      </td>
      <td className="px-4 py-3 text-sm font-medium">{r.customer_name}</td>
      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
        {r.customer_phone ?? '—'}
      </td>
      <td className="px-4 py-3">
        <Badge label={r.status} variant={statusVariant(r.status)} />
      </td>
      <td className="px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-300">
        {r.party_size} {r.party_size === 1 ? 'guest' : 'guests'} · {dateLabel}
      </td>
      <td className="px-4 py-3 text-right text-xs text-gray-400 dark:text-gray-500">
        {formatDate(r.created_at)}
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CallLog() {
  const { entries, loading, error, refetch } = useCallLog(50);

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">

      {/* Card header (카드 헤더) */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <PhoneCall className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          <div>
            <h3 className="text-base font-semibold">Recent Call Log</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Latest 50 orders and reservations placed via the AI voice assistant.
            </p>
          </div>
        </div>

        {/* Refresh button (새로고침 버튼) */}
        <button
          onClick={refetch}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          {loading
            ? <Spinner className="h-3.5 w-3.5 text-indigo-500" />
            : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </div>

      {/* Error banner (오류 배너) */}
      {error && (
        <div className="px-6 pt-4">
          <ErrorAlert message={error} />
        </div>
      )}

      {/* Empty state (빈 상태) */}
      {!loading && entries.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-gray-400 dark:text-gray-500">
          <PhoneCall className="mb-3 h-8 w-8 opacity-30" />
          <p>No calls recorded yet.</p>
          <p className="mt-1 text-xs">Orders and reservations from the AI voice assistant will appear here.</p>
        </div>
      )}

      {/* Data table (데이터 테이블) */}
      {entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Amount / Details</th>
                <th className="px-4 py-3 text-right">Date</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <CallLogRow key={`${entry.kind}-${entry.data.id}`} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
