/**
 * IQR-based upper-outlier gate over candidate scores — the deterministic
 * "is the winner unambiguous?" test proposed as future work in the
 * VON Similo LLM paper (arXiv:2310.02046) and prototyped in its
 * replication package. Tier 2 of the healing cascade builds on this.
 */

export interface GateResult {
  /** q3 + 1.5 * IQR over the top-10 scores (zero-padded, see below). */
  threshold: number;
  /** Number of candidates at or above the threshold. */
  outlierCount: number;
  /** True when exactly one candidate stands out — safe to adopt without LLM. */
  unique: boolean;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.trunc(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid]! + sorted[mid - 1]!) / 2 : sorted[mid]!;
}

/**
 * Faithful port including the reference quirk: the top array is always
 * length 10 and zero-padded when there are fewer candidates, which biases
 * q1 downward on small candidate sets. Kept as-is for benchmark parity;
 * revisit before the runtime gate ships.
 */
export function iqrUpperOutlierThreshold(scores: readonly number[]): number {
  const sortedDesc = [...scores].sort((a, b) => b - a);
  const top = new Array<number>(10).fill(0);
  const count = Math.min(10, sortedDesc.length);
  for (let i = 0; i < count; i++) {
    top[i] = sortedDesc[i]!;
  }
  const higher = top.slice(0, 5);
  const lower = top.slice(5);
  const q1 = median(lower);
  const q3 = median(higher);
  const iqr = q3 - q1;
  return q3 + 1.5 * iqr;
}

export function evaluateGate(scores: readonly number[]): GateResult {
  const threshold = iqrUpperOutlierThreshold(scores);
  const outlierCount = scores.filter((s) => s >= threshold).length;
  return { threshold, outlierCount, unique: outlierCount === 1 };
}
