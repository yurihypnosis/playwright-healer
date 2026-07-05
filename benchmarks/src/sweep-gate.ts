/**
 * Gate-threshold calibration sweep (§6.3): on the 804-oracle replication
 * dataset, measure Tier 2 coverage (adopt & correct / all) and false-adopt
 * rate for a grid of (abs, gap, ratio) thresholds. Scores are computed
 * once; the sweep itself is arithmetic. Output feeds the preset table
 * (aggressive / standard / conservative).
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  calcMaxSimilarityScore,
  rankCandidates,
  thresholdGate,
} from '@relocator/core';
import { parseOracles, parseWidgets, xpathListContains, type DatasetWidget } from './parse.ts';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const oldWidgets = parseWidgets(join(dataDir, 'old.txt'));
const newWidgets = parseWidgets(join(dataDir, 'new.txt'));
const oracles = parseOracles(join(dataDir, 'oracles.txt'));

const newByApp = new Map<string, DatasetWidget[]>();
for (const w of newWidgets) {
  (newByApp.get(w.app) ?? newByApp.set(w.app, []).get(w.app)!).push(w);
}

interface Case {
  top: { score: number; normalizedScore: number };
  second: { score: number; normalizedScore: number } | undefined;
  topCorrect: boolean;
}

const cases: Case[] = [];
for (const oracle of oracles) {
  const target = oldWidgets.find(
    (w) => w.app === oracle.app && xpathListContains(w.props['xpath'], oracle.fromXPath),
  );
  if (!target) continue;
  const ranked = rankCandidates(target.props, newByApp.get(oracle.app) ?? [], (w) => w.props);
  const max = calcMaxSimilarityScore(target.props);
  const norm = (s: number) => (max > 0 ? s / max : 0);
  const top = ranked[0];
  if (!top) continue;
  cases.push({
    top: { score: top.score, normalizedScore: norm(top.score) },
    second: ranked[1]
      ? { score: ranked[1].score, normalizedScore: norm(ranked[1].score) }
      : undefined,
    topCorrect: xpathListContains(top.widget.props['xpath'], oracle.toXPath),
  });
}
console.log(`cases: ${cases.length} (top-1 correct: ${cases.filter((c) => c.topCorrect).length})`);
console.log('');
console.log('abs   gap   ratio | adopt  right  wrong  falseAdopt  coverage');
console.log('─'.repeat(66));

interface Row {
  abs: number;
  gap: number;
  ratio: number;
  adopt: number;
  wrong: number;
  falseRate: number;
  coverage: number;
}
const rows: Row[] = [];
for (const abs of [0.45, 0.5, 0.55, 0.6, 0.65]) {
  for (const gap of [0.02, 0.05, 0.08, 0.1, 0.15]) {
    for (const ratio of [1.05, 1.1, 1.15, 1.25, 1.4]) {
      let adopt = 0;
      let wrong = 0;
      for (const c of cases) {
        if (thresholdGate(c.top, c.second, { abs, gap, ratio }) === 'adopt') {
          adopt++;
          if (!c.topCorrect) wrong++;
        }
      }
      rows.push({
        abs,
        gap,
        ratio,
        adopt,
        wrong,
        falseRate: adopt > 0 ? wrong / cases.length : 0,
        coverage: (adopt - wrong) / cases.length,
      });
    }
  }
}

// Show the Pareto frontier: best coverage per false-adopt budget.
const budgets = [0.005, 0.01, 0.02, 0.03, 0.05];
for (const budget of budgets) {
  const feasible = rows.filter((r) => r.wrong / cases.length <= budget);
  feasible.sort((a, b) => b.coverage - a.coverage);
  const best = feasible[0];
  if (!best) continue;
  console.log(
    `${best.abs.toFixed(2)}  ${best.gap.toFixed(2)}  ${best.ratio.toFixed(2)}  | ` +
      `${String(best.adopt).padStart(5)}  ${String(best.adopt - best.wrong).padStart(5)}  ` +
      `${String(best.wrong).padStart(5)}  ${((best.wrong / cases.length) * 100).toFixed(2).padStart(8)}%  ` +
      `${(best.coverage * 100).toFixed(1).padStart(7)}%   <- best at false-adopt <= ${(budget * 100).toFixed(1)}%`,
  );
}

// Current defaults for reference.
const current = { abs: 0.55, gap: 0.1, ratio: 1.25 };
let adopt = 0;
let wrong = 0;
for (const c of cases) {
  if (thresholdGate(c.top, c.second, current) === 'adopt') {
    adopt++;
    if (!c.topCorrect) wrong++;
  }
}
console.log('─'.repeat(66));
console.log(
  `0.55  0.10  1.25  | ${String(adopt).padStart(5)}  ${String(adopt - wrong).padStart(5)}  ${String(wrong).padStart(5)}  ` +
    `${((wrong / cases.length) * 100).toFixed(2).padStart(8)}%  ${(((adopt - wrong) / cases.length) * 100).toFixed(1).padStart(7)}%   <- CURRENT defaults`,
);
