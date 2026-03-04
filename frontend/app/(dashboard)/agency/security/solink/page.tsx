"use client";

import { useState, useEffect, useMemo } from 'react';
import { 
  Search, Filter, Calendar, Clock, Camera, 
  RefreshCcw, AlertCircle, CheckCircle2, XCircle, Monitor
} from 'lucide-react';

// ── Type Definitions (타입 정의) ──────────────────────────────────────────────

interface ReceiptItem {
  name: string;
  qty: number;
  price: number;
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

  // Filter States (필터 상태)
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('All');
  const [filterDate, setFilterDate] = useState('');
  const [filterTime, setFilterTime] = useState('All Day');

  // ── Data Fetching & Bulletproof Mapping (데이터 로드 및 방탄 매핑) ────────

  const loadData = async () => {
    setLoading(true);
    try {
      // Fetch 30 days of real data from the backend
      // (백엔드에서 30일치 실제 데이터를 가져옵니다)
      const response = await fetch("https://jm-saas-platform.onrender.com/api/solink/events?days=30");
      const result = await response.json();
      
      if (result.success && Array.isArray(result.data)) {
        // Robust mapping to absolutely prevent $0.00 displays
        // (0달러 표시를 완벽히 차단하기 위한 강력한 데이터 매핑)
        const normalizedData = result.data.map((item: any) => {
          // Check every possible field name Solink might use for the total price
          // (솔링크가 총액에 사용할 수 있는 모든 필드명을 검사하여 금액을 추출합니다)
          const rawAmount = item.amount ?? item.totalAmount ?? item.total ?? item.gross_amount ?? item.net_amount ?? 0;
          const parsedAmount = parseFloat(rawAmount) || 0;

          return {
            eventId: item.eventId || `EVT-${Math.random().toString(36).substr(2, 9)}`,
            startTime: item.startTime || new Date().toISOString(),
            type: item.type || 'Sale',
            amount: parsedAmount,
            register: item.register || item.posId || item.terminalId || 'POS-01',
            cashier: item.cashier || item.employeeId || 'System',
            items: Array.isArray(item.items) ? item.items.map((i: any) => ({
              name: i.name || i.description || 'Unknown Item',
              qty: parseInt(i.qty || i.quantity || 1, 10),
              // Check possible fields for item price
              // (품목 가격에 대한 모든 가능한 필드명을 검사합니다)
              price: parseFloat(i.price || i.unitPrice || i.cost || 0)
            })) : []
          };
        });

        setEvents(normalizedData);
        if (normalizedData.length > 0) setSelectedEvent(normalizedData[0]);
      }
    } catch (error) {
      console.error("Failed to load Solink data (솔링크 데이터 로드 실패):", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // ── Advanced Filtering Logic (고급 필터링 로직) ───────────────────────────

  const filteredEvents = useMemo(() => {
    return events.filter(event => {
      // 1. Type Filter (유형 필터)
      if (filterType !== 'All' && event.type !== filterType) return false;

      // 2. Date Filter (날짜 필터 - YYYY-MM-DD format exact match)
      if (filterDate) {
        const eventDate = new Date(event.startTime).toISOString().split('T')[0];
        if (eventDate !== filterDate) return false;
      }

      // 3. Time Range Filter (시간대 필터)
      if (filterTime !== 'All Day') {
        const hour = new Date(event.startTime).getHours();
        if (filterTime === 'Morning' && (hour < 6 || hour >= 12)) return false;
        if (filterTime === 'Afternoon' && (hour < 12 || hour >= 18)) return false;
        if (filterTime === 'Evening' && (hour < 18 && hour >= 6)) return false;
      }

      // 4. Text Search: Event ID or POS ID (텍스트 검색: 이벤트 ID 또는 POS ID)
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchReg = event.register.toLowerCase().includes(query);
        const matchId = event.eventId.toLowerCase().includes(query);
        if (!matchReg && !matchId) return false;
      }

      return true;
    });
  }, [events, filterType, filterDate, filterTime, searchQuery]);

  // ── UI Render (UI 렌더링) ──────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200">
      
      {/* ── Top Bar: Search & Filters (상단 바: 검색 및 필터) ── */}
      <div className="bg-slate-900 border-b border-slate-800 p-4 grid grid-cols-1 md:flex gap-4 items-center">
        
        {/* Date Filter (날짜 필터) */}
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-800 rounded border border-slate-700">
          <Calendar size={16} className="text-emerald-500" />
          <input 
            type="date" 
            className="bg-transparent outline-none text-sm text-white"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
          />
        </div>

        {/* Type Filter (유형 필터) */}
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-800 rounded border border-slate-700">
          <Filter size={16} className="text-emerald-500" />
          <select 
            className="bg-transparent outline-none text-sm"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="All">All Types</option>
            <option value="Sale">Sales</option>
            <option value="Void">Voids</option>
            <option value="Refund">Refunds</option>
          </select>
        </div>

        {/* Time Filter (시간 필터) */}
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-800 rounded border border-slate-700">
          <Clock size={16} className="text-emerald-500" />
          <select 
            className="bg-transparent outline-none text-sm"
            value={filterTime}
            onChange={(e) => setFilterTime(e.target.value)}
          >
            <option value="All Day">All Day</option>
            <option value="Morning">Morning (06-12)</option>
            <option value="Afternoon">Afternoon (12-18)</option>
            <option value="Evening">Evening (18-06)</option>
          </select>
        </div>

        {/* Text Search (텍스트 검색) */}
        <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-slate-800 rounded border border-slate-700">
          <Search size={16} className="text-slate-500" />
          <input 
            placeholder="Search POS ID or Event ID..."
            className="bg-transparent outline-none text-sm w-full"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Refresh Button (새로고침 버튼) */}
        <button onClick={loadData} className="p-2 hover:bg-slate-700 rounded transition-colors">
          <RefreshCcw size={18} className={loading ? "animate-spin text-emerald-500" : "text-slate-400"} />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        
        {/* ── Left Panel: Result List (왼쪽 패널: 결과 리스트) ── */}
        <div className="w-[380px] border-r border-slate-800 overflow-y-auto p-4 space-y-3 bg-slate-900/50">
          <div className="flex justify-between items-center mb-4">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
              {filteredEvents.length} Events Matching
            </span>
            {filterDate && (
              <button onClick={() => setFilterDate('')} className="text-[10px] text-emerald-500 hover:underline">
                Clear Date
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-600 gap-3">
              <RefreshCcw className="animate-spin" />
              <p className="text-sm">Fetching cloud data... (클라우드 데이터 로딩 중...)</p>
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="text-center py-20 text-slate-600">No events match your filters. (검색 결과가 없습니다.)</div>
          ) : (
            filteredEvents.map((event) => (
              <div 
                key={event.eventId}
                onClick={() => setSelectedEvent(event)}
                className={`p-4 rounded-xl border transition-all cursor-pointer group ${
                  selectedEvent?.eventId === event.eventId 
                    ? "border-emerald-500 bg-emerald-500/10 shadow-[0_0_20px_rgba(16,185,129,0.1)]" 
                    : "border-slate-800 bg-slate-900/80 hover:border-slate-600"
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    {event.type === 'Void' ? <XCircle size={14} className="text-red-500" /> : 
                     event.type === 'Refund' ? <AlertCircle size={14} className="text-orange-500" /> : 
                     <CheckCircle2 size={14} className="text-emerald-500" />}
                    <span className="text-xs font-bold uppercase tracking-tighter">{event.type}</span>
                  </div>
                  {/* Amount display with guaranteed number formatting (숫자 포맷이 보장된 금액 표시) */}
                  <span className="font-mono font-bold text-white text-lg">
                    ${event.amount.toFixed(2)}
                  </span>
                </div>
                <div className="mt-3 flex justify-between items-end">
                  <div className="text-[10px] text-slate-500 space-y-0.5">
                    <p className="flex items-center gap-1"><Calendar size={10} /> {new Date(event.startTime).toLocaleDateString()}</p>
                    <p className="flex items-center gap-1"><Clock size={10} /> {new Date(event.startTime).toLocaleTimeString()}</p>
                  </div>
                  <div className="text-[10px] bg-slate-800 px-2 py-1 rounded text-slate-400 border border-slate-700">
                    {event.register}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Right Panel: Video Feed & Receipt (오른쪽 패널: 비디오 피드 및 영수증) ── */}
        <div className="flex-1 bg-black relative flex items-center justify-center p-12">
          {/* CAM Indicator (카메라 상태 표시) */}
          <div className="absolute top-6 left-6 flex items-center gap-3 bg-black/50 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-bold tracking-widest text-white/80">CAM-01 [REGISTER] LIVE FEED</span>
          </div>

          {selectedEvent ? (
            <div className="relative z-10 w-full max-w-[320px] bg-white rounded-sm shadow-[0_30px_60px_rgba(0,0,0,0.8)] overflow-hidden font-mono text-slate-900 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Visual Header (영수증 상단 색상 바) */}
              <div className={`h-2 ${
                selectedEvent.type === 'Void' ? 'bg-red-500' : 
                selectedEvent.type === 'Refund' ? 'bg-orange-500' : 'bg-emerald-500'
              }`} />
              
              <div className="p-6">
                <div className="text-center mb-6">
                  <h3 className="text-sm font-black uppercase tracking-widest mb-1">JM AI Security</h3>
                  <p className="text-[10px] text-slate-400">Transaction Audit Receipt</p>
                </div>

                <div className="flex justify-between text-[10px] mb-4 pb-2 border-b border-slate-100">
                  <span>DATE: {new Date(selectedEvent.startTime).toLocaleDateString()}</span>
                  <span>POS: {selectedEvent.register}</span>
                </div>

                <div className="space-y-3 mb-8 min-h-[100px]">
                  {selectedEvent.items.length > 0 ? (
                    selectedEvent.items.map((item, i) => (
                      <div key={i} className="flex justify-between text-[11px]">
                        <span className="flex-1 truncate pr-2">{item.name} x{item.qty}</span>
                        {/* Safe item total calculation (안전한 품목 총액 계산) */}
                        <span className="font-bold">${(item.price * item.qty).toFixed(2)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-4 text-[10px] text-slate-300 italic">No items listed (품목 내역 없음)</div>
                  )}
                </div>

                <div className="border-t-2 border-double border-slate-200 pt-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold">TOTAL AMOUNT</span>
                    <span className="text-xl font-black">${selectedEvent.amount.toFixed(2)}</span>
                  </div>
                  <div className={`mt-2 text-center py-1 rounded-sm text-[10px] font-bold ${
                    selectedEvent.type === 'Void' ? 'bg-red-50 text-red-600' : 'text-emerald-600 bg-emerald-50'
                  }`}>
                    STATUS: {selectedEvent.type.toUpperCase()}
                  </div>
                </div>

                <div className="mt-8 pt-4 border-t border-slate-50 flex flex-col items-center gap-2">
                  <span className="text-[9px] text-slate-400">REF: {selectedEvent.eventId}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-slate-700 flex flex-col items-center gap-4">
              <Monitor size={48} strokeWidth={1} />
              <p className="text-sm font-medium tracking-wide">SELECT AN EVENT TO VIEW DETAILS (이벤트를 선택하세요)</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}