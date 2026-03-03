// Base API client — all backend requests go through this instance.
// Uses NEXT_PUBLIC_SERVER_URL so the same code works in dev (Ngrok) and prod.
// (기본 API 클라이언트 — 모든 백엔드 요청이 이 인스턴스를 통과.
//  NEXT_PUBLIC_SERVER_URL 사용으로 개발(Ngrok)과 프로덕션에서 동일하게 동작)

const BASE_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:3000';

// Standard response shape — every helper returns this so callers never have to
// distinguish between network errors, HTTP errors, and parse errors.
// (표준 응답 형태 — 모든 헬퍼가 이를 반환하여 호출자가 오류 유형을 구분할 필요 없음)
export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

// Build full URL from a path segment (경로 세그먼트로 전체 URL 생성)
function url(path: string): string {
  return `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

// Shared fetch wrapper — handles JSON parsing and HTTP error codes.
// Returns ApiResponse<T> so callers can use simple { data, error } destructuring.
// (공유 fetch 래퍼 — JSON 파싱 및 HTTP 오류 코드 처리.
//  ApiResponse<T> 반환으로 호출자가 간단히 { data, error }로 구조분해 가능)
async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(url(path), {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });

    if (!res.ok) {
      // Surface HTTP-level errors with status text for the UI to display
      // (UI에 표시할 HTTP 레벨 오류를 상태 텍스트와 함께 노출)
      const body = await res.text().catch(() => '');
      return { data: null, error: body || `HTTP ${res.status}: ${res.statusText}` };
    }

    const data: T = await res.json();
    return { data, error: null };
  } catch (err) {
    // Network-level failures (CORS, DNS, offline) surface here
    // (CORS, DNS, 오프라인 등 네트워크 레벨 실패 처리)
    const message = err instanceof Error ? err.message : 'Network error';
    return { data: null, error: message };
  }
}

// Convenience methods — mirrors Axios-style interface without the dependency
// (편의 메서드 — 의존성 없이 Axios 스타일 인터페이스 구현)
export const api = {
  get:    <T>(path: string, init?: RequestInit) =>
    request<T>(path, { method: 'GET',    ...init }),

  post:   <T>(path: string, body: unknown, init?: RequestInit) =>
    request<T>(path, { method: 'POST',   body: JSON.stringify(body), ...init }),

  patch:  <T>(path: string, body: unknown, init?: RequestInit) =>
    request<T>(path, { method: 'PATCH',  body: JSON.stringify(body), ...init }),

  delete: <T>(path: string, init?: RequestInit) =>
    request<T>(path, { method: 'DELETE', ...init }),
};
