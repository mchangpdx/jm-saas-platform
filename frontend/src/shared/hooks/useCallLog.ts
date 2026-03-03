// useCallLog hook — merges orders and reservations into a unified, date-sorted list.
// Both fetches run in parallel via Promise.allSettled to avoid one failure blocking the other.
// (useCallLog 훅 — 주문과 예약을 통합된 날짜 정렬 목록으로 병합.
//  두 fetch가 Promise.allSettled로 병렬 실행되어 하나의 실패가 다른 것을 차단하지 않음)

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSessionStore }                  from '../stores/sessionStore';
import {
  fetchOrders,
  fetchReservations,
  type CallLogEntry,
} from '../api/calllog';

export interface UseCallLogResult {
  entries: CallLogEntry[];
  loading: boolean;
  error:   string | null;
  refetch: () => void;
}

export function useCallLog(limit = 50): UseCallLogResult {
  const storeId = useSessionStore((s) => s.storeId);

  const [entries, setEntries] = useState<CallLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError  ] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!storeId) { setEntries([]); return; }

    setLoading(true);
    setError(null);

    // Run both fetches in parallel — partial failure still renders available data
    // (두 fetch 병렬 실행 — 부분 실패 시에도 사용 가능한 데이터 렌더링)
    const [ordersResult, reservationsResult] = await Promise.allSettled([
      fetchOrders(storeId, limit),
      fetchReservations(storeId, limit),
    ]);

    const errors: string[] = [];

    const orders =
      ordersResult.status === 'fulfilled' && ordersResult.value.data
        ? ordersResult.value.data
        : (errors.push(ordersResult.status === 'rejected'
            ? String(ordersResult.reason)
            : (ordersResult.value.error ?? '')), []);

    const reservations =
      reservationsResult.status === 'fulfilled' && reservationsResult.value.data
        ? reservationsResult.value.data
        : (errors.push(reservationsResult.status === 'rejected'
            ? String(reservationsResult.reason)
            : (reservationsResult.value.error ?? '')), []);

    // Merge and sort descending by created_at (created_at 기준 내림차순 정렬 후 병합)
    const merged: CallLogEntry[] = [
      ...orders.map((d) => ({ kind: 'order' as const, data: d })),
      ...reservations.map((d) => ({ kind: 'reservation' as const, data: d })),
    ].sort(
      (a, b) =>
        new Date(b.data.created_at).getTime() -
        new Date(a.data.created_at).getTime(),
    );

    setEntries(merged);
    setError(errors.filter(Boolean).join(' | ') || null);
    setLoading(false);
  }, [storeId, limit]);

  useEffect(() => { load(); }, [load]);

  return { entries, loading, error, refetch: load };
}
