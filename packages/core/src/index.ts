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
