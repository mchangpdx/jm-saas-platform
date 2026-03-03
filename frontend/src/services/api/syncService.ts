// syncService — frontend API integration for the Direct-to-DB sync engine.
// All functions use the shared api client (NEXT_PUBLIC_SERVER_URL) so they work
// in dev (Ngrok) and production without any URL changes.
// Functions accept { storeId } objects for consistent, self-documenting call sites.
// Every POST is sent with Content-Type: application/json (set by client.ts api.post)
// and body: JSON.stringify({ storeId }) so Express json() middleware can parse it.
// (Direct-to-DB 동기화 엔진용 프론트엔드 API 연동.
//  모든 함수는 공유 api 클라이언트(NEXT_PUBLIC_SERVER_URL) 사용 —
//  URL 변경 없이 개발(Ngrok)과 프로덕션 동작 보장.
//  함수는 일관성 있고 자기 문서화된 호출 지점을 위해 { storeId } 객체를 받음.
//  모든 POST는 Content-Type: application/json으로 전송되고
//  body: JSON.stringify({ storeId })로 Express json() 미들웨어가 파싱 가능하게 함)

import { api } from '@/shared/api/client';
import type { ApiResponse } from '@/shared/api/client';

// ── Response type definitions ─────────────────────────────────────────────────

// Result shape returned by the POST /api/sync/all endpoint (전체 동기화 엔드포인트 반환 결과 형태)
export interface SyncAllResult {
  success: boolean;
  synced?: number;  // Number of variant rows written to menu_items (menu_items에 쓴 변형 행 수)
  error?:  string;
}

// Customer sync result — aligns with POST /api/sync/customers backend endpoint
// (고객 동기화 결과 — POST /api/sync/customers 백엔드 엔드포인트와 일치)
export interface CustomerSyncResult {
  success: boolean;
  synced?: number;  // Number of customer records written (고객 레코드 작성 수)
  error?:  string;
}

// ── Phone number formatter ────────────────────────────────────────────────────

/**
 * Format a raw phone string to the NANP XXX-XXX-XXXX display format.
 * Strips non-digits, takes the last 10, inserts dashes.
 * Falls back to the raw value when fewer than 10 digits are present.
 * (원시 전화번호를 NANP XXX-XXX-XXXX 표시 형식으로 변환.
 *  비숫자 제거, 마지막 10자리 추출, 대시 삽입.
 *  10자리 미만이면 원시 값 그대로 반환)
 *
 * @param raw — raw phone string from Loyverse or the DB (Loyverse 또는 DB의 원시 전화번호 문자열)
 * @returns formatted phone string (형식화된 전화번호 문자열)
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '—';
  const digits = raw.replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return raw;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// ── syncAll ───────────────────────────────────────────────────────────────────

/**
 * Trigger a full Direct-to-DB sync for a store.
 * Calls POST /api/sync/all — fetches the complete Loyverse catalog and upserts
 * all variants directly into menu_items in a single batch.
 * (매장의 전체 Direct-to-DB 동기화 트리거.
 *  POST /api/sync/all 호출 — 전체 Loyverse 카탈로그를 가져와
 *  모든 변형을 단일 배치로 menu_items에 직접 업서트)
 *
 * @param storeId — store UUID from the stores table (stores 테이블의 매장 UUID)
 */
export async function syncAll({ storeId }: { storeId: string }): Promise<ApiResponse<SyncAllResult>> {
  // Strict guard — SyncCenter's handler should prevent reaching here with an empty storeId,
  // but this second line of defence ensures no silent empty-body requests slip through.
  // (엄격한 가드 — SyncCenter의 핸들러가 빈 storeId로 여기까지 오는 것을 방지해야 하지만,
  //  조용한 빈 바디 요청이 통과하지 못하도록 하는 두 번째 방어선)
  if (!storeId) throw new Error('CRITICAL: storeId is missing before API call');
  // api.post serialises body as JSON.stringify({ storeId }) with Content-Type: application/json
  // (api.post는 바디를 JSON.stringify({ storeId })로 직렬화하고 Content-Type: application/json 설정)
  return api.post<SyncAllResult>('/api/sync/all', { storeId });
}

// ── syncCustomers ─────────────────────────────────────────────────────────────

/**
 * Trigger a customer list sync from Loyverse for a store.
 * Calls POST /api/sync/customers — upserts into the customers table keyed on
 * (store_id, customer_phone). Phone numbers are normalised to XXX-XXX-XXXX.
 * Use formatPhone() when displaying individual phone numbers in the UI.
 * (매장의 Loyverse 고객 목록 동기화 트리거.
 *  POST /api/sync/customers 호출 — (store_id, customer_phone) 키로 customers 테이블에 업서트.
 *  전화번호는 XXX-XXX-XXXX로 정규화.
 *  UI에서 개별 전화번호 표시 시 formatPhone() 사용)
 *
 * @param storeId — store UUID from the stores table (stores 테이블의 매장 UUID)
 */
export async function syncCustomers({ storeId }: { storeId: string }): Promise<ApiResponse<CustomerSyncResult>> {
  // Strict guard — second line of defence after SyncCenter's storeId check
  // (엄격한 가드 — SyncCenter의 storeId 확인 이후 두 번째 방어선)
  if (!storeId) throw new Error('CRITICAL: storeId is missing before API call');
  // api.post serialises body as JSON.stringify({ storeId }) with Content-Type: application/json
  // (api.post는 바디를 JSON.stringify({ storeId })로 직렬화하고 Content-Type: application/json 설정)
  return api.post<CustomerSyncResult>('/api/sync/customers', { storeId });
}
