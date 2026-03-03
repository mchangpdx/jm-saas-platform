// ReservationList — client component that fetches reservations for a given store
// from Supabase and displays them in a sortable, paginated table with color-coded status badges.
// Features: client-side column sorting (Date, Time, Customer) and 15-row pagination.
// Uses the correct DB column names: reservation_date (DATE) and reservation_time (TIME).
// (ReservationList — Supabase에서 주어진 매장의 예약을 조회하고
//  정렬 가능한 페이지네이션 테이블과 색상 코딩 상태 배지로 표시하는 클라이언트 컴포넌트.
//  기능: 클라이언트 측 열 정렬(날짜, 시간, 고객)과 15행 페이지네이션.
//  올바른 DB 열 이름 사용: reservation_date (DATE), reservation_time (TIME))

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CalendarCheck,
  RefreshCw,
  Users,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from 'lucide-react';
import { getSupabaseClient } from '@/shared/api/supabaseClient';
import { Spinner }           from '@/shared/components/Spinner';
import { ErrorAlert }        from '@/shared/components/ErrorAlert';

// DB row shape aligned with the actual Supabase schema (실제 Supabase 스키마에 맞는 DB 행 형태)
interface ReservationRow {
  id:               string | number;
  reservation_date: string;        // date string — YYYY-MM-DD (날짜 문자열 — YYYY-MM-DD)
  reservation_time: string | null; // time string — HH:MM or HH:MM:SS, null when not set (시간 문자열, 미설정 시 null)
  party_size:       number;
  customer_name:    string;
  customer_phone:   string | null; // DB column is customer_phone, not phone (DB 열명: customer_phone)
  status:           string;        // e.g. 'confirmed', 'pending', 'cancelled' (확인됨, 대기 중, 취소됨)
}

interface ReservationListProps {
  storeId: string;
}

// Columns that support client-side sorting (클라이언트 측 정렬을 지원하는 열)
type SortColumn    = 'reservation_date' | 'reservation_time' | 'customer_name';
type SortDirection = 'asc' | 'desc';

// Number of rows displayed per page — matches the product requirement exactly.
// (페이지당 표시 행 수 — 제품 요구사항과 정확히 일치)
const ROWS_PER_PAGE = 15;

// Format a YYYY-MM-DD date string as MM/DD/YYYY (US standard date format).
// (YYYY-MM-DD 날짜 문자열을 미국 표준 날짜 형식 MM/DD/YYYY로 변환)
function formatDate(date: string): string {
  const [yyyy, mm, dd] = date.split('-');
  return `${mm}/${dd}/${yyyy}`;
}

// Format a HH:MM or HH:MM:SS time string to 12-hour AM/PM format.
// Returns '—' when time is null or empty.
// (HH:MM 또는 HH:MM:SS 시간 문자열을 12시간 AM/PM 형식으로 변환.
//  시간이 null이거나 비어 있으면 '—' 반환)
function formatTime(time: string | null): string {
  if (!time) return '—';
  const parts   = time.split(':');
  const hours24 = parseInt(parts[0], 10);
  const minutes = parts[1] ?? '00';
  const period  = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12; // Convert 0 → 12 for midnight (자정 0시 → 12시 변환)
  return `${String(hours12).padStart(2, '0')}:${minutes} ${period}`;
}

// Format a raw phone string to the XXX-XXX-XXXX display format.
// Strips all non-digit characters, takes the last 10 (removes country code),
// then inserts NANP dashes. Falls back to the raw value if fewer than 10 digits remain.
// (원시 전화번호를 XXX-XXX-XXXX 표시 형식으로 변환.
//  비숫자 문자 제거, 마지막 10자리 추출 후 NANP 대시 삽입.
//  10자리 미만이면 원시 값 그대로 반환)
function formatPhone(raw: string | null): string {
  if (!raw) return '—';
  const digits = raw.replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return raw;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// Map reservation status strings to Tailwind badge classes.
// (예약 상태 문자열을 Tailwind 배지 클래스로 매핑)
function statusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'confirmed':
      return 'bg-green-50 text-green-700 ring-green-200 dark:bg-green-900/20 dark:text-green-400 dark:ring-green-800';
    case 'pending':
      return 'bg-yellow-50 text-yellow-700 ring-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:ring-yellow-800';
    case 'cancelled':
      return 'bg-red-50 text-red-600 ring-red-200 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-800';
    default:
      return 'bg-gray-100 text-gray-600 ring-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700';
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export function ReservationList({ storeId }: ReservationListProps) {
  const [rows,    setRows   ] = useState<ReservationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError  ] = useState<string | null>(null);

  // Sorting state — default newest date first (정렬 상태 — 기본값: 최신 날짜순)
  const [sortColumn,    setSortColumn   ] = useState<SortColumn>('reservation_date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Pagination state — 1-indexed current page (페이지네이션 상태 — 1부터 시작하는 현재 페이지)
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch the most recent 150 reservations for this store, newest date first from DB.
  // 150 rows supports meaningful multi-page display at 15 rows per page (up to 10 pages).
  // Resets to page 1 on every reload so stale page numbers never reference missing rows.
  // (DB에서 이 매장의 최근 150건 예약을 최신 날짜순으로 조회.
  //  150행은 페이지당 15행으로 최대 10페이지 표시 가능.
  //  모든 새로고침 시 1페이지로 초기화 — 오래된 페이지 번호가 없는 행을 참조하지 않도록 보장)
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCurrentPage(1); // Reset pagination on reload (새로고침 시 페이지네이션 초기화)

    const { data, error: dbError } = await getSupabaseClient()
      .from('reservations')
      .select('id, reservation_date, reservation_time, party_size, customer_name, customer_phone, status')
      .eq('store_id', storeId)
      .order('reservation_date', { ascending: false })
      .limit(150);

    if (dbError) {
      setError(dbError.message);
    } else {
      setRows(data ?? []);
    }

    setLoading(false);
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  // ── Sorting logic ──────────────────────────────────────────────────────────
  // Clicking the same column toggles direction; clicking a new column resets to
  // the most natural default (desc for date, asc for text fields).
  // Page is reset to 1 on every sort change so the user always sees the first results.
  // (같은 열 클릭 시 방향 전환; 새 열 클릭 시 가장 자연스러운 기본값으로 재설정
  //  (날짜는 내림차순, 텍스트 필드는 오름차순).
  //  정렬 변경마다 1페이지로 초기화 — 항상 첫 결과 표시)
  function handleSort(column: SortColumn) {
    if (column === sortColumn) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection(column === 'customer_name' ? 'asc' : 'desc');
    }
    setCurrentPage(1);
  }

  // Derive sorted rows via useMemo so the sort only re-runs when rows or sort state changes.
  // Null times sort last regardless of direction — a missing time is never promoted.
  // (행 또는 정렬 상태 변경 시에만 재실행되도록 useMemo로 정렬된 행 파생.
  //  null 시간은 방향에 관계없이 항상 마지막으로 정렬 — 누락된 시간이 앞으로 오지 않도록)
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      // Null-time guard: always send null times to the bottom (null 시간 가드: 항상 하단으로)
      if (sortColumn === 'reservation_time') {
        if (!a.reservation_time && !b.reservation_time) return 0;
        if (!a.reservation_time) return 1;
        if (!b.reservation_time) return -1;
      }

      let cmp = 0;
      switch (sortColumn) {
        case 'reservation_date':
          cmp = (a.reservation_date ?? '').localeCompare(b.reservation_date ?? '');
          break;
        case 'reservation_time':
          cmp = (a.reservation_time ?? '').localeCompare(b.reservation_time ?? '');
          break;
        case 'customer_name':
          cmp = (a.customer_name ?? '').localeCompare(b.customer_name ?? '');
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortColumn, sortDirection]);

  // ── Pagination derived values ──────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / ROWS_PER_PAGE));
  const safePage   = Math.min(currentPage, totalPages); // Clamp in case total drops (총 페이지 감소 시 클램프)
  const pagedRows  = sortedRows.slice((safePage - 1) * ROWS_PER_PAGE, safePage * ROWS_PER_PAGE);

  // Start and end item indices for the "Showing X–Y of N" range indicator.
  // startItem is 1-indexed; endItem is clamped to the actual row count.
  // (1부터 시작하는 startItem과 실제 행 수로 클램프된 endItem — "Showing X–Y of N" 표시용)
  const startItem = sortedRows.length === 0 ? 0 : (safePage - 1) * ROWS_PER_PAGE + 1;
  const endItem   = Math.min(safePage * ROWS_PER_PAGE, sortedRows.length);

  // ── Sort icon helper — inline component for column header indicators ───────
  // Renders a neutral double-chevron for unsorted columns, and a directional
  // chevron in indigo for the active sort column.
  // (정렬되지 않은 열에는 중립 이중 화살표, 활성 정렬 열에는 인디고 방향 화살표 표시)
  function SortIcon({ column }: { column: SortColumn }) {
    if (sortColumn !== column) {
      return <ChevronsUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
    }
    return sortDirection === 'asc'
      ? <ChevronUp   className="ml-1 inline h-3 w-3 text-indigo-600 dark:text-indigo-400" />
      : <ChevronDown className="ml-1 inline h-3 w-3 text-indigo-600 dark:text-indigo-400" />;
  }

  // Shared styles for all <th> cells — flex is intentionally absent here so that the
  // browser's display:table-cell layout model is preserved. Applying flex directly on a
  // <th> overrides table-cell and causes headers to stack vertically inside a single column.
  // (모든 <th> 셀 공유 스타일 — flex 의도적 제외: <th>에 flex 직접 적용 시
  //  display:table-cell 재정의로 헤더가 단일 열 안에 수직 스택되는 버그 방지)
  const thClass =
    'pb-3 pr-6 text-left text-xs font-semibold uppercase tracking-wide ' +
    'text-gray-400 dark:text-gray-500';

  // Shared styles for the inner <button> inside sortable <th> cells.
  // flex lives here — never on the <th> itself — to keep the table layout intact.
  // (정렬 가능한 <th> 셀 내부 <button> 공유 스타일.
  //  테이블 레이아웃 유지를 위해 flex를 <th>가 아닌 여기에만 적용)
  const sortBtnClass =
    'flex w-full cursor-pointer select-none items-center gap-0.5 transition-colors ' +
    'hover:text-gray-600 dark:hover:text-gray-300';

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">

      {/* Card header (카드 헤더) */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <CalendarCheck className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          <div>
            <h3 className="text-base font-semibold">Reservations</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Up to 150 reservations from the AI voice assistant — click column headers to sort.
            </p>
          </div>
        </div>

        {/* Refresh button (새로고침 버튼) */}
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          {loading
            ? <Spinner className="h-3.5 w-3.5 text-indigo-500" />
            : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
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

        {/* Empty state — no reservations yet (예약 없음 — 빈 상태) */}
        {!loading && !error && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CalendarCheck className="mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" />
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
              No reservations found for this store.
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Reservations made via the AI voice assistant will appear here.
            </p>
          </div>
        )}

        {/* Reservations table with sortable headers (정렬 가능한 헤더가 있는 예약 테이블) */}
        {!loading && !error && rows.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                {/*
                  * THEAD: exactly ONE <tr> with SIX <th> elements in horizontal order:
                  *   DATE | TIME | CUSTOMER | PARTY | PHONE | STATUS
                  *
                  * Each <th> uses thClass (no flex) to preserve display:table-cell.
                  * Sortable columns wrap their label + icon in an inner <button> that
                  * carries the flex layout — this is the correct pattern.
                  *
                  * (정확히 하나의 <tr>과 6개의 <th> 수평 순서:
                  *  날짜 | 시간 | 고객 | 인원 | 전화번호 | 상태
                  *  각 <th>는 display:table-cell 유지를 위해 thClass 사용.
                  *  정렬 가능한 열은 flex 레이아웃을 가진 내부 <button>으로 래핑)
                  */}
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800">

                    {/* DATE — sortable, defaults descending (날짜 — 정렬 가능, 기본값 내림차순) */}
                    <th className={thClass}>
                      <button className={sortBtnClass} onClick={() => handleSort('reservation_date')}>
                        Date <SortIcon column="reservation_date" />
                      </button>
                    </th>

                    {/* TIME — sortable, null times always sort last (시간 — 정렬 가능, null은 항상 마지막) */}
                    <th className={thClass}>
                      <button className={sortBtnClass} onClick={() => handleSort('reservation_time')}>
                        Time <SortIcon column="reservation_time" />
                      </button>
                    </th>

                    {/* CUSTOMER — sortable, defaults ascending (고객 — 정렬 가능, 기본값 오름차순) */}
                    <th className={thClass}>
                      <button className={sortBtnClass} onClick={() => handleSort('customer_name')}>
                        Customer <SortIcon column="customer_name" />
                      </button>
                    </th>

                    {/* PARTY — not sortable (인원 — 정렬 불가) */}
                    <th className={thClass}>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" /> Party
                      </span>
                    </th>

                    {/* PHONE — not sortable (전화번호 — 정렬 불가) */}
                    <th className={thClass}>Phone</th>

                    {/* STATUS — not sortable, no right padding (the badge fills naturally)
                        (상태 — 정렬 불가, 우측 여백 없음 — 배지가 자연스럽게 채움) */}
                    <th className="pb-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      Status
                    </th>

                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {pagedRows.map((r) => (
                    <tr key={String(r.id)} className="group hover:bg-gray-50 dark:hover:bg-gray-800/40">

                      {/* Reservation date formatted MM/DD/YYYY (MM/DD/YYYY 형식의 예약 날짜) */}
                      <td className="py-3 pr-4 font-mono text-xs text-gray-700 dark:text-gray-300">
                        {formatDate(r.reservation_date)}
                      </td>

                      {/* Reservation time in 12-hour AM/PM format (12시간 AM/PM 형식의 예약 시간) */}
                      <td className="py-3 pr-4 font-mono text-xs text-gray-700 dark:text-gray-300">
                        {formatTime(r.reservation_time)}
                      </td>

                      {/* Customer name (고객명) */}
                      <td className="py-3 pr-4 font-medium text-gray-900 dark:text-gray-100">
                        {r.customer_name || '—'}
                      </td>

                      {/* Party size (인원 수) */}
                      <td className="py-3 pr-4 text-gray-700 dark:text-gray-300">
                        {r.party_size}
                      </td>

                      {/* Phone number — formatted XXX-XXX-XXXX via formatPhone (XXX-XXX-XXXX 형식의 전화번호) */}
                      <td className="py-3 pr-4 font-mono text-xs text-gray-600 dark:text-gray-400">
                        {formatPhone(r.customer_phone)}
                      </td>

                      {/* Status badge with color coding (색상 코딩된 상태 배지) */}
                      <td className="py-3">
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 capitalize ${statusBadgeClass(r.status)}`}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Pagination footer — shown whenever total rows exceed one page ──── */}
            {/* Previous / Next arrows with "Showing X–Y of N" range indicator.
                Buttons are disabled at boundary pages so no invalid state is reachable.
                (이전/다음 화살표와 "Showing X–Y of N" 범위 표시기.
                 경계 페이지에서 버튼 비활성화 — 유효하지 않은 상태 진입 불가) */}
            <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4 dark:border-gray-800">

              {/* "Showing X–Y of N" range indicator (범위 표시기) */}
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Showing{' '}
                <span className="font-semibold text-gray-700 dark:text-gray-300">{startItem}–{endItem}</span>
                {' '}of{' '}
                <span className="font-semibold text-gray-700 dark:text-gray-300">{sortedRows.length}</span>
              </p>

              {/* Previous / Next navigation buttons (이전/다음 내비게이션 버튼) */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  <ChevronUp className="h-3 w-3 -rotate-90" />
                  Previous
                </button>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  Next
                  <ChevronDown className="h-3 w-3 -rotate-90" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
