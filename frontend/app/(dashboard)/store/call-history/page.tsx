// Store Call History page — master-detail view of AI voice agent call logs for a single store.
// Fetches from the call_logs table via the browser Supabase client,
// filtered by the store's own storeId from session context.
// (매장 통화 기록 페이지 — 단일 매장의 AI 음성 에이전트 통화 로그 마스터-디테일 뷰.
//  세션 컨텍스트의 storeId 기준으로 call_logs 테이블 조회)

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

// Single turn in a Retell transcript array (Retell 트랜스크립트 배열의 단일 턴)
interface TranscriptTurn {
  role:    'agent' | 'user';
  content: string;
  words?:  unknown[]; // optional word-level timestamps from Retell (Retell 단어 레벨 타임스탬프 — 선택)
}

// Row shape mirroring the exact call_logs Postgres column names — every field must match the DB exactly.
// (정확한 call_logs Postgres 컬럼명을 반영한 행 형태 — 모든 필드가 DB와 정확히 일치해야 함)
interface CallLog {
  call_id:        string;
  agent_id:       string;
  store_id:       string;
  start_time:     string;               // ISO-8601 timestamptz DB column (ISO-8601 타임스탬프 DB 컬럼)
  customer_phone: string | null;        // Retell from_number mapped to this column (Retell from_number이 이 컬럼에 매핑)
  duration:       number | null;        // Integer seconds — NOT milliseconds (정수 초 — 밀리초 아님)
  sentiment:      string | null;        // DB column 'sentiment', NOT 'user_sentiment' (DB 컬럼 'sentiment' — 'user_sentiment' 아님)
  call_status:    string;
  cost:           number | null;
  recording_url:  string | null;
  summary:        string | null;
  transcript:     TranscriptTurn[] | null; // DB column 'transcript', NOT 'transcript_object' (DB 컬럼 'transcript' — 'transcript_object' 아님)
}

// Active date preset selection (활성 날짜 프리셋 선택)
type DatePreset = 'today' | 'week' | 'month' | 'custom' | null;

// ── Pure helpers ──────────────────────────────────────────────────────────────

// Format duration from integer seconds to MM:SS display string.
// The DB stores seconds directly — no ms→s conversion needed here.
// (정수 초를 MM:SS 표시 문자열로 변환.
//  DB는 초를 직접 저장하므로 여기서 ms→s 변환 불필요)
function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
  const ss = (seconds % 60).toString().padStart(2, '0');
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

// Fetch up to 200 call_logs for a store ordered by start_time descending.
// Column names in select() must match exact Postgres column names — any mismatch causes a schema cache error.
// (start_time 내림차순으로 매장의 통화 로그 최대 200건 조회.
//  select()의 컬럼명은 정확한 Postgres 컬럼명과 일치해야 함 — 불일치 시 스키마 캐시 오류 발생)
async function fetchCallLogs(
  storeId: string,
): Promise<{ data: CallLog[] | null; error: string | null }> {
  const { data, error } = await getSupabaseClient()
    .from('call_logs')
    .select(
      // Fetch using exact DB column names (정확한 DB 컬럼명을 사용하여 통화 기록을 가져옵니다)
      'call_id, agent_id, store_id, start_time, customer_phone, duration, ' +
      'sentiment, call_status, cost, recording_url, summary, transcript',
    )
    .eq('store_id', storeId)
    .order('start_time', { ascending: false })
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
          {formatDateTime(call.start_time)}
        </span>
        {/* Use DB column 'sentiment', not 'user_sentiment' (DB 컬럼 'sentiment' 사용 — 'user_sentiment' 아님) */}
        <SentimentBadge sentiment={call.sentiment} />
      </div>

      {/* Customer phone from the 'customer_phone' DB column (DB 컬럼 'customer_phone'의 고객 전화번호) */}
      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-200 mb-1.5 min-w-0">
        <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        <span className="truncate text-xs">{call.customer_phone ?? call.call_id}</span>
      </div>

      {/* Duration + cost row (통화 시간 + 비용 행) */}
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatDuration(call.duration)}
        </span>
        <span className="flex items-center gap-1">
          <DollarSign className="h-3 w-3" />
          {formatCost(call.cost)}
        </span>
      </div>
    </button>
  );
}

// Render stylish chat bubbles for User and Agent (사용자와 에이전트를 위한 세련된 채팅 말풍선을 렌더링합니다)
// Agent messages align left with an emerald glassmorphism style.
// User messages align right with a blue glassmorphism style for clear visual distinction.
// (에이전트 메시지는 에메랄드 글래스모피즘 스타일로 왼쪽 정렬.
//  사용자 메시지는 명확한 시각적 구분을 위해 파란색 글래스모피즘 스타일로 오른쪽 정렬)
function TranscriptView({ turns }: { turns: TranscriptTurn[] }) {
  return (
    <div className="space-y-4">
      {turns.map((turn, i) => {
        const isAgent = turn.role === 'agent';
        return (
          <div
            key={i}
            className={`flex items-end gap-2.5 ${isAgent ? 'justify-start' : 'justify-end'}`}
          >
            {/* Agent avatar — emerald ring on the left (왼쪽 에메랄드 링 에이전트 아바타) */}
            {isAgent && (
              <div className="h-8 w-8 shrink-0 rounded-full bg-emerald-500/20 flex items-center justify-center ring-1 ring-emerald-500/30">
                <Bot className="h-4 w-4 text-emerald-400" />
              </div>
            )}

            {/* Bubble + role label wrapper (말풍선 + 역할 레이블 래퍼) */}
            <div className={`flex flex-col gap-1 max-w-[75%] ${isAgent ? 'items-start' : 'items-end'}`}>

              {/* Role label — small caption above each bubble for clarity (각 말풍선 위 역할 캡션 — 명확성을 위해) */}
              <span className="text-[10px] font-medium tracking-wide text-slate-500 px-1">
                {isAgent ? 'AI Agent' : 'Customer'}
              </span>

              {isAgent ? (
                // Agent bubble — dark slate with subtle border and shadow (에이전트 말풍선 — 미묘한 테두리와 그림자가 있는 어두운 슬레이트)
                <div className="bg-slate-800/80 border border-slate-700/50 text-slate-300 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed shadow-md">
                  {turn.content}
                </div>
              ) : (
                // User bubble — blue glassmorphism for high contrast readability (높은 대비 가독성을 위한 파란색 글래스모피즘 사용자 말풍선)
                <div className="bg-blue-600/10 border border-blue-500/20 text-blue-50 rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed shadow-md">
                  {turn.content}
                </div>
              )}
            </div>

            {/* User avatar — blue ring on the right (오른쪽 파란색 링 사용자 아바타) */}
            {!isAgent && (
              <div className="h-8 w-8 shrink-0 rounded-full bg-blue-500/20 flex items-center justify-center ring-1 ring-blue-500/30">
                <User className="h-4 w-4 text-blue-400" />
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
  // Parse the 'transcript' DB column — handles both native JSONB array and stringified JSON.
  // The DB column is named 'transcript', NOT 'transcript_object'.
  // (DB 컬럼 'transcript' 파싱 — 네이티브 JSONB 배열과 문자열화된 JSON 모두 처리.
  //  DB 컬럼명은 'transcript_object'가 아닌 'transcript'입니다)
  const turns = useMemo((): TranscriptTurn[] => {
    if (!call.transcript) return [];
    if (Array.isArray(call.transcript)) return call.transcript;
    try {
      return JSON.parse(call.transcript as unknown as string) as TranscriptTurn[];
    } catch {
      return [];
    }
  }, [call.transcript]);

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
            {/* DB column 'sentiment' — not 'user_sentiment' (DB 컬럼 'sentiment' — 'user_sentiment' 아님) */}
            <SentimentBadge sentiment={call.sentiment} />
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Start Time</p>
              <p className="text-slate-200">{formatDateTime(call.start_time)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Duration</p>
              <p className="text-slate-200 font-mono">{formatDuration(call.duration)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Status</p>
              <p className="text-slate-200 capitalize">{call.call_status}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Cost</p>
              <p className="text-slate-200">{formatCost(call.cost)}</p>
            </div>
            {/* Customer phone — store view shows this prominently in the detail card (매장 뷰에서 고객 전화번호를 상세 카드에 강조 표시) */}
            <div className="col-span-2">
              <p className="text-xs text-slate-500 mb-0.5">Customer</p>
              <p className="text-slate-200 flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-slate-400" />
                {call.customer_phone ?? '—'}
              </p>
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

export default function StoreCallHistoryPage() {
  // Store's own storeId from session — set by DashboardShell on mount (DashboardShell이 마운트 시 설정하는 매장 고유 storeId)
  const storeId = useSessionStore((s) => s.storeId);

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

  // Load call logs for this store, resetting selection and errors.
  // (이 매장의 통화 로그 조회 — 선택 항목과 오류 초기화)
  const loadLogs = useCallback(async (id: string) => {
    setLoading(true);
    setFetchError(null);
    setSelected(null);
    setShowDetail(false);

    const { data, error } = await fetchCallLogs(id);
    setAllLogs(data ?? []);
    if (error) setFetchError(error);
    setLoading(false);
  }, []);

  // Fetch on mount and whenever storeId changes (마운트 및 storeId 변경 시 조회)
  useEffect(() => {
    if (storeId) {
      loadLogs(storeId);
    } else {
      setAllLogs([]);
      setSelected(null);
    }
  }, [storeId, loadLogs]);

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
      // Search filter — matches customer_phone or falls back to call_id when phone is null.
      // (검색 필터 — customer_phone 기준, 전화번호가 null이면 call_id로 폴백)
      if (searchQuery) {
        const haystack = (c.customer_phone ?? c.call_id).toLowerCase();
        if (!haystack.includes(searchQuery.toLowerCase())) return false;
      }

      // Date range filter — lower bound (날짜 범위 필터 — 하한)
      if (filterFrom && new Date(c.start_time) < new Date(filterFrom)) return false;

      // Date range filter — upper bound (날짜 범위 필터 — 상한)
      if (filterTo && new Date(c.start_time) > new Date(filterTo)) return false;

      // Sentiment filter — use DB column 'sentiment', NOT 'user_sentiment' (감정 필터 — DB 컬럼 'sentiment' 사용 — 'user_sentiment' 아님)
      if (sentimentFilter && c.sentiment !== sentimentFilter) return false;

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
          Review AI voice agent call logs, recordings, and transcripts for your store.
        </p>
      </div>

      {/* ── Empty state — no store linked to session (빈 상태 — 세션에 연결된 매장 없음) */}
      {!storeId && (
        <div className="flex flex-col items-center justify-center flex-1 py-20 text-center">
          <Mic className="mb-3 h-8 w-8 text-slate-700" />
          <p className="text-sm font-medium text-slate-500">
            No store linked to your account yet.
          </p>
        </div>
      )}

      {storeId && (
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
