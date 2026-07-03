/**
 * TypeScript port of the Similo / VON Similo scoring algorithm
 * (Nass et al., TOSEM 2023, arXiv:2208.00677; VON Similo, arXiv:2301.03863).
 *
 * Browser-safe: pure functions only, no platform APIs. This module runs both
 * in Node (benchmarks, tuning) and inside the page (Tier 1 runtime scoring);
 * benchmark parity between the two is what backs our accuracy claims, so any
 * platform-specific code here is a bug.
 *
 * Fidelity notes (all required to reproduce the replication-package numbers):
 * - VON-merged multi-values are ' || '-joined strings; 'exact' and 'string'
 *   kinds take the max pairwise similarity across the split values, other
 *   kinds compare the raw string.
 * - Integer arithmetic in the reference (Java int division) is replicated
 *   with Math.trunc.
 * - Java String.split("\\s+") drops trailing empty strings; JS keeps them.
 * - Java Integer.parseInt rejects strings like "116,0"; JS parseInt would
 *   accept them, so parsing is regex-strict.
 */

export type SimilarityKind =
  | 'exact'
  | 'string'
  | 'integer'
  | 'location2d'
  | 'neighborText';

export interface PropertySpec {
  key: string;
  weight: number;
  kind: SimilarityKind;
  /** Weight multiplier applied when similarity is exactly 1 (Similo doubles visible_text). */
  exactBonus?: number;
}

/** Absent keys mean "unknown": the property is skipped and contributes 0. */
export type WidgetProps = Record<string, string | undefined>;

export interface ScoredCandidate<T> {
  widget: T;
  score: number;
  /** Per-property weighted contribution, kept for HealingEvent audit logs. */
  breakdown: Record<string, number>;
}

/** Property set and weights of the reference implementation. */
export const SIMILO_PROPERTIES: readonly PropertySpec[] = [
  { key: 'tag', weight: 1.5, kind: 'exact' },
  { key: 'class', weight: 0.5, kind: 'string' },
  { key: 'name', weight: 1.5, kind: 'exact' },
  { key: 'id', weight: 1.5, kind: 'exact' },
  { key: 'href', weight: 0.5, kind: 'string' },
  { key: 'alt', weight: 0.5, kind: 'string' },
  { key: 'xpath', weight: 0.5, kind: 'string' },
  { key: 'idxpath', weight: 0.5, kind: 'string' },
  { key: 'is_button', weight: 0.5, kind: 'exact' },
  { key: 'location', weight: 0.5, kind: 'location2d' },
  { key: 'area', weight: 0.5, kind: 'integer' },
  { key: 'shape', weight: 0.5, kind: 'integer' },
  { key: 'visible_text', weight: 1.5, kind: 'string', exactBonus: 2 },
  { key: 'neighbor_text', weight: 1.5, kind: 'neighborText' },
];

export const VON_SEPARATOR = ' || ';

function splitVonValues(value: string): string[] {
  return value.split(VON_SEPARATOR);
}

function toIntStrict(text: string): number {
  return /^[+-]?\d+$/.test(text) ? Number.parseInt(text, 10) : 0;
}

function equalSimilarity(a: string, b: string): number {
  return a.toLowerCase() === b.toLowerCase() ? 1 : 0;
}

function levenshtein(s1: string, s2: string): number {
  const costs = new Array<number>(s2.length + 1);
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1]!;
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(newValue, lastValue, costs[j]!) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) {
      costs[s2.length] = lastValue;
    }
  }
  return costs[s2.length]!;
}

function stringSimilarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (a.toLowerCase() === b.toLowerCase()) return 1;
  let s1 = a;
  let s2 = b;
  if (s1.length < s2.length) {
    s1 = b;
    s2 = a;
  }
  const distance = levenshtein(s1.toLowerCase(), s2.toLowerCase());
  return Math.trunc(((s1.length - distance) * 100) / s1.length) / 100;
}

function integerSimilarity(a: string, b: string): number {
  const v1 = toIntStrict(a);
  const v2 = toIntStrict(b);
  const max = Math.max(v1, v2);
  // The reference would divide by zero here; the dataset never hits it.
  if (max <= 0) return 0;
  const distance = Math.abs(v1 - v2);
  return Math.trunc(((max - distance) * 1000) / max) / 1000;
}

function locationSimilarity(a: string, b: string): number {
  const pa = a.split(',');
  const pb = b.split(',');
  if (pa.length !== 2 || pb.length !== 2) return 0;
  const dx = toIntStrict(pa[0]!) - toIntStrict(pb[0]!);
  const dy = toIntStrict(pa[1]!) - toIntStrict(pb[1]!);
  const pixelDistance = Math.trunc(Math.sqrt(dx * dx + dy * dy));
  return Math.max(200 - pixelDistance, 0) / 200;
}

/** Java-style split: trailing empty strings removed, leading one kept. */
function splitWords(text: string): string[] {
  const words = text.split(/\s+/);
  while (words.length > 0 && words[words.length - 1] === '') {
    words.pop();
  }
  return words;
}

function containsWord(target: string, words: readonly string[]): boolean {
  for (const word of words) {
    if (target.length < word.length && (word.startsWith(target) || word.endsWith(target))) {
      return true;
    }
    if (word.length < target.length && (target.startsWith(word) || target.endsWith(word))) {
      return true;
    }
    if (target === word) {
      return true;
    }
  }
  return false;
}

function neighborTextSimilarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  const words1 = splitWords(a);
  const words2 = splitWords(b);
  const wordCount = Math.max(a.length - words1.length + 1, b.length - words2.length + 1);
  if (wordCount <= 0) return 0;
  let existsCount = 0;
  for (const word of words1) {
    if (containsWord(word, words2)) {
      existsCount += word.length;
    }
  }
  return Math.min(Math.trunc((existsCount * 100) / wordCount), 100) / 100;
}

function maxPairwise(
  target: string,
  candidate: string,
  compare: (a: string, b: string) => number,
): number {
  let best = 0;
  for (const tv of splitVonValues(target)) {
    for (const cv of splitVonValues(candidate)) {
      const s = compare(tv, cv);
      if (s > best) best = s;
    }
  }
  return best;
}

export function calcSimilarityScore(
  target: WidgetProps,
  candidate: WidgetProps,
  specs: readonly PropertySpec[] = SIMILO_PROPERTIES,
  breakdown?: Record<string, number>,
): number {
  let score = 0;
  for (const spec of specs) {
    const targetValue = target[spec.key];
    const candidateValue = candidate[spec.key];
    let similarity = 0;
    if (targetValue !== undefined && candidateValue !== undefined) {
      switch (spec.kind) {
        case 'exact':
          similarity = maxPairwise(targetValue, candidateValue, equalSimilarity);
          break;
        case 'string':
          similarity = maxPairwise(targetValue, candidateValue, stringSimilarity);
          break;
        case 'integer':
          similarity = integerSimilarity(targetValue, candidateValue);
          break;
        case 'location2d':
          similarity = locationSimilarity(targetValue, candidateValue);
          break;
        case 'neighborText':
          similarity = neighborTextSimilarity(targetValue, candidateValue);
          break;
      }
    }
    let weight = spec.weight;
    if (similarity === 1 && spec.exactBonus !== undefined) {
      weight *= spec.exactBonus;
    }
    const contribution = similarity * weight;
    score += contribution;
    if (breakdown) breakdown[spec.key] = contribution;
  }
  return score;
}

/** Sum of weights for properties the candidate actually has (normalization ceiling). */
export function calcMaxSimilarityScore(
  candidate: WidgetProps,
  specs: readonly PropertySpec[] = SIMILO_PROPERTIES,
): number {
  let sum = 0;
  for (const spec of specs) {
    if (candidate[spec.key] !== undefined) sum += spec.weight;
  }
  return sum;
}

/**
 * Score all candidates against the target and sort best-first.
 * The comparator quantizes to 0.001 like the reference; ties keep input order
 * (both Java's TimSort and JS Array#sort are stable).
 */
export function rankCandidates<T>(
  target: WidgetProps,
  candidates: readonly T[],
  getProps: (item: T) => WidgetProps,
  specs: readonly PropertySpec[] = SIMILO_PROPERTIES,
): ScoredCandidate<T>[] {
  const scored = candidates.map((widget) => {
    const breakdown: Record<string, number> = {};
    const score = calcSimilarityScore(target, getProps(widget), specs, breakdown);
    return { widget, score, breakdown };
  });
  scored.sort((a, b) => Math.trunc(b.score * 1000 - a.score * 1000));
  return scored;
}
