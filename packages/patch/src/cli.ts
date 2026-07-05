#!/usr/bin/env node
/**
 * relocator-patch [--dir <.relocator>] [--write]
 *
 * Aggregates healing events from the last runs and proposes locator patches
 * as a reviewable diff. Never writes without --write (design goal G7:
 * a human reviews every patch).
 */

import { relative } from 'node:path';
import { aggregateEvents, readEvents } from './aggregate.js';
import { applyProposals } from './codemod.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const dir = arg('--dir') ?? '.relocator';
const write = process.argv.includes('--write');

const events = readEvents(dir);
if (events.length === 0) {
  console.log(`relocator-patch: no healing events found under ${dir}/events`);
  process.exit(0);
}

const { proposals, warnings: aggWarnings } = aggregateEvents(events);
const { edits, warnings: modWarnings } = applyProposals(proposals, { write });

const cwd = process.cwd();
for (const edit of edits) {
  const file = relative(cwd, edit.file);
  const p = edit.proposal;
  console.log(`--- a/${file}`);
  console.log(`+++ b/${file}`);
  console.log(`@@ line ${edit.line} @@ healed ${p.healCount}×, tier ${p.tier}, score ${p.bestScore.toFixed(2)}`);
  console.log(`-${edit.before}`);
  console.log(`+${edit.after}`);
  console.log('');
}

for (const warning of [...aggWarnings, ...modWarnings]) {
  const where = warning.callsite
    ? ` [${relative(cwd, warning.callsite.file)}:${warning.callsite.line}]`
    : '';
  console.log(`⚠ ${warning.originalLocator}${where}: ${warning.reason}`);
}

if (edits.length > 0) {
  console.log(
    write
      ? `\nApplied ${edits.length} patch(es). Review with git diff before committing.`
      : `\n${edits.length} patch(es) proposed. Re-run with --write to apply.`,
  );
} else {
  console.log('No auto-patchable healings.');
}
