// Store Security — Prevent Theft page.
// Renders the AI Vision theft prevention simulation for store-role users.
// (스토어 보안 — 절도 방지 페이지.
//  스토어 역할 사용자를 위한 AI 비전 절도 방지 시뮬레이션 렌더링)

'use client';

import { Eye }              from 'lucide-react';
import { PreventTheftSim }  from '@/modules/security';

export default function StorePreventTheftPage() {
  return (
    <div className="space-y-6">

      {/* Page heading (페이지 제목) */}
      <div className="flex items-center gap-3">
        <Eye className="h-6 w-6 text-orange-500" />
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Prevent Theft</h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            AI Vision external theft detection — real-time suspect tracking and alerting.
          </p>
        </div>
      </div>

      {/* Theft prevention simulation panel (절도 방지 시뮬레이션 패널) */}
      <PreventTheftSim />
    </div>
  );
}
