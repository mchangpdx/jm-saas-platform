// PromptManager — editable textarea that loads and saves the AI system_prompt
// for the active store. Fetches via the shared API client, patches on save.
// Isolated to the ai-voice-bot module: no imports leak to other modules.
// (PromptManager — 활성 매장의 AI system_prompt를 불러오고 저장하는 편집 가능한 텍스트 에리어.
//  공유 API 클라이언트로 조회, 저장 시 PATCH 요청.
//  ai-voice-bot 모듈에 격리 — 다른 모듈로 임포트 누출 없음)

'use client';

import { useState, useEffect } from 'react';
import { Save, RotateCcw, Mic } from 'lucide-react';
import { useStore }              from '@/shared/hooks/useStore';
import { updateSystemPrompt }    from '@/shared/api/stores';
import { Spinner }               from '@/shared/components/Spinner';
import { ErrorAlert }            from '@/shared/components/ErrorAlert';

export function PromptManager() {
  const { store, loading, error, refetch } = useStore();

  // Local draft — edited by the user, committed only on Save
  // (로컬 드래프트 — 사용자가 편집, 저장 시에만 커밋)
  const [draft,   setDraft  ] = useState('');
  const [saving,  setSaving ] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Sync draft with fetched store data on load or external change
  // (로드 또는 외부 변경 시 조회된 매장 데이터와 드래프트 동기화)
  useEffect(() => {
    if (store?.system_prompt != null) setDraft(store.system_prompt);
  }, [store?.system_prompt]);

  // Save draft to backend via PATCH (PATCH로 드래프트 백엔드 저장)
  async function handleSave() {
    if (!store) return;
    setSaving(true);
    setSaveMsg(null);

    const { error: saveError } = await updateSystemPrompt(store.id, draft);

    if (saveError) {
      setSaveMsg(`Error: ${saveError}`);
    } else {
      setSaveMsg('Saved successfully.');
      refetch(); // Re-sync from DB to confirm round-trip (DB에서 재동기화로 왕복 확인)
    }
    setSaving(false);

    // Auto-clear feedback message after 4 seconds (4초 후 피드백 메시지 자동 제거)
    setTimeout(() => setSaveMsg(null), 4000);
  }

  // Revert draft to the last saved value (드래프트를 마지막 저장 값으로 되돌리기)
  function handleRevert() {
    setDraft(store?.system_prompt ?? '');
    setSaveMsg(null);
  }

  const isDirty = draft !== (store?.system_prompt ?? '');

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">

      {/* Card header (카드 헤더) */}
      <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4 dark:border-gray-800">
        <Mic className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
        <div>
          <h3 className="text-base font-semibold">AI Persona / System Prompt</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Controls how your AI voice assistant introduces itself and behaves on calls.
          </p>
        </div>
      </div>

      <div className="p-6 space-y-4">

        {/* API error banner (API 오류 배너) */}
        {error && <ErrorAlert message={error} />}

        {/* Loading skeleton (로딩 스켈레톤) */}
        {loading && !store && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Spinner className="h-4 w-4 text-indigo-500" />
            Loading system prompt…
          </div>
        )}

        {/* Prompt textarea (프롬프트 텍스트 에리어) */}
        {!loading || store ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={10}
            placeholder="e.g. You are Mina, a warm voice assistant for JM Korean BBQ. Help customers order with enthusiasm…"
            className="w-full resize-y rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 text-sm font-mono leading-relaxed text-gray-800 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:placeholder-gray-500 dark:focus:border-indigo-400"
          />
        ) : null}

        {/* Character count (글자 수) */}
        <p className="text-right text-xs text-gray-400 dark:text-gray-500">
          {draft.length.toLocaleString('en-US')} characters
        </p>

        {/* Save feedback message (저장 피드백 메시지) */}
        {saveMsg && (
          <p className={`text-sm ${saveMsg.startsWith('Error') ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
            {saveMsg}
          </p>
        )}

        {/* Action buttons (액션 버튼) */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving || !isDirty || !store}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            {saving ? <Spinner className="h-4 w-4 text-white" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving…' : 'Save Prompt'}
          </button>

          <button
            onClick={handleRevert}
            disabled={!isDirty || saving}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <RotateCcw className="h-4 w-4" />
            Revert
          </button>

          {isDirty && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              Unsaved changes
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
