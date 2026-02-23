// Tenant resolution middleware — resolves agent_id to a full store context (테넌트 미들웨어 — agent_id를 스토어 컨텍스트로 변환)
import { supabase } from '../config/supabase.js';

/**
 * Resolves the calling tenant from `agent_id` in the request body.
 * Attaches a `storeContext` object to `req` for downstream handlers to use.
 * (요청 바디의 agent_id로 테넌트를 식별하고, req.storeContext를 하위 핸들러에 주입)
 *
 * req.storeContext shape:
 * {
 *   agentId:     string   — unique tenant identifier (테넌트 고유 ID)
 *   storeName:   string   — human-readable store name (매장명)
 *   posType:     string   — POS system key, e.g. 'LOYVERSE' | 'QUANTIC' (POS 시스템 키)
 *   posApiKey:   string   — API key/token for the POS system (POS 시스템 API 키/토큰)
 *   paymentType: string   — payment adapter key, e.g. 'stripe' | 'toss' (결제 어댑터 키)
 *   timezone:    string   — store timezone (매장 타임존)
 *   active:      boolean  — whether the agent subscription is active (구독 활성 여부)
 * }
 */
export async function tenantMiddleware(req, res, next) {
  // Extract agent_id from request body — required for all tenant-scoped routes (요청 바디에서 agent_id 추출 — 테넌트 스코프 라우트 필수 값)
  const agentId = req.body?.agent_id;

  if (!agentId) {
    return res.status(400).json({
      error: 'agent_id is required in request body',
      // 한글 오류 메시지 (Korean error message)
      message: 'agent_id가 요청 바디에 없습니다.',
    });
  }

  try {
    // Fetch store context from Supabase agents table (Supabase agents 테이블에서 스토어 컨텍스트 조회)
    const storeContext = await resolveStoreContext(agentId);

    if (!storeContext) {
      return res.status(404).json({
        error: `No store found for agent_id: ${agentId}`,
        message: '해당 agent_id에 등록된 스토어가 없습니다.',
      });
    }

    if (!storeContext.active) {
      return res.status(403).json({
        error: 'Agent subscription is inactive',
        message: '에이전트 구독이 비활성 상태입니다.',
      });
    }

    // Attach resolved context to request for downstream use (하위 핸들러에서 사용할 컨텍스트를 req에 주입)
    req.storeContext = storeContext;

    next();
  } catch (err) {
    console.error('[tenantMiddleware] Failed to resolve store context (스토어 컨텍스트 조회 실패):', err.message);
    next(err);
  }
}

/**
 * Resolves store context by agent_id.
 * In production this queries `agents` table in Supabase.
 * During local dev / testing it falls back to a mock record.
 * (운영 환경: Supabase agents 테이블 조회 / 로컬 개발: 목 데이터 반환)
 *
 * @param {string} agentId
 * @returns {Promise<object|null>}
 */
async function resolveStoreContext(agentId) {
  // ── MOCK PATH ── return deterministic fixtures when Supabase is not yet wired (Supabase 미연결 시 목 데이터 반환)
  if (process.env.NODE_ENV === 'development' && process.env.USE_MOCK_TENANT === 'true') {
    return getMockStoreContext(agentId);
  }

  // ── PRODUCTION PATH ── query Supabase agents table (운영 경로 — Supabase agents 테이블 실조회)
  const { data, error } = await supabase
    .from('agents')
    .select('id, store_name, pos_type, pos_api_key, payment_type, timezone, active')
    .eq('id', agentId)
    .single();

  if (error) {
    // Not-found is a business-level miss, not a system error (데이터 없음은 시스템 오류가 아닌 비즈니스 레벨 처리)
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  // Normalize DB column names to camelCase storeContext shape (DB 컬럼명을 camelCase storeContext 형태로 정규화)
  return {
    agentId:     data.id,
    storeName:   data.store_name,
    posType:     data.pos_type,
    posApiKey:   data.pos_api_key,   // POS API key passed to the POS adapter factory (POS 어댑터 팩토리에 전달될 POS API 키)
    paymentType: data.payment_type,
    timezone:    data.timezone ?? 'America/Los_Angeles',
    active:      data.active,
  };
}

/**
 * Mock store context factory for local development.
 * Returns a realistic fixture so routes can be tested without a live Supabase DB.
 * (로컬 개발용 목 스토어 컨텍스트 — 실제 DB 없이 라우트 테스트 가능)
 *
 * @param {string} agentId
 * @returns {object|null}
 */
function getMockStoreContext(agentId) {
  const MOCK_STORES = {
    'agent-001': {
      agentId:     'agent-001',
      storeName:   'JM Korean BBQ — Downtown',
      posType:     'LOYVERSE',
      posApiKey:   'mock-loyverse-key-001',  // Mock key for local dev (로컬 개발용 목 키)
      paymentType: 'stripe',
      timezone:    'America/Los_Angeles',
      active:      true,
    },
    'agent-002': {
      agentId:     'agent-002',
      storeName:   'JM Boba Tea — Koreatown',
      posType:     'QUANTIC',
      posApiKey:   'mock-quantic-key-002',   // Mock key for local dev (로컬 개발용 목 키)
      paymentType: 'toss',
      timezone:    'America/Los_Angeles',
      active:      true,
    },
  };

  return MOCK_STORES[agentId] ?? null;
}
