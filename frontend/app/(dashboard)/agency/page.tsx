// Agency overview page — fetches the real Supabase auth user UUID from the browser session.
// The auth user UUID is what stores.agency_id maps to, so it is the correct id to pass
// to AnalyticsDashboard in agency mode. StoreContext.agentId and Zustand's agentId both
// carry the Retell/voice agent identifier, NOT the agency UUID — they must not be used here.
// (에이전시 개요 페이지 — 브라우저 세션에서 실제 Supabase auth 사용자 UUID 조회.
//  auth 사용자 UUID가 stores.agency_id에 매핑되므로 agency 모드 AnalyticsDashboard에 올바른 id.
//  StoreContext.agentId와 Zustand agentId는 Retell/음성 에이전트 식별자 — 여기서 사용 금지)

'use client';

import { useState, useEffect }     from 'react';
import Link                        from 'next/link';
import { Mic, CalendarCheck }      from 'lucide-react';
import { getSupabaseClient }       from '@/shared/api/supabaseClient';
import { AnalyticsDashboard }      from '@/shared/components/AnalyticsDashboard';

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AgencyOverviewPage() {
  // agencyId is the Supabase auth user UUID — the single source of truth for agency identity.
  // Initialised as '' so the guard clause in AnalyticsDashboard blocks any premature Supabase calls.
  // (agencyId는 Supabase auth 사용자 UUID — 에이전시 ID의 단일 진실 소스.
  //  ''로 초기화하여 AnalyticsDashboard 가드 절이 조기 Supabase 호출을 차단)
  const [agencyId,  setAgencyId ] = useState<string>('');
  const [idLoading, setIdLoading] = useState<boolean>(true);

  useEffect(() => {
    // Fetch the authenticated user from the browser Supabase session on mount.
    // getUser() validates the JWT locally — no network round-trip required.
    // (마운트 시 브라우저 Supabase 세션에서 인증된 사용자 조회.
    //  getUser()는 JWT를 로컬에서 검증 — 네트워크 왕복 불필요)
    getSupabaseClient()
      .auth.getUser()
      .then(({ data }) => {
        // Set agencyId only when a valid UUID is returned — prevents '' from reaching Supabase queries (유효한 UUID가 반환될 때만 agencyId 설정 — ''가 Supabase 쿼리에 도달하는 것을 방지)
        if (data.user?.id) {
          setAgencyId(data.user.id);
        }
      })
      .finally(() => {
        // Always stop loading in finally — guarantees the UI unblocks even if getUser() rejects (항상 finally에서 로딩 중지 — getUser()가 거부되더라도 UI가 차단 해제됨을 보장)
        setIdLoading(false);
      });
  }, []);

  return (
    <div className="space-y-8">

      {/* Page heading (페이지 제목) */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">
          Agency Overall Performance
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Aggregated across all stores.
        </p>
      </div>

      {/* Render the dashboard only once the agency UUID is confirmed — prevents the '' UUID error.
          forceAggregation={true} ignores the sidebar dropdown entirely on this page.
          (에이전시 UUID 확인 후에만 대시보드 렌더링 — '' UUID 오류 방지.
           forceAggregation={true}으로 이 페이지에서 사이드바 드롭다운을 완전히 무시) */}
      {idLoading ? (
        // Show a minimal placeholder while auth resolves — avoids layout shift (인증 확인 중 최소 플레이스홀더 표시 — 레이아웃 이동 방지)
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
        </div>
      ) : agencyId ? (
        <AnalyticsDashboard mode="agency" id={agencyId} forceAggregation={true} />
      ) : (
        // agencyId is empty after auth resolved — session is invalid or user is not logged in (인증 확인 후 agencyId가 비어있음 — 세션이 유효하지 않거나 사용자가 로그인하지 않음)
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-600">
            Unable to load agency account. Please refresh the page or log in again.
          </p>
        </div>
      )}

      {/* Module shortcuts — quick navigation to key agency modules (주요 에이전시 모듈로의 빠른 내비게이션) */}
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
