// Retell AI webhook receiver — processes call_analyzed events and stores results in Supabase.
// Retell sends ALL event types here; non-target events are acknowledged and dropped immediately.
// Signature verification is omitted — Retell no longer exposes a webhook secret in the dashboard.
// (Retell AI 웹훅 수신기 — call_analyzed 이벤트를 처리하고 결과를 Supabase에 저장.
//  Retell이 모든 이벤트 타입을 전송하므로 대상 외 이벤트는 즉시 응답 후 폐기.
//  Retell 대시보드에서 웹훅 시크릿을 더 이상 제공하지 않아 서명 검증 생략)

import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Supabase admin client — service role bypasses RLS for trusted server writes.
// (서비스 롤 키로 RLS를 우회하는 Supabase 관리자 클라이언트)
// ---------------------------------------------------------------------------
function getAdminClient() {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(url, key, {
    auth: { persistSession: false }, // No session persistence needed for server-side use (서버 사이드에서 세션 유지 불필요)
  });
}

// ---------------------------------------------------------------------------
// Retell payload shape — only fields we consume are typed here.
// (소비하는 필드만 타입 정의한 Retell 페이로드 형태)
// ---------------------------------------------------------------------------
interface RetellPayload {
  event:             string;
  call: {
    call_id:          string;
    agent_id:         string;
    start_timestamp:  number;        // Unix ms (Unix 밀리초)
    duration_ms:      number;
    user_sentiment?:  string | null;
    call_status:      string;
    cost?:            number | null;
    recording_url?:   string | null;
    call_analysis?: {
      call_summary?:    string | null;
      transcript_object?: unknown;
    };
  };
}

// ---------------------------------------------------------------------------
// POST /api/webhooks/retell
// (POST 핸들러 — Retell 이벤트 수신 및 처리)
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Parse incoming JSON payload — malformed bodies return 200 so Retell does not retry.
  // (수신 JSON 페이로드 파싱 — 잘못된 바디는 Retell 재시도 방지를 위해 200 반환)
  let payload: RetellPayload;
  try {
    payload = await request.json();
  } catch {
    console.warn('[retell-webhook] Failed to parse JSON body — ignoring (JSON 바디 파싱 실패 — 무시)');
    return NextResponse.json({ received: true, processed: false, reason: 'invalid json' }, { status: 200 });
  }

  // Ignore events other than call_analyzed — Retell sends all event types to this endpoint.
  // (call_analyzed 이외의 이벤트는 무시 — Retell이 모든 이벤트 타입을 이 엔드포인트로 전송)
  if (payload.event !== 'call_analyzed') {
    return NextResponse.json({ received: true, processed: false }, { status: 200 });
  }

  const { call } = payload;

  // Validate required fields — missing data is logged and acknowledged without retrying.
  // (필수 필드 검증 — 누락된 데이터는 로그 후 재시도 없이 응답)
  if (!call?.call_id || !call?.agent_id) {
    console.warn('[retell-webhook] Missing call_id or agent_id in payload (페이로드에 call_id 또는 agent_id 누락)');
    return NextResponse.json({ received: true, processed: false, reason: 'missing required fields' }, { status: 200 });
  }

  try {
    const supabase = getAdminClient();

    // Look up store_id by agent_id — agents table maps Retell agent IDs to store records.
    // (agent_id로 store_id 조회 — agents 테이블이 Retell 에이전트 ID를 스토어 레코드에 매핑)
    const { data: agentRow, error: agentError } = await supabase
      .from('agents')
      .select('store_id')
      .eq('agent_id', call.agent_id)
      .maybeSingle();

    if (agentError) {
      // DB read errors are non-critical for Retell — log and return 200 to suppress retries.
      // (DB 읽기 오류는 Retell에 비중요 — 로그 후 재시도 억제를 위해 200 반환)
      console.error('[retell-webhook] Agent lookup failed (에이전트 조회 실패):', agentError.message);
      return NextResponse.json({ received: true, processed: false, reason: 'agent lookup error' }, { status: 200 });
    }

    // agent_id not registered in our system — log and return 200 to stop Retell from retrying.
    // (시스템에 등록되지 않은 agent_id — 로그 남기고 200 반환으로 Retell 재시도 중단)
    if (!agentRow) {
      console.warn(`[retell-webhook] Unknown agent_id: ${call.agent_id} (등록되지 않은 에이전트 ID)`);
      return NextResponse.json({ received: true, processed: false, reason: 'unknown agent' }, { status: 200 });
    }

    const storeId = agentRow.store_id;

    // Map Retell payload fields to call_logs table columns.
    // start_timestamp is Unix ms from Retell — convert to ISO-8601 string for timestamptz.
    // (Retell 페이로드 필드를 call_logs 테이블 컬럼에 매핑.
    //  start_timestamp는 Retell의 Unix ms — timestamptz용 ISO-8601 문자열로 변환)
    const callLogRow = {
      call_id:          call.call_id,
      agent_id:         call.agent_id,
      store_id:         storeId,
      start_timestamp:  new Date(call.start_timestamp).toISOString(),
      duration_ms:      call.duration_ms    ?? null,
      user_sentiment:   call.user_sentiment ?? null,
      call_status:      call.call_status,
      cost:             call.cost           ?? null,
      recording_url:    call.recording_url  ?? null,
      summary:          call.call_analysis?.call_summary      ?? null,
      transcript_object: call.call_analysis?.transcript_object ?? null, // Stored as JSONB (JSONB로 저장)
    };

    // Upsert on call_id to make this handler idempotent against Retell retries.
    // (Retell 재시도에 대한 멱등성 보장을 위해 call_id 기준 upsert)
    const { error: insertError } = await supabase
      .from('call_logs')
      .upsert(callLogRow, { onConflict: 'call_id' });

    if (insertError) {
      console.error('[retell-webhook] Failed to upsert call_log (통화 로그 upsert 실패):', insertError.message);
      return NextResponse.json({ error: 'Database write failed' }, { status: 500 });
    }

    console.log(`[retell-webhook] call_analyzed stored — call_id: ${call.call_id}, store_id: ${storeId} (통화 분석 저장 완료)`);

    return NextResponse.json({ received: true, processed: true, call_id: call.call_id }, { status: 200 });

  } catch (err) {
    // Catch-all for unexpected runtime errors — return 200 to prevent unnecessary Retell retries.
    // (예상치 못한 런타임 오류 캐치 — 불필요한 Retell 재시도 방지를 위해 200 반환)
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[retell-webhook] Unexpected error (예상치 못한 오류):', message);
    return NextResponse.json({ received: true, processed: false, reason: 'internal error' }, { status: 200 });
  }
}
