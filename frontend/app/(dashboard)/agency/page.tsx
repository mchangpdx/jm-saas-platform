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

      {/* Full analytics dashboard in agency mode — always rendered, no conditional gate.
          AnalyticsDashboard handles its own empty/error states internally so there is no need
          to guard on agentId here. A gate on agentId caused the error block to show because
          StoreContext defaults agentId to '' (empty string, falsy) before the provider mounts.
          (에이전시 모드 전체 분석 대시보드 — 항상 렌더링, 조건부 게이트 없음.
           AnalyticsDashboard가 내부적으로 빈/오류 상태를 처리하므로 여기서 agentId 게이트 불필요.
           agentId 게이트가 오류 블록을 표시한 원인: StoreContext 기본값 agentId='' 이 falsy이기 때문) */}
      <AnalyticsDashboard mode="agency" id={agentId} />

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
