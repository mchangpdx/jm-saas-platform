// Store API helpers — CRUD operations against the backend /api/stores endpoints.
// All functions return ApiResponse<T> so UI components can show errors inline.
// (매장 API 헬퍼 — 백엔드 /api/stores 엔드포인트에 대한 CRUD 작업.
//  모든 함수는 ApiResponse<T>를 반환하여 UI 컴포넌트가 오류를 인라인으로 표시 가능)

import { api } from './client';

// Shape of a store row returned by the backend (백엔드가 반환하는 매장 행 형태)
export interface Store {
  id:             string;
  name:           string;
  retell_agent_id: string | null;
  pos_system:     string | null;
  payment_gateway: string | null;
  timezone:       string;
  system_prompt:  string | null;
  business_hours: string | null;
  parking_info:   string | null;
  custom_knowledge: string | null;
  is_active:      boolean;
}

// Fetch a single store by ID — used by PromptManager and CallLog on mount
// (ID로 단일 매장 조회 — 마운트 시 PromptManager와 CallLog에서 사용)
export function fetchStore(storeId: string) {
  return api.get<Store>(`/api/stores/${storeId}`);
}

// Update the system_prompt for a store — called by PromptManager on save
// (매장의 system_prompt 업데이트 — 저장 시 PromptManager에서 호출)
export function updateSystemPrompt(storeId: string, systemPrompt: string) {
  return api.patch<{ success: boolean }>(`/api/stores/${storeId}/system-prompt`, {
    system_prompt: systemPrompt,
  });
}

// Fetch all stores accessible to the current session (현재 세션에서 접근 가능한 모든 매장 조회)
export function fetchAllStores() {
  return api.get<Store[]>('/api/stores');
}
