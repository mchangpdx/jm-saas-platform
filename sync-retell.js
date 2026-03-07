// sync-retell.js — One-time backfill script: fetches ALL historical calls from the
// Retell AI REST API and upserts them into the Supabase call_logs table.
//
// Usage:
//   node sync-retell.js              # live run
//   DRY_RUN=true node sync-retell.js # preview only — no DB writes
//
// Prerequisites: RETELL_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env
//
// (사용법: node sync-retell.js | DRY_RUN=true node sync-retell.js (미리보기)
//  전제 조건: .env에 RETELL_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 설정)

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// ── Configuration ─────────────────────────────────────────────────────────────

// Validate required environment variables before doing any I/O (I/O 전 필수 환경 변수 검증)
const RETELL_API_KEY         = process.env.RETELL_API_KEY;
const SUPABASE_URL           = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN                = process.env.DRY_RUN === 'true';

if (!RETELL_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    '[sync-retell] FATAL: Missing required env vars.\n' +
    '  Required: RETELL_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY\n' +
    '  (필수 환경 변수 누락: RETELL_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)',
  );
  process.exit(1);
}

// Retell API base URL (Retell API 기준 URL)
const RETELL_BASE_URL = 'https://api.retellai.com';

// Batch size for Supabase upsert calls — keeps payloads manageable (Supabase upsert 호출 배치 크기 — 페이로드 관리 가능하게 유지)
const UPSERT_BATCH_SIZE = 50;

// Milliseconds to wait between Supabase batch writes to avoid rate limiting.
// (속도 제한 방지를 위한 Supabase 배치 쓰기 간격 밀리초)
const BATCH_DELAY_MS = 150;

// ── Supabase admin client ─────────────────────────────────────────────────────

// Service role key bypasses RLS — safe for a trusted server-side one-time script.
// (서비스 롤 키로 RLS 우회 — 신뢰할 수 있는 서버 사이드 일회성 스크립트에서 안전)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── Agent → store_id cache ────────────────────────────────────────────────────

// In-memory cache maps Retell agent_id → Supabase stores.id (or null if not found).
// Avoids a redundant DB round-trip for every call that shares the same agent.
// (메모리 내 캐시: Retell agent_id → Supabase stores.id (없으면 null) 매핑.
//  같은 에이전트를 공유하는 모든 통화에 대한 중복 DB 왕복 방지)
const agentStoreCache = new Map();

// ── Stats ─────────────────────────────────────────────────────────────────────

// Mutable counters updated throughout the run and printed in the final summary.
// (실행 중 업데이트되고 최종 요약에 출력되는 가변 카운터)
const stats = {
  pagesFetched:    0,  // Number of Retell API pages fetched (Retell API에서 가져온 페이지 수)
  totalFetched:    0,  // Total call objects received from Retell (Retell에서 수신한 총 통화 객체 수)
  inserted:        0,  // Records successfully upserted into call_logs (call_logs에 성공적으로 업서트된 레코드 수)
  skippedNoStore:  0,  // Calls skipped because no matching store was found (일치하는 매장이 없어 건너뛴 통화 수)
  skippedErrors:   0,  // Calls skipped due to mapping or DB errors (매핑 또는 DB 오류로 건너뛴 통화 수)
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Simple sleep utility for rate-limit-friendly delays between batch writes.
// (배치 쓰기 간 속도 제한 친화적 지연을 위한 간단한 슬립 유틸리티)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Format elapsed milliseconds into a human-readable "Xm Ys" string for the summary.
// (요약을 위해 경과 밀리초를 "Xm Ys" 형식의 가독성 좋은 문자열로 포맷)
function formatElapsed(ms) {
  const totalSecs = Math.round(ms / 1000);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ── Store lookup ──────────────────────────────────────────────────────────────

// Look up the Supabase stores.id that owns the given Retell agent_id.
// Results are cached in agentStoreCache to eliminate redundant DB queries.
// Returns null and logs a warning when no matching store exists.
// (주어진 Retell agent_id를 소유한 Supabase stores.id 조회.
//  중복 DB 쿼리 제거를 위해 agentStoreCache에 결과 캐시.
//  일치하는 매장이 없으면 null 반환 후 경고 로그 출력)
async function resolveStoreId(agentId) {
  // Return cached result immediately if available (캐시된 결과가 있으면 즉시 반환)
  if (agentStoreCache.has(agentId)) {
    return agentStoreCache.get(agentId);
  }

  const { data, error } = await supabase
    .from('stores')
    .select('id')
    .eq('retell_agent_id', agentId)
    .maybeSingle();

  if (error) {
    console.warn(`  [store-lookup] DB error for agent ${agentId}: ${error.message} (에이전트 ${agentId} 매장 조회 DB 오류)`);
    agentStoreCache.set(agentId, null);
    return null;
  }

  const storeId = data?.id ?? null;

  if (!storeId) {
    // Log once per unseen agent_id — cache prevents repeated warnings on the same agent.
    // (처음 발견된 agent_id에 대해서만 로그 — 캐시로 동일 에이전트 반복 경고 방지)
    console.warn(`  [store-lookup] No store found for agent_id: ${agentId} — calls will be skipped (에이전트 ${agentId}에 대한 매장 없음 — 통화 건너뜀)`);
  } else {
    console.log(`  [store-lookup] agent ${agentId} → store ${storeId} (캐시에 저장됨)`);
  }

  agentStoreCache.set(agentId, storeId);
  return storeId;
}

// ── Payload mapper ────────────────────────────────────────────────────────────

// Transform a raw Retell call object into the exact call_logs row schema.
// Column names and value types here are the authoritative mapping agreed with the DB schema.
// (원시 Retell 통화 객체를 정확한 call_logs 행 스키마로 변환.
//  컬럼명과 값 타입은 DB 스키마와 합의된 권위 있는 매핑임)
function mapCallToRow(call, storeId) {
  return {
    call_id:        call.call_id,
    store_id:       storeId,
    agent_id:       call.agent_id,

    // Retell sends start_timestamp as Unix milliseconds — convert to ISO-8601 for timestamptz.
    // (Retell은 start_timestamp를 Unix 밀리초로 전송 — timestamptz용 ISO-8601로 변환)
    start_time:     new Date(call.start_timestamp).toISOString(),

    // from_number is the caller's phone number — fall back to 'Unknown' if absent.
    // (from_number는 발신자 전화번호 — 없으면 'Unknown'으로 폴백)
    customer_phone: call.from_number || 'Unknown',

    // Prefer duration_ms converted to integer seconds; fall back to total_duration_seconds.
    // (duration_ms를 정수 초로 변환 우선; total_duration_seconds로 폴백)
    duration:       Math.floor(call.duration_ms / 1000) || call.total_duration_seconds || 0,

    // user_sentiment from call_analysis — default 'Neutral' when analysis is missing.
    // (call_analysis의 user_sentiment — 분석 누락 시 'Neutral' 기본값)
    sentiment:      call.call_analysis?.user_sentiment || 'Neutral',

    // call_successful boolean maps to 'Successful'/'Unsuccessful' status string.
    // (call_successful 불리언을 'Successful'/'Unsuccessful' 상태 문자열로 매핑)
    call_status:    call.call_analysis?.call_successful ? 'Successful' : 'Unsuccessful',

    // combined_cost from call_cost object — 0 when billing data is absent.
    // (call_cost 객체의 combined_cost — 비용 데이터 없으면 0)
    cost:           call.call_cost?.combined_cost || 0,

    // recording_url is a direct CDN link from Retell — empty string when not available.
    // (recording_url은 Retell의 직접 CDN 링크 — 없으면 빈 문자열)
    recording_url:  call.recording_url || '',

    // call_summary is the AI-generated summary from call_analysis.
    // (call_summary는 call_analysis에서 생성된 AI 요약)
    summary:        call.call_analysis?.call_summary || '',

    // transcript_object is the full JSONB turn array — empty array when unavailable.
    // (transcript_object는 전체 JSONB 턴 배열 — 없으면 빈 배열)
    transcript:     call.transcript_object || [],
  };
}

// ── Retell API fetcher ────────────────────────────────────────────────────────

// Fetch a single page of calls from the Retell v2 list-calls endpoint using POST.
// Retell v2 returns a direct JSON array — NOT a wrapped object like { calls: [] }.
// The pagination_key for the next page lives inside the last element's metadata
// OR is returned as a top-level field depending on account tier; we handle both shapes.
// (POST를 사용하여 Retell v2 list-calls 엔드포인트에서 단일 페이지 통화 목록 조회.
//  Retell v2는 { calls: [] }와 같은 래핑 객체가 아닌 직접 JSON 배열을 반환.
//  다음 페이지의 pagination_key는 계정 등급에 따라 마지막 요소 메타데이터 또는
//  최상위 필드에 있으며, 두 가지 형태 모두 처리함)
async function fetchRetellPage(paginationKey = null) {
  // Start with an empty body — Retell returns all calls when no filter is applied.
  // (빈 바디로 시작 — 필터 없이 Retell이 모든 통화를 반환함)
  const body = {};

  // Append pagination_key only on subsequent pages to advance the cursor.
  // (커서를 진행하기 위해 후속 페이지에만 pagination_key 추가)
  if (paginationKey) {
    body.pagination_key = paginationKey;
  }

  // Send POST request with Content-Type header — required even for an empty body.
  // (빈 바디에도 Content-Type 헤더가 필요한 POST 요청 전송)
  const response = await fetch(`${RETELL_BASE_URL}/v2/list-calls`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${RETELL_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Retell API error ${response.status}: ${text} (Retell API 오류 ${response.status}: ${text})`);
  }

  const raw = await response.json();

  // Normalise response shape: Retell v2 returns a plain array, not { calls: [] }.
  // Guard for both formats so the script survives any future Retell API changes.
  // (응답 형태 정규화: Retell v2는 { calls: [] }가 아닌 일반 배열을 반환.
  //  향후 Retell API 변경에도 스크립트가 동작하도록 두 형태 모두 처리)
  const calls       = Array.isArray(raw) ? raw            : (raw.calls          ?? []);
  const nextCursor  = Array.isArray(raw) ? null           : (raw.pagination_key ?? null);

  // Log the raw response type on the very first page to aid debugging.
  // (첫 번째 페이지에서 원시 응답 유형을 로그에 출력하여 디버깅 지원)
  if (!paginationKey) {
    console.log(`  [api] Response shape: ${Array.isArray(raw) ? 'array' : 'object'}, calls parsed: ${calls.length} (응답 형태: ${Array.isArray(raw) ? '배열' : '객체'}, 파싱된 통화 수: ${calls.length})`);
  }

  return { calls, nextCursor };
}

// ── Supabase batch upsert ─────────────────────────────────────────────────────

// Upsert a batch of mapped call_logs rows — idempotent on call_id conflict.
// Returns the count of successfully upserted rows.
// (매핑된 call_logs 행 배치 업서트 — call_id 충돌 시 멱등성 보장.
//  성공적으로 업서트된 행 수 반환)
async function upsertBatch(rows) {
  if (DRY_RUN) {
    // In dry-run mode, print a preview without touching the database (드라이런 모드에서 DB 수정 없이 미리보기 출력)
    console.log(`  [dry-run] Would upsert ${rows.length} rows (${rows.length}개 행 업서트 예정)`);
    rows.forEach((r) => console.log(`    call_id=${r.call_id}  store_id=${r.store_id}  status=${r.call_status}`));
    return rows.length;
  }

  const { error } = await supabase
    .from('call_logs')
    .upsert(rows, { onConflict: 'call_id' });

  if (error) {
    throw new Error(`Supabase upsert failed: ${error.message} (Supabase 업서트 실패: ${error.message})`);
  }

  return rows.length;
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();

  console.log('');
  console.log('==========================================================');
  console.log(' sync-retell — Retell AI → Supabase historical call sync  ');
  if (DRY_RUN) console.log(' MODE: DRY RUN — no database writes will occur         ');
  console.log('==========================================================');
  console.log('');

  let paginationKey = null; // Cursor for the next Retell API page (다음 Retell API 페이지 커서)
  let pageNum       = 0;

  // Pending rows buffer — accumulated across pages and flushed in UPSERT_BATCH_SIZE chunks.
  // (대기 중인 행 버퍼 — 페이지 전체에서 누적하고 UPSERT_BATCH_SIZE 청크로 플러시)
  const pendingRows = [];

  // Flush helper — upserts all pending rows in fixed-size batches then clears the buffer.
  // (플러시 헬퍼 — 고정 크기 배치로 모든 대기 중인 행을 업서트한 후 버퍼 초기화)
  async function flushPending(force = false) {
    while (pendingRows.length >= UPSERT_BATCH_SIZE || (force && pendingRows.length > 0)) {
      const batch = pendingRows.splice(0, UPSERT_BATCH_SIZE);
      try {
        const count = await upsertBatch(batch);
        stats.inserted += count;
        console.log(`  [upsert] Saved ${count} rows (total: ${stats.inserted}) (${count}개 저장 완료, 총: ${stats.inserted}개)`);
      } catch (err) {
        console.error(`  [upsert] Batch failed — skipping ${batch.length} rows: ${err.message} (배치 실패 — ${batch.length}개 행 건너뜀)`);
        stats.skippedErrors += batch.length;
      }
      // Pause briefly between batch writes to stay within Supabase rate limits.
      // (Supabase 속도 제한 내에 머물기 위해 배치 쓰기 사이에 잠시 일시 정지)
      if (pendingRows.length > 0) await sleep(BATCH_DELAY_MS);
    }
  }

  // ── Pagination loop — runs until Retell returns no pagination_key ─────────
  // (페이지네이션 루프 — Retell이 pagination_key를 반환하지 않을 때까지 실행)
  do {
    pageNum++;
    console.log(`[page ${pageNum}] Fetching calls via POST /v2/list-calls${paginationKey ? ` (cursor: ${paginationKey.slice(0, 12)}…)` : ''} (POST /v2/list-calls로 통화 조회 중)`);

    // Fetch one page — throw on non-200 responses (한 페이지 조회 — 200 이외 응답에서 예외 발생)
    let page;
    try {
      page = await fetchRetellPage(paginationKey);
    } catch (err) {
      console.error(`[page ${pageNum}] Retell fetch failed: ${err.message} (Retell 조회 실패)`);
      console.error('  Aborting sync. Already-processed calls are committed. (동기화 중단. 이미 처리된 통화는 커밋됨)');
      break;
    }

    // Destructure the normalised response produced by fetchRetellPage (fetchRetellPage가 생성한 정규화된 응답을 구조분해)
    const { calls, nextCursor } = page;
    stats.pagesFetched++;
    stats.totalFetched += calls.length;
    console.log(`[page ${pageNum}] Received ${calls.length} calls (${calls.length}개 통화 수신)`);

    if (calls.length === 0) {
      // Retell returned an empty page — treat as end of data regardless of pagination_key.
      // (Retell이 빈 페이지를 반환 — pagination_key와 관계없이 데이터 끝으로 처리)
      console.log('[page] Empty page received — assuming end of data (빈 페이지 수신 — 데이터 끝으로 간주)');
      paginationKey = null;
      break;
    }

    // ── Process each call on this page ────────────────────────────────────────
    for (const call of calls) {
      // Skip calls without a call_id — they cannot be upserted safely (call_id가 없는 통화 건너뜀 — 안전하게 업서트 불가)
      if (!call.call_id || !call.agent_id) {
        console.warn(`  [skip] call_id or agent_id missing — skipping (call_id 또는 agent_id 누락 — 건너뜀)`);
        stats.skippedErrors++;
        continue;
      }

      // Resolve the owning store — cached after the first lookup per agent (소유 매장 확인 — 에이전트당 첫 조회 후 캐시됨)
      const storeId = await resolveStoreId(call.agent_id);

      if (!storeId) {
        // No store mapped to this agent — skip silently (warning already logged in resolveStoreId).
        // (이 에이전트에 매핑된 매장 없음 — resolveStoreId에서 이미 경고 로그 출력)
        stats.skippedNoStore++;
        continue;
      }

      // Map raw Retell fields to the strict call_logs column schema (원시 Retell 필드를 엄격한 call_logs 컬럼 스키마에 매핑)
      let row;
      try {
        row = mapCallToRow(call, storeId);
      } catch (err) {
        console.error(`  [map] Failed to map call ${call.call_id}: ${err.message} (통화 ${call.call_id} 매핑 실패)`);
        stats.skippedErrors++;
        continue;
      }

      // Accumulate row into the pending buffer (행을 대기 버퍼에 누적)
      pendingRows.push(row);

      // Flush whenever the buffer reaches the batch threshold (버퍼가 배치 임계값에 도달하면 플러시)
      await flushPending();
    }

    // Advance cursor using the normalised nextCursor from fetchRetellPage.
    // null means this was the final page — the do-while condition exits the loop.
    // (fetchRetellPage의 정규화된 nextCursor로 커서 진행.
    //  null은 마지막 페이지를 의미 — do-while 조건이 루프를 종료)
    paginationKey = nextCursor;

    if (paginationKey) {
      // Brief pause between Retell API pages to avoid hitting rate limits.
      // (속도 제한 방지를 위한 Retell API 페이지 간 짧은 일시 정지)
      await sleep(100);
    }
  } while (paginationKey);

  // Flush any rows that didn't fill a complete batch (완전한 배치를 채우지 못한 나머지 행 플러시)
  await flushPending(true);

  // ── Final summary report ──────────────────────────────────────────────────
  const elapsed = Date.now() - startedAt;
  console.log('');
  console.log('==========================================================');
  console.log(' SYNC COMPLETE (동기화 완료)');
  console.log('==========================================================');
  console.log(`  Pages fetched      : ${stats.pagesFetched}    (조회된 페이지 수)`);
  console.log(`  Total calls from API: ${stats.totalFetched}  (API에서 수신한 총 통화 수)`);
  console.log(`  Inserted / updated : ${stats.inserted}   (삽입/업데이트된 레코드 수)`);
  console.log(`  Skipped (no store) : ${stats.skippedNoStore}   (매장 없음으로 건너뛴 수)`);
  console.log(`  Skipped (errors)   : ${stats.skippedErrors}   (오류로 건너뛴 수)`);
  console.log(`  Elapsed time       : ${formatElapsed(elapsed)}  (경과 시간)`);
  if (DRY_RUN) console.log('  NOTE: DRY RUN — zero rows were written to the database (주의: 드라이런 — 데이터베이스에 쓰여진 행 없음)');
  console.log('==========================================================');
  console.log('');

  // Exit with non-zero code if any records encountered errors — useful in CI pipelines.
  // (CI 파이프라인에서 유용하도록 오류 발생 레코드가 있으면 비정상 종료 코드로 종료)
  if (stats.skippedErrors > 0) {
    process.exit(1);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

// Catch unhandled top-level errors so the process always exits cleanly.
// (항상 깔끔하게 종료되도록 처리되지 않은 최상위 오류 포착)
main().catch((err) => {
  console.error('[sync-retell] Fatal unhandled error (치명적 오류):', err.message);
  process.exit(1);
});
