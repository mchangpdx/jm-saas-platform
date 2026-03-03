// PersonaEditor — client component that displays and saves the AI persona for a given store.
// Separates the prompt into two distinct sections to prevent accidental overwrites:
//   Core AI Persona (Essential) — system_prompt, the foundational identity set by the agency.
//     Read-only for store-role users; editable only by agency-role users.
//   Daily Instructions (Temporary) — temporary_prompt, fully editable by store owners.
//     Injected at the end of the master prompt so it carries the highest situational priority.
// Agency users can edit both sections; store users can only edit the temporary section.
// Saves are persisted directly to the Supabase stores table via the browser client.
// (PersonaEditor — 주어진 매장의 AI 페르소나를 표시하고 저장하는 클라이언트 컴포넌트.
//  우발적 덮어쓰기 방지를 위해 프롬프트를 두 섹션으로 분리:
//    핵심 AI 페르소나(필수) — system_prompt, 에이전시가 설정한 기본 정체성. 매장 역할 읽기 전용.
//    일일 지시사항(임시) — temporary_prompt, 매장 소유자가 완전히 편집 가능.
//      마스터 프롬프트 맨 끝에 주입되어 즉각적인 상황별 우선순위가 가장 높음.
//  에이전시 사용자는 두 섹션 모두 편집 가능; 매장 사용자는 임시 섹션만 편집 가능.
//  저장은 브라우저 클라이언트를 통해 Supabase stores 테이블에 직접 저장)

'use client';

import { useState }                          from 'react';
import { Mic, Save, RotateCcw, Lock, Zap }   from 'lucide-react';
import { getSupabaseClient }                 from '@/shared/api/supabaseClient';
import { Spinner }                           from '@/shared/components/Spinner';

// Minimal store shape required by this component — includes both prompt columns.
// (이 컴포넌트에 필요한 최소 매장 형태 — 두 프롬프트 컬럼 모두 포함)
export interface PersonaEditorStore {
  id:               string;
  name:             string;
  system_prompt:    string | null;
  temporary_prompt: string | null;
}

interface PersonaEditorProps {
  store:    PersonaEditorStore;
  // userRole controls which sections are editable — agency can edit both, store only temporary.
  // Named userRole (not role) to avoid shadowing HTML role attributes on child elements.
  // (편집 가능한 섹션 제어 — 에이전시는 둘 다, 매장은 임시만.
  //  자식 요소의 HTML role 속성과 충돌 방지를 위해 userRole로 명명)
  userRole: 'agency' | 'store';
}

export function PersonaEditor({ store, userRole }: PersonaEditorProps) {

  // Agency users may edit the Essential Prompt; store users see it as read-only.
  // (에이전시 사용자는 필수 프롬프트 편집 가능; 매장 사용자는 읽기 전용)
  const canEditEssential = userRole === 'agency';

  // ── Essential Prompt state (system_prompt) ─────────────────────────────────
  // Separate draft and lastSaved baseline so isDirty tracks unsaved changes accurately.
  // (드래프트와 lastSaved 기준값을 분리하여 isDirty가 미저장 변경을 정확히 추적)
  const [essentialDraft,     setEssentialDraft    ] = useState(store.system_prompt     ?? '');
  const [essentialLastSaved, setEssentialLastSaved] = useState(store.system_prompt     ?? '');

  // ── Temporary Prompt state (temporary_prompt) ──────────────────────────────
  // Always editable for both roles — the store owner's daily operational override.
  // (두 역할 모두 항상 편집 가능 — 매장 소유자의 일일 운영 오버라이드)
  const [tempDraft,     setTempDraft    ] = useState(store.temporary_prompt ?? '');
  const [tempLastSaved, setTempLastSaved] = useState(store.temporary_prompt ?? '');

  // ── Shared save feedback state ─────────────────────────────────────────────
  const [saving,  setSaving ] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  // Dirty flags — true when draft differs from the last persisted DB value.
  // essentialDirty is always false for store users since that textarea is read-only.
  // (드래프트가 마지막 저장 DB 값과 다를 때 true — 더티 플래그.
  //  매장 사용자의 essentialDirty는 항상 false — 읽기 전용 텍스트에리어)
  const essentialDirty = canEditEssential && (essentialDraft !== essentialLastSaved);
  const tempDirty      = tempDraft !== tempLastSaved;
  const anyDirty       = essentialDirty || tempDirty;

  // Persist changes to the Supabase stores table via the browser client.
  // Store-role users write only temporary_prompt.
  // Agency-role users write both system_prompt and temporary_prompt when either is dirty.
  // (브라우저 클라이언트를 통해 Supabase stores 테이블에 변경사항 저장.
  //  매장 역할 사용자는 temporary_prompt만 씀.
  //  에이전시 역할 사용자는 둘 중 하나라도 더티면 두 필드 모두 씀)
  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    setIsError(false);

    // Build the update payload based on role — agency can write both columns.
    // (역할에 따라 업데이트 페이로드 구성 — 에이전시는 두 컬럼 모두 쓰기 가능)
    const payload: Record<string, string> = { temporary_prompt: tempDraft };
    if (canEditEssential) {
      payload.system_prompt = essentialDraft;
    }

    const { error } = await getSupabaseClient()
      .from('stores')
      .update(payload)
      .eq('id', store.id);

    if (error) {
      setIsError(true);
      setSaveMsg(`Error: ${error.message}`);
    } else {
      // Advance the lastSaved baselines so isDirty resets to false after a clean save.
      // (저장 후 isDirty가 false로 재설정되도록 lastSaved 기준값 업데이트)
      setTempLastSaved(tempDraft);
      if (canEditEssential) setEssentialLastSaved(essentialDraft);
      setSaveMsg('Saved successfully.');
    }

    setSaving(false);

    // Auto-clear the feedback message after 4 seconds (4초 후 피드백 메시지 자동 제거)
    setTimeout(() => setSaveMsg(null), 4_000);
  }

  // Revert both drafts to their last persisted values without a server round-trip.
  // (서버 왕복 없이 두 드래프트를 마지막 저장 값으로 되돌리기)
  function handleRevert() {
    setTempDraft(tempLastSaved);
    if (canEditEssential) setEssentialDraft(essentialLastSaved);
    setSaveMsg(null);
    setIsError(false);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">

      {/* Card header (카드 헤더) */}
      <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4 dark:border-gray-800">
        <Mic className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
        <div>
          <h3 className="text-base font-semibold">AI Persona Editor</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Manage your AI voice assistant&apos;s core identity and today&apos;s daily instructions.
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col space-y-6 p-6">

        {/* ── Section 1: Core AI Persona (Essential) ──────────────────────────── */}
        {/* system_prompt — read-only for store role, editable for agency role.    */}
        {/* (시스템 프롬프트 — 매장 역할은 읽기 전용, 에이전시 역할은 편집 가능) */}
        <div className="space-y-2">

          {/* Section label with lock icon and Essential badge (섹션 레이블) */}
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-gray-400 dark:text-gray-500" />
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Core AI Persona
              <span className="ml-2 inline-block rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-600 ring-1 ring-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-400 dark:ring-indigo-800">
                Essential
              </span>
            </h4>
          </div>

          {/* Role-aware helper text (역할별 안내 문구) */}
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {canEditEssential
              ? 'The foundational AI identity set by your agency. Edit with care — changes affect every call.'
              : 'Set by your agency. Defines the AI\'s core identity and cannot be changed from this view.'}
          </p>

          {/* Essential prompt textarea — readOnly when role is store (필수 프롬프트 텍스트에리어) */}
          <textarea
            value={essentialDraft}
            onChange={(e) => canEditEssential && setEssentialDraft(e.target.value)}
            readOnly={!canEditEssential}
            rows={8}
            placeholder="e.g. You are Mina, a warm voice assistant for JM Korean BBQ. Help customers with orders and reservations…"
            className={`w-full resize-y rounded-lg border px-4 py-3 text-sm font-mono leading-relaxed placeholder-gray-400 focus:outline-none dark:placeholder-gray-500 ${
              canEditEssential
                ? 'border-gray-300 bg-gray-50 text-gray-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:focus:border-indigo-400'
                : 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-500 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-500'
            }`}
          />

          {/* Essential prompt character count (필수 프롬프트 글자 수) */}
          <p className="text-right text-xs text-gray-400 dark:text-gray-500">
            {essentialDraft.length.toLocaleString('en-US')} characters
          </p>
        </div>

        {/* Divider with DAILY OVERRIDE label (구분선) */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Daily Override
          </span>
          <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
        </div>

        {/* ── Section 2: Daily Instructions (Temporary) ───────────────────────── */}
        {/* temporary_prompt — fully editable by both store and agency users.       */}
        {/* Injected at the end of the master prompt for highest situational priority. */}
        {/* (임시 프롬프트 — 매장·에이전시 모두 편집 가능.                         */}
        {/*  마스터 프롬프트 맨 끝에 주입되어 즉각적인 상황별 우선순위가 가장 높음) */}
        <div className="space-y-2">

          {/* Section label with Zap icon and Temporary badge (섹션 레이블) */}
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500 dark:text-amber-400" />
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Daily Instructions
              <span className="ml-2 inline-block rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-600 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:ring-amber-800">
                Temporary
              </span>
            </h4>
          </div>

          {/* Helper text explaining situational priority (상황별 우선순위 안내) */}
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Today&apos;s specials, sold-out items, or event notes. Takes the highest priority during live calls — update this daily without touching the core persona.
          </p>

          {/* Temporary prompt textarea — always editable, amber accent (임시 프롬프트 텍스트에리어) */}
          <textarea
            value={tempDraft}
            onChange={(e) => setTempDraft(e.target.value)}
            rows={5}
            placeholder="e.g. The spicy pork belly is sold out today. Happy hour — all drinks 50% off before 6 PM. Private event in the back room until 8 PM."
            className="w-full resize-y rounded-lg border border-amber-200 bg-amber-50/40 px-4 py-3 text-sm font-mono leading-relaxed text-gray-800 placeholder-gray-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400 dark:border-amber-800/50 dark:bg-amber-900/10 dark:text-gray-200 dark:placeholder-gray-500 dark:focus:border-amber-600"
          />

          {/* Temporary prompt character count (임시 프롬프트 글자 수) */}
          <p className="text-right text-xs text-gray-400 dark:text-gray-500">
            {tempDraft.length.toLocaleString('en-US')} characters
          </p>
        </div>

        {/* Save feedback banner — green for success, red for error (저장 피드백 — 성공 녹색, 오류 빨강) */}
        {saveMsg && (
          <div
            className={`rounded-lg px-4 py-2.5 text-sm font-medium ${
              isError
                ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                : 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
            }`}
          >
            {saveMsg}
          </div>
        )}

        {/* Action buttons row (액션 버튼 행) */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saving || !anyDirty}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            {saving
              ? <Spinner className="h-4 w-4 text-white" />
              : <Save className="h-4 w-4" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>

          <button
            onClick={handleRevert}
            disabled={saving || !anyDirty}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <RotateCcw className="h-4 w-4" />
            Revert
          </button>

          {/* Unsaved-changes indicator (미저장 변경 표시) */}
          {anyDirty && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              Unsaved changes
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
