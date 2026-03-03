// PosOverlaySim — simulates an AI-powered internal fraud detection dashboard.
// Left panel: mock CCTV feed of a cashier station with scan-line overlay.
// Right panel: POS receipt simulation with a red VOID transaction alert.
// Pure CSS/Tailwind — no external video or image assets required.
// (PosOverlaySim — AI 기반 내부 사기 탐지 대시보드 시뮬레이션.
//  왼쪽 패널: 스캔라인 오버레이가 있는 캐셔 스테이션 모의 CCTV 피드.
//  오른쪽 패널: 빨간 무효 거래 경고가 있는 POS 영수증 시뮬레이션.
//  순수 CSS/Tailwind — 외부 비디오나 이미지 에셋 불필요)

'use client';

import { Monitor, AlertTriangle, ShieldAlert, Wifi, Circle } from 'lucide-react';

// ── Receipt line item type (영수증 항목 타입) ────────────────────────────────
interface ReceiptItem {
  name:   string;
  qty:    number;
  amount: string;
}

// Sample POS receipt data for the simulation (시뮬레이션용 샘플 POS 영수증 데이터)
const RECEIPT_ITEMS: ReceiptItem[] = [
  { name: 'Steak Dinner',   qty: 2, amount: '$48.00' },
  { name: 'House Wine',     qty: 1, amount: '$12.00' },
  { name: 'Dessert Combo',  qty: 1, amount: '$14.50' },
  { name: 'Coffee x2',      qty: 2, amount: '$9.00'  },
];

// Fake alert log entries shown in the fraud panel (사기 패널에 표시되는 가짜 경고 로그)
const ALERT_LOG = [
  { time: '02/27/2026 02:14 AM', msg: 'VOID detected — $57.50',   severity: 'critical' },
  { time: '02/27/2026 01:52 AM', msg: 'Cash drawer opened: no sale', severity: 'warning' },
  { time: '02/27/2026 01:30 AM', msg: 'Refund issued — $23.00',   severity: 'warning' },
  { time: '02/26/2026 11:44 PM', msg: 'System nominal',           severity: 'ok'       },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function PosOverlaySim() {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl">

      {/* ── Header bar (헤더 바) ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <ShieldAlert className="h-5 w-5 text-red-400" />
          <span className="text-sm font-bold tracking-wide text-gray-100">
            Internal Fraud Detection
          </span>
          <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-red-400 ring-1 ring-red-500/40">
            POS Overlay
          </span>
        </div>

        {/* Live connection indicator (라이브 연결 표시기) */}
        <div className="flex items-center gap-1.5">
          <Wifi className="h-3.5 w-3.5 text-green-400" />
          <span className="text-[10px] font-medium text-green-400">LIVE FEED</span>
          <Circle className="h-2 w-2 animate-pulse fill-green-400 text-green-400" />
        </div>
      </div>

      {/* ── Body: two-column layout (바디: 2열 레이아웃) ──────────────────────── */}
      <div className="flex flex-col gap-4 p-5 lg:flex-row">

        {/* ── Left: Mock CCTV feed (왼쪽: 모의 CCTV 피드) ──────────────────── */}
        <div className="flex-1">
          {/* Camera feed container (카메라 피드 컨테이너) */}
          <div className="relative overflow-hidden rounded-xl bg-gray-900" style={{ aspectRatio: '16/9' }}>

            {/* Simulated scene — dark background with floor/counter geometry
                (어두운 배경과 바닥/카운터 기하학으로 구성된 시뮬레이션 장면) */}
            <div className="absolute inset-0 bg-gradient-to-b from-gray-800 via-gray-900 to-gray-950">
              {/* Counter surface (카운터 표면) */}
              <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gray-800 opacity-70" />
              {/* Register silhouette (레지스터 실루엣) */}
              <div className="absolute bottom-1/3 left-1/2 h-16 w-24 -translate-x-1/2 rounded-t bg-gray-700 opacity-60" />
              {/* Screen glow (화면 빛) */}
              <div className="absolute bottom-1/3 left-1/2 h-10 w-20 -translate-x-1/2 -translate-y-1 rounded bg-blue-900/40" />
              {/* Cashier figure — simplified silhouette (캐셔 실루엣) */}
              <div className="absolute bottom-1/3 right-1/3 flex flex-col items-center gap-0.5">
                <div className="h-8 w-8 rounded-full bg-gray-600 opacity-70" />
                <div className="h-12 w-10 rounded-t-lg bg-gray-600 opacity-60" />
              </div>
            </div>

            {/* CRT scan-line effect overlay (CRT 스캔라인 효과 오버레이) */}
            <div
              className="pointer-events-none absolute inset-0 opacity-10"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.8) 2px, rgba(0,0,0,0.8) 4px)',
              }}
            />

            {/* Camera info overlay — top-left (카메라 정보 오버레이 — 좌상단) */}
            <div className="absolute left-3 top-3 flex items-center gap-1.5">
              <Monitor className="h-3 w-3 text-green-400" />
              <span className="font-mono text-[10px] font-bold text-green-400">
                CAM-01 | CASHIER STATION
              </span>
            </div>

            {/* Timestamp overlay — top-right (타임스탬프 오버레이 — 우상단) */}
            <div className="absolute right-3 top-3">
              <span className="font-mono text-[10px] text-gray-400">
                02/27/2026  02:14:33 AM
              </span>
            </div>

            {/* FRAUD ALERT banner — bottom (사기 경고 배너 — 하단) */}
            <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 bg-red-600/90 px-4 py-2 backdrop-blur-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 text-white" />
              <span className="text-xs font-bold uppercase tracking-widest text-white">
                FRAUD ALERT — Unauthorized VOID Detected
              </span>
              <span className="ml-auto font-mono text-xs font-semibold text-red-100">
                CONF: 97%
              </span>
            </div>
          </div>

          {/* Alert log below the feed (피드 아래 경고 로그) */}
          <div className="mt-3 rounded-xl border border-gray-800 bg-gray-900 p-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
              Alert Log
            </p>
            <ul className="space-y-1.5">
              {ALERT_LOG.map((entry, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span
                    className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                      entry.severity === 'critical' ? 'bg-red-500' :
                      entry.severity === 'warning'  ? 'bg-yellow-400' :
                      'bg-green-400'
                    }`}
                  />
                  <div className="min-w-0">
                    <span className="font-mono text-[10px] text-gray-500">
                      {entry.time}
                    </span>
                    <p className={`text-xs font-medium ${
                      entry.severity === 'critical' ? 'text-red-400' :
                      entry.severity === 'warning'  ? 'text-yellow-400' :
                      'text-green-400'
                    }`}>
                      {entry.msg}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ── Right: Simulated POS receipt (오른쪽: 시뮬레이션된 POS 영수증) ── */}
        <div className="w-full lg:w-64 xl:w-72">
          <div className="relative overflow-hidden rounded-xl border border-gray-800 bg-gray-900 p-4 font-mono text-xs">

            {/* Receipt header (영수증 헤더) */}
            <div className="mb-3 border-b border-dashed border-gray-700 pb-3 text-center">
              <p className="text-sm font-bold text-gray-100">JM BISTRO</p>
              <p className="text-gray-500">123 Main St, Suite 4</p>
              <p className="text-gray-500">02/27/2026  02:12:00 AM</p>
              <p className="mt-1 text-gray-400">CASHIER: EMP #4421</p>
              <p className="text-gray-400">TXN #: 00881-C</p>
            </div>

            {/* Line items (항목 목록) */}
            <div className="mb-3 space-y-1.5">
              {RECEIPT_ITEMS.map((item, i) => (
                <div key={i} className="flex justify-between text-gray-300">
                  <span>{item.qty}x {item.name}</span>
                  <span>{item.amount}</span>
                </div>
              ))}
            </div>

            {/* Subtotal (소계) */}
            <div className="mb-1 flex justify-between border-t border-dashed border-gray-700 pt-2 text-gray-300">
              <span>Subtotal</span>
              <span>$83.50</span>
            </div>
            <div className="mb-3 flex justify-between text-gray-400">
              <span>Tax (8%)</span>
              <span>$6.68</span>
            </div>
            <div className="mb-3 flex justify-between font-bold text-gray-100">
              <span>TOTAL</span>
              <span>$90.18</span>
            </div>

            {/* VOID overlay stripe (VOID 오버레이 줄) */}
            <div className="mb-3 rounded-lg border border-red-600 bg-red-950/60 p-3 text-center">
              <p className="text-base font-extrabold uppercase tracking-widest text-red-400">
                *** VOID TRANSACTION ***
              </p>
              <p className="mt-1 text-xl font-black text-red-500">-$57.50</p>
              <p className="mt-0.5 text-[10px] text-red-400 opacity-80">
                AUTH: NONE  |  REASON: UNSPECIFIED
              </p>
            </div>

            {/* AI detection badge (AI 탐지 배지) */}
            <div className="rounded-lg bg-red-600/20 px-3 py-2 text-center ring-1 ring-red-600/40">
              <p className="text-[10px] font-bold uppercase tracking-widest text-red-400">
                AI Anomaly Detected
              </p>
              <p className="mt-0.5 text-[10px] text-red-300">
                Unauthorized void — no manager override
              </p>
            </div>
          </div>

          {/* Threat level meter (위협 수준 미터) */}
          <div className="mt-3 rounded-xl border border-gray-800 bg-gray-900 p-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
              Threat Level
            </p>
            <div className="flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-yellow-500 to-red-600 transition-all"
                  style={{ width: '92%' }}
                />
              </div>
              <span className="text-xs font-bold text-red-400">92%</span>
            </div>
            <p className="mt-1.5 text-[10px] font-semibold text-red-400">CRITICAL — Escalate immediately</p>
          </div>
        </div>
      </div>
    </div>
  );
}
