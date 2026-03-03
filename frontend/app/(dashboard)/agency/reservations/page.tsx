// Agency Reservations page — reads the globally selected store from the Zustand session
// store (set by the sidebar dropdown in DashboardShell) and renders ReservationList.
// (에이전시 예약 페이지 — Zustand 세션 스토어에서 전역 선택 매장을 읽어
//  (DashboardShell의 사이드바 드롭다운으로 설정) ReservationList를 렌더링)

'use client';

import { CalendarCheck }   from 'lucide-react';
import { useSessionStore } from '@/shared/stores/sessionStore';
import { ReservationList } from '@/modules/reservations';

export default function AgencyReservationsPage() {
  // Read the globally selected store — set by the agency sidebar dropdown.
  // (에이전시 사이드바 드롭다운에 의해 설정된 전역 선택 매장 읽기)
  const selectedStoreId = useSessionStore((s) => s.selectedStoreId);

  return (
    <div className="space-y-6">

      {/* Page heading (페이지 제목) */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Reservations</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          View and manage upcoming guest reservations for the selected store.
        </p>
      </div>

      {/* No store selected — prompt the user to use the sidebar selector
          (선택된 매장 없음 — 사이드바 선택기 사용을 안내) */}
      {!selectedStoreId && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 py-20 text-center dark:border-gray-700">
          <CalendarCheck className="mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Select a store from the sidebar to view reservations.
          </p>
        </div>
      )}

      {/* Reservation list — rendered once a store is selected (매장 선택 후 예약 목록 렌더링) */}
      {/* key forces a clean remount when selectedStoreId changes, resetting data state.
          (selectedStoreId 변경 시 key로 강제 리마운트하여 데이터 상태 초기화) */}
      {selectedStoreId && (
        <ReservationList key={selectedStoreId} storeId={selectedStoreId} />
      )}
    </div>
  );
}
