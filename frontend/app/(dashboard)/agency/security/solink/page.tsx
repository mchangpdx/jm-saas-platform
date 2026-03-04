"use client";

import { useState, useEffect, useMemo } from 'react';
import { 
  ShoppingCart, AlertTriangle, RotateCcw, ChevronDown, 
  Camera, Clock, Monitor, Filter, Calendar 
} from 'lucide-react';

// ── Type Definitions (타입 정의) ──────────────────────────────────────────────

// Individual line item on a receipt (영수증 개별 품목)
interface ReceiptItem {
  name: string;
  qty: number;
  price: number;
}

// A single Solink POS transaction event (단일 Solink POS 거래 이벤트)
interface SolinkEvent {
  eventId: string;
  startTime: string;                  // ISO 8601 timestamp (ISO 8601 타임스탬프)
  type: 'Sale' | 'Void' | 'Refund';
  amount: number;
  register: string;                   // POS terminal identifier (POS 단말기 식별자)
  cashier: string;
  items: ReceiptItem[];
}

export default function SolinkRealTimePage() {
  // ── State Management (상태 관리) ───────────────────────────────────────────

  const [events, setEvents] = useState<SolinkEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedEvent, setSelectedEvent] = useState<SolinkEvent | null>(null);

  // Filter States (필터 상태)
  const [filterType, setFilterType] = useState<string>('All');
  const [filterDate, setFilterDate] = useState<string>('Today');
  const [filterTime, setFilterTime] = useState<string>('All Day');

  // ── Data Fetching (데이터 가져오기) ────────────────────────────────────────

  useEffect(() => {
    // Fetch real data from the Render proxy backend
    // (Render 프록시 백엔드에서 실제 데이터를 가져옵니다)
    async function loadRealData() {
      setLoading(true);
      try {
        const response = await fetch("https://jm-saas-platform.onrender.com/api/solink/events?days=7");
        const result = await response.json();
        
        if (result.success) {
          setEvents(result.data);
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

  // ── Real-time Search & Filtering Logic (실시간 검색 및 필터링 로직) ───────────

  const filteredEvents = useMemo(() => {
    // Apply filters directly to the fetched data
    // (가져온 데이터에 필터를 즉시 적용합니다)
    return events.filter(event => {
      // 1. Filter by Type (유형별 필터링)
      if (filterType !== 'All' && event.type !== filterType) return false;

      // 2. Filter by Time (시간대별 필터링)
      const hour = new Date(event.startTime).getHours();
      if (filterTime === 'Morning' && (hour < 6 || hour >= 12)) return false;
      if (filterTime === 'Afternoon' && (hour < 12 || hour >= 18)) return false;
      if (filterTime === 'Evening' && (hour < 18 && hour >= 6)) return false;

      return true;
    });
  }, [events, filterType, filterTime]);

  // ── UI Components (UI 컴포넌트) ─────────────────────────────────────────────

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
          {filteredEvents.length} Events Found (검색됨)
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        
        {/* Left: Event List (왼쪽: 이벤트 리스트) */}
        <div className="w-[350px] border-r border-slate-800 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="text-center py-10 animate-pulse text-slate-500">Connecting to Solink...</div>
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
                  <span className="font-bold text-white">${event.amount.toFixed(2)}</span>
                </div>
                <div className="mt-2 text-xs text-slate-400 flex justify-between">
                  <span>{new Date(event.startTime).toLocaleTimeString()}</span>
                  <span>{event.register}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Right: Video & Receipt Overlay (오른쪽: 비디오 및 영수증 오버레이) */}
        <div className="flex-1 bg-black relative flex items-center justify-center">
          {/* Background indicating camera feed placeholder (카메라 피드 자리표시 배경) */}
          <div className="absolute top-4 left-4 flex items-center gap-2 text-slate-500 text-xs">
            <Camera size={14} /> [CAM-01] REGISTER ZONE - LIVE
          </div>

          {selectedEvent && (
            <div className="relative z-10 w-[300px] bg-white rounded shadow-2xl overflow-hidden font-mono text-slate-900 scale-90 sm:scale-100">
              {/* Receipt Header (영수증 헤더) */}
              <div className={`p-3 text-center text-white ${
                selectedEvent.type === 'Void' ? 'bg-red-600' : 
                selectedEvent.type === 'Refund' ? 'bg-orange-600' : 'bg-emerald-600'
              }`}>
                <div className="text-xs font-bold uppercase">★ {selectedEvent.type} COMPLETE ★</div>
                <div className="text-[10px] opacity-80">JM AI Guard & POS</div>
              </div>

              {/* Receipt Content (영수증 내용) */}
              <div className="p-4 text-[11px] leading-tight space-y-2">
                <div className="flex justify-between border-b border-dashed pb-1 mb-2 opacity-60">
                  <span>{new Date(selectedEvent.startTime).toLocaleDateString()}</span>
                  <span>{selectedEvent.register}</span>
                </div>

                <div className="space-y-1">
                  {selectedEvent.items.map((item, i) => (
                    <div key={i} className="flex justify-between">
                      <span className="truncate w-32">{item.name} x{item.qty}</span>
                      <span>${(item.price * item.qty).toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                <div className="border-t pt-2 mt-4 space-y-1 font-bold text-sm">
                  <div className="flex justify-between">
                    <span>TOTAL:</span>
                    <span>${selectedEvent.amount.toFixed(2)}</span>
                  </div>
                </div>

                <div className="text-[9px] text-center mt-6 opacity-40">
                  ID: {selectedEvent.eventId}<br/>
                  Powered by JM AI Platform
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}