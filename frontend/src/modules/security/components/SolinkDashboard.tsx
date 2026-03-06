// Solink POS Video Overlay Dashboard — shared component for agency and store roles
// (Solink POS 비디오 오버레이 대시보드 — 에이전시 및 매장 역할 공유 컴포넌트)
// Fetches real events from backend, loads time-indexed video on event click via Solink API proxy
// (백엔드에서 실제 이벤트 가져오기, 이벤트 클릭 시 Solink API 프록시를 통한 시간 인덱스 비디오 로드)

'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  RefreshCcw, AlertCircle, CheckCircle2, XCircle, Monitor,
  ChevronLeft, Star, Printer, MoreVertical, FileText, Camera, Loader2, ExternalLink,
} from 'lucide-react';
import { getCameras, getVideoLink, SolinkCamera } from '@/services/api/solinkService';

// ── Type Definitions (타입 정의) ──────────────────────────────────────────────

interface ReceiptItem {
  name:       string;
  qty:        number;
  unitPrice:  number;
  totalPrice: number;
}

interface SolinkEvent {
  eventId:   string;
  startTime: string;
  type:      string;
  amount:    number;
  register:  string;
  cashier:   string;
  items:     ReceiptItem[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Backend URL for events endpoint (이벤트 엔드포인트 백엔드 URL)
const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'https://jm-saas-platform.onrender.com';

// ── SolinkDashboard ───────────────────────────────────────────────────────────

export default function SolinkDashboard() {

  // ── Events & UI state (이벤트 및 UI 상태) ──────────────────────────────────
  const [events,      setEvents     ] = useState<SolinkEvent[]>([]);
  const [loading,     setLoading    ] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<SolinkEvent | null>(null);

  // Mobile drill-down state (모바일 화면 전환 상태)
  const [isMobileDetailOpen, setIsMobileDetailOpen] = useState(false);

  // ── Camera state (카메라 상태) ──────────────────────────────────────────────
  const [cameras,        setCameras       ] = useState<SolinkCamera[]>([]);
  // Default to the known correct camera ID; overridden by dropdown selection (알려진 올바른 카메라 ID를 기본값으로 사용; 드롭다운 선택으로 재정의 가능)
  const [selectedCamera, setSelectedCamera] = useState('3f34c890-17fb-11f1-a67a-af67afbf5812');
  const [videoLoading, setVideoLoading] = useState(false); // True while fetching video URL for popup (팝업용 비디오 URL 조회 중 true)
  // Persistent ref to the popup window — survives re-renders, avoids duplicate windows
  // (팝업 창에 대한 영속적 ref — 리렌더 후에도 유지, 중복 창 방지)
  const popupRef = useRef<Window | null>(null);

  // ── Filter state (필터 상태) ────────────────────────────────────────────────
  const [searchQuery,    setSearchQuery   ] = useState('');
  const [filterType,     setFilterType    ] = useState('All');
  const [filterTime,     setFilterTime    ] = useState('All Day');
  const [datePreset,     setDatePreset    ] = useState('Today');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo,   setCustomDateTo  ] = useState('');

  // ── Data loading (데이터 로딩) ──────────────────────────────────────────────

  // Load events + camera list concurrently on mount (마운트 시 이벤트와 카메라 목록 동시 로드)
  const loadData = async () => {
    setLoading(true);
    try {
      const [eventsRes, fetchedCameras] = await Promise.all([
        fetch(`${BACKEND}/api/solink/events?days=30`).then(r => r.json()),
        getCameras(),
      ]);

      // Populate camera dropdown (카메라 드롭다운 채우기)
      if (fetchedCameras.length > 0) {
        setCameras(fetchedCameras);
        // Pre-select first camera if none selected (선택된 카메라 없을 경우 첫 번째 카메라 사전 선택)
        setSelectedCamera(prev => prev || fetchedCameras[0].id);
      }

      // Normalize events (이벤트 정규화)
      if (eventsRes.success && Array.isArray(eventsRes.data)) {
        const normalizedData: SolinkEvent[] = eventsRes.data.map((item: any) => {
          const details = item.details || {};

          // Guaranteed amount extraction to prevent $0.00 ($0.00을 방지하기 위한 금액 추출)
          const rawAmount   = details['Total amount'] ?? details['Total price'] ?? item.amount ?? 0;
          const parsedAmount = parseFloat(rawAmount) || 0;

          // Transaction type normalization (거래 유형 정규화)
          let eventType = 'Sale';
          const statusStr = (details['Status'] || item.subtype || item.type || '').toUpperCase();
          if (statusStr.includes('VOID'))                              eventType = 'Void';
          else if (statusStr.includes('REFUND') || statusStr.includes('RETURN')) eventType = 'Refund';

          return {
            eventId:   item.id || `EVT-${Math.random().toString(36).substr(2, 9)}`,
            startTime: item.startTime || new Date().toISOString(),
            type:      eventType,
            amount:    parsedAmount,
            register:  details['Register ID'] || details['Store Number'] || 'JM-POS-01',
            cashier:   item.cashier || details['Employee ID'] || '—',
            items: Array.isArray(details.items)
              ? details.items.map((i: any) => {
                  const q = parseInt(i.quantity || i.qty || 1, 10);
                  const p = parseFloat(i.unitPrice || i.price || 0);
                  return {
                    name:       i.description || i.name || 'Unknown Item',
                    qty:        q,
                    unitPrice:  p,
                    totalPrice: parseFloat(i.extendedPrice) || q * p,
                  };
                })
              : [],
          };
        });

        // Keep only records with meaningful data and sort descending (의미 있는 데이터만 유지 후 최신순 정렬)
        const valid = normalizedData
          .filter(e => e.amount > 0 || e.items.length > 0)
          .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

        setEvents(valid);
        if (valid.length > 0 && !isMobileDetailOpen) setSelectedEvent(valid[0]);
      }
    } catch (err) {
      console.error('[SolinkDashboard] loadData error (데이터 로드 오류):', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch video URL on event/camera change and open in a named popup (이벤트/카메라 변경 시 비디오 URL 조회 후 고정 이름 팝업으로 열기)
  useEffect(() => {
    if (!selectedEvent || !selectedCamera) return;
    let cancelled = false;
    setVideoLoading(true);
    getVideoLink(selectedCamera, selectedEvent.startTime).then(url => {
      if (cancelled) return;
      setVideoLoading(false);
      if (!url) return;
      // If the popup is already open, force-navigate via location.href so the Solink SPA
      // receives a full page load rather than a target-name reuse (which the SPA ignores).
      // (팝업이 이미 열려있으면 location.href로 강제 이동 — window.open target 재활용 시
      //  Solink SPA가 URL 변경을 감지하지 못하는 버그를 이 방식으로 우회)
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.location.href = url; // Force full navigation inside existing popup (기존 팝업 내 강제 전체 탐색)
        popupRef.current.focus();             // Bring existing popup to front (기존 팝업을 전면으로 가져오기)
      } else {
        // No popup open yet — create a new sized popup and store the reference
        // (아직 열린 팝업 없음 — 새 크기 지정 팝업 생성 후 참조 저장)
        popupRef.current = window.open(
          url,
          'SolinkVideoPlayer',
          'width=1280,height=720,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no',
        );
      }
    });
    return () => { cancelled = true; };
  }, [selectedEvent, selectedCamera]);

  // ── Filtering (필터링) ──────────────────────────────────────────────────────

  const filteredEvents = useMemo(() => {
    return events.filter(event => {
      // Type filter (유형 필터)
      if (filterType !== 'All' && event.type !== filterType) return false;

      // Time of day filter (시간대 필터)
      if (filterTime !== 'All Day') {
        const hour = new Date(event.startTime).getHours();
        if (filterTime === 'Morning'   && (hour < 6  || hour >= 12)) return false;
        if (filterTime === 'Afternoon' && (hour < 12 || hour >= 18)) return false;
        if (filterTime === 'Evening'   && (hour < 18 && hour >= 6))  return false;
      }

      // Text search (텍스트 검색)
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!event.register.toLowerCase().includes(q) && !event.eventId.toLowerCase().includes(q)) return false;
      }

      // Date range filter (기간 필터)
      const eventDate  = new Date(event.startTime);
      const now        = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      if (datePreset === 'Today') {
        if (eventDate < todayStart) return false;
      } else if (datePreset === 'Week') {
        if (eventDate < new Date(todayStart.getTime() - 7   * 86400000)) return false;
      } else if (datePreset === 'Month') {
        if (eventDate < new Date(todayStart.getTime() - 30  * 86400000)) return false;
      } else if (datePreset === 'Year') {
        if (eventDate < new Date(todayStart.getTime() - 365 * 86400000)) return false;
      } else if (datePreset === 'Custom') {
        if (customDateFrom && eventDate < new Date(customDateFrom)) return false;
        if (customDateTo) {
          const to = new Date(customDateTo);
          to.setHours(23, 59, 59, 999);
          if (eventDate > to) return false;
        }
      }

      return true;
    });
  }, [events, filterType, filterTime, searchQuery, datePreset, customDateFrom, customDateTo]);

  // ── Handlers (핸들러) ───────────────────────────────────────────────────────

  const handleEventClick = (event: SolinkEvent) => {
    setSelectedEvent(event);
    setIsMobileDetailOpen(true); // Open detail view on mobile (모바일에서 상세 뷰 열기)
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-200 font-sans overflow-x-hidden md:overflow-hidden relative">

      {/* ── Top bar: filters + camera selector (상단 바: 필터 + 카메라 선택기) */}
      <div className="bg-slate-900 border-b border-slate-800 p-4 shrink-0 z-10 w-full">
        <div className="flex flex-wrap gap-3 items-center">

          {/* Date preset buttons (기간 프리셋 버튼) */}
          <div className="flex bg-slate-800 rounded-lg p-1 border border-slate-700 overflow-x-auto no-scrollbar max-w-full">
            {['Today', 'Week', 'Month', 'Year', 'Custom', 'All'].map(preset => (
              <button
                key={preset}
                onClick={() => setDatePreset(preset)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                  datePreset === preset ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>

          {/* Custom date pickers (사용자 지정 날짜 선택기) */}
          {datePreset === 'Custom' && (
            <div className="flex items-center gap-2">
              <input type="date" value={customDateFrom} onChange={e => setCustomDateFrom(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 outline-none focus:border-emerald-500 max-w-[120px]" />
              <span className="text-slate-500 text-xs">to</span>
              <input type="date" value={customDateTo} onChange={e => setCustomDateTo(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 outline-none focus:border-emerald-500 max-w-[120px]" />
            </div>
          )}

          {/* Type & time filters (유형 및 시간대 필터) */}
          <div className="flex gap-2 w-full md:w-auto">
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-3 py-1.5 outline-none focus:border-emerald-500 flex-1 md:flex-none">
              <option value="All">All Types</option>
              <option value="Sale">Sales</option>
              <option value="Void">Voids</option>
              <option value="Refund">Refunds</option>
            </select>
            <select value={filterTime} onChange={e => setFilterTime(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-3 py-1.5 outline-none focus:border-emerald-500 flex-1 md:flex-none">
              <option value="All Day">All Day</option>
              <option value="Morning">Morning</option>
              <option value="Afternoon">Afternoon</option>
              <option value="Evening">Evening</option>
            </select>
          </div>

          {/* Camera selector dropdown — populated from /api/solink/cameras (카메라 선택 드롭다운 — /api/solink/cameras에서 데이터 로드) */}
          {cameras.length > 0 && (
            <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded px-2 py-1.5">
              <Camera size={14} className="text-emerald-400 shrink-0" />
              <select
                value={selectedCamera}
                onChange={e => setSelectedCamera(e.target.value)}
                className="bg-transparent text-slate-200 text-xs outline-none min-w-[120px] max-w-[180px]"
              >
                {cameras.map(cam => (
                  <option key={cam.id} value={cam.id}>{cam.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Search box (검색창) */}
          <div className="flex flex-1 min-w-[160px] items-center gap-2 px-3 py-1.5 bg-slate-800 rounded border border-slate-700 w-full md:w-auto">
            <Search size={14} className="text-slate-400" />
            <input placeholder="Search POS ID..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="bg-transparent outline-none text-xs w-full text-white placeholder-slate-500" />
          </div>

          {/* Refresh button (새로고침 버튼) */}
          <button onClick={loadData} className="p-1.5 hover:bg-slate-800 rounded border border-slate-700 transition-colors hidden md:block">
            <RefreshCcw size={16} className={loading ? 'animate-spin text-emerald-500' : 'text-slate-400'} />
          </button>
        </div>
      </div>

      {/* ── Main layout (메인 레이아웃) */}
      <div className="flex flex-1 overflow-hidden relative w-full">

        {/* ── Left panel: event list (왼쪽 패널: 이벤트 리스트) */}
        <div className={`w-full md:w-[380px] border-r border-slate-800 overflow-y-auto bg-slate-900/50 flex-col ${isMobileDetailOpen ? 'hidden md:flex' : 'flex'}`}>
          <div className="p-4 border-b border-slate-800 flex justify-between items-center sticky top-0 bg-slate-900/95 backdrop-blur z-10">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              {filteredEvents.length} Events Found
            </span>
          </div>

          <div className="p-3 space-y-2 pb-20 md:pb-3">
            {loading ? (
              <div className="text-center py-10 text-slate-500 text-sm animate-pulse">Syncing events...</div>
            ) : filteredEvents.length === 0 ? (
              <div className="text-center py-10 text-slate-600 text-sm">No results match your filters.</div>
            ) : (
              filteredEvents.map(event => (
                <div
                  key={event.eventId}
                  onClick={() => handleEventClick(event)}
                  className={`p-3 rounded-lg border transition-all cursor-pointer ${
                    selectedEvent?.eventId === event.eventId
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-slate-800 bg-slate-900 hover:border-slate-700'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-1.5">
                      {event.type === 'Void'   ? <XCircle      size={14} className="text-red-500"    /> :
                       event.type === 'Refund' ? <AlertCircle  size={14} className="text-orange-500" /> :
                                                 <CheckCircle2 size={14} className="text-emerald-500" />}
                      <span className="text-[11px] font-bold uppercase tracking-wider">{event.type}</span>
                    </div>
                    <span className="font-mono font-bold text-white">${event.amount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-end text-[10px] text-slate-500">
                    <div>
                      <p>{new Date(event.startTime).toLocaleDateString()}</p>
                      <p>{new Date(event.startTime).toLocaleTimeString()}</p>
                    </div>
                    <div className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-400 border border-slate-700">
                      {event.register}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Right panel: video + receipt overlay (오른쪽 패널: 비디오 + 영수증 오버레이) */}
        <div className={`flex-1 bg-black flex-col relative w-full ${!isMobileDetailOpen ? 'hidden md:flex' : 'flex'}`}>

          {/* Mobile back button (모바일 뒤로 가기 버튼) */}
          <div className="md:hidden absolute top-4 left-4 z-50">
            <button onClick={() => setIsMobileDetailOpen(false)}
              className="flex items-center gap-1 bg-slate-800/80 backdrop-blur text-white px-3 py-1.5 rounded-full border border-slate-600 shadow-lg active:scale-95 transition-transform">
              <ChevronLeft size={16} />
              <span className="text-xs font-bold">Back to List</span>
            </button>
          </div>

          {/* Camera live indicator (카메라 라이브 표시기) */}
          <div className="absolute top-4 right-4 md:left-4 md:right-auto z-40 flex items-center gap-2 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-md border border-white/10">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-bold tracking-widest text-white/80 uppercase">
              {cameras.find(c => c.id === selectedCamera)?.name ?? 'CAM-01'} LIVE
            </span>
          </div>

          {/* Dark video background — video plays in a separate named popup, not inline */}
          {/* (어두운 비디오 배경 — 비디오는 인라인이 아닌 별도의 고정 이름 팝업에서 재생) */}
          <div className="absolute inset-0 bg-slate-950 flex items-center justify-center">
            {videoLoading ? (
              // Loading spinner while fetching video URL (비디오 URL 조회 중 로딩 스피너)
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={28} className="text-emerald-500 animate-spin" />
                <p className="text-slate-600 text-xs tracking-widest uppercase">Opening video…</p>
              </div>
            ) : selectedEvent ? (
              // Hint shown after popup has opened or when no URL was returned (팝업 열린 후 또는 URL 없을 때 표시되는 힌트)
              <div className="flex flex-col items-center gap-2 text-slate-700">
                <ExternalLink size={28} strokeWidth={1.2} />
                <p className="text-xs tracking-widest uppercase">Video opens in popup</p>
              </div>
            ) : null}
          </div>

          {/* Receipt overlay — sits on top of video, centered */}
          {/* (비디오 위에 올려진 영수증 오버레이, 가운데 정렬) */}
          {selectedEvent ? (
            <div className="relative z-10 flex-1 flex items-center justify-center p-4 overflow-y-auto w-full">
              <div className="w-full max-w-[340px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.7)] border border-slate-200 animate-in fade-in zoom-in-95 duration-300 mx-auto mt-12 md:mt-0">

                {/* Snapshot thumbnail — camera still-frame at the exact transaction moment.
                    Fetched via the backend proxy so API credentials never reach the browser.
                    Hidden automatically if the endpoint returns an error or no image. */}
                <div className="w-full overflow-hidden bg-slate-900">
                  <img
                    key={`${selectedCamera}-${selectedEvent.startTime}`}
                    src={`${BACKEND}/api/solink/snapshot?cameraId=${encodeURIComponent(selectedCamera)}&timestamp=${encodeURIComponent(selectedEvent.startTime)}`}
                    alt={`Camera snapshot — ${new Date(selectedEvent.startTime).toLocaleString()}`}
                    className="w-full h-[160px] object-cover block"
                    onError={(e) => {
                      // Hide the container gracefully if Solink returns no image
                      (e.currentTarget.parentElement as HTMLElement).style.display = 'none';
                    }}
                  />
                </div>

                {/* Receipt top banner (영수증 상단 배너) */}
                <div className="bg-[#e0e0e0] h-6 flex justify-end items-center px-2 text-slate-400">
                  <Star size={14} className="fill-current" />
                </div>

                {/* Receipt header with type-color left border (유형 색상 왼쪽 테두리 헤더) */}
                <div className="flex border-b border-slate-300 bg-white">
                  <div className={`w-3 flex-shrink-0 ${
                    selectedEvent.type === 'Void'   ? 'bg-red-500'    :
                    selectedEvent.type === 'Refund' ? 'bg-orange-500' : 'bg-[#5cb85c]'
                  }`} />
                  <div className="p-4 flex-1">
                    <div className="flex justify-between items-start">
                      <div>
                        <h2 className="text-lg font-black text-black tracking-tight">
                          ${selectedEvent.amount.toFixed(2)} {selectedEvent.type}
                        </h2>
                        <p className="text-xs text-slate-600 mt-1">
                          {new Date(selectedEvent.startTime).toLocaleString('en-US', {
                            hour12: true, month: 'short', day: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit', second: '2-digit',
                          })}
                        </p>
                      </div>
                      <div className="flex gap-2 text-slate-400">
                        <FileText size={16} />
                        <Printer size={16} />
                        <MoreVertical size={16} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Receipt body — monospace (영수증 본문 - 고정폭 폰트) */}
                <div className="p-5 font-mono text-[11px] md:text-xs text-slate-800 leading-relaxed bg-white">

                  <div className="mb-4">
                    <p>Store: JM Cafe</p>
                    <p>Register: {selectedEvent.register}</p>
                    <p className="truncate">Employee: {selectedEvent.cashier}</p>
                  </div>

                  <div className="mb-4 space-y-1 min-h-[80px]">
                    {selectedEvent.items.length > 0 ? (
                      selectedEvent.items.map((item, i) => (
                        <div key={i} className="flex justify-between">
                          <span className="w-6 text-right mr-2">{item.qty}</span>
                          <span className="flex-1 truncate pr-2">{item.name}</span>
                          <span className="w-12 text-right">{item.unitPrice.toFixed(2)}</span>
                          <span className="w-14 text-right font-bold">{item.totalPrice.toFixed(2)}</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-4 text-slate-400 italic">No items available</div>
                    )}
                  </div>

                  <div className="border-t border-dashed border-slate-400 pt-3 mb-4 pl-12 pr-2">
                    <div className="flex justify-between">
                      <span>Subtotal:</span><span>$ {selectedEvent.amount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-sm mt-1">
                      <span>Total:</span><span>$ {selectedEvent.amount.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="mt-4 mb-6">
                    <p>Total # Items: {selectedEvent.items.reduce((acc, item) => acc + item.qty, 0)}</p>
                  </div>

                  <div className="text-center text-[10px] text-slate-400 pt-4 border-t border-slate-200">
                    <p className="mb-1 truncate opacity-50">ID: {selectedEvent.eventId}</p>
                    <p className="font-bold text-emerald-600/70 tracking-widest mt-2">POWERED BY JM TECH ONE</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-slate-600">
              <Monitor size={48} strokeWidth={1} className="mb-4" />
              <p className="text-sm tracking-widest text-center px-4">
                AWAITING SELECTION<br />(이벤트를 선택하세요)
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
