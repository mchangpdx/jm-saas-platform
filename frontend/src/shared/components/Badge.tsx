// Badge — coloured pill used for status labels (pending, paid, confirmed, etc.).
// Variant maps directly to a Tailwind color scheme.
// (배지 — 상태 레이블(pending, paid, confirmed 등)에 사용되는 색상 pill.
//  Variant는 Tailwind 색상 스키마에 직접 매핑)

type BadgeVariant = 'green' | 'yellow' | 'red' | 'gray' | 'blue' | 'indigo';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  green:  'bg-green-100  text-green-800  dark:bg-green-900/30  dark:text-green-400',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  red:    'bg-red-100    text-red-800    dark:bg-red-900/30    dark:text-red-400',
  gray:   'bg-gray-100   text-gray-700   dark:bg-gray-700      dark:text-gray-300',
  blue:   'bg-blue-100   text-blue-800   dark:bg-blue-900/30   dark:text-blue-400',
  indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
};

interface BadgeProps {
  label:   string;
  variant: BadgeVariant;
}

export function Badge({ label, variant }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${VARIANT_CLASSES[variant]}`}>
      {label}
    </span>
  );
}

// Map order/reservation status strings to badge variants
// (주문/예약 상태 문자열을 배지 variant에 매핑)
export function statusVariant(status: string): BadgeVariant {
  const map: Record<string, BadgeVariant> = {
    paid:       'green',
    confirmed:  'green',
    pending:    'yellow',
    failed:     'red',
    cancelled:  'red',
  };
  return map[status] ?? 'gray';
}
