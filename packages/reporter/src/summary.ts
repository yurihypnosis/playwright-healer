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
