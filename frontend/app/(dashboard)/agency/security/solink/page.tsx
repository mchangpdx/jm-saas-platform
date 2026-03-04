'use client';

import { useState, useMemo } from 'react';
import {
  ShoppingCart,
  AlertTriangle,
  RotateCcw,
  ChevronDown,
  Camera,
  Clock,
  Monitor,
  Filter,
  Calendar,
} from 'lucide-react';

// ── Type Definitions ──────────────────────────────────────────────────────────

// Individual line item on a receipt (영수증 개별 품목)
interface ReceiptItem {
  name:  string;
  qty:   number;
  price: number;
}

// A single Solink POS transaction event (단일 Solink POS 거래 이벤트)
interface SolinkEvent {
  eventId:   string;
  startTime: string;                    // ISO 8601 timestamp (ISO 8601 타임스탬프)
  type:      'Sale' | 'Void' | 'Refund';
  amount:    number;
  register:  string;                    // POS terminal identifier (POS 단말기 식별자)
  cashier:   string;
  items:     ReceiptItem[];
}

// Top filter bar state (상단 필터 바 상태)
interface FilterState {
  eventType: 'All' | 'Sale' | 'Void' | 'Refund';
  dateRange: 'Today' | 'Yesterday' | 'Last 7 Days';
  timeOfDay: 'All Day' | 'Morning' | 'Afternoon' | 'Evening';
}

// ── Mock Data ─────────────────────────────────────────────────────────────────

// Ten representative POS events — replace with live Solink API data in production
// (10개의 대표 POS 이벤트 — 프로덕션에서는 실제 Solink API 데이터로 교체)
const MOCK_EVENTS: SolinkEvent[] = [
  {
    eventId:   'EVT-001',
    startTime: '2026-03-03T09:14:22',
    type:      'Sale',
    amount:    47.85,
    register:  'POS-01',
    cashier:   'Sarah K.',
    items: [
      { name: 'Americano (L)',    qty: 2, price: 13.00 },
      { name: 'Croissant',        qty: 1, price:  4.25 },
      { name: 'Chicken Sandwich', qty: 1, price: 13.99 },
      { name: 'Orange Juice',     qty: 1, price:  5.50 },
      { name: 'Matcha Latte',     qty: 1, price:  7.25 },
      { name: 'Blueberry Muffin', qty: 2, price:  3.86 },
    ],
  },
  {
    eventId:   'EVT-002',
    startTime: '2026-03-03T09:31:05',
    type:      'Void',
    amount:    22.50,
    register:  'POS-02',
    cashier:   'Mike T.',
    items: [
      { name: 'Caramel Macchiato', qty: 1, price:  7.50 },
      { name: 'Avocado Toast',     qty: 1, price: 11.00 },
      { name: 'Sparkling Water',   qty: 2, price:  4.00 },
    ],
  },
  {
    eventId:   'EVT-003',
    startTime: '2026-03-03T10:02:47',
    type:      'Sale',
    amount:    31.20,
    register:  'POS-01',
    cashier:   'Sarah K.',
    items: [
      { name: 'Breakfast Burrito', qty: 1, price: 12.75 },
      { name: 'Latte (M)',         qty: 2, price: 11.00 },
      { name: 'Fruit Cup',         qty: 1, price:  7.45 },
    ],
  },
  {
    eventId:   'EVT-004',
    startTime: '2026-03-03T10:45:13',
    type:      'Refund',
    amount:    13.99,
    register:  'POS-03',
    cashier:   'James L.',
    items: [
      { name: 'Chicken Sandwich', qty: 1, price: 13.99 },
    ],
  },
  {
    eventId:   'EVT-005',
    startTime: '2026-03-03T11:18:39',
    type:      'Sale',
    amount:    58.60,
    register:  'POS-02',
    cashier:   'Ana R.',
    items: [
      { name: 'Club Sandwich', qty: 2, price: 26.00 },
      { name: 'Cappuccino',    qty: 2, price: 13.00 },
      { name: 'Caesar Salad',  qty: 1, price: 10.50 },
      { name: 'Tiramisu',      qty: 1, price:  9.10 },
    ],
  },
  {
    eventId:   'EVT-006',
    startTime: '2026-03-03T12:03:22',
    type:      'Void',
    amount:    9.75,
    register:  'POS-01',
    cashier:   'Sarah K.',
    items: [
      { name: 'Flat White',   qty: 1, price: 5.75 },
      { name: 'Banana Bread', qty: 1, price: 4.00 },
    ],
  },
  {
    eventId:   'EVT-007',
    startTime: '2026-03-03T13:27:55',
    type:      'Sale',
    amount:    74.30,
    register:  'POS-03',
    cashier:   'James L.',
    items: [
      { name: 'Ribeye Steak',       qty: 1, price: 34.00 },
      { name: 'House Wine (glass)', qty: 2, price: 18.00 },
      { name: 'Garlic Bread',       qty: 1, price:  6.00 },
      { name: 'Tiramisu',           qty: 2, price: 16.30 },
    ],
  },
  {
    eventId:   'EVT-008',
    startTime: '2026-03-03T14:11:08',
    type:      'Refund',
    amount:    34.00,
    register:  'POS-03',
    cashier:   'Ana R.',
    items: [
      { name: 'Ribeye Steak', qty: 1, price: 34.00 },
    ],
  },
  {
    eventId:   'EVT-009',
    startTime: '2026-03-03T15:44:31',
    type:      'Sale',
    amount:    22.15,
    register:  'POS-02',
    cashier:   'Mike T.',
    items: [
      { name: 'Espresso (D)',    qty: 1, price:  4.25 },
      { name: 'Almond Croissant', qty: 2, price:  9.50 },
      { name: 'Greek Yogurt Bowl', qty: 1, price:  8.40 },
    ],
  },
  {
    eventId:   'EVT-010',
    startTime: '2026-03-03T16:55:19',
    type:      'Sale',
    amount:    41.90,
    register:  'POS-01',
    cashier:   'Sarah K.',
    items: [
      { name: 'Margherita Pizza',  qty: 1, price: 18.50 },
      { name: 'Craft Beer (pint)', qty: 2, price: 16.00 },
      { name: 'Truffle Fries',     qty: 1, price:  7.40 },
    ],
  },
];

// ── Utility Helpers ───────────────────────────────────────────────────────────

// Format ISO timestamp to "hh:mm AM/PM" for event cards (이벤트 카드용 시간 포맷)
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour:   '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

// Format ISO timestamp to "MM/DD/YYYY" for the receipt header (영수증 헤더용 날짜 포맷)
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: '2-digit',
    day:   '2-digit',
    year:  'numeric',
  });
}

// Format a number as a "$0.00" USD string (숫자를 "$0.00" 달러 문자열로 포맷)
function fmt(n: number): string {
  return `$${n.toFixed(2)}`;
}

// Return true if the event type is an anomaly requiring visual alerting (이상 거래 여부 판별)
function isAnomaly(type: SolinkEvent['type']): boolean {
  return type === 'Void' || type === 'Refund';
}

// ── Shared Sub-components ─────────────────────────────────────────────────────

// Styled select dropdown for the dark filter bar (어두운 필터 바용 스타일 드롭다운)
function FilterDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  icon,
}: {
  label:    string;
  value:    T;
  options:  T[];
  onChange: (v: T) => void;
  icon:     React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 min-w-[168px] cursor-pointer hover:border-slate-600 transition-colors">
      <span className="text-slate-500 shrink-0">{icon}</span>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="bg-transparent text-slate-200 text-sm flex-1 outline-none cursor-pointer appearance-none"
      >
        {options.map((opt) => (
          <option key={opt} value={opt} className="bg-slate-900 text-slate-200">
            {opt}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="text-slate-600 shrink-0" />
    </label>
  );
}

// Coloured pill badge for each event type (이벤트 타입별 색상 뱃지)
function TypeBadge({ type }: { type: SolinkEvent['type'] }) {
  const cls: Record<SolinkEvent['type'], string> = {
    Sale:   'bg-emerald-900/60 text-emerald-400 border-emerald-700/40',
    Void:   'bg-red-900/60    text-red-400    border-red-700/40',
    Refund: 'bg-orange-900/60 text-orange-400 border-orange-700/40',
  };
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border tracking-wide ${cls[type]}`}>
      {type}
    </span>
  );
}

// Lucide icon mapped to each event type (이벤트 타입별 아이콘)
function TypeIcon({ type, size = 13 }: { type: SolinkEvent['type']; size?: number }) {
  if (type === 'Sale')   return <ShoppingCart size={size} className="text-emerald-400" />;
  if (type === 'Void')   return <AlertTriangle size={size} className="text-red-400" />;
  return                        <RotateCcw    size={size} className="text-orange-400" />;
}

// ── Paper Receipt Component ───────────────────────────────────────────────────

// Realistic paper receipt rendered in the video stage overlay (비디오 스테이지 오버레이용 영수증)
function PaperReceipt({ event }: { event: SolinkEvent }) {
  const anomaly  = isAnomaly(event.type);
  const subtotal = event.items.reduce((sum, item) => sum + item.price, 0);
  const tax      = parseFloat((subtotal * 0.0875).toFixed(2));  // 8.75% sales tax (8.75% 판매세)
  const total    = subtotal + tax;

  // Header background — green for Sale, red for Void / Refund (헤더 배경 — Sale: 녹색, Void/Refund: 빨간색)
  const headerBg   = anomaly ? 'bg-red-600'  : 'bg-emerald-600';
  const headerText = anomaly ? 'text-red-50' : 'text-emerald-50';

  // Total text — red for anomalies, dark for normal sales (합계 텍스트 색상 — 이상 거래는 빨간색)
  const totalColor = anomaly ? 'text-red-600' : 'text-gray-900';

  return (
    <div
      className="w-[272px] bg-white rounded-sm font-mono text-xs text-gray-800 flex flex-col border border-gray-200 select-none"
      style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.65), 0 2px 8px rgba(0,0,0,0.35)' }}
    >
      {/* ── Header: type banner + store name ── (헤더: 거래 유형 배너 + 매장명) */}
      <div className={`${headerBg} ${headerText} px-4 py-3 text-center rounded-t-sm`}>
        <p className="font-bold text-[13px] tracking-widest uppercase">
          {anomaly ? `⚠ ${event.type} TRANSACTION` : '★ SALE COMPLETE'}
        </p>
        <p className="text-[10px] opacity-80 mt-0.5">JM Café &amp; Bistro</p>
      </div>

      {/* ── Store metadata ── (매장 메타데이터) */}
      <div className="text-center px-4 pt-3 pb-2 border-b border-dashed border-gray-300">
        <p className="text-gray-400 text-[10px]">1234 Market Street, Portland OR 97201</p>
        <p className="text-gray-400 text-[10px]">Tel: (503) 555-0192</p>
        <div className="flex justify-between text-gray-500 text-[10px] mt-1.5">
          <span>{formatDate(event.startTime)}</span>
          <span>{formatTime(event.startTime)}</span>
        </div>
        <div className="flex justify-between text-gray-500 text-[10px] mt-0.5">
          <span>REG: {event.register}</span>
          <span>CSH: {event.cashier}</span>
        </div>
        <p className="text-gray-400 text-[10px] mt-0.5">TXN: {event.eventId}</p>
      </div>

      {/* ── Line items ── (품목 목록) */}
      <div className="px-4 py-3 space-y-1.5 border-b border-dashed border-gray-300">
        {/* Column headers (컬럼 헤더) */}
        <div className="flex justify-between text-gray-400 text-[9px] uppercase pb-1 border-b border-gray-200">
          <span className="flex-1">Item</span>
          <span className="w-6 text-center">Qty</span>
          <span className="w-14 text-right">Price</span>
        </div>
        {/* Item rows (품목 행) */}
        {event.items.map((item, i) => (
          <div key={i} className="flex justify-between text-[11px]">
            <span className="flex-1 truncate pr-2 text-gray-700">{item.name}</span>
            <span className="w-6 text-center text-gray-400">{item.qty}</span>
            <span className="w-14 text-right text-gray-800">{fmt(item.price)}</span>
          </div>
        ))}
      </div>

      {/* ── Totals ── (합계) */}
      <div className="px-4 py-3 space-y-1 border-b border-dashed border-gray-300 text-[11px]">
        <div className="flex justify-between text-gray-500">
          <span>Subtotal</span>
          <span>{fmt(subtotal)}</span>
        </div>
        <div className="flex justify-between text-gray-500">
          <span>Tax (8.75%)</span>
          <span>{fmt(tax)}</span>
        </div>
        <div className={`flex justify-between font-bold text-[13px] pt-1 ${totalColor}`}>
          <span>TOTAL</span>
          <span>{fmt(total)}</span>
        </div>
        {/* Anomaly stamp — only rendered for Void / Refund (이상 거래 스탬프 — Void/Refund만) */}
        {anomaly && (
          <div className="text-center text-red-500 font-bold text-[11px] mt-1 pt-1 border-t border-red-200 tracking-widest">
            *** {event.type.toUpperCase()} ***
          </div>
        )}
      </div>

      {/* ── Payment method ── (결제 수단) */}
      <div className="px-4 py-2 border-b border-dashed border-gray-300 text-[11px] text-gray-600">
        <div className="flex justify-between">
          <span>CARD (VISA ****4521)</span>
          <span>{fmt(total)}</span>
        </div>
        <div className="flex justify-between text-gray-400 text-[10px] mt-0.5">
          <span>Auth: 847291</span>
          <span>Ref: {event.eventId}</span>
        </div>
      </div>

      {/* ── Footer + barcode simulation ── (하단 + 바코드 시뮬레이션) */}
      <div className="px-4 py-3 text-center text-gray-400 text-[10px] space-y-0.5">
        <p>Thank you for your business!</p>
        <p className="text-[9px]">★ POWERED BY JM SAAS PLATFORM ★</p>
        {/* Decorative barcode stripes (장식용 바코드 줄무늬) */}
        <div className="mt-2 flex justify-center gap-px" aria-hidden="true">
          {Array.from({ length: 34 }).map((_, i) => (
            <div
              key={i}
              className="bg-gray-700"
              style={{ width: i % 3 === 0 ? '3px' : '1.5px', height: '24px' }}
            />
          ))}
        </div>
        <p className="text-[9px] mt-1 tracking-widest">{event.eventId}-{event.register}</p>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SolinkTestPage() {
  // Selected event — drives the receipt displayed in the video stage (선택된 이벤트 — 비디오 스테이지 영수증 구동)
  const [selectedEvent, setSelectedEvent] = useState<SolinkEvent>(MOCK_EVENTS[0]);

  // Active filter state (활성 필터 상태)
  const [filters, setFilters] = useState<FilterState>({
    eventType: 'All',
    dateRange: 'Today',
    timeOfDay: 'All Day',
  });

  // Partial filter updater (필터 부분 업데이트 헬퍼)
  function updateFilter<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  // Apply event type filter — date and time filters are UI-only until API is wired up
  // (이벤트 타입 필터 적용 — 날짜/시간 필터는 API 연결 전까지 UI 전용)
  const filteredEvents = useMemo<SolinkEvent[]>(() => {
    if (filters.eventType === 'All') return MOCK_EVENTS;
    return MOCK_EVENTS.filter((e) => e.type === filters.eventType);
  }, [filters.eventType]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col">

      {/* ── Page Header ── (페이지 헤더) */}
      <header className="px-6 py-3.5 border-b border-slate-800 bg-slate-950/90 backdrop-blur-sm sticky top-0 z-20 flex items-center gap-3">
        <Monitor size={18} className="text-sky-400 shrink-0" />
        <div className="leading-tight">
          <h1 className="text-sm font-semibold text-slate-100">POS Video Overlay</h1>
          <p className="text-[11px] text-slate-500">Solink Integration · Live Event Feed</p>
        </div>
        {/* Live pulse indicator (라이브 펄스 표시기) */}
        <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-500 font-mono">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          LIVE
        </div>
      </header>

      {/* ── Top Filter Bar ── (상단 필터 바) */}
      <div className="px-6 py-2.5 border-b border-slate-800 bg-slate-900/40 flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500 uppercase tracking-wider font-medium">
          <Filter size={11} />
          Filters
        </span>

        {/* Event type filter (이벤트 타입 필터) */}
        <FilterDropdown
          label="Event Type"
          value={filters.eventType}
          options={['All', 'Sale', 'Void', 'Refund']}
          onChange={(v) => updateFilter('eventType', v)}
          icon={<ShoppingCart size={13} />}
        />

        {/* Date range filter (날짜 범위 필터) */}
        <FilterDropdown
          label="Date Range"
          value={filters.dateRange}
          options={['Today', 'Yesterday', 'Last 7 Days']}
          onChange={(v) => updateFilter('dateRange', v)}
          icon={<Calendar size={13} />}
        />

        {/* Time of day filter (시간대 필터) */}
        <FilterDropdown
          label="Time of Day"
          value={filters.timeOfDay}
          options={['All Day', 'Morning', 'Afternoon', 'Evening']}
          onChange={(v) => updateFilter('timeOfDay', v)}
          icon={<Clock size={13} />}
        />

        {/* Result count (결과 건수) */}
        <span className="ml-auto text-[11px] text-slate-600 font-mono">
          {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Main Split Layout ── (메인 분할 레이아웃) */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left Panel: Event List (35%) ── (왼쪽 패널: 이벤트 목록, 35%) */}
        <aside className="w-[35%] border-r border-slate-800 flex flex-col overflow-hidden bg-slate-950">
          {/* Panel header (패널 헤더) */}
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/30 flex items-center justify-between shrink-0">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Events</span>
            <span className="text-[10px] text-slate-700">Click to review</span>
          </div>

          {/* Scrollable event cards (스크롤 가능한 이벤트 카드) */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filteredEvents.length === 0 ? (
              // Empty state (빈 상태)
              <div className="flex flex-col items-center justify-center py-20 gap-2 text-slate-700">
                <Filter size={22} />
                <p className="text-sm">No events match this filter</p>
              </div>
            ) : (
              filteredEvents.map((event) => {
                const isSelected = event.eventId === selectedEvent.eventId;

                // Border + background per state: selected → sky, void → red, refund → orange, normal → slate
                // (상태별 테두리 + 배경: 선택됨 → 하늘색, void → 빨강, refund → 주황, 일반 → 슬레이트)
                const cardClass = isSelected
                  ? 'border-sky-500 bg-slate-800/80'
                  : event.type === 'Void'
                    ? 'border-red-700/50 bg-red-950/20 hover:bg-red-950/30'
                    : event.type === 'Refund'
                      ? 'border-orange-700/50 bg-orange-950/20 hover:bg-orange-950/30'
                      : 'border-slate-700/40 bg-slate-900/40 hover:bg-slate-800/50';

                return (
                  <button
                    key={event.eventId}
                    onClick={() => setSelectedEvent(event)}
                    className={`w-full text-left rounded-lg border px-3 py-2.5 transition-all duration-150 ${cardClass}`}
                    aria-pressed={isSelected}
                    aria-label={`${event.type} ${event.eventId} at ${formatTime(event.startTime)}`}
                  >
                    {/* Row 1: icon + ID + type badge (1행: 아이콘 + ID + 타입 뱃지) */}
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <TypeIcon type={event.type} />
                        <span className="text-[10px] font-semibold text-slate-500 font-mono">{event.eventId}</span>
                      </div>
                      <TypeBadge type={event.type} />
                    </div>

                    {/* Row 2: amount + register (2행: 금액 + 단말기) */}
                    <div className="flex items-baseline justify-between">
                      <span className={`text-[15px] font-bold ${
                        event.type === 'Void'   ? 'text-red-300'    :
                        event.type === 'Refund' ? 'text-orange-300' :
                                                   'text-slate-100'
                      }`}>
                        {fmt(event.amount)}
                      </span>
                      <span className="text-[10px] text-slate-600 font-mono">{event.register}</span>
                    </div>

                    {/* Row 3: time + cashier (3행: 시간 + 캐셔) */}
                    <div className="flex items-center justify-between mt-1">
                      <span className="flex items-center gap-1 text-[10px] text-slate-500">
                        <Clock size={9} />
                        {formatTime(event.startTime)}
                      </span>
                      <span className="text-[10px] text-slate-600">{event.cashier}</span>
                    </div>

                    {/* Items preview — first two lines (품목 미리보기 — 앞 2개) */}
                    <div className="mt-2 pt-2 border-t border-slate-700/30 space-y-0.5">
                      {event.items.slice(0, 2).map((item, i) => (
                        <div key={i} className="flex justify-between text-[10px] text-slate-600">
                          <span className="truncate">{item.name}</span>
                          <span className="ml-2 shrink-0">{fmt(item.price)}</span>
                        </div>
                      ))}
                      {event.items.length > 2 && (
                        <p className="text-[10px] text-slate-700 italic">
                          +{event.items.length - 2} more item{event.items.length - 2 > 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ── Right Panel: Video Stage (65%) ── (오른쪽 패널: 비디오 스테이지, 65%) */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Camera label bar (카메라 레이블 바) */}
          <div className="px-4 py-2 bg-black/70 border-b border-slate-800 flex items-center gap-2 shrink-0">
            <Camera size={12} className="text-slate-600" />
            <span className="text-[10px] text-slate-600 font-mono">CAM-01 · REGISTER ZONE</span>
            <span className="ml-auto text-[10px] font-mono text-slate-700">
              {formatDate(selectedEvent.startTime)} · {formatTime(selectedEvent.startTime)}
            </span>
          </div>

          {/* Simulated camera feed area (시뮬레이션 카메라 피드 영역) */}
          <div
            className="flex-1 relative flex items-center justify-center overflow-hidden"
            style={{
              background: 'radial-gradient(ellipse at 30% 40%, #0f172a 0%, #020617 55%, #000 100%)',
            }}
          >
            {/* Scan-line texture — evokes real CCTV footage (CCTV 효과를 위한 스캔라인 텍스처) */}
            <div
              className="absolute inset-0 pointer-events-none opacity-[0.04]"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,1) 2px, rgba(255,255,255,1) 4px)',
              }}
              aria-hidden="true"
            />

            {/* Corner HUD crosshairs (코너 HUD 크로스헤어) */}
            {(
              ['top-3 left-3', 'top-3 right-3', 'bottom-3 left-3', 'bottom-3 right-3'] as const
            ).map((pos) => (
              <div key={pos} className={`absolute ${pos} w-6 h-6 pointer-events-none opacity-25`} aria-hidden="true">
                <div className="absolute top-0 left-0 w-3 h-px bg-sky-400" />
                <div className="absolute top-0 left-0 w-px h-3 bg-sky-400" />
                <div className="absolute bottom-0 right-0 w-3 h-px bg-sky-400" />
                <div className="absolute bottom-0 right-0 w-px h-3 bg-sky-400" />
              </div>
            ))}

            {/* Bottom-left timestamp HUD (왼쪽 하단 타임스탬프 HUD) */}
            <div className="absolute bottom-4 left-4 font-mono text-[10px] text-green-400/60 pointer-events-none" aria-hidden="true">
              <p>{formatDate(selectedEvent.startTime)} {formatTime(selectedEvent.startTime)}</p>
              <p>{selectedEvent.register} · {selectedEvent.eventId}</p>
            </div>

            {/* Top-right REC indicator (오른쪽 상단 녹화 표시기) */}
            <div className="absolute top-4 right-4 flex items-center gap-1.5 pointer-events-none" aria-hidden="true">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="font-mono text-[10px] text-red-400/70">REC</span>
            </div>

            {/* ── Paper Receipt Overlay ── (영수증 오버레이) */}
            <div className="relative z-10">
              <PaperReceipt event={selectedEvent} />
            </div>
          </div>

          {/* Bottom metadata bar (하단 메타데이터 바) */}
          <div className="px-4 py-2 bg-black/70 border-t border-slate-800 flex items-center gap-3 text-[11px] font-mono text-slate-600 shrink-0">
            <TypeIcon type={selectedEvent.type} size={11} />
            <span className={
              selectedEvent.type === 'Void'   ? 'text-red-400'    :
              selectedEvent.type === 'Refund' ? 'text-orange-400' :
                                                 'text-emerald-400'
            }>
              {selectedEvent.type}
            </span>
            <span className="text-slate-800">·</span>
            <span>{selectedEvent.eventId}</span>
            <span className="text-slate-800">·</span>
            <span>{selectedEvent.register}</span>
            <span className="text-slate-800">·</span>
            <span className={`font-bold ${isAnomaly(selectedEvent.type) ? 'text-red-300' : 'text-slate-400'}`}>
              {fmt(selectedEvent.amount)}
            </span>
            <span className="ml-auto text-slate-700">{selectedEvent.cashier}</span>
          </div>
        </main>

      </div>
    </div>
  );
}
