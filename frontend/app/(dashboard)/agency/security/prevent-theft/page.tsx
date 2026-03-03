// Agency Security — Prevent Theft page.
// Renders the AI Vision theft prevention simulation for agency-role users.
// Reads the globally selected store from Zustand for context display.
// (에이전시 보안 — 절도 방지 페이지.
//  에이전시 역할 사용자를 위한 AI 비전 절도 방지 시뮬레이션 렌더링.
//  Zustand에서 전역 선택 매장을 읽어 컨텍스트 표시)

'use client';

import { Eye }             from 'lucide-react';
import { useSessionStore } from '@/shared/stores/sessionStore';
import { PreventTheftSim } from '@/modules/security';

export default function AgencyPreventTheftPage() {
  // Read the globally selected store name for the page subtitle.
  // (페이지 부제목용 전역 선택 매장명 읽기)
  const storeName = useSessionStore((s) => s.storeName);

  return (
    <div className="space-y-6">

      {/* Page heading (페이지 제목) */}
      <div className="flex items-center gap-3">
        <Eye className="h-6 w-6 text-orange-500" />
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Prevent Theft</h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            AI Vision external theft detection — real-time suspect tracking and alerting
            {storeName ? ` for ${storeName}` : ''}.
          </p>
        </div>
      </div>

      {/* Theft prevention simulation panel (절도 방지 시뮬레이션 패널) */}
      <PreventTheftSim />
    </div>
  );
}
