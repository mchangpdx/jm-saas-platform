// ai-voice-bot module public API — only these exports are visible to other modules.
// Internal helpers (hooks, sub-components) are NOT re-exported here to keep the
// module boundary sealed. Adding or refactoring internals never breaks consumers.
// (ai-voice-bot 모듈 공개 API — 이 내보내기만 다른 모듈에서 접근 가능.
//  내부 헬퍼(훅, 하위 컴포넌트)는 여기서 재내보내기 하지 않아 모듈 경계 유지.
//  내부 추가·리팩토링이 소비자를 절대 깨뜨리지 않음)

export { PromptManager } from './PromptManager';
export { CallLog }       from './CallLog';
