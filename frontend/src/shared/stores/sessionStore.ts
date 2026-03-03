// Session store — global Zustand slice that holds the authenticated user context.
// Stores store_id and agent_id so every module can read them without prop-drilling.
// Persisted to sessionStorage so a hard refresh doesn't require re-login during dev.
// (세션 스토어 — 인증된 사용자 컨텍스트를 보유하는 전역 Zustand 슬라이스.
//  store_id와 agent_id를 저장하여 모든 모듈이 prop 드릴링 없이 읽을 수 있음.
//  개발 중 하드 새로고침 시 재로그인이 필요 없도록 sessionStorage에 유지)

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type UserRole = 'agency' | 'store';

export interface SessionState {
  // Currently active store context (현재 활성 매장 컨텍스트)
  storeId:   string | null;
  agentId:   string | null;
  storeName: string | null;
  role:      UserRole | null;

  // Agency-selected store ID driven by the sidebar dropdown (사이드바 드롭다운으로 에이전시가 선택한 매장 ID)
  // Store-role users have this auto-set to their own storeId in DashboardShell.
  // (매장 역할 사용자는 DashboardShell에서 자신의 storeId로 자동 설정)
  selectedStoreId: string | null;

  // Setters — called after login or store selection (로그인 또는 매장 선택 후 호출되는 세터)
  setStore: (payload: {
    storeId:   string;
    agentId:   string | null;
    storeName: string;
    role:      UserRole;
  }) => void;

  // Update the globally selected store (전역 선택 매장 업데이트)
  setSelectedStoreId: (id: string) => void;

  // Clear context on logout (로그아웃 시 컨텍스트 초기화)
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      storeId:         null,
      agentId:         null,
      storeName:       null,
      role:            null,
      selectedStoreId: null,

      setStore: (payload) =>
        set({
          storeId:   payload.storeId,
          agentId:   payload.agentId,
          storeName: payload.storeName,
          role:      payload.role,
        }),

      setSelectedStoreId: (id) => set({ selectedStoreId: id }),

      clearSession: () =>
        set({ storeId: null, agentId: null, storeName: null, role: null, selectedStoreId: null }),
    }),
    {
      name:    'jm-session',                            // sessionStorage key (sessionStorage 키)
      storage: createJSONStorage(() => sessionStorage), // Cleared on tab close (탭 닫을 때 초기화)
    },
  ),
);
