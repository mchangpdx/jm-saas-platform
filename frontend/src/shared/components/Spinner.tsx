// Spinner — animated loading indicator used across all async states.
// Size and color are configurable via Tailwind class props.
// (스피너 — 모든 비동기 상태에서 사용되는 애니메이션 로딩 표시기.
//  크기와 색상은 Tailwind 클래스 props로 설정 가능)

interface SpinnerProps {
  className?: string;
}

export function Spinner({ className = 'h-6 w-6 text-indigo-500' }: SpinnerProps) {
  return (
    <svg
      className={`animate-spin ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-label="Loading"
    >
      <circle
        className="opacity-25"
        cx="12" cy="12" r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
