// Agency Call History page — master-detail view of AI voice agent call logs.
// Fetches from the call_logs table via the browser Supabase client,
// filtered by the agency's currently selected store.
// (에이전시 통화 기록 페이지 — AI 음성 에이전트 통화 로그의 마스터-디테일 뷰.
//  브라우저 Supabase 클라이언트로 call_logs 테이블 조회, 선택된 매장 기준 필터링)

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search,
  Phone,
  Bot,
  User,
  Calendar,
  ChevronLeft,
  Clock,
  DollarSign,
  Mic,
  AlertCircle,
  PhoneCall,
  Volume2,
} from 'lucide-react';
import { getSupabaseClient } from '@/shared/api/supabaseClient';
import { useSessionStore }   from '@/shared/stores/sessionStore';

// ── Types ─────────────────────────────────────────────────────────────────────

// Single turn in a Retell transcript_object array (Retell transcript_object 배열의 단일 턴)
interface TranscriptTurn {
  role:    'agent' | 'user';
  content: string;
  words?:  unknown[]; // optional word-level timestamps from Retell (Retell 단어 레벨 타임스탬프 — 선택)
}

// Row shape mirroring the call_logs Supabase table columns (call_logs Supabase 테이블 컬럼 반영 행 형태)
interface CallLog {
  call_id:           string;
  agent_id:          string;
  store_id:          string;
  start_timestamp:   string;        // ISO-8601 timestamptz (ISO-8601 타임스탬프)
  duration_ms:       number | null;
  user_sentiment:    string | null; // "Positive" | "Neutral" | "Negative" | null (Retell 값)
  call_status:       string;
  cost:              number | null;
  recording_url:     string | null;
  summary:           string | null;
  transcript_object: TranscriptTurn[] | null; // JSONB array from Retell (Retell JSONB 배열)
}

// Active date preset selection (활성 날짜 프리셋 선택)
type DatePreset = 'today' | 'week' | 'month' | 'custom' | null;

// ── Pure helpers ──────────────────────────────────────────────────────────────

// Format duration from milliseconds to MM:SS display string (밀리초를 MM:SS 표시 문자열로 변환)
function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  const totalSec = Math.floor(ms / 1000);
  const mm = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const ss = (totalSec % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

// Format ISO timestamp to US locale short date + 12-hour time (ISO 타임스탬프를 미국 날짜 + 12시간 형식으로 포맷)
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month:  'short',
    day:    'numeric',
    year:   'numeric',
    hour:   'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// Format cost as a 4-decimal dollar string (비용을 소수점 4자리 달러 문자열로 포맷)
function formatCost(cost: number | null): string {
  if (cost == null) return '—';
  return `$${cost.toFixed(4)}`;
}

// Return the ISO start boundary for a given date preset (날짜 프리셋에 대한 ISO 시작 경계 반환)
function presetToIso(preset: 'today' | 'week' | 'month'): string {
  const d = new Date();
  if (preset === 'today') {
    d.setHours(0, 0, 0, 0);
  } else if (preset === 'week') {
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
  } else {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
  }
  return d.toISOString();
}

// Sentiment badge Tailwind class map (감정 배지 Tailwind 클래스 맵)
const SENTIMENT_STYLES: Record<string, string> = {
  Positive: 'bg-emerald-900/50 text-emerald-400 ring-1 ring-inset ring-emerald-700',
  Neutral:  'bg-slate-700/50   text-slate-300   ring-1 ring-inset ring-slate-600',
  Negative: 'bg-red-900/50     text-red-400     ring-1 ring-inset ring-red-700',
};

// ── Data layer ────────────────────────────────────────────────────────────────

// Fetch up to 200 call_logs for a store ordered by start_timestamp descending.
// Client-side filters are applied after fetch to avoid extra round-trips.
// (start_timestamp 내림차순으로 매장의 통화 로그 최대 200건 조회.
//  추가 왕복 방지를 위해 클라이언트에서 필터 적용)
async function fetchCallLogs(
  storeId: string,
): Promise<{ data: CallLog[] | null; error: string | null }> {
  const { data, error } = await getSupabaseClient()
    .from('call_logs')
    .select(
      'call_id, agent_id, store_id, start_timestamp, duration_ms, ' +
      'user_sentiment, call_status, cost, recording_url, summary, transcript_object',
    )
    .eq('store_id', storeId)
    .order('start_timestamp', { ascending: false })
    .limit(200);

  return {
    data:  data as CallLog[] | null,
    error: error?.message ?? null,
  };
}

// ── Presentational sub-components ─────────────────────────────────────────────

// Colored sentiment badge (색상 있는 감정 배지)
function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  const label = sentiment ?? 'Unknown';
  const cls   =
    SENTIMENT_STYLES[label] ??
    'bg-slate-700/50 text-slate-400 ring-1 ring-inset ring-slate-600';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

// Clickable row card in the master list (마스터 목록의 클릭 가능한 행 카드)
function CallCard({
  call,
  isSelected,
  onClick,
}: {
  call:       CallLog;
  isSelected: boolean;
  onClick:    () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'w-full text-left p-4 border-b border-slate-800 transition-colors',
        'hover:bg-slate-800/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500',
        isSelected ? 'bg-slate-800 border-l-2 border-l-emerald-500' : '',
      ].join(' ')}
    >
      {/* Date/time + sentiment row (날짜/시간 + 감정 행) */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-slate-400">
          {formatDateTime(call.start_timestamp)}
        </span>
        <SentimentBadge sentiment={call.user_sentiment} />
      </div>

      {/* Call ID as proxy for customer phone — schema has no phone column
          (고객 전화번호 대리 call ID — 스키마에 전화번호 컬럼 없음) */}
      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-200 mb-1.5 min-w-0">
        <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        <span className="truncate font-mono text-xs">{call.call_id}</span>
      </div>

      {/* Duration + cost row (통화 시간 + 비용 행) */}
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatDuration(call.duration_ms)}
        </span>
        <span className="flex items-center gap-1">
          <DollarSign className="h-3 w-3" />
          {formatCost(call.cost)}
        </span>
      </div>
    </button>
  );
}

// Chat bubble transcript renderer — agent left, user right.
// (채팅 버블 트랜스크립트 렌더러 — 에이전트 왼쪽, 사용자 오른쪽)
function TranscriptView({ turns }: { turns: TranscriptTurn[] }) {
  return (
    <div className="space-y-3">
      {turns.map((turn, i) => {
        const isAgent = turn.role === 'agent';
        return (
          <div
            key={i}
            className={`flex items-end gap-2 ${isAgent ? 'justify-start' : 'justify-end'}`}
          >
            {/* Agent avatar — left (에이전트 아바타 — 왼쪽) */}
            {isAgent && (
              <div className="h-7 w-7 shrink-0 rounded-full bg-emerald-900/70 flex items-center justify-center">
                <Bot className="h-4 w-4 text-emerald-400" />
              </div>
            )}

            {/* Message bubble (메시지 버블) */}
            <div
              className={[
                'max-w-[75%] rounded-2xl px-3 py-2 text-sm leading-relaxed',
                isAgent
                  ? 'bg-slate-700 text-slate-100 rounded-tl-sm'
                  : 'bg-slate-600 text-slate-100 rounded-tr-sm',
              ].join(' ')}
            >
              {turn.content}
            </div>

            {/* User avatar — right (사용자 아바타 — 오른쪽) */}
            {!isAgent && (
              <div className="h-7 w-7 shrink-0 rounded-full bg-slate-600 flex items-center justify-center">
                <User className="h-4 w-4 text-slate-300" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Detail pane — shown on the right (desktop) or full screen (mobile).
// (상세 패널 — 데스크톱 오른쪽 또는 모바일 전체 화면 표시)
function DetailView({ call, onBack }: { call: CallLog; onBack: () => void }) {
  // Parse transcript_object — handles both native JSONB array and stringified JSON.
  // (transcript_object 파싱 — 네이티브 JSONB 배열과 문자열화된 JSON 모두 처리)
  const turns = useMemo((): TranscriptTurn[] => {
    if (!call.transcript_object) return [];
    if (Array.isArray(call.transcript_object)) return call.transcript_object;
    try {
      return JSON.parse(call.transcript_object as unknown as string) as TranscriptTurn[];
    } catch {
      return [];
    }
  }, [call.transcript_object]);

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Mobile back button — hidden on lg+ (모바일 뒤로 가기 버튼 — lg 이상에서 숨김) */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 lg:hidden shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to list
        </button>
      </div>

      {/* Scrollable detail content (스크롤 가능한 상세 콘텐츠) */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── Header card — call metadata (헤더 카드 — 통화 메타데이터) */}
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
            <div className="min-w-0">
              <p className="text-xs text-slate-500 mb-0.5">Call ID</p>
              <p className="text-sm font-mono text-slate-200 break-all">{call.call_id}</p>
            </div>
            <SentimentBadge sentiment={call.user_sentiment} />
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Start Time</p>
              <p className="text-slate-200">{formatDateTime(call.start_timestamp)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Duration</p>
              <p className="text-slate-200 font-mono">{formatDuration(call.duration_ms)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Status</p>
              <p className="text-slate-200 capitalize">{call.call_status}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Cost</p>
              <p className="text-slate-200">{formatCost(call.cost)}</p>
            </div>
          </div>
        </div>

        {/* ── Audio player — streams recording directly from Retell's CDN
            (오디오 스트리밍 플레이어를 렌더링합니다) */}
        {call.recording_url && (
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Volume2 className="h-4 w-4 text-emerald-500" />
              <p className="text-sm font-medium text-slate-200">Recording</p>
            </div>
            {/* HTML5 audio player — browser streams directly from Retell URL (브라우저가 Retell URL에서 직접 스트리밍) */}
            <audio controls src={call.recording_url} className="w-full" />
          </div>
        )}

        {/* ── Summary section (요약 섹션) */}
        {call.summary && (
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Summary
            </p>
            <p className="text-sm text-slate-300 leading-relaxed">{call.summary}</p>
          </div>
        )}

        {/* ── Transcript chat UI (트랜스크립트 채팅 UI) */}
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">
            Transcript
          </p>
          {turns.length > 0 ? (
            <TranscriptView turns={turns} />
          ) : (
            <p className="text-sm text-slate-500 italic">No transcript available for this call.</p>
          )}
        </div>

      </div>
    </div>
  );
}

// ── Main page component ───────────────────────────────────────────────────────

export default function CallHistoryPage() {
  // Agency-wide selected store driven by the sidebar dropdown (사이드바 드롭다운으로 설정된 에이전시 전체 선택 매장)
  const selectedStoreId = useSessionStore((s) => s.selectedStoreId);

  // ── Data state (데이터 상태) ──────────────────────────────────────────────
  const [allLogs,    setAllLogs   ] = useState<CallLog[]>([]);
  const [loading,    setLoading   ] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── UI state (UI 상태) ────────────────────────────────────────────────────
  // Currently selected call for the detail pane (상세 패널에 표시할 선택된 통화)
  const [selected,   setSelected  ] = useState<CallLog | null>(null);
  // Mobile view toggle: false = master list, true = detail pane (모바일 뷰 토글: false = 목록, true = 상세)
  const [showDetail, setShowDetail] = useState(false);

  // ── Filter state (필터 상태) ──────────────────────────────────────────────
  const [searchQuery,     setSearchQuery    ] = useState('');
  const [datePreset,      setDatePreset     ] = useState<DatePreset>(null);
  const [customFrom,      setCustomFrom     ] = useState('');
  const [customTo,        setCustomTo       ] = useState('');
  const [sentimentFilter, setSentimentFilter] = useState('');
  const [statusFilter,    setStatusFilter   ] = useState('');

  // ── Data loading ──────────────────────────────────────────────────────────

  // Load call logs for the given store, resetting selection and errors.
  // (매장의 통화 로그 조회 — 선택 항목과 오류 초기화)
  const loadLogs = useCallback(async (storeId: string) => {
    setLoading(true);
    setFetchError(null);
    setSelected(null);
    setShowDetail(false);

    const { data, error } = await fetchCallLogs(storeId);
    setAllLogs(data ?? []);
    if (error) setFetchError(error);
    setLoading(false);
  }, []);

  // Re-fetch whenever the agency switches stores (에이전시가 매장 전환 시 재조회)
  useEffect(() => {
    if (selectedStoreId) {
      loadLogs(selectedStoreId);
    } else {
      setAllLogs([]);
      setSelected(null);
    }
  }, [selectedStoreId, loadLogs]);

  // ── Derived filter boundaries ─────────────────────────────────────────────

  // Compute ISO date range from the active preset or custom inputs.
  // (활성 프리셋 또는 커스텀 입력에서 ISO 날짜 범위 계산)
  const { filterFrom, filterTo } = useMemo(() => {
    if (datePreset === 'custom') {
      return {
        filterFrom: customFrom ? new Date(customFrom).toISOString()                    : null,
        filterTo:   customTo   ? new Date(`${customTo}T23:59:59`).toISOString() : null,
      };
    }
    // TypeScript already narrowed out 'custom' above — plain truthiness check is sufficient.
    // (위 분기에서 'custom' 제외됨 — 단순 truthy 검사로 충분)
    if (datePreset) {
      return { filterFrom: presetToIso(datePreset), filterTo: null };
    }
    return { filterFrom: null, filterTo: null };
  }, [datePreset, customFrom, customTo]);

  // Apply all active filters client-side — avoids extra Supabase round-trips.
  // (모든 활성 필터를 클라이언트에서 적용 — 추가 Supabase 왕복 방지)
  const filteredLogs = useMemo(() => {
    return allLogs.filter((c) => {
      // Search filter — matches call_id (no customer_phone column in call_logs schema)
      // (검색 필터 — call_id 기준 — call_logs 스키마에 고객 전화번호 컬럼 없음)
      if (
        searchQuery &&
        !c.call_id.toLowerCase().includes(searchQuery.toLowerCase())
      ) return false;

      // Date range filter — lower bound (날짜 범위 필터 — 하한)
      if (filterFrom && new Date(c.start_timestamp) < new Date(filterFrom)) return false;

      // Date range filter — upper bound (날짜 범위 필터 — 상한)
      if (filterTo && new Date(c.start_timestamp) > new Date(filterTo)) return false;

      // Sentiment filter — exact match against Retell sentiment string (감정 필터 — Retell 감정 문자열 정확 일치)
      if (sentimentFilter && c.user_sentiment !== sentimentFilter) return false;

      // Status filter — exact match against call_status value (상태 필터 — call_status 값 정확 일치)
      if (statusFilter && c.call_status !== statusFilter) return false;

      return true;
    });
  }, [allLogs, searchQuery, filterFrom, filterTo, sentimentFilter, statusFilter]);

  // Derive unique status values from loaded data for the dropdown options.
  // (드롭다운 옵션을 위해 로드된 데이터에서 고유 상태 값 추출)
  const uniqueStatuses = useMemo(
    () => [...new Set(allLogs.map((c) => c.call_status).filter(Boolean))],
    [allLogs],
  );

  // ── Event handlers ────────────────────────────────────────────────────────

  // Select a call and switch to detail view on mobile (통화 선택 및 모바일에서 상세 뷰로 전환)
  function handleSelect(call: CallLog) {
    setSelected(call);
    setShowDetail(true);
  }

  // Navigate back to the list on mobile (모바일에서 목록으로 돌아가기)
  function handleBack() {
    setShowDetail(false);
  }

  // Toggle date preset — clicking the active preset deactivates it (날짜 프리셋 토글 — 활성 프리셋 클릭 시 비활성화)
  function togglePreset(preset: 'today' | 'week' | 'month') {
    setDatePreset((prev) => (prev === preset ? null : preset));
    setCustomFrom('');
    setCustomTo('');
  }

  // Toggle custom date range panel (커스텀 날짜 범위 패널 토글)
  function toggleCustom() {
    setDatePreset((prev) => (prev === 'custom' ? null : 'custom'));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    // Full-height flex column — the dashboard shell provides the outer scroll context.
    // (전체 높이 플렉스 컬럼 — 대시보드 쉘이 외부 스크롤 컨텍스트 제공)
    <div className="flex flex-col h-full min-h-0">

      {/* Page heading (페이지 제목) */}
      <div className="px-1 pb-4 shrink-0">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100">Call History</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Review AI voice agent call logs, recordings, and transcripts for the selected store.
        </p>
      </div>

      {/* ── Empty state — no store selected (빈 상태 — 매장 미선택) */}
      {!selectedStoreId && (
        <div className="flex flex-col items-center justify-center flex-1 py-20 text-center">
          <Mic className="mb-3 h-8 w-8 text-slate-700" />
          <p className="text-sm font-medium text-slate-500">
            Select a store from the sidebar to view call history.
          </p>
        </div>
      )}

      {selectedStoreId && (
        <div className="flex flex-col flex-1 min-h-0 rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">

          {/* ── Filter bar (필터 바) ─────────────────────────────────────── */}
          <div className="shrink-0 p-3 border-b border-slate-800 space-y-2 bg-slate-900">

            {/* Row 1 — search + sentiment dropdown + status dropdown
                (첫 번째 행 — 검색 + 감정 드롭다운 + 상태 드롭다운) */}
            <div className="flex flex-wrap gap-2">

              {/* Search input (검색 입력) */}
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search by call ID / phone…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {/* Sentiment dropdown (감정 드롭다운) */}
              <select
                value={sentimentFilter}
                onChange={(e) => setSentimentFilter(e.target.value)}
                className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">All Sentiments</option>
                <option value="Positive">Positive</option>
                <option value="Neutral">Neutral</option>
                <option value="Negative">Negative</option>
              </select>

              {/* Status dropdown — options populated from live data (상태 드롭다운 — 실시간 데이터로 옵션 채움) */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">All Statuses</option>
                {uniqueStatuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* Row 2 — date preset buttons + optional custom range inputs
                (두 번째 행 — 날짜 프리셋 버튼 + 선택적 커스텀 범위 입력) */}
            <div className="flex flex-wrap items-center gap-2">
              <Calendar className="h-4 w-4 text-slate-400 shrink-0" />

              {/* Preset pills (프리셋 알약 버튼) */}
              {(['today', 'week', 'month'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => togglePreset(p)}
                  className={[
                    'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                    datePreset === p
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-emerald-700 hover:text-emerald-400',
                  ].join(' ')}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}

              {/* Custom range toggle (커스텀 범위 토글) */}
              <button
                onClick={toggleCustom}
                className={[
                  'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                  datePreset === 'custom'
                    ? 'bg-emerald-600 border-emerald-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-emerald-700 hover:text-emerald-400',
                ].join(' ')}
              >
                Custom
              </button>

              {/* Custom date pickers — visible only when custom preset is active
                  (커스텀 날짜 선택기 — 커스텀 프리셋 활성 시에만 표시) */}
              {datePreset === 'custom' && (
                <>
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <span className="text-xs text-slate-500">to</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </>
              )}

              {/* Live result count (실시간 결과 수) */}
              <span className="ml-auto text-xs text-slate-500 shrink-0">
                {filteredLogs.length}{' '}
                {filteredLogs.length === 1 ? 'call' : 'calls'}
              </span>
            </div>
          </div>

          {/* ── Loading spinner (로딩 스피너) */}
          {loading && (
            <div className="flex items-center justify-center flex-1 py-16">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
            </div>
          )}

          {/* ── Fetch error banner (조회 오류 배너) */}
          {!loading && fetchError && (
            <div className="mx-4 mt-4 flex items-center gap-2 rounded-lg bg-red-900/20 border border-red-800 px-4 py-3 text-sm text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {fetchError}
            </div>
          )}

          {/* ── Master-Detail split layout (마스터-디테일 분할 레이아웃) */}
          {!loading && !fetchError && (
            <div className="flex flex-1 min-h-0 overflow-hidden">

              {/* MASTER — scrollable call list
                  Desktop: always visible at 40% width.
                  Mobile: hidden when detail pane is open.
                  (마스터 — 스크롤 가능한 통화 목록
                   데스크톱: 항상 40% 너비로 표시.
                   모바일: 상세 패널이 열리면 숨김) */}
              <div
                className={[
                  'flex flex-col border-r border-slate-800 overflow-hidden',
                  'w-full lg:w-[40%]',
                  showDetail ? 'hidden lg:flex' : 'flex',
                ].join(' ')}
              >
                {filteredLogs.length === 0 ? (
                  // Empty state when filters produce no matches (필터 일치 결과 없을 때 빈 상태)
                  <div className="flex flex-col items-center justify-center flex-1 py-16 text-center px-4">
                    <PhoneCall className="mb-3 h-7 w-7 text-slate-700" />
                    <p className="text-sm text-slate-500">
                      No calls match the current filters.
                    </p>
                  </div>
                ) : (
                  // Scrollable list of call cards (스크롤 가능한 통화 카드 목록)
                  <div className="flex-1 overflow-y-auto">
                    {filteredLogs.map((call) => (
                      <CallCard
                        key={call.call_id}
                        call={call}
                        isSelected={selected?.call_id === call.call_id}
                        onClick={() => handleSelect(call)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* DETAIL — right pane
                  Desktop: always visible at 60% width.
                  Mobile: full width, only visible when showDetail is true.
                  (디테일 — 오른쪽 패널
                   데스크톱: 항상 60% 너비로 표시.
                   모바일: 전체 너비, showDetail이 true일 때만 표시) */}
              <div
                className={[
                  'flex flex-col overflow-hidden bg-slate-950',
                  'w-full lg:w-[60%]',
                  showDetail ? 'flex' : 'hidden lg:flex',
                ].join(' ')}
              >
                {selected ? (
                  // Render the selected call's detail view (선택된 통화의 상세 뷰 렌더링)
                  <DetailView call={selected} onBack={handleBack} />
                ) : (
                  // Desktop prompt — no call selected yet (데스크톱 안내 — 아직 통화 미선택)
                  <div className="flex flex-col items-center justify-center flex-1 text-center px-4">
                    <PhoneCall className="mb-3 h-8 w-8 text-slate-700" />
                    <p className="text-sm text-slate-500">
                      Select a call from the list to view details.
                    </p>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      )}
    </div>
  );
}
