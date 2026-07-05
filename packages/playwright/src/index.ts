export { withRelocator } from './fixture.js';
export { applyProfile } from './engine.js';
export type { RelocatorOptions, GateThresholds, LLMOptions } from './engine.js';
export {
  wrapPage,
  wrapLocator,
  unwrap,
  RAW_TARGET,
  withInitialTimeout,
  computeInitialActionTimeout,
} from './wrap.js';
export type { WrapHooks, ActionFailure, LocatorMeta } from './wrap.js';
export { normalizePagePattern, serializeCall, chainKey } from './keys.js';
export { captureFingerprint, collectAndScore } from './inpage-client.js';
export type { ScoreRequest, ScoreResponse, ScoredElement } from './inpage/main.js';
