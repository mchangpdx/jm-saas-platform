// ErrorAlert — dismissible inline error banner used when API calls fail.
// (ErrorAlert — API 호출 실패 시 사용되는 해제 가능한 인라인 오류 배너)

'use client';

import { useState }      from 'react';
import { AlertCircle, X } from 'lucide-react';

interface ErrorAlertProps {
  message: string;
}

export function ErrorAlert({ message }: ErrorAlertProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
      {/* Error icon (오류 아이콘) */}
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />

      {/* Error message (오류 메시지) */}
      <span className="flex-1">{message}</span>

      {/* Dismiss button (해제 버튼) */}
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/40"
        aria-label="Dismiss error"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
