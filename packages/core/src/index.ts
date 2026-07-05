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

export { VON_IOU_THRESHOLD, intersectionOverUnion, mergeOverlapping } from './scoring/von.js';
export type { VonGroup, VonRect } from './scoring/von.js';

export { GATE_PRESETS, evaluateGate, iqrUpperOutlierThreshold, thresholdGate } from './gate/outlier.js';
export type {
  GateDecision,
  GatePreset,
  GateResult,
  ScoredForGate,
  ThresholdGateConfig,
} from './gate/outlier.js';

export { classifyFailure, isHealable } from './classify/failure.js';
export type { FailureClass } from './classify/failure.js';

export { MASKED, RELOCATOR_PROPERTIES, fingerprintToWidgetProps } from './fingerprint/types.js';
export type { Callsite, ElementFingerprint, ElementRect } from './fingerprint/types.js';

export type {
  DisambiguationCandidate,
  DisambiguationInput,
  DisambiguationResult,
  LLMProvider,
} from './llm/types.js';
