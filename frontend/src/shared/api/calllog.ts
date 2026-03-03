// Call log API helpers — fetches orders and reservations for a given store.
// Both tables share the same store_id column for simple cross-filtering.
// (통화 로그 API 헬퍼 — 매장의 주문 및 예약 조회.
//  두 테이블 모두 store_id 컬럼을 공유하여 간단히 필터링 가능)

import { api } from './client';

// Order row shape (주문 행 형태)
export interface Order {
  id:             string;
  store_id:       string;
  agent_id:       string | null;
  customer_name:  string;
  customer_phone: string | null;
  customer_email: string | null;
  items:          Array<{ name: string; quantity: number; unit_price: number }>;
  total_amount:   number;
  status:         'pending' | 'paid' | 'failed';
  created_at:     string;
}

// Reservation row shape (예약 행 형태)
export interface Reservation {
  id:               string;
  store_id:         string;
  agent_id:         string | null;
  customer_name:    string;
  customer_phone:   string | null;
  customer_email:   string | null;
  reservation_date: string;  // YYYY-MM-DD
  reservation_time: string;  // HH:MM
  party_size:       number;
  status:           'pending' | 'confirmed' | 'cancelled';
  created_at:       string;
}

// Unified call log entry — merges orders and reservations into one list for the UI
// (통합 통화 로그 항목 — UI용 주문과 예약을 하나의 목록으로 병합)
export type CallLogEntry =
  | { kind: 'order';       data: Order }
  | { kind: 'reservation'; data: Reservation };

// Fetch recent orders for a store — limit defaults to 50 (최근 주문 조회 — 기본 50개 제한)
export function fetchOrders(storeId: string, limit = 50) {
  return api.get<Order[]>(`/api/stores/${storeId}/orders?limit=${limit}`);
}

// Fetch recent reservations for a store — limit defaults to 50 (최근 예약 조회 — 기본 50개 제한)
export function fetchReservations(storeId: string, limit = 50) {
  return api.get<Reservation[]>(`/api/stores/${storeId}/reservations?limit=${limit}`);
}
