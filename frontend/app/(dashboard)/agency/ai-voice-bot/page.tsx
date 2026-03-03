// AI Voice Bot page — agency view that reads the globally selected store from the
// Zustand session store (set by the sidebar dropdown in DashboardShell) and
// shows PersonaEditor + LiveCallLog for that store.
// Agency users always receive role='agency' so the Essential Prompt textarea is editable.
// If no store is selected yet, an empty state prompts the user to use the sidebar.
// (AI Voice Bot 페이지 — Zustand 세션 스토어에서 전역 선택 매장을 읽어
//  (DashboardShell의 사이드바 드롭다운으로 설정)
//  해당 매장의 PersonaEditor + LiveCallLog를 표시하는 에이전시 뷰.
//  에이전시 사용자는 항상 role='agency'를 받아 필수 프롬프트 텍스트에리어가 편집 가능.
//  선택된 매장이 없으면 빈 상태로 사이드바 사용을 안내)

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Mic }                              from 'lucide-react';
import { getSupabaseClient }               from '@/shared/api/supabaseClient';
import { useSessionStore }                 from '@/shared/stores/sessionStore';
import { Spinner }                         from '@/shared/components/Spinner';
import { PersonaEditor }                   from '@/modules/ai-voice-bot/components/PersonaEditor';
import { LiveCallLog }                     from '@/modules/ai-voice-bot/components/LiveCallLog';

// Full store shape needed by PersonaEditor — includes both prompt columns.
// temporary_prompt holds daily operational overrides set by the store owner.
// (PersonaEditor에 필요한 전체 매장 형태 — 두 프롬프트 컬럼 모두 포함.
//  temporary_prompt는 매장 소유자가 설정한 일일 운영 오버라이드)
interface StoreDetail {
  id:               string;
  name:             string;
  system_prompt:    string | null;
  temporary_prompt: string | null;
}

export default function AiVoiceBotPage() {
  const selectedStoreId = useSessionStore((s) => s.selectedStoreId);

  const [store,      setStore     ] = useState<StoreDetail | null>(null);
  const [loading,    setLoading   ] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fetch the full store record whenever selectedStoreId changes.
  // Both system_prompt and temporary_prompt are required by PersonaEditor's dual-prompt UI.
  // (selectedStoreId 변경 시 전체 매장 레코드 조회.
  //  PersonaEditor의 이중 프롬프트 UI에 system_prompt와 temporary_prompt 모두 필요)
  const loadStore = useCallback(async (id: string) => {
    setLoading(true);
    setFetchError(null);
    setStore(null);

    const { data, error: dbError } = await getSupabaseClient()
      .from('stores')
      .select('id, name, system_prompt, temporary_prompt')
      .eq('id', id)
      .maybeSingle<StoreDetail>();

    if (dbError) {
      setFetchError(dbError.message);
    } else {
      setStore(data);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedStoreId) {
      loadStore(selectedStoreId);
    } else {
      setStore(null);
    }
  }, [selectedStoreId, loadStore]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Page heading (페이지 제목) */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">AI Voice Bot</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Manage the AI persona and review recent call orders for the selected store.
        </p>
      </div>

      {/* No store selected — prompt the user to use the sidebar selector
          (선택된 매장 없음 — 사이드바 선택기 사용을 안내) */}
      {!selectedStoreId && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 py-20 text-center dark:border-gray-700">
          <Mic className="mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Select a store from the sidebar to manage its AI persona and call log.
          </p>
        </div>
      )}

      {/* Loading state while fetching store detail (매장 상세 조회 중 로딩 상태) */}
      {selectedStoreId && loading && (
        <div className="flex items-center justify-center py-16">
          <Spinner className="h-6 w-6 text-indigo-500" />
        </div>
      )}

      {/* Fetch error (조회 오류) */}
      {selectedStoreId && !loading && fetchError && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Failed to load store: {fetchError}
        </p>
      )}

      {/* ── Main grid — rendered once the store detail is resolved ───────────── */}
      {/* key forces a full remount when selectedStoreId changes so PersonaEditor's
          textarea draft and LiveCallLog's data both reset cleanly.
          (selectedStoreId 변경 시 key로 강제 리마운트하여 PersonaEditor 드래프트와
           LiveCallLog 데이터가 깔끔하게 초기화됨) */}
      {store && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">

          {/* PersonaEditor — left: edit both prompt sections as agency.
              userRole='agency' enables editing of both the Essential Prompt (system_prompt)
              and the Daily Instructions (temporary_prompt).
              (왼쪽: 에이전시로 두 프롬프트 섹션 편집.
               userRole='agency'로 필수 프롬프트(system_prompt)와
               일일 지시사항(temporary_prompt) 모두 편집 가능) */}
          <PersonaEditor
            key={`persona-${store.id}`}
            store={store}
            userRole="agency"
          />

          {/* LiveCallLog — right: latest 10 voice-ordered orders (오른쪽: 음성 주문 최근 10건) */}
          <LiveCallLog
            key={`log-${store.id}`}
            storeId={store.id}
          />
        </div>
      )}
    </div>
  );
}
