/**
 * Pure aggregation/formatting over healing events (design doc §11.1):
 * the run summary, tier distribution, and CI annotation lines. Kept free of
 * Playwright/reporter types so it is unit-testable and reusable.
 */

import { relative } from 'node:path';
import type { HealingEvent } from '@relocator/core/store';

export interface HealSummary {
  healed: HealingEvent[];
  rejected: HealingEvent[];
  unresolved: HealingEvent[];
  tierCounts: Map<string, number>;
  meanHealLatencyMs: number;
}

export function summarize(events: readonly HealingEvent[]): HealSummary {
  const healed = events.filter((e) => e.outcome === 'healed');
  const rejected = events.filter((e) => e.outcome === 'rejected');
  const unresolved = events.filter((e) => e.outcome === 'unresolved');
  const tierCounts = new Map<string, number>();
  for (const e of healed) {
    const key = `tier${e.resolvedTier}`;
    tierCounts.set(key, (tierCounts.get(key) ?? 0) + 1);
  }
  const meanHealLatencyMs =
    healed.length === 0 ? 0 : healed.reduce((s, e) => s + e.totalLatencyMs, 0) / healed.length;
  return { healed, rejected, unresolved, tierCounts, meanHealLatencyMs };
}

function callsiteLabel(event: HealingEvent, cwd: string): string {
  if (!event.callsite) return '';
  const file = relative(cwd, event.callsite.file.replace(/^file:\/\//, ''));
  return ` [${file}:${event.callsite.line}]`;
}

export function formatSummary(summary: HealSummary, cwd: string = process.cwd()): string {
  const { healed, rejected, unresolved } = summary;
  const lines: string[] = [];
  const tierText = [...summary.tierCounts.entries()].map(([t, n]) => `${t}: ${n}`).join(', ');
  lines.push(
    `Relocator: ${healed.length} healed (${tierText || '-'}), ${rejected.length} rejected, ` +
      `${unresolved.length} unresolved, mean heal latency ${summary.meanHealLatencyMs.toFixed(0)}ms`,
  );
  for (const e of healed) {
    const top = e.candidates[0];
    const score = top ? ` score ${top.normalizedScore.toFixed(2)}` : '';
    lines.push(`  ✚ ${e.originalLocator} → ${e.adoptedLocator}${score}${callsiteLabel(e, cwd)}`);
  }
  for (const e of unresolved) {
    lines.push(`  ✖ ${e.originalLocator} could not be healed (${e.failureClass})${callsiteLabel(e, cwd)}`);
  }
  for (const e of rejected) {
    lines.push(
      `  ∅ ${e.originalLocator} rejected: no similar element (likely a real removal)${callsiteLabel(e, cwd)}`,
    );
  }
  return lines.join('\n');
}

export interface RecurringHeal {
  originalLocator: string;
  runCount: number;
  lastAdopted: string | null;
  callsite: HealingEvent['callsite'];
}

/**
 * Recurring-heal detection (design §11.2): the same locator healing across
 * several distinct runs means the patch was never applied — or the element
 * is unstable and needs a human look (quarantine recommendation).
 */
export function findRecurringHeals(
  allEvents: readonly HealingEvent[],
  minRuns = 3,
): RecurringHeal[] {
  const groups = new Map<string, { runs: Set<string>; last: HealingEvent }>();
  for (const event of allEvents) {
    if (event.outcome !== 'healed') continue;
    const site = event.callsite ? `${event.callsite.file}:${event.callsite.line}` : '';
    const key = `${site} ${event.originalLocator}`;
    const group = groups.get(key);
    if (group) {
      group.runs.add(event.runId);
      if (event.timestamp >= group.last.timestamp) group.last = event;
    } else {
      groups.set(key, { runs: new Set([event.runId]), last: event });
    }
  }
  return [...groups.values()]
    .filter((g) => g.runs.size >= minRuns)
    .map((g) => ({
      originalLocator: g.last.originalLocator,
      runCount: g.runs.size,
      lastAdopted: g.last.adoptedLocator,
      callsite: g.last.callsite,
    }))
    .sort((a, b) => b.runCount - a.runCount);
}

export function formatRecurringHeals(
  recurring: readonly RecurringHeal[],
  cwd: string = process.cwd(),
): string {
  if (recurring.length === 0) return '';
  const lines = ['Recurring heals (quarantine recommended — apply the patch or review the element):'];
  for (const r of recurring) {
    const site = r.callsite
      ? ` [${relative(cwd, r.callsite.file.replace(/^file:\/\//, ''))}:${r.callsite.line}]`
      : '';
    lines.push(`  ⟳ ${r.originalLocator} healed in ${r.runCount} runs → ${r.lastAdopted}${site}`);
    lines.push('    run `relocator-patch --write` or quarantine the test');
  }
  return lines.join('\n');
}

/** `::warning` lines that land on the exact file/line in a GitHub PR. */
export function formatGithubAnnotations(
  summary: HealSummary,
  cwd: string = process.cwd(),
): string[] {
  const annotate = (e: HealingEvent, message: string): string => {
    const location = e.callsite
      ? `file=${relative(cwd, e.callsite.file.replace(/^file:\/\//, ''))},line=${e.callsite.line},col=${e.callsite.column},`
      : '';
    return `::warning ${location}title=Relocator::${message}`;
  };
  return [
    ...summary.healed.map((e) =>
      annotate(e, `Selector healed at runtime: ${e.originalLocator} → ${e.adoptedLocator}. Update the locator.`),
    ),
    ...summary.unresolved.map((e) =>
      annotate(e, `Selector broke and could not be healed: ${e.originalLocator} (${e.failureClass}).`),
    ),
  ];
}
