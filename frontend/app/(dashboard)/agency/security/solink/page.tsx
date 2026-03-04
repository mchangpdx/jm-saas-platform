"use client";

import { useState, useEffect, useMemo } from 'react';
import { 
  ShoppingCart, AlertTriangle, RotateCcw, ChevronDown, 
  Camera, Clock, Monitor, Filter, Calendar 
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
  type: 'Sale' | 'Void' | 'Refund';
  amount: number;
  register: string;
  cashier: string;
  items: ReceiptItem[];
}

export default function SolinkRealTimePage() {
  // ── State Management (상태 관리) ───────────────────────────────────────────

  const [events, setEvents] = useState<SolinkEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedEvent, setSelectedEvent] = useState<SolinkEvent | null>(null);

  const [filterType, setFilterType] = useState<string>('All');
  const [filterTime, setFilterTime] = useState<string>('All Day');

  // ── Data Fetching (데이터 가져오기) ────────────────────────────────────────

  useEffect(() => {
    // Fetch real data from the backend proxy
    // (백엔드 프록시에서 실제 데이터를 가져옵니다)
    async function loadRealData() {
      setLoading(true);
      try {
        const response = await fetch("https://jm-saas-platform.onrender.com/api/solink/events?days=7");
        const result = await response.json();
        
        if (result.success && Array.isArray(result.data)) {
          setEvents(result.data);
          // Set initial selected event safely (초기 선택 이벤트를 안전하게 설정)
          if (result.data.length > 0) setSelectedEvent(result.data[0]);
        }
      } catch (error) {
        console.error("API Error (API 오류):", error);
      } finally {
        setLoading(false);
      }
    }
    loadRealData();
  }, []);

  // ── Filtering Logic (필터링 로직) ──────────────────────────────────────────

  const filteredEvents = useMemo(() => {
    return events.filter(event => {
      if (filterType !== 'All' && event.type !== filterType) return false;

      const hour = new Date(event.startTime).getHours();
      if (filterTime === 'Morning' && (hour < 6 || hour >= 12)) return false;
      if (filterTime === 'Afternoon' && (hour < 12 || hour >= 18)) return false;
      if (filterTime === 'Evening' && (hour < 18 && hour >= 6)) return false;

      return true;
    });
  }, [events, filterType, filterTime]);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200 font-sans">
      
      {/* Top Filter Bar (상단 필터 바) */}
      <div className="bg-slate-900 border-b border-slate-800 p-4 flex gap-4 items-center shadow-lg">
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

        <span className="text-xs text-slate-500 ml-auto">
          {filteredEvents.length} Events Found
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        
        {/* Left: Event List (왼쪽: 이벤트 리스트) */}
        <div className="w-[350px] border-r border-slate-800 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="text-center py-10 animate-pulse text-slate-500">Syncing with Solink Cloud...</div>
          ) : (
            filteredEvents.map((event) => (
              <div 
                key={event.eventId}
                onClick={() => setSelectedEvent(event)}
                className={`p-4 rounded-lg border transition-all cursor-pointer ${
                  selectedEvent?.eventId === event.eventId 
                    ? "border-emerald-500 bg-emerald-500/10 shadow-[0_0_15px_rgba(16,185,129,0.2)]" 
                    : "border-slate-800 bg-slate-900 hover:border-slate-600"
                }`}
              >
                <div className="flex justify-between items-start">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                    event.type === 'Void' ? 'bg-red-500/20 text-red-400' : 
                    event.type === 'Refund' ? 'bg-orange-500/20 text-orange-400' : 'bg-emerald-500/20 text-emerald-400'
                  }`}>
                    {event.type}
                  </span>
                  {/* Defense: Amount default to 0 (금액 기본값을 0으로 설정하여 에러 방지) */}
                  <span className="font-bold text-white">${(event.amount ?? 0).toFixed(2)}</span>
                </div>
                <div className="mt-2 text-xs text-slate-400 flex justify-between">
                  <span>{new Date(event.startTime).toLocaleTimeString()}</span>
                  <span>{event.register ?? 'POS-01'}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Right: Video Feed & Overlay (오른쪽: 비디오 피드 및 오버레이) */}
        <div className="flex-1 bg-black relative flex items-center justify-center">
          <div className="absolute top-4 left-4 flex items-center gap-2 text-slate-500 text-xs">
            <Camera size={14} /> [CAM-01] CASHIER OVERLAY - LIVE
          </div>

          {selectedEvent && (
            <div className="relative z-10 w-[300px] bg-white rounded shadow-2xl overflow-hidden font-mono text-slate-900 scale-90 sm:scale-100 animate-in fade-in zoom-in duration-300">
              {/* Receipt Header (영수증 헤더) */}
              <div className={`p-3 text-center text-white ${
                selectedEvent.type === 'Void' ? 'bg-red-600' : 
                selectedEvent.type === 'Refund' ? 'bg-orange-600' : 'bg-emerald-600'
              }`}>
                <div className="text-xs font-bold uppercase">★ {selectedEvent.type} COMPLETE ★</div>
                <div className="text-[10px] opacity-80">JM AI Guard System</div>
              </div>

              {/* Receipt Detail (영수증 상세) */}
              <div className="p-4 text-[11px] leading-tight space-y-2">
                <div className="flex justify-between border-b border-dashed pb-1 mb-2 opacity-60 text-[9px]">
                  <span>{new Date(selectedEvent.startTime).toLocaleString()}</span>
                  <span>{selectedEvent.register ?? 'POS-01'}</span>
                </div>

                <div className="space-y-1 min-h-[80px]">
                  {selectedEvent.items?.map((item, i) => (
                    <div key={i} className="flex justify-between">
                      <span className="truncate w-32">{item.name || 'Unknown Item'} x{item.qty ?? 1}</span>
                      {/* Defense: Item price safety (품목 가격 안전 처리) */}
                      <span>${((item.price ?? 0) * (item.qty ?? 1)).toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                <div className="border-t pt-2 mt-4 space-y-1 font-bold text-sm">
                  <div className="flex justify-between">
                    <span>TOTAL:</span>
                    {/* Defense: selectedEvent amount safety (선택된 이벤트 금액 안전 처리) */}
                    <span>${(selectedEvent.amount ?? 0).toFixed(2)}</span>
                  </div>
                </div>

                <div className="text-[9px] text-center mt-6 opacity-40">
                  REF: {selectedEvent.eventId}<br/>
                  JM TECH ONE PLATFORM
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}