// Store Security — POS Overlay page.
// Renders the AI-powered internal fraud detection simulation for store-role users.
// (스토어 보안 — POS 오버레이 페이지.
//  스토어 역할 사용자를 위한 AI 기반 내부 사기 탐지 시뮬레이션 렌더링)

'use client';

import { ShieldAlert }   from 'lucide-react';
import { PosOverlaySim } from '@/modules/security';

export default function StorePosOverlayPage() {
  return (
    <div className="space-y-6">

      {/* Page heading (페이지 제목) */}
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-6 w-6 text-red-500" />
        <div>
          <h2 className="text-2xl font-bold tracking-tight">POS Overlay</h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            AI-powered internal fraud detection — real-time POS transaction monitoring.
          </p>
        </div>
      </div>

      {/* POS overlay simulation panel (POS 오버레이 시뮬레이션 패널) */}
      <PosOverlaySim />
    </div>
  );
}
