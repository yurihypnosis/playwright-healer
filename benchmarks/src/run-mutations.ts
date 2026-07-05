/**
 * Mutation harness (design §15.2): measures heal success rate (G1: 90%+),
 * FALSE heal rate against ground truth (G2: <1%), tier distribution, and
 * in-page scoring latency (G3) on a realistic page under scripted DOM rot.
 *
 * Flow per mutation: load base page → capture fingerprints of every
 * [data-truth] target → apply mutation in-page → run the exact runtime
 * cascade (in-page scoring + shared threshold gate) → resolve the adopted
 * xpath and compare its data-truth key with the original.
 */

import { chromium } from 'playwright';
import {
  GATE_PRESETS,
  evaluateGate,
  fingerprintToWidgetProps,
  thresholdGate,
  type ElementFingerprint,
  type GatePreset,
  type ThresholdGateConfig,
} from '@relocator/core';
import { captureFingerprint, collectAndScore } from '@relocator/playwright';
import { BASE_APP } from './mutation-app.ts';
import { MUTATIONS } from './mutations.ts';

const PRESET = (process.env['RELOCATOR_BENCH_PRESET'] ?? 'standard') as GatePreset;
const THRESHOLDS: ThresholdGateConfig = GATE_PRESETS[PRESET];
const TEST_ID_ATTRIBUTE = 'data-testid';
console.log(`gate preset: ${PRESET} (abs ${THRESHOLDS.abs}, gap ${THRESHOLDS.gap}, ratio ${THRESHOLDS.ratio})`);

interface CaseResult {
  mutation: string;
  truthKey: string;
  removed: boolean;
  decision: 'adopt' | 'reject' | 'ambiguous';
  adoptedTruth: string | null;
  correct: boolean;
  falseHeal: boolean;
  /** For ambiguous cases: was top-1 the right element (Tier 3 ceiling)? */
  ambiguousTopCorrect: boolean;
  /** Would the IQR unique-outlier gate (OR-variant) have adopted, and rightly? */
  iqrWouldAdopt: boolean;
  iqrAdoptCorrect: boolean;
  latencyMs: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });

// Record fingerprints once on the pristine page.
await page.setContent(BASE_APP);
const truthKeys: string[] = await page.$$eval('[data-truth]', (els) =>
  els.map((el) => el.getAttribute('data-truth')!),
);
const fingerprints = new Map<string, ElementFingerprint>();
for (const key of truthKeys) {
  const handle = (await page.$(`[data-truth='${key}']`))!;
  fingerprints.set(key, await captureFingerprint(page, handle, TEST_ID_ATTRIBUTE));
  await handle.dispose();
}
console.log(`targets: ${truthKeys.length}, mutations: ${MUTATIONS.length}\n`);

const results: CaseResult[] = [];

for (const mutation of MUTATIONS) {
  await page.setContent(BASE_APP);
  const removed = new Set(await page.evaluate(mutation.apply));

  for (const key of truthKeys) {
    const fingerprint = fingerprints.get(key)!;
    const start = performance.now();
    const response = await collectAndScore(page, {
      target: fingerprintToWidgetProps(fingerprint),
      testIdAttribute: TEST_ID_ATTRIBUTE,
      topN: 10,
      maxCandidates: 2000,
    });
    const latencyMs = performance.now() - start;

    const decision = thresholdGate(response.candidates[0], response.candidates[1], THRESHOLDS);
    const truthOfXpath = (xpath: string): Promise<string | null> =>
      page.evaluate((xp) => {
        const node = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
          .singleNodeValue as Element | null;
        return node?.getAttribute('data-truth') ?? null;
      }, xpath);

    const top = response.candidates[0];
    const topTruth = top && decision !== 'reject' ? await truthOfXpath(top.xpath) : null;
    const adoptedTruth = decision === 'adopt' ? topTruth : null;

    const wasRemoved = removed.has(key);
    const correct = wasRemoved ? decision !== 'adopt' : adoptedTruth === key;
    const falseHeal = decision === 'adopt' && adoptedTruth !== key;

    // IQR unique-outlier gate as an OR-fallback on ambiguous cases (paper's gate).
    let iqrWouldAdopt = false;
    let iqrAdoptCorrect = false;
    if (decision === 'ambiguous' && top && top.normalizedScore >= THRESHOLDS.abs) {
      const gate = evaluateGate(response.candidates.map((c) => c.score));
      if (gate.unique) {
        iqrWouldAdopt = true;
        iqrAdoptCorrect = !wasRemoved && topTruth === key;
      }
    }

    results.push({
      mutation: mutation.name,
      truthKey: key,
      removed: wasRemoved,
      decision,
      adoptedTruth,
      correct,
      falseHeal,
      ambiguousTopCorrect: decision === 'ambiguous' && !wasRemoved && topTruth === key,
      iqrWouldAdopt,
      iqrAdoptCorrect,
      latencyMs,
    });
  }
}

await browser.close();

// ── Report ──────────────────────────────────────────────────────────────
const byMutation = new Map<string, CaseResult[]>();
for (const r of results) {
  const list = byMutation.get(r.mutation) ?? [];
  list.push(r);
  byMutation.set(r.mutation, list);
}

console.log('mutation          n   healed  ambig  reject  FALSE  correct');
console.log('─'.repeat(64));
for (const [name, cases] of byMutation) {
  const healed = cases.filter((c) => c.decision === 'adopt' && !c.falseHeal).length;
  const ambiguous = cases.filter((c) => c.decision === 'ambiguous').length;
  const rejected = cases.filter((c) => c.decision === 'reject').length;
  const falseHeals = cases.filter((c) => c.falseHeal).length;
  const correct = cases.filter((c) => c.correct).length;
  console.log(
    `${name.padEnd(16)} ${String(cases.length).padStart(3)}  ${String(healed).padStart(5)}  ${String(ambiguous).padStart(5)}  ${String(rejected).padStart(6)}  ${String(falseHeals).padStart(5)}  ${String(correct).padStart(4)}/${cases.length}`,
  );
}

const healable = results.filter((r) => !r.removed);
const healedRight = healable.filter((r) => r.decision === 'adopt' && !r.falseHeal);
const falseHeals = results.filter((r) => r.falseHeal);
const removedCases = results.filter((r) => r.removed);
const removedRefused = removedCases.filter((r) => r.decision !== 'adopt');
const ambiguous = results.filter((r) => r.decision === 'ambiguous');
const ambiguousTopCorrect = ambiguous.filter((r) => r.ambiguousTopCorrect);
const iqrAdopts = results.filter((r) => r.iqrWouldAdopt);
const iqrRight = iqrAdopts.filter((r) => r.iqrAdoptCorrect);
const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);

const tier2Rate = healedRight.length / healable.length;
const ceiling = (healedRight.length + ambiguousTopCorrect.length) / healable.length;

console.log('─'.repeat(64));
console.log(`Tier 2 deterministic heal rate:   ${healedRight.length}/${healable.length} = ${(tier2Rate * 100).toFixed(1)}%`);
console.log(`Tier 3 residue (ambiguous):       ${ambiguous.length}/${results.length} = ${((ambiguous.length / results.length) * 100).toFixed(1)}%  (top-1 correct in ${ambiguousTopCorrect.length})`);
console.log(`Full-cascade ceiling (G1 90%+):   ${(ceiling * 100).toFixed(1)}%  (Tier 2 + perfect Tier 3)`);
console.log(`False heals  (G2 target <1%):     ${falseHeals.length}/${results.length} = ${((falseHeals.length / results.length) * 100).toFixed(2)}%`);
console.log(`Removed targets refused:           ${removedRefused.length}/${removedCases.length}`);
console.log(`IQR-OR gate experiment:            would adopt ${iqrAdopts.length} ambiguous cases, ${iqrRight.length} correctly (${iqrAdopts.length - iqrRight.length} false)`);
console.log(`Scoring latency (G3 p50 <50ms):    p50 ${percentile(latencies, 50).toFixed(1)}ms  p95 ${percentile(latencies, 95).toFixed(1)}ms`);

for (const f of falseHeals) {
  console.log(`  ✗ FALSE HEAL [${f.mutation}] ${f.truthKey} → ${f.adoptedTruth}`);
}

// CI quality gates: false heals are the hard constraint; the deterministic
// floor guards against scoring regressions; the ceiling guards Tier 3 value.
const falseRate = falseHeals.length / results.length;
if (falseRate >= 0.02) {
  console.error(`\nFAIL: false-heal rate ${(falseRate * 100).toFixed(2)}% exceeds 2% ceiling`);
  process.exit(1);
}
if (tier2Rate < 0.85) {
  console.error(`\nFAIL: Tier 2 heal rate ${(tier2Rate * 100).toFixed(1)}% below 85% floor (standard preset)`);
  process.exit(1);
}
if (ceiling < 0.9) {
  console.error(`\nFAIL: full-cascade ceiling ${(ceiling * 100).toFixed(1)}% below the G1 target 90%`);
  process.exit(1);
}
