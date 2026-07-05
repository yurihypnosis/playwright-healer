/**
 * Prompt construction for Tier 3 disambiguation (design doc §6.4).
 * Input is deliberately tiny: remembered fingerprint + top-N candidate
 * property bags + test context. The scoring engine already did the heavy
 * lifting; the model only breaks the tie — one call, no agentic loop.
 */

import type { DisambiguationInput } from '@relocator/core';

export const SYSTEM_PROMPT = `You help repair broken end-to-end test selectors. A UI changed and a test's locator no longer matches. You are given the remembered properties of the original element (recorded when the test was green) and a shortlist of candidate elements from the current page, pre-ranked by a similarity engine.

Pick the candidate that is semantically the SAME element the test intended to interact with — same purpose, same user-facing meaning — even if ids, classes, or position changed. If none of the candidates is that element (the feature may have been removed), answer with chosen: null. A wrong heal is worse than no heal: when unsure, prefer null or a low confidence.`;

/** JSON Schema for the strict verdict (structured outputs / Ollama format). */
export const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    chosen: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    confidence: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['chosen', 'confidence', 'reason'],
  additionalProperties: false,
} as const;

export function buildUserPrompt(input: DisambiguationInput): string {
  const fp = input.fingerprint;
  const original = {
    tag: fp.tag,
    role: fp.role,
    accessibleName: fp.accessibleName,
    visibleText: fp.visibleText,
    id: fp.id,
    testId: fp.testId,
    name: fp.name,
    classList: fp.classList,
    placeholder: fp.placeholder,
    href: fp.href,
    neighborText: fp.neighborText.slice(0, 16),
  };
  const candidates = input.candidates.map((c) => ({
    index: c.index,
    similarity: Number(c.normalizedScore.toFixed(3)),
    locator: c.suggestedLocator,
    props: c.props,
  }));
  return [
    `Test: ${input.testName}`,
    `Action being attempted: ${input.actionType}`,
    '',
    'Original element (recorded while the test was green):',
    JSON.stringify(original, null, 1),
    '',
    'Candidates on the current page:',
    JSON.stringify(candidates, null, 1),
    '',
    'Answer with JSON: {"chosen": <candidate index or null>, "confidence": <0..1>, "reason": "<one short sentence>"}',
  ].join('\n');
}

export function parseVerdict(text: string): { chosen: number | null; confidence: number; reason: string } {
  const parsed = JSON.parse(text) as { chosen: unknown; confidence: unknown; reason: unknown };
  const chosen =
    typeof parsed.chosen === 'number' && Number.isInteger(parsed.chosen) ? parsed.chosen : null;
  const confidence =
    typeof parsed.confidence === 'number' ? Math.min(Math.max(parsed.confidence, 0), 1) : 0;
  const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
  return { chosen, confidence, reason };
}
