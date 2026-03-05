// Solink API service — calls our backend proxy, never Solink directly from the browser
// (Solink API 서비스 — 브라우저에서 Solink 직접 호출 없이 백엔드 프록시를 통해 호출)

// Backend base URL — set NEXT_PUBLIC_BACKEND_URL in .env.local for local dev
// (백엔드 기본 URL — 로컬 개발 시 .env.local에 NEXT_PUBLIC_BACKEND_URL 설정)
const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'https://jm-saas-platform.onrender.com';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SolinkCamera {
  id:     string;
  name:   string;
  status: string;
}

// ── getCameras ────────────────────────────────────────────────────────────────

// Fetch the list of cameras registered to this Solink account via backend proxy
// (백엔드 프록시를 통해 Solink 계정에 등록된 카메라 목록 조회)
export async function getCameras(): Promise<SolinkCamera[]> {
  const res = await fetch(`${BACKEND}/api/solink/cameras`);
  if (!res.ok) {
    console.error('[solinkService] getCameras failed (카메라 목록 조회 실패)', res.status);
    return [];
  }
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
}

// ── getVideoLink ──────────────────────────────────────────────────────────────

// Fetch a time-indexed playback URL for the given camera and ISO timestamp
// (지정된 카메라와 ISO 타임스탬프에 대한 시간 인덱스 재생 URL 조회)
export async function getVideoLink(
  cameraId:  string,
  timestamp: string,   // ISO 8601 e.g. "2026-03-05T15:33:09Z"
): Promise<string | null> {
  const params = new URLSearchParams({ cameraId, timestamp });
  const res = await fetch(`${BACKEND}/api/solink/video-link?${params}`);
  if (!res.ok) {
    console.error('[solinkService] getVideoLink failed (비디오 링크 조회 실패)', res.status);
    return null;
  }
  const json = await res.json();
  // Backend returns either { data: { url } } or { videoLink } depending on route version
  // (백엔드 라우트 버전에 따라 { data: { url } } 또는 { videoLink } 중 하나 반환)
  return json?.data?.url ?? json?.videoLink ?? null;
}
