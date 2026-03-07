// Retell AI webhook receiver — processes call_analyzed events and stores results in Supabase.
// Uses the service role key for server-to-server writes with no user session context.
// (Retell AI 웹훅 수신기 — call_analyzed 이벤트를 처리하고 결과를 Supabase에 저장)

import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';

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
// Signature verification — HMAC-SHA256 over the raw request body.
// Only enforced when RETELL_WEBHOOK_SECRET is set in the environment.
// (원시 요청 바디에 대한 HMAC-SHA256 서명 검증 — RETELL_WEBHOOK_SECRET 설정 시에만 적용)
// ---------------------------------------------------------------------------
async function verifySignature(request: NextRequest, rawBody: string): Promise<boolean> {
  const secret = process.env.RETELL_WEBHOOK_SECRET;

  // Secret not configured — skip verification and trust all requests.
  // (시크릿 미설정 — 검증 건너뛰고 모든 요청 신뢰)
  if (!secret) return true;

  const signature = request.headers.get('x-retell-signature');
  if (!signature) return false;

  // Compute expected HMAC-SHA256 digest in hex (예상 HMAC-SHA256 다이제스트 hex 계산)
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

  // Timing-safe comparison prevents timing attacks (타이밍 공격 방지를 위한 타이밍 안전 비교)
  try {
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    // Buffer lengths differ — signature is definitely invalid (버퍼 길이 불일치 — 서명 무효)
    return false;
  }
}

// ---------------------------------------------------------------------------
// POST /api/webhooks/retell
// (POST 핸들러 — Retell 이벤트 수신 및 처리)
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Read raw body once so it can be used for both signature check and JSON parse.
  // (서명 검증과 JSON 파싱 모두에 사용할 수 있도록 원시 바디를 한 번만 읽음)
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: 'Failed to read request body' }, { status: 400 });
  }

  // Verify webhook authenticity before doing any work (작업 전 웹훅 진위성 검증)
  const isValid = await verifySignature(request, rawBody);
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Parse JSON payload (JSON 페이로드 파싱)
  let payload: RetellPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Only process call_analyzed events — acknowledge others with 200 to prevent Retell retries.
  // (call_analyzed 이벤트만 처리 — 나머지는 Retell 재시도 방지를 위해 200으로 응답)
  if (payload.event !== 'call_analyzed') {
    return NextResponse.json({ received: true, processed: false }, { status: 200 });
  }

  const { call } = payload;

  // Validate required fields are present (필수 필드 존재 여부 확인)
  if (!call?.call_id || !call?.agent_id) {
    return NextResponse.json({ error: 'Missing required fields: call_id or agent_id' }, { status: 400 });
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
      console.error('[retell-webhook] Agent lookup failed (에이전트 조회 실패):', agentError.message);
      return NextResponse.json({ error: 'Agent lookup failed' }, { status: 500 });
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
    // Catch-all for unexpected runtime errors (예상치 못한 런타임 오류 캐치)
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[retell-webhook] Unexpected error (예상치 못한 오류):', message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
