/**
 * VON Similo benchmark reproduction (Spike A).
 *
 * Replays the replication package's testVONSimilo evaluation:
 * for each oracle, locate the target in old.txt by (app, fromxpath),
 * score every new.txt widget of the same app, and count the localization
 * as correct when the top-1 candidate's xpath list contains toxpath.
 *
 * Reference results (results/VONSimilo): 734 correct / 70 incorrect, ~29ms avg.
 * Also reports the IQR outlier gate split (Tier 2 feasibility numbers).
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rankCandidates, evaluateGate } from '@relocator/core';
import { parseOracles, parseWidgets, xpathListContains, type DatasetWidget } from './parse.ts';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

const oldWidgets = parseWidgets(join(dataDir, 'old.txt'));
const newWidgets = parseWidgets(join(dataDir, 'new.txt'));
const oracles = parseOracles(join(dataDir, 'oracles.txt'));

const newByApp = new Map<string, DatasetWidget[]>();
for (const w of newWidgets) {
  let list = newByApp.get(w.app);
  if (!list) {
    list = [];
    newByApp.set(w.app, list);
  }
  list.push(w);
}

function findTarget(app: string, fromXPath: string): DatasetWidget | undefined {
  return oldWidgets.find((w) => w.app === app && xpathListContains(w.props['xpath'], fromXPath));
}

let correct = 0;
let incorrect = 0;
let targetNotFound = 0;

// Gate stats: how the deterministic outlier gate would triage each healing.
let gateUniqueCorrect = 0;
let gateUniqueIncorrect = 0;
let gateAmbiguousTopCorrect = 0;
let gateAmbiguousTopIncorrect = 0;

let totalScoringMs = 0;
let scoredOracles = 0;
const incorrectDetails: string[] = [];

for (const oracle of oracles) {
  const target = findTarget(oracle.app, oracle.fromXPath);
  if (!target) {
    targetNotFound++;
    continue;
  }
  const candidates = newByApp.get(oracle.app) ?? [];

  const start = performance.now();
  const ranked = rankCandidates(target.props, candidates, (w) => w.props);
  totalScoringMs += performance.now() - start;
  scoredOracles++;

  const best = ranked[0];
  const isCorrect = best !== undefined && xpathListContains(best.widget.props['xpath'], oracle.toXPath);
  if (isCorrect) correct++;
  else {
    incorrect++;
    if (incorrectDetails.length < 5) {
      incorrectDetails.push(
        `app=${oracle.app} (${oracle.name}) from=${oracle.fromXPath}\n  top1=${best?.widget.props['xpath'] ?? 'none'} score=${best?.score.toFixed(3) ?? '-'}`,
      );
    }
  }

  const gate = evaluateGate(ranked.map((r) => r.score));
  if (gate.unique) {
    if (isCorrect) gateUniqueCorrect++;
    else gateUniqueIncorrect++;
  } else if (isCorrect) gateAmbiguousTopCorrect++;
  else gateAmbiguousTopIncorrect++;
}

const evaluated = correct + incorrect;
console.log('=== VON Similo reproduction (reference: 734 correct / 70 incorrect) ===');
console.log(`oracles: ${oracles.length}, evaluated: ${evaluated}, target-not-found: ${targetNotFound}`);
console.log(`correct:   ${correct} (${((correct / evaluated) * 100).toFixed(1)}%)`);
console.log(`incorrect: ${incorrect} (${((incorrect / evaluated) * 100).toFixed(1)}%)`);
console.log(`scoring latency: avg ${(totalScoringMs / scoredOracles).toFixed(1)}ms over ${scoredOracles} localizations`);
console.log();
console.log('=== IQR outlier gate triage (Tier 2 feasibility) ===');
console.log(`unique outlier & correct:     ${gateUniqueCorrect}  <- deterministic adoption, right`);
console.log(`unique outlier & incorrect:   ${gateUniqueIncorrect}  <- deterministic adoption, WRONG (false heals)`);
console.log(`ambiguous, top-1 correct:     ${gateAmbiguousTopCorrect}  <- would go to Tier 3`);
console.log(`ambiguous, top-1 incorrect:   ${gateAmbiguousTopIncorrect}  <- would go to Tier 3`);
if (incorrectDetails.length > 0) {
  console.log();
  console.log('--- first incorrect samples ---');
  for (const d of incorrectDetails) console.log(d);
}
