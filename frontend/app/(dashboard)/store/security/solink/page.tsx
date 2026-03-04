"use client";

import { useState, useEffect, useMemo } from 'react';
import { 
  Search, Filter, Calendar, Clock, Camera, 
  RefreshCcw, AlertCircle, CheckCircle2, XCircle
} from 'lucide-react';

// ── Type Definitions & Data Normalization (타입 정의 및 데이터 정규화) ─────

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

  // Advanced Filter States (고급 필터 상태)
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('All');
  const [filterDate, setFilterDate] = useState(''); // Specific date (특정 날짜)
  const [filterTime, setFilterTime] = useState('All Day');

  // ── Data Fetching with Robust Mapping (데이터 가져오기 및 정밀 매핑) ─────

  const loadData = async () => {
    setLoading(true);
    try {
      // Fetching 30 days of data for better date search (날짜 검색을 위해 30일치 데이터를 가져옵니다)
      const response = await fetch("https://jm-saas-platform.onrender.com/api/solink/events?days=30");
      const result = await response.json();
      
      if (result.success && Array.isArray(result.data)) {
        // Normalize data to handle potential $0 issues (0달러 문제를 해결하기 위해 데이터를 정규화합니다)
        const normalizedData = result.data.map((item: any) => ({
          ...item,
          // Check multiple field names for amount (금액 표시를 위해 다양한 필드명을 체크합니다)
          amount: item.amount || item.totalAmount || item.total || 0,
          type: item.type || 'Sale',
          items: item.items || []
        }));
        setEvents(normalizedData);
        if (normalizedData.length > 0) setSelectedEvent(normalizedData[0]);
      }
    } catch (error) {
      console.error("Fetch failed (데이터 로드 실패):", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // ── High-Integrity Filtering Logic (무결성 필터링 로직) ───────────────────

  const filteredEvents = useMemo(() => {
    return events.filter(event => {
      // 1. Transaction Type Filter (거래 유형 필터)
      if (filterType !== 'All' && event.type !== filterType) return false;

      // 2. Exact Date Filter (정확한 날짜 필터)
      if (filterDate) {
        const eventDate = new Date(event.startTime).toISOString().split('T')[0];
        if (eventDate !== filterDate) return false;
      }

      // 3. Time Range Filter (시간대 필터)
      const hour = new Date(event.startTime).getHours();
      if (filterTime === 'Morning' && (hour < 6 || hour >= 12)) return false;
      if (filterTime === 'Afternoon' && (hour < 12 || hour >= 18)) return false;
      if (filterTime === 'Evening' && (hour < 18 && hour >= 6)) return false;

      // 4. Search Query (Register or EventID) (검색어: 단말기 또는 이벤트ID)
      if (searchQuery && !event.register.toLowerCase().includes(searchQuery.toLowerCase()) && !event.eventId.includes(searchQuery)) return false;

      return true;
    });
  }, [events, filterType, filterDate, filterTime, searchQuery]);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200">
      
      {/* ── Advanced Search & Filter Bar (고급 검색 및 필터 바) ── */}
      <div className="bg-slate-900 border-b border-slate-800 p-4 grid grid-cols-1 md:flex gap-4 items-center">
        
        {/* Date Picker Search (날짜 검색 입력) */}
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

        {/* Time Filter (시간대 필터) */}
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

        <button onClick={loadData} className="p-2 hover:bg-slate-700 rounded transition-colors">
          <RefreshCcw size={18} className={loading ? "animate-spin text-emerald-500" : "text-slate-400"} />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        
        {/* ── Left: Search Results (왼쪽: 검색 결과 리스트) ── */}
        <div className="w-[380px] border-r border-slate-800 overflow-y-auto p-4 space-y-3 bg-slate-900/50">
          <div className="flex justify-between items-center mb-4">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
              {filteredEvents.length} Events Matching
            </span>
            {filterDate && (
              <button onClick={() => setFilterDate('')} className="text-[10px] text-emerald-500 hover:underline">Clear Date</button>
            )}
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-600 gap-3">
              <RefreshCcw className="animate-spin" />
              <p className="text-sm">Fetching cloud data...</p>
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="text-center py-20 text-slate-600">No events match your filters.</div>
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
                  <span className="font-mono font-bold text-white text-lg">
                    ${Number(event.amount).toFixed(2)}
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

        {/* ── Right: Live Feed & Receipt (오른쪽: 라이브 피드 및 영수증) ── */}
        <div className="flex-1 bg-black relative flex items-center justify-center p-12">
          {/* CAM Indicator (카메라 상태 표시) */}
          <div className="absolute top-6 left-6 flex items-center gap-3 bg-black/50 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-bold tracking-widest text-white/80">CAM-01 [REGISTER] LIVE FEED</span>
          </div>

          {selectedEvent ? (
            <div className="relative z-10 w-full max-w-[320px] bg-white rounded-sm shadow-[0_30px_60px_rgba(0,0,0,0.8)] overflow-hidden font-mono text-slate-900 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {/* Receipt Visual Header (영수증 상단 디자인) */}
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
                  {selectedEvent.items?.length > 0 ? (
                    selectedEvent.items.map((item, i) => (
                      <div key={i} className="flex justify-between text-[11px]">
                        <span className="flex-1">{item.name} x{item.qty}</span>
                        <span className="font-bold">${(Number(item.price) * item.qty).toFixed(2)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-4 text-[10px] text-slate-300 italic">No items listed</div>
                  )}
                </div>

                <div className="border-t-2 border-double border-slate-200 pt-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold">TOTAL AMOUNT</span>
                    <span className="text-xl font-black">${Number(selectedEvent.amount).toFixed(2)}</span>
                  </div>
                  <div className={`mt-2 text-center py-1 rounded-sm text-[10px] font-bold ${
                    selectedEvent.type === 'Void' ? 'bg-red-50 text-red-600' : 'text-emerald-600 bg-emerald-50'
                  }`}>
                    STATUS: {selectedEvent.type.toUpperCase()}
                  </div>
                </div>

                <div className="mt-8 pt-4 border-t border-slate-50 flex flex-col items-center gap-2">
                  <div className="w-full h-8 bg-[url('https://www.scantech.com/wp-content/uploads/2021/03/barcode-1.png')] bg-repeat-x opacity-20" />
                  <span className="text-[9px] text-slate-300">REF: {selectedEvent.eventId}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-slate-700 flex flex-col items-center gap-4">
              <Monitor size={48} strokeWidth={1} />
              <p className="text-sm font-medium tracking-wide">SELECT AN EVENT TO VIEW DETAILS</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}