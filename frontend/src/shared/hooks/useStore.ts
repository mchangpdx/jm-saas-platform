// useStore hook — convenience accessor for the active store's API data.
// Fetches the full store row on mount and re-fetches when storeId changes.
// Returns loading, error, and store so components don't repeat fetch logic.
// (useStore 훅 — 활성 매장 API 데이터에 대한 편의 접근자.
//  마운트 시 전체 매장 행 조회, storeId 변경 시 재조회.
//  컴포넌트가 fetch 로직을 반복하지 않도록 loading, error, store 반환)

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSessionStore }                  from '../stores/sessionStore';
import { fetchStore, type Store }           from '../api/stores';

export interface UseStoreResult {
  store:   Store | null;
  loading: boolean;
  error:   string | null;
  refetch: () => void;
}

export function useStore(): UseStoreResult {
  const storeId = useSessionStore((s) => s.storeId);

  const [store,   setStore  ] = useState<Store | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError  ] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!storeId) {
      // No store selected yet — clear data and return (아직 선택된 매장 없음 — 데이터 초기화 후 반환)
      setStore(null);
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: apiError } = await fetchStore(storeId);
    setStore(data);
    setError(apiError);
    setLoading(false);
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  return { store, loading, error, refetch: load };
}
