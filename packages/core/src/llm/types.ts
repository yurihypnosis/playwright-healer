/**
 * Tier 3 provider abstraction (design doc §6.4). Types only — browser-safe.
 * Implementations live in @relocator/llm; the Playwright fixture accepts any
 * object satisfying LLMProvider, so custom providers need no extra deps.
 *
 * Input is deliberately minimal: the remembered fingerprint, the top-N
 * candidates' property bags, and the test context. No screenshots, no DOM
 * dumps (§13). Output is a strict JSON verdict; `chosen: null` explicitly
 * allows the model to say "none of these" (§6.4).
 */

import type { ElementFingerprint } from '../fingerprint/types.js';
import type { WidgetProps } from '../scoring/similo.js';

export interface DisambiguationCandidate {
  /** Index in the candidate list; the model answers with this. */
  index: number;
  props: WidgetProps;
  suggestedLocator: string;
  normalizedScore: number;
}

export interface DisambiguationInput {
  fingerprint: ElementFingerprint;
  candidates: DisambiguationCandidate[];
  /** e.g. "login > submits with valid credentials" */
  testName: string;
  /** e.g. "click", "fill" */
  actionType: string;
}

export interface DisambiguationResult {
  chosen: number | null;
  /** 0-1; verdicts below the configured threshold are rejected. */
  confidence: number;
  reason: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  } | undefined;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  disambiguate(input: DisambiguationInput): Promise<DisambiguationResult>;
}
