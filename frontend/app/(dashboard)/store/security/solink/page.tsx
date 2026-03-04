"use client";

import { useState, useEffect, useMemo } from 'react';
import { 
  Search, Filter, Calendar, Clock, Camera, 
  RefreshCcw, AlertCircle, CheckCircle2, XCircle, Monitor, 
  ChevronLeft, Star, Printer, MoreVertical, FileText
} from 'lucide-react';

// ── Type Definitions (타입 정의) ──────────────────────────────────────────────

interface ReceiptItem {
  name: string;
  qty: number;
  unitPrice: number;
  totalPrice: number;
}

interface SolinkEvent {
  eventId: string;
  startTime: string;
  type: string;
  amount: number;
  register: string;
  cashier: string;
  items: ReceiptItem[];
}

export default function SolinkProDashboard() {
  // ── State Management (상태 관리) ───────────────────────────────────────────

  const [events, setEvents] = useState<SolinkEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedEvent, setSelectedEvent] = useState<SolinkEvent | null>(null);

  // Mobile Drill-down State for responsive view
  // (반응형 뷰를 위한 모바일 화면 전환 상태)
  const [isMobileDetailOpen, setIsMobileDetailOpen] = useState<boolean>(false);

  // Advanced Filter States
  // (고급 필터 상태)
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('All');
  const [filterTime, setFilterTime] = useState('All Day');
  
  // Date Range States
  // (기간 검색 상태)
  const [datePreset, setDatePreset] = useState('Today'); // 'Today', 'Week', 'Month', 'Year', 'Custom', 'All'
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');

  // ── Data Fetching & Bulletproof Mapping (데이터 로드 및 방탄 매핑) ────────

  const loadData = async () => {
    setLoading(true);
    try {
      // Fetch 30 days of real data for comprehensive filtering
      // (포괄적인 필터링을 위해 30일치 실제 데이터를 가져옵니다)
      const response = await fetch("https://jm-saas-platform.onrender.com/api/solink/events?days=30");
      const result = await response.json();
      
      if (result.success && Array.isArray(result.data)) {
        const normalizedData = result.data.map((item: any) => {
          const details = item.details || {};
          
          // Guaranteed amount extraction to prevent $0.00
          // ($0.00을 방지하기 위한 보장된 금액 추출)
          const rawAmount = details["Total amount"] ?? details["Total price"] ?? item.amount ?? 0;
          const parsedAmount = parseFloat(rawAmount) || 0;

          // Transaction type normalization
          // (거래 유형 정규화)
          let eventType = "Sale";
          const statusStr = (details["Status"] || item.subtype || item.type || "").toUpperCase();
          if (statusStr.includes("VOID")) eventType = "Void";
          else if (statusStr.includes("REFUND") || statusStr.includes("RETURN")) eventType = "Refund";

          return {
            eventId: item.id || `EVT-${Math.random().toString(36).substr(2, 9)}`,
            startTime: item.startTime || new Date().toISOString(),
            type: eventType,
            amount: parsedAmount,
            register: details["Register ID"] || details["Store Number"] || "JM-POS-01",
            cashier: item.cashier || details["Employee ID"] || "08afabe6-09fb...",
            
            // Map items with safety checks
            // (안전 검사를 포함한 품목 매핑)
            items: Array.isArray(details.items) ? details.items.map((i: any) => {
              const q = parseInt(i.quantity || i.qty || 1, 10);
              const p = parseFloat(i.unitPrice || i.price || 0);
              return {
                name: i.description || i.name || 'Unknown Item',
                qty: q,
                unitPrice: p,
                totalPrice: parseFloat(i.extendedPrice) || (q * p)
              };
            }) : []
          };
        });

        // Filter out completely empty records
        // (완전히 비어있는 기록 제외)
        const validEvents = normalizedData.filter(e => e.amount > 0 || e.items.length > 0);

        // Sort descending by time
        // (최신순 정렬)
        validEvents.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

        setEvents(validEvents);
        if (validEvents.length > 0 && !isMobileDetailOpen) {
          setSelectedEvent(validEvents[0]);
        }
      }
    } catch (error) {
      console.error("Fetch Error (가져오기 오류):", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // ── High-Integrity Filtering Logic (무결성 필터링 로직) ───────────────────

  const filteredEvents = useMemo(() => {
    return events.filter(event => {
      // 1. Type Filter (유형 필터)
      if (filterType !== 'All' && event.type !== filterType) return false;

      // 2. Time of Day Filter (시간대 필터)
      if (filterTime !== 'All Day') {
        const hour = new Date(event.startTime).getHours();
        if (filterTime === 'Morning' && (hour < 6 || hour >= 12)) return false;
        if (filterTime === 'Afternoon' && (hour < 12 || hour >= 18)) return false;
        if (filterTime === 'Evening' && (hour < 18 && hour >= 6)) return false;
      }

      // 3. Text Search (텍스트 검색)
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!event.register.toLowerCase().includes(query) && !event.eventId.toLowerCase().includes(query)) return false;
      }

      // 4. Advanced Date Range Filter (고급 기간 필터)
      const eventDate = new Date(event.startTime);
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      if (datePreset === 'Today') {
        if (eventDate < todayStart) return false;
      } else if (datePreset === 'Week') {
        const weekAgo = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
        if (eventDate < weekAgo) return false;
      } else if (datePreset === 'Month') {
        const monthAgo = new Date(todayStart.getTime() - 30 * 24 * 60 * 60 * 1000);
        if (eventDate < monthAgo) return false;
      } else if (datePreset === 'Year') {
        const yearAgo = new Date(todayStart.getTime() - 365 * 24 * 60 * 60 * 1000);
        if (eventDate < yearAgo) return false;
      } else if (datePreset === 'Custom') {
        if (customDateFrom && eventDate < new Date(customDateFrom)) return false;
        if (customDateTo) {
          const toDate = new Date(customDateTo);
          toDate.setHours(23, 59, 59, 999);
          if (eventDate > toDate) return false;
        }
      }

      return true;
    });
  }, [events, filterType, filterTime, searchQuery, datePreset, customDateFrom, customDateTo]);

  // ── Event Handlers (이벤트 핸들러) ─────────────────────────────────────────

  const handleEventClick = (event: SolinkEvent) => {
    setSelectedEvent(event);
    // Open detail view on mobile
    // (모바일에서 상세 뷰 열기)
    setIsMobileDetailOpen(true); 
  };

  const handleBackToList = () => {
    // Go back to list on mobile
    // (모바일에서 리스트로 돌아가기)
    setIsMobileDetailOpen(false); 
  };

  // ── UI Components (UI 컴포넌트) ─────────────────────────────────────────────

  return (
    // ✨ CRITICAL FIX: Changed h-screen to h-full w-full so it fits perfectly inside DashboardShell on mobile
    // (중요 수정: 모바일의 DashboardShell 안에 완벽히 맞도록 h-screen을 h-full w-full로 변경했습니다)
    <div className="flex flex-col h-full w-full bg-slate-950 text-slate-200 font-sans overflow-x-hidden md:overflow-hidden relative">
      
      {/* ── Top Bar: Search & Advanced Filters (상단 바: 검색 및 고급 필터) ── */}
      <div className="bg-slate-900 border-b border-slate-800 p-4 shrink-0 z-10 w-full">
        <div className="flex flex-wrap gap-3 items-center">
          
          {/* Date Range Preset Buttons (기간 검색 프리셋 버튼) */}
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

          {/* Custom Date Pickers (사용자 지정 날짜 선택기) */}
          {datePreset === 'Custom' && (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
              <input 
                type="date" 
                value={customDateFrom}
                onChange={(e) => setCustomDateFrom(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 outline-none focus:border-emerald-500 w-full max-w-[120px]"
              />
              <span className="text-slate-500 text-xs">to</span>
              <input 
                type="date" 
                value={customDateTo}
                onChange={(e) => setCustomDateTo(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 outline-none focus:border-emerald-500 w-full max-w-[120px]"
              />
            </div>
          )}

          {/* Type & Time Filters (유형 및 시간대 필터) */}
          <div className="flex gap-2 w-full md:w-auto">
            <select 
              value={filterType} onChange={(e) => setFilterType(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-3 py-1.5 outline-none focus:border-emerald-500 flex-1 md:flex-none"
            >
              <option value="All">All Types</option>
              <option value="Sale">Sales</option>
              <option value="Void">Voids</option>
              <option value="Refund">Refunds</option>
            </select>
            <select 
              value={filterTime} onChange={(e) => setFilterTime(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-3 py-1.5 outline-none focus:border-emerald-500 flex-1 md:flex-none"
            >
              <option value="All Day">All Day</option>
              <option value="Morning">Morning</option>
              <option value="Afternoon">Afternoon</option>
              <option value="Evening">Evening</option>
            </select>
          </div>

          {/* Search Box (검색창) */}
          <div className="flex flex-1 min-w-[200px] items-center gap-2 px-3 py-1.5 bg-slate-800 rounded border border-slate-700 w-full md:w-auto">
            <Search size={14} className="text-slate-400" />
            <input 
              placeholder="Search POS ID..."
              value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent outline-none text-xs w-full text-white placeholder-slate-500"
            />
          </div>

          {/* Refresh Button (새로고침 버튼) */}
          <button onClick={loadData} className="p-1.5 hover:bg-slate-800 rounded border border-slate-700 transition-colors hidden md:block">
            <RefreshCcw size={16} className={loading ? "animate-spin text-emerald-500" : "text-slate-400"} />
          </button>
        </div>
      </div>

      {/* ── Main Responsive Layout (메인 반응형 레이아웃) ── */}
      <div className="flex flex-1 overflow-hidden relative w-full">
        
        {/* ── Left Panel: List View (왼쪽 패널: 리스트 뷰) ── */}
        {/* Hidden on mobile if detail is open, visible on desktop */}
        {/* (모바일 상세 뷰 열릴 때 숨김, 데스크탑 항상 표시) */}
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
              filteredEvents.map((event) => (
                <div 
                  key={event.eventId}
                  onClick={() => handleEventClick(event)}
                  className={`p-3 rounded-lg border transition-all cursor-pointer group ${
                    selectedEvent?.eventId === event.eventId 
                      ? "border-emerald-500 bg-emerald-500/10" 
                      : "border-slate-800 bg-slate-900 hover:border-slate-700"
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-1.5">
                      {event.type === 'Void' ? <XCircle size={14} className="text-red-500" /> : 
                       event.type === 'Refund' ? <AlertCircle size={14} className="text-orange-500" /> : 
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

        {/* ── Right Panel: Detail & Video View (오른쪽 패널: 상세 및 비디오 뷰) ── */}
        {/* Hidden on mobile if detail is closed, visible on desktop */}
        {/* (모바일 리스트 뷰일 때 숨김, 데스크탑 항상 표시) */}
        <div className={`flex-1 bg-black flex-col relative w-full ${!isMobileDetailOpen ? 'hidden md:flex' : 'flex'}`}>
          
          {/* Mobile Back Button */}
          {/* (모바일 뒤로 가기 버튼) */}
          <div className="md:hidden absolute top-4 left-4 z-50">
            <button 
              onClick={handleBackToList}
              className="flex items-center gap-1 bg-slate-800/80 backdrop-blur text-white px-3 py-1.5 rounded-full border border-slate-600 shadow-lg active:scale-95 transition-transform"
            >
              <ChevronLeft size={16} /> <span className="text-xs font-bold">Back to List</span>
            </button>
          </div>

          {/* Camera Indicator */}
          {/* (카메라 상태) */}
          <div className="absolute top-4 right-4 md:left-4 md:right-auto z-40 flex items-center gap-2 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-md border border-white/10">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-bold tracking-widest text-white/80 uppercase">CAM-01 LIVE</span>
          </div>

          {/* Detailed Receipt Overlay */}
          {/* (상세 영수증 오버레이) */}
          {selectedEvent ? (
            <div className="flex-1 flex items-center justify-center p-4 overflow-y-auto w-full">
              {/* Receipt Wrapper matching styling */}
              {/* (실사 영수증 래퍼) */}
              <div className="relative w-full max-w-[340px] bg-white shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-slate-200 animate-in fade-in zoom-in-95 duration-300 mx-auto mt-12 md:mt-0">
                
                {/* Receipt Top Banner */}
                {/* (영수증 상단 배너) */}
                <div className="bg-[#e0e0e0] h-6 flex justify-end items-center px-2 text-slate-400">
                  <Star size={14} className="fill-current" />
                </div>

                {/* Receipt Header block with left-border */}
                {/* (왼쪽 테두리가 있는 헤더 블록) */}
                <div className="flex border-b border-slate-300 bg-white">
                  <div className={`w-3 flex-shrink-0 ${
                    selectedEvent.type === 'Void' ? 'bg-red-500' : 
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
                            hour: '2-digit', minute: '2-digit', second: '2-digit'
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

                {/* Receipt Body (Monospace) */}
                {/* (영수증 본문 - 고정폭 폰트) */}
                <div className="p-5 font-mono text-[11px] md:text-xs text-slate-800 leading-relaxed bg-white">
                  
                  {/* Store Info */}
                  {/* (가게 정보) */}
                  <div className="mb-4">
                    <p>Store: JM Cafe</p>
                    <p>Register: {selectedEvent.register}</p>
                    <p className="truncate">Employee: {selectedEvent.cashier}</p>
                  </div>

                  {/* Items List */}
                  {/* (품목 리스트) */}
                  <div className="mb-4 space-y-1 min-h-[120px]">
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

                  {/* Totals Section */}
                  {/* (합계 섹션) */}
                  <div className="border-t border-dashed border-slate-400 pt-3 mb-4 pl-12 pr-2">
                    <div className="flex justify-between">
                      <span>Subtotal:</span>
                      <span>$ {selectedEvent.amount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-sm mt-1">
                      <span>Total:</span>
                      <span>$ {selectedEvent.amount.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Footer Stats */}
                  {/* (하단 통계) */}
                  <div className="mt-6 mb-8">
                    <p>Total # Items: {selectedEvent.items.reduce((acc, item) => acc + item.qty, 0)}</p>
                  </div>

                  {/* ID & Branding */}
                  {/* (ID 및 브랜드 표시) */}
                  <div className="text-center text-[10px] text-slate-400 pt-4 border-t border-slate-200">
                    <p className="mb-1 truncate opacity-50">ID: {selectedEvent.eventId}</p>
                    <p className="font-bold text-emerald-600/70 tracking-widest mt-2">POWERED BY JM TECH ONE</p>
                  </div>

                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-600">
              <Monitor size={48} strokeWidth={1} className="mb-4" />
              <p className="text-sm tracking-widest text-center px-4">AWAITING SELECTION<br/>(이벤트를 선택하세요)</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}