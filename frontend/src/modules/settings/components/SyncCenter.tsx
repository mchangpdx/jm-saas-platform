// SyncCenter — Direct-to-Live sync dashboard for the settings page.
// Layout:
//   1. Action bar — "Sync Now" (full catalog sync) and "Sync Customers" buttons.
//   2. Paginated menu_items table — exactly 15 rows per page.
//      Columns: Category | Item Name | Price | Stock | Last Synced.
//      Name, Price, Stock headers are clickable to toggle Ascending / Descending sort.
//      Previous/Next navigation with "Page X of Y — N total" counter.
//   3. Toast notification bar — auto-dismisses after 4 s on success or error.
// Theme: modern dark slate — matches the overall app design language.
// StoreID resolution: StoreContext (primary) → Zustand sessionStore (fallback).
// (Direct-to-Live 설정 페이지용 동기화 대시보드.
//  레이아웃:
//  1. 액션 바 — "Sync Now"(전체 카탈로그 동기화)와 "Sync Customers" 버튼.
//  2. 페이지네이션 menu_items 테이블 — 정확히 15개 행.
//     컬럼: 카테고리|항목명|가격|재고|마지막 동기화.
//     이름, 가격, 재고 헤더 클릭으로 오름차순/내림차순 정렬 전환.
//     "이전/다음" 탐색 및 "페이지 X / Y — N개 합계" 카운터.
//  3. 토스트 알림 바 — 성공/오류 후 4초 후 자동 해제.
//  테마: 모던 다크 슬레이트 — 앱 전체 디자인 언어와 일치.
//  StoreID 결정: StoreContext(우선) → Zustand sessionStore(폴백))

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw,
  Users,
  CheckCircle2,
  AlertCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from 'lucide-react';
import { getSupabaseClient }      from '@/shared/api/supabaseClient';
import { useStoreContext }         from '@/shared/contexts/StoreContext';
import { useSessionStore }         from '@/shared/stores/sessionStore';
import { Spinner }                 from '@/shared/components/Spinner';
import { syncAll, syncCustomers }  from '@/services/api/syncService';

// ── Constants ─────────────────────────────────────────────────────────────────

// Exact number of rows displayed per page (페이지당 정확한 행 수)
const ROWS_PER_PAGE = 15;

// ── Types ─────────────────────────────────────────────────────────────────────

// Shape of a menu_items row read from Supabase (Supabase에서 읽은 menu_items 행 형태)
interface MenuItem {
  variant_id:     string;
  name:           string;
  price:          number;
  category:       string | null;
  stock_quantity: number | null;
  promoted_at:    string | null; // Reused as "last synced" timestamp (마지막 동기화 타임스탬프로 재사용)
}

// Columns that support sorting (정렬을 지원하는 열)
type SortField = 'name' | 'price' | 'stock_quantity';
type SortDir   = 'asc'  | 'desc';

// Toast notification payload (토스트 알림 페이로드)
interface Toast {
  type:    'success' | 'error';
  message: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format a price number to USD currency display string.
 * (가격 숫자를 USD 통화 표시 문자열로 변환)
 */
function formatPrice(price: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price);
}

/**
 * Format an ISO timestamp to a human-readable relative time string.
 * Returns '—' when the timestamp is null or invalid.
 * (ISO 타임스탬프를 상대 시간 문자열로 변환. null이거나 유효하지 않으면 '—' 반환)
 */
function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (diffMin < 1)  return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)  return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

// ── SortIcon ──────────────────────────────────────────────────────────────────

/**
 * Inline sort indicator icon shown next to sortable column headers.
 * Renders the neutral double-arrow when the column is not the active sort field,
 * or the appropriate directional arrow when it is.
 * (정렬 가능한 열 헤더 옆에 표시되는 인라인 정렬 표시 아이콘.
 *  활성 정렬 필드가 아니면 중립 양방향 화살표, 활성이면 방향성 화살표 렌더링)
 */
function SortIcon({ field, sortField, sortDir }: {
  field:     SortField;
  sortField: SortField;
  sortDir:   SortDir;
}) {
  if (sortField !== field) {
    // Inactive column — show faint neutral icon (비활성 열 — 흐린 중립 아이콘 표시)
    return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-30" />;
  }
  return sortDir === 'asc'
    ? <ArrowUp   className="ml-1 inline h-3 w-3 text-indigo-400" />
    : <ArrowDown className="ml-1 inline h-3 w-3 text-indigo-400" />;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SyncCenter() {
  // ── StoreID resolution ────────────────────────────────────────────────────
  // StoreContext is the primary source (set synchronously by DashboardShell).
  // Zustand sessionStore is the fallback for pages that don't wrap StoreProvider.
  // (StoreContext가 기본 소스(DashboardShell에 의해 동기적으로 설정).
  //  Zustand sessionStore는 StoreProvider로 감싸지 않은 페이지를 위한 폴백)
  const ctxStore  = useStoreContext();
  const zustandId = useSessionStore((s) => s.selectedStoreId);
  const storeId   = ctxStore.storeId || zustandId || '';

  // ── Data state ────────────────────────────────────────────────────────────
  const [items,    setItems]    = useState<MenuItem[]>([]);       // All menu_items for this store (이 매장의 모든 menu_items)
  const [loading,  setLoading]  = useState(true);                 // Initial table load in progress (초기 테이블 로드 중)
  const [tableErr, setTableErr] = useState<string | null>(null);  // Fetch error (조회 오류)

  // ── Pagination state ──────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1); // 1-indexed page number (1 기반 페이지 번호)

  // ── Sort state ────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<SortField>('name'); // Active sort column (활성 정렬 열)
  const [sortDir,   setSortDir]   = useState<SortDir>('asc');    // Sort direction (정렬 방향)

  // ── Action loading states ─────────────────────────────────────────────────
  const [syncingAll,       setSyncingAll]       = useState(false);
  const [syncingCustomers, setSyncingCustomers] = useState(false);

  // ── Toast state ───────────────────────────────────────────────────────────
  const [toast, setToast] = useState<Toast | null>(null);

  // ── showToast ─────────────────────────────────────────────────────────────
  const showToast = useCallback((type: Toast['type'], message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000); // Auto-dismiss after 4 s (4초 후 자동 해제)
  }, []);

  // ── fetchMenuItems ────────────────────────────────────────────────────────
  // Read all menu_items for this store from Supabase, ordered by category then name.
  // (Supabase에서 이 매장의 모든 menu_items를 카테고리, 이름 순으로 조회)
  const fetchMenuItems = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    setTableErr(null);

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('menu_items')
      .select('variant_id, name, price, category, stock_quantity, promoted_at')
      .eq('store_id', storeId)
      .order('category', { ascending: true, nullsFirst: false })
      .order('name',     { ascending: true });

    if (error) {
      console.error('[SyncCenter] menu_items fetch failed:', error.message); // Log fetch failure (조회 실패 로깅)
      setTableErr(error.message);
    } else {
      setItems(data ?? []);
      setCurrentPage(1); // Always reset to page 1 on fresh fetch (새 조회마다 1페이지로 리셋)
    }
    setLoading(false);
  }, [storeId]);

  // Fetch on mount and whenever storeId changes (마운트 및 storeId 변경 시 조회)
  useEffect(() => { fetchMenuItems(); }, [fetchMenuItems]);

  // ── toggleSort ────────────────────────────────────────────────────────────
  // Clicking the same column toggles direction; clicking a new column resets to asc.
  // Always resets to page 1 so the user sees the top of the sorted result.
  // (같은 열 클릭 시 방향 전환; 새 열 클릭 시 오름차순으로 리셋.
  //  항상 1페이지로 리셋하여 정렬된 결과의 상단 표시)
  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setCurrentPage(1);
  }, [sortField]);

  // ── Sorted + paginated data ───────────────────────────────────────────────
  // Sort is client-side so it applies instantly without a round-trip.
  // Null values always sort last regardless of direction.
  // (클라이언트 측 정렬 — 왕복 없이 즉시 적용.
  //  null 값은 방향에 관계없이 항상 마지막에 정렬)
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (av === null || av === undefined) return 1;  // Nulls last (null은 마지막)
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string') {
        const cmp = av.localeCompare(bv as string);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      return sortDir === 'asc'
        ? (av as number) - (bv as number)
        : (bv as number) - (av as number);
    });
  }, [items, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / ROWS_PER_PAGE));

  const pagedItems = useMemo(() => {
    const start = (currentPage - 1) * ROWS_PER_PAGE;
    return sortedItems.slice(start, start + ROWS_PER_PAGE);
  }, [sortedItems, currentPage]);

  // ── handleSyncAll ─────────────────────────────────────────────────────────
  // Full Direct-to-Live sync: fetches Loyverse catalog and merges into menu_items.
  // (전체 Direct-to-Live 동기화: Loyverse 카탈로그를 menu_items에 병합)
  const handleSyncAll = useCallback(async () => {
    if (!storeId) { showToast('error', 'No store selected'); return; }
    setSyncingAll(true);
    try {
      const res = await syncAll({ storeId });
      if (res.data?.success) {
        showToast('success', `Synced ${res.data.synced ?? 0} item(s) to AI menu`);
        await fetchMenuItems();
      } else {
        showToast('error', res.data?.error ?? 'Sync failed');
      }
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSyncingAll(false);
    }
  }, [storeId, showToast, fetchMenuItems]);

  // ── handleSyncCustomers ───────────────────────────────────────────────────
  const handleSyncCustomers = useCallback(async () => {
    if (!storeId) { showToast('error', 'No store selected'); return; }
    setSyncingCustomers(true);
    try {
      const res = await syncCustomers({ storeId });
      if (res.data?.success) {
        showToast('success', `Synced ${res.data.synced ?? 0} customer(s)`);
      } else {
        showToast('error', res.data?.error ?? 'Customer sync failed');
      }
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSyncingCustomers(false);
    }
  }, [storeId, showToast]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Action bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">

        {/* Sync Now — full Direct-to-Live catalog sync (전체 Direct-to-Live 카탈로그 동기화) */}
        <button
          onClick={handleSyncAll}
          disabled={syncingAll || !storeId}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncingAll
            ? <Spinner size="sm" className="text-white" />
            : <RefreshCw className="h-4 w-4" />}
          {syncingAll ? 'Syncing…' : 'Sync Now'}
        </button>

        {/* Sync Customers (고객 동기화) */}
        <button
          onClick={handleSyncCustomers}
          disabled={syncingCustomers || !storeId}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 shadow-sm ring-1 ring-inset ring-slate-600 transition-colors hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncingCustomers
            ? <Spinner size="sm" className="text-slate-300" />
            : <Users className="h-4 w-4 text-slate-300" />}
          {syncingCustomers ? 'Syncing…' : 'Sync Customers'}
        </button>

        {/* Item count — right-aligned (항목 수 — 오른쪽 정렬) */}
        {!loading && items.length > 0 && (
          <span className="ml-auto text-xs text-slate-400">
            {items.length} item{items.length !== 1 ? 's' : ''} in AI menu
          </span>
        )}
      </div>

      {/* ── Toast notification ─────────────────────────────────────────────── */}
      {toast && (
        <div className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium ${
          toast.type === 'success'
            ? 'bg-emerald-900/50 text-emerald-300 ring-1 ring-emerald-700'
            : 'bg-red-900/50 text-red-300 ring-1 ring-red-700'
        }`}>
          {toast.type === 'success'
            ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            : <AlertCircle  className="h-4 w-4 shrink-0 text-red-400" />}
          <span className="flex-1">{toast.message}</span>
          <button onClick={() => setToast(null)} className="opacity-50 hover:opacity-100 transition-opacity">
            <XCircle className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── AI Menu Items table ─────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl bg-slate-900 ring-1 ring-slate-700">

        {/* Card header (카드 헤더) */}
        <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-white">AI Menu Items</h2>
            <p className="mt-0.5 text-xs text-slate-400">Live catalog synced from Loyverse POS</p>
          </div>
          {!loading && !tableErr && (
            <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-300 ring-1 ring-slate-700">
              {items.length} total
            </span>
          )}
        </div>

        {/* ── Loading state ───────────────────────────────────────────────── */}
        {loading && (
          <div className="flex items-center justify-center gap-3 py-16">
            <Spinner size="md" className="text-indigo-500" />
            <span className="text-sm text-slate-400">Loading items…</span>
          </div>
        )}

        {/* ── Error state ─────────────────────────────────────────────────── */}
        {!loading && tableErr && (
          <div className="flex items-center gap-3 px-6 py-10 text-sm text-red-400">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>Failed to load: {tableErr}</span>
          </div>
        )}

        {/* ── Empty state ─────────────────────────────────────────────────── */}
        {!loading && !tableErr && items.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <RefreshCw className="h-8 w-8 text-slate-600" />
            <p className="text-sm font-medium text-slate-400">No items synced yet</p>
            <p className="text-xs text-slate-500">Click "Sync Now" to pull your Loyverse catalog</p>
          </div>
        )}

        {/* ── Table ───────────────────────────────────────────────────────── */}
        {!loading && !tableErr && items.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">

                {/* Table header — sortable columns highlighted (정렬 가능한 열이 강조된 테이블 헤더) */}
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-800/60">
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Category
                    </th>

                    {/* Name — sortable (이름 — 정렬 가능) */}
                    <th
                      className="cursor-pointer select-none px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-white transition-colors"
                      onClick={() => toggleSort('name')}
                    >
                      Item Name
                      <SortIcon field="name" sortField={sortField} sortDir={sortDir} />
                    </th>

                    {/* Price — sortable (가격 — 정렬 가능) */}
                    <th
                      className="cursor-pointer select-none px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-white transition-colors"
                      onClick={() => toggleSort('price')}
                    >
                      Price
                      <SortIcon field="price" sortField={sortField} sortDir={sortDir} />
                    </th>

                    {/* Stock — sortable (재고 — 정렬 가능) */}
                    <th
                      className="cursor-pointer select-none px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-white transition-colors"
                      onClick={() => toggleSort('stock_quantity')}
                    >
                      Stock
                      <SortIcon field="stock_quantity" sortField={sortField} sortDir={sortDir} />
                    </th>

                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Last Synced
                    </th>
                  </tr>
                </thead>

                {/* Table body (테이블 본문) */}
                <tbody className="divide-y divide-slate-800">
                  {pagedItems.map((item) => (
                    <tr
                      key={item.variant_id}
                      className="group transition-colors hover:bg-slate-800/50"
                    >
                      {/* Category pill (카테고리 필) */}
                      <td className="whitespace-nowrap px-5 py-3.5">
                        {item.category ? (
                          <span className="inline-flex items-center rounded-md bg-indigo-900/60 px-2 py-0.5 text-xs font-medium text-indigo-300 ring-1 ring-inset ring-indigo-800">
                            {item.category}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                      </td>

                      {/* Item name (항목명) */}
                      <td className="px-5 py-3.5 font-medium text-white">
                        {item.name}
                      </td>

                      {/* Price (가격) */}
                      <td className="whitespace-nowrap px-5 py-3.5 text-right font-mono text-slate-200">
                        {formatPrice(item.price)}
                      </td>

                      {/* Stock — red when 0, dash when null (재고 — 0이면 빨간색, null이면 대시) */}
                      <td className="whitespace-nowrap px-5 py-3.5 text-right">
                        {item.stock_quantity !== null ? (
                          <span className={
                            item.stock_quantity === 0
                              ? 'font-semibold text-red-400'
                              : 'text-slate-200'
                          }>
                            {item.stock_quantity}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      {/* Last synced — relative time from promoted_at (마지막 동기화 — promoted_at 기준 상대 시간) */}
                      <td className="whitespace-nowrap px-5 py-3.5 text-right text-xs text-slate-500">
                        {formatRelativeTime(item.promoted_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Pagination controls ─────────────────────────────────────── */}
            <div className="flex items-center justify-between border-t border-slate-700 px-5 py-3">

              {/* Page summary (페이지 요약) */}
              <p className="text-xs text-slate-500">
                Page {currentPage} of {totalPages} — {sortedItems.length} total
              </p>

              {/* Previous / Next (이전 / 다음) */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-inset ring-slate-700 transition-colors hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Previous
                </button>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-inset ring-slate-700 transition-colors hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
