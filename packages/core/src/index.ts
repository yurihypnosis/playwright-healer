export {
  SIMILO_PROPERTIES,
  VON_SEPARATOR,
  calcMaxSimilarityScore,
  calcSimilarityScore,
  rankCandidates,
} from './scoring/similo.js';
export type {
  PropertySpec,
  ScoredCandidate,
  SimilarityKind,
  WidgetProps,
} from './scoring/similo.js';

export { evaluateGate, iqrUpperOutlierThreshold } from './gate/outlier.js';
export type { GateResult } from './gate/outlier.js';

export { classifyFailure, isHealable } from './classify/failure.js';
export type { FailureClass } from './classify/failure.js';

export { RELOCATOR_PROPERTIES, fingerprintToWidgetProps } from './fingerprint/types.js';
export type { Callsite, ElementFingerprint, ElementRect } from './fingerprint/types.js';
