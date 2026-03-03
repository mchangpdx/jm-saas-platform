// Store Reservations page — async Server Component.
// Authenticates the user server-side and fetches the linked store directly from Supabase.
// This pattern mirrors store/page.tsx (Overview) and is the correct Next.js App Router
// approach: each page owns its own data fetch so no client-side state is needed.
// (스토어 예약 페이지 — 비동기 서버 컴포넌트.
//  서버 사이드에서 사용자를 인증하고 Supabase에서 연결된 매장을 직접 조회.
//  이 패턴은 store/page.tsx(개요)와 동일하며 올바른 Next.js App Router 방식:
//  각 페이지가 자체 데이터 조회를 수행하므로 클라이언트 상태가 불필요)

import { Building2 }                  from 'lucide-react';
import { createServerSupabaseClient } from '@/shared/api/supabaseServer';
import { ReservationList }            from '@/modules/reservations/components/ReservationList';

// Minimal store shape — only id and name are needed for this page.
// (이 페이지에 필요한 최소 매장 형태 — id와 name만 필요)
interface StoreRow {
  id:   string;
  name: string;
  [key: string]: unknown; // allow select('*') extra columns (select('*') 추가 열 허용)
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function StoreReservationsPage() {
  const supabase = await createServerSupabaseClient();

  // Verify session via server-side JWT — more secure than getSession().
  // (서버 사이드 JWT로 세션 확인 — getSession()보다 안전)
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // Layout auth guard should already redirect — handle defensively here.
    // (레이아웃 인증 가드가 이미 리다이렉트해야 하지만 방어적으로 처리)
    return <EmptyState message="You must be logged in to view this page." />;
  }

  // Fetch the store linked to this user via owner_id — the same query the Overview uses.
  // single() is used here; if no store is found it returns an error (not null), which
  // we treat as "no store linked" and show the empty state.
  // (owner_id로 이 사용자에 연결된 매장 조회 — 개요 페이지와 동일한 쿼리.
  //  single() 사용; 매장이 없으면 오류를 반환(null 아님), 이를 "연결 매장 없음"으로 처리)
  const { data: store, error: storeError } = await supabase
    .from('stores')
    .select('*')
    .eq('owner_id', user.id)
    .single<StoreRow>();

  if (storeError || !store) {
    // Log server-side warning to aid debugging when owner_id has no linked store.
    // (owner_id에 연결된 매장이 없을 때 디버깅을 돕기 위한 서버 사이드 경고 기록)
    console.warn(`[reservations] No store found for owner_id: ${user.id}`);
    return <EmptyState message="No store linked to this account." />;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Page heading (페이지 제목) */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Reservations</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          View and manage upcoming guest reservations for{' '}
          <span className="font-semibold text-gray-700 dark:text-gray-200">{store.name}</span>.
        </p>
      </div>

      {/* ReservationList — client component that fetches and displays reservations.
          Receives store.id from the server-resolved store row.
          (ReservationList — 예약을 조회하고 표시하는 클라이언트 컴포넌트.
           서버에서 확인된 매장 행의 store.id를 받음) */}
      <ReservationList storeId={store.id} />
    </div>
  );
}

// ── Empty state helper ────────────────────────────────────────────────────────

// Renders a centred message when auth fails or no store is linked to the user.
// No redirect — prevents infinite loop with the layout auth guard.
// (인증 실패 또는 사용자에게 연결된 매장이 없을 때 가운데 정렬 메시지 렌더링.
//  리다이렉트 없음 — 레이아웃 인증 가드와의 무한 루프 방지)
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-28 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
        <Building2 className="h-8 w-8 text-gray-400 dark:text-gray-500" />
      </div>
      <p className="text-base font-semibold text-gray-700 dark:text-gray-300">{message}</p>
      <p className="mt-2 max-w-xs text-sm text-gray-400 dark:text-gray-500">
        Contact your administrator to link a store to your account.
      </p>
    </div>
  );
}
