/**
 * POS Adapter Factory — resolves the correct PosAdapter from the tenant's storeContext.
 * Controllers and queue workers call this factory; they never instantiate adapters directly.
 * (POS 어댑터 팩토리 — 테넌트 storeContext에서 올바른 PosAdapter 반환)
 * (컨트롤러와 큐 워커는 이 팩토리를 호출하며, 어댑터를 직접 생성하지 않음)
 */

import { LoyverseAdapter } from './loyverse.js';
import { QuanticAdapter }  from './quantic.js';
import { PosError }        from './interface.js';

// Registry map — keys are canonical uppercase POS system names (레지스트리 맵 — 키는 정규화된 대문자 POS 시스템명)
const POS_REGISTRY = {
  LOYVERSE: (apiKey) => new LoyverseAdapter(apiKey),
  QUANTIC:  (apiKey) => new QuanticAdapter(apiKey),
};

/**
 * Resolve and instantiate a POS adapter for a given store configuration.
 * Reads pos_system (DB/snake_case) with a posType (camelCase) fallback for compatibility.
 * (스토어 구성에 따라 POS 어댑터 해석 및 생성.
 *  pos_system(DB/스네이크케이스) 우선, posType(카멜케이스) 폴백)
 *
 * @param {object} storeConfig                — tenant store context (테넌트 스토어 컨텍스트)
 * @param {string} storeConfig.pos_system     — POS system key, e.g. 'LOYVERSE' | 'QUANTIC' (POS 시스템 키)
 * @param {string} [storeConfig.posType]      — camelCase alias for pos_system (카멜케이스 별칭)
 * @param {string} storeConfig.pos_api_key    — API key/token for the POS system (POS 시스템 API 키)
 * @param {string} [storeConfig.posApiKey]    — camelCase alias for pos_api_key (카멜케이스 별칭)
 * @returns {PosAdapter}
 * @throws  {PosError} when pos_system is not in the registry (등록되지 않은 pos_system이면 PosError)
 */
export function getPosAdapter(storeConfig) {
  // Accept both snake_case (from DB) and camelCase (from storeContext) field names
  // (DB의 스네이크케이스와 storeContext의 카멜케이스를 모두 허용)
  const posKey = (storeConfig.pos_system ?? storeConfig.posType)?.toUpperCase();
  const apiKey =  storeConfig.pos_api_key  ?? storeConfig.posApiKey;

  const factory = POS_REGISTRY[posKey];

  if (!factory) {
    // Unknown POS system — fail loudly so misconfigured tenants surface immediately
    // (알 수 없는 POS 시스템 — 잘못 구성된 테넌트를 즉시 드러내기 위해 명확한 오류 발생)
    const supported = Object.keys(POS_REGISTRY).join(', ');
    throw new PosError(
      `[PosFactory] Unknown POS system "${posKey}". Supported: ${supported}. ` +
      `(알 수 없는 POS 시스템 "${posKey}". 지원 목록: ${supported})`,
      'PosFactory',
      'UNKNOWN_POS_SYSTEM'
    );
  }

  // Pass the tenant's API key into the adapter constructor (테넌트 API 키를 어댑터 생성자에 전달)
  return factory(apiKey);
}
