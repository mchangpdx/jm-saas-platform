// Agency overview page — landing page after login for agency-role users.
// Uses useStoreContext() (NOT useSessionStore) to read agentId synchronously on first render.
// Zustand's persisted store hydrates asynchronously from sessionStorage, causing an infinite
// loading state when agentId is read from it on mount. StoreContext is populated synchronously
// by DashboardShell from server-resolved props, guaranteeing agentId is available immediately.
// (에이전시 개요 페이지 — useStoreContext()로 agentId를 첫 렌더에서 동기적으로 읽음.
//  Zustand는 sessionStorage에서 비동기 수화되어 무한 로딩 상태를 유발하므로 사용 금지.
//  StoreContext는 DashboardShell이 서버 props에서 동기적으로 채워 즉시 사용 가능)

'use client';

import Link                        from 'next/link';
import { Mic, CalendarCheck }      from 'lucide-react';
import { useStoreContext }         from '@/shared/contexts/StoreContext';
import { AnalyticsDashboard }      from '@/shared/components/AnalyticsDashboard';

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AgencyOverviewPage() {
  // Read agentId from StoreContext — synchronous, no hydration delay, no loading state needed.
  // agentId is the agency's identifier used by AnalyticsDashboard to query stores WHERE agency_id = agentId.
  // (StoreContext에서 agentId 읽기 — 동기적, 수화 지연 없음, 로딩 상태 불필요.
  //  agentId는 AnalyticsDashboard가 agency_id = agentId인 매장을 조회하는 데 사용하는 에이전시 식별자)
  const { agentId } = useStoreContext();

  return (
    <div className="space-y-8">

      {/* Page heading (페이지 제목) */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">
          Agency Overall Performance
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Aggregated across all stores. Select a specific store in the sidebar to filter.
        </p>
      </div>

      {/* Full analytics dashboard in agency mode — aggregates all stores when no store is selected,
          or scopes to the selected store when the sidebar dropdown is active.
          agentId is always a non-empty string here because StoreContext is synchronously provided.
          (에이전시 모드 전체 분석 대시보드 — 매장 미선택 시 전체 집계,
           사이드바 드롭다운 활성 시 선택 매장만 표시. StoreContext 동기 제공으로 agentId는 항상 비어있지 않음) */}
      {agentId ? (
        <AnalyticsDashboard mode="agency" id={agentId} />
      ) : (
        // Fallback for the rare case where agentId is an empty string (agency account not fully configured).
        // This is a configuration error, not a loading state — AnalyticsDashboard would query nothing useful.
        // (agentId가 빈 문자열인 드문 경우의 폴백 — 에이전시 계정 미설정 오류, 로딩 상태 아님)
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-gray-500">
            No agency account linked. Please contact support to configure your agency profile.
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
