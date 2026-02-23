/**
 * POS Adapter Factory — resolves the correct PosAdapter based on the tenant's pos_system config.
 * Controllers and queue workers call this factory; they never instantiate adapters directly.
 * (POS 어댑터 팩토리 — 테넌트 pos_system 설정에 따라 올바른 PosAdapter 반환)
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
 * (스토어 구성에 따라 POS 어댑터 해석 및 생성)
 *
 * @param {object} storeConfig              — tenant store context (테넌트 스토어 컨텍스트)
 * @param {string} storeConfig.posType      — POS system identifier, e.g. 'LOYVERSE' (POS 시스템 식별자)
 * @param {string} [storeConfig.posApiKey]  — API key/token for the POS system (POS 시스템 API 키)
 * @returns {import('./interface.js').PosAdapter}
 * @throws  {PosError} when posType is not registered in the registry (등록되지 않은 posType이면 PosError 발생)
 */
export function getPosAdapter(storeConfig) {
  // Normalize to uppercase to handle mixed-case values from the DB (DB의 대소문자 혼합 값을 처리하기 위해 대문자로 정규화)
  const posKey = storeConfig.posType?.toUpperCase();

  const factory = POS_REGISTRY[posKey];

  if (!factory) {
    // Unknown POS type — fail loudly so misconfigured tenants are caught early
    // (알 수 없는 POS 타입 — 잘못 구성된 테넌트를 조기에 감지하기 위해 명확한 오류 발생)
    const supported = Object.keys(POS_REGISTRY).join(', ');
    throw new PosError(
      `[PosFactory] Unknown POS adapter "${posKey}". Supported: ${supported}. ` +
      `(알 수 없는 POS 어댑터 "${posKey}". 지원 목록: ${supported})`,
      'PosFactory',
      'UNKNOWN_POS_ADAPTER'
    );
  }

  // Pass the tenant's POS API key into the adapter constructor (테넌트 POS API 키를 어댑터 생성자에 전달)
  return factory(storeConfig.posApiKey ?? storeConfig.pos_api_key);
}
