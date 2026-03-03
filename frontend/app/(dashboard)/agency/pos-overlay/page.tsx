// POS Overlay page placeholder — module coming soon.
// (POS 오버레이 페이지 플레이스홀더 — 모듈 준비 중)

import { ShoppingCart } from 'lucide-react';

export default function PosOverlayPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">POS Overlay</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Real-time POS integration and order injection monitor.
        </p>
      </div>
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-white py-24 text-center dark:border-gray-800 dark:bg-gray-900">
        <ShoppingCart className="mb-4 h-10 w-10 text-gray-300 dark:text-gray-600" />
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">POS Overlay module — coming soon</p>
      </div>
    </div>
  );
}
