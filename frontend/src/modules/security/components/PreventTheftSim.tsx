// PreventTheftSim — simulates an AI Vision-powered external theft prevention system.
// Main panel: mock AI camera feed with a red bounding box tracking a suspected shoplifter.
// Right panel: alert history, confidence score, and threat classification indicators.
// Pure CSS/Tailwind — no external video or image assets required.
// (PreventTheftSim — AI 비전 기반 외부 절도 방지 시스템 시뮬레이션.
//  메인 패널: 절도 용의자를 추적하는 빨간 경계 박스가 있는 모의 AI 카메라 피드.
//  오른쪽 패널: 경고 기록, 신뢰도 점수, 위협 분류 표시기.
//  순수 CSS/Tailwind — 외부 비디오나 이미지 에셋 불필요)

'use client';

import { Eye, ShieldAlert, Wifi, Circle, AlertTriangle, UserX } from 'lucide-react';

// Fake alert timeline entries for the theft simulation (절도 시뮬레이션 타임라인 경고)
const THREAT_LOG = [
  { time: '02/27/2026  02:17:04 AM', event: 'THEFT DETECTED — Zone B3',     severity: 'critical' },
  { time: '02/27/2026  02:16:51 AM', event: 'Suspect entered blind spot',    severity: 'warning'  },
  { time: '02/27/2026  02:16:40 AM', event: 'Unusual dwell time — Shelf B3', severity: 'warning'  },
  { time: '02/27/2026  02:16:25 AM', event: 'Subject detected — CAM-07',     severity: 'info'     },
  { time: '02/27/2026  02:15:50 AM', event: 'System nominal',                severity: 'ok'       },
];

// AI classification tags shown as chips (AI 분류 태그 칩으로 표시)
const CLASSIFICATION_TAGS = [
  { label: 'Concealment', active: true  },
  { label: 'Repeat Visit', active: true  },
  { label: 'Suspicious Gait', active: true  },
  { label: 'Bag Switch',  active: false },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function PreventTheftSim() {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl">

      {/* ── Header bar (헤더 바) ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-5 py-3">
        <div className="flex items-center gap-2.5">
          <Eye className="h-5 w-5 text-orange-400" />
          <span className="text-sm font-bold tracking-wide text-gray-100">
            Theft Prevention
          </span>
          <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-orange-400 ring-1 ring-orange-500/40">
            AI Vision
          </span>
        </div>

        {/* Live connection indicator (라이브 연결 표시기) */}
        <div className="flex items-center gap-1.5">
          <Wifi className="h-3.5 w-3.5 text-green-400" />
          <span className="text-[10px] font-medium text-green-400">TRACKING ACTIVE</span>
          <Circle className="h-2 w-2 animate-pulse fill-red-500 text-red-500" />
        </div>
      </div>

      {/* ── Body: two-column layout (바디: 2열 레이아웃) ──────────────────────── */}
      <div className="flex flex-col gap-4 p-5 lg:flex-row">

        {/* ── Left: AI Vision feed with bounding box (왼쪽: 경계 박스가 있는 AI 비전 피드) */}
        <div className="flex-1">
          {/* Camera feed container (카메라 피드 컨테이너) */}
          <div
            className="relative overflow-hidden rounded-xl bg-gray-900"
            style={{ aspectRatio: '16/9' }}
          >
            {/* Simulated store interior — shelving aisle scene
                (진열대 통로 장면 시뮬레이션된 매장 내부) */}
            <div className="absolute inset-0 bg-gradient-to-b from-gray-800 to-gray-950">
              {/* Floor (바닥) */}
              <div className="absolute bottom-0 left-0 right-0 h-1/4 bg-gray-800 opacity-60" />
              {/* Left shelf (왼쪽 선반) */}
              <div className="absolute bottom-1/4 left-4 top-8 w-14 rounded bg-gray-700 opacity-50" />
              <div className="absolute bottom-1/4 left-4 top-16 w-14 space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-4 rounded bg-gray-600 opacity-70" />
                ))}
              </div>
              {/* Right shelf (오른쪽 선반) */}
              <div className="absolute bottom-1/4 right-4 top-8 w-14 rounded bg-gray-700 opacity-50" />
              <div className="absolute bottom-1/4 right-4 top-16 w-14 space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-4 rounded bg-gray-600 opacity-70" />
                ))}
              </div>
              {/* Center aisle perspective lines (중앙 통로 원근 선) */}
              <div className="absolute inset-x-0 bottom-1/4 top-1/4 flex justify-center">
                <div className="h-full w-px bg-gray-700 opacity-30" />
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

            {/* Suspect silhouette (용의자 실루엣) */}
            <div className="absolute bottom-1/4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-0.5">
              <div className="h-10 w-10 rounded-full bg-gray-500 opacity-70" />
              <div className="h-14 w-12 rounded-t-lg bg-gray-500 opacity-60" />
            </div>

            {/* Red AI bounding box (빨간 AI 경계 박스) */}
            <div
              className="absolute animate-pulse"
              style={{
                left:   'calc(50% - 48px)',
                top:    'calc(25% - 4px)',
                width:  '96px',
                height: '148px',
              }}
            >
              {/* Box border using corner brackets for authenticity (진정성을 위한 코너 브래킷 박스 테두리) */}
              <div className="absolute inset-0 rounded border-2 border-red-500/80" />
              {/* Corner decorations (코너 장식) */}
              <div className="absolute -left-0.5 -top-0.5 h-3 w-3 border-l-2 border-t-2 border-red-400" />
              <div className="absolute -right-0.5 -top-0.5 h-3 w-3 border-r-2 border-t-2 border-red-400" />
              <div className="absolute -bottom-0.5 -left-0.5 h-3 w-3 border-b-2 border-l-2 border-red-400" />
              <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 border-b-2 border-r-2 border-red-400" />

              {/* Confidence label above box (박스 위 신뢰도 레이블) */}
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-red-600 px-1.5 py-0.5">
                <span className="font-mono text-[9px] font-bold text-white">SUSPECT  CONF: 98%</span>
              </div>
            </div>

            {/* Camera info overlay — top-left (카메라 정보 오버레이 — 좌상단) */}
            <div className="absolute left-3 top-3 flex items-center gap-1.5">
              <Eye className="h-3 w-3 text-orange-400" />
              <span className="font-mono text-[10px] font-bold text-orange-400">
                CAM-07 | AISLE B3
              </span>
            </div>

            {/* Timestamp — top-right (타임스탬프 — 우상단) */}
            <div className="absolute right-3 top-3">
              <span className="font-mono text-[10px] text-gray-400">
                02/27/2026  02:17:04 AM
              </span>
            </div>

            {/* DANGER banner (위험 배너) */}
            <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 bg-red-700/90 px-4 py-2 backdrop-blur-sm">
              <UserX className="h-4 w-4 shrink-0 text-white" />
              <span className="text-xs font-extrabold uppercase tracking-widest text-white">
                DANGER: THEFT DETECTED | CONF: 98%
              </span>
              <span className="ml-auto rounded bg-white/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                ZONE B3
              </span>
            </div>
          </div>

          {/* AI classification tags below feed (피드 아래 AI 분류 태그) */}
          <div className="mt-3 rounded-xl border border-gray-800 bg-gray-900 p-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
              AI Behavior Analysis
            </p>
            <div className="flex flex-wrap gap-1.5">
              {CLASSIFICATION_TAGS.map((tag) => (
                <span
                  key={tag.label}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ring-1 ${
                    tag.active
                      ? 'bg-red-500/20 text-red-400 ring-red-500/40'
                      : 'bg-gray-800 text-gray-500 ring-gray-700'
                  }`}
                >
                  {tag.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: Alert log + threat meter (오른쪽: 경고 로그 + 위협 미터) ── */}
        <div className="w-full lg:w-64 xl:w-72 space-y-3">

          {/* Confidence score card (신뢰도 점수 카드) */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
              Detection Confidence
            </p>
            <p className="mt-1 text-4xl font-black text-red-400">98%</p>
            <p className="mt-0.5 text-xs font-semibold text-red-300">HIGH CERTAINTY</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-orange-500 to-red-600"
                style={{ width: '98%' }}
              />
            </div>
          </div>

          {/* Threat log panel (위협 로그 패널) */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
              Threat Log
            </p>
            <ul className="space-y-2">
              {THREAT_LOG.map((entry, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span
                    className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                      entry.severity === 'critical' ? 'bg-red-500' :
                      entry.severity === 'warning'  ? 'bg-orange-400' :
                      entry.severity === 'info'     ? 'bg-blue-400' :
                      'bg-green-400'
                    }`}
                  />
                  <div className="min-w-0">
                    <span className="font-mono text-[9px] text-gray-500 block">{entry.time}</span>
                    <p className={`text-[11px] font-medium leading-tight ${
                      entry.severity === 'critical' ? 'text-red-400' :
                      entry.severity === 'warning'  ? 'text-orange-400' :
                      entry.severity === 'info'     ? 'text-blue-400' :
                      'text-green-400'
                    }`}>
                      {entry.event}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Recommended action card (권장 조치 카드) */}
          <div className="rounded-xl border border-orange-900/40 bg-orange-950/20 p-3">
            <div className="mb-1.5 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />
              <p className="text-[10px] font-bold uppercase tracking-wider text-orange-400">
                Recommended Action
              </p>
            </div>
            <p className="text-xs text-orange-300">
              Dispatch floor security to Aisle B3 immediately. Suspect matches prior incident profile.
            </p>
          </div>

          {/* System status (시스템 상태) */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">
              System Status
            </p>
            {[
              { label: 'AI Vision',      status: 'Active',   ok: true  },
              { label: 'Facial Recog.',  status: 'Scanning', ok: true  },
              { label: 'Alert Relay',    status: 'Sent',     ok: true  },
              { label: 'POS Lock',       status: 'Standby',  ok: false },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between py-0.5">
                <span className="text-[11px] text-gray-400">{row.label}</span>
                <span className={`text-[10px] font-semibold ${row.ok ? 'text-green-400' : 'text-gray-500'}`}>
                  {row.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
