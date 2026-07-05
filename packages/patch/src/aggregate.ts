/**
 * Phase C step 1 (design doc §10): aggregate healing events into patch
 * proposals. A callsite is only patchable when every healed event for it
 * converged on the same replacement locator; disagreement means the element
 * identity is unstable and a human needs to look.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HealingEvent } from '@relocator/core/store';
import type { Callsite } from '@relocator/core';

export interface PatchProposal {
  callsite: Callsite;
  originalLocator: string;
  adoptedLocator: string;
  healCount: number;
  testIds: string[];
  /** Highest normalized top-candidate score across the group. */
  bestScore: number;
  tier: HealingEvent['resolvedTier'];
}

export interface PatchWarning {
  callsite: Callsite | null;
  originalLocator: string;
  reason: string;
}

export interface AggregateResult {
  proposals: PatchProposal[];
  warnings: PatchWarning[];
}

export function readEvents(relocatorDir: string): HealingEvent[] {
  const eventsDir = join(relocatorDir, 'events');
  if (!existsSync(eventsDir)) return [];
  const events: HealingEvent[] = [];
  for (const name of readdirSync(eventsDir)) {
    if (!name.endsWith('.jsonl')) continue;
    for (const line of readFileSync(join(eventsDir, name), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as HealingEvent);
      } catch {
        // torn line — skip
      }
    }
  }
  return events;
}

function normalizeFile(file: string): string {
  return file.replace(/^file:\/\//, '');
}

export function aggregateEvents(events: readonly HealingEvent[]): AggregateResult {
  const proposals: PatchProposal[] = [];
  const warnings: PatchWarning[] = [];
  const groups = new Map<string, HealingEvent[]>();

  for (const event of events) {
    if (event.outcome !== 'healed' || !event.adoptedLocator) continue;
    if (!event.callsite) {
      warnings.push({
        callsite: null,
        originalLocator: event.originalLocator,
        reason: 'healed but no callsite was captured — cannot locate the source to patch',
      });
      continue;
    }
    const key = `${normalizeFile(event.callsite.file)}:${event.callsite.line}:${event.callsite.column}:${event.originalLocator}`;
    const group = groups.get(key);
    if (group) group.push(event);
    else groups.set(key, [event]);
  }

  for (const group of groups.values()) {
    const first = group[0]!;
    const adopted = new Set(group.map((e) => e.adoptedLocator!));
    const callsite: Callsite = { ...first.callsite!, file: normalizeFile(first.callsite!.file) };
    if (adopted.size > 1) {
      warnings.push({
        callsite,
        originalLocator: first.originalLocator,
        reason: `healed to ${adopted.size} different locators across events (${[...adopted].join(' / ')}) — element identity is unstable, review manually`,
      });
      continue;
    }
    proposals.push({
      callsite,
      originalLocator: first.originalLocator,
      adoptedLocator: first.adoptedLocator!,
      healCount: group.length,
      testIds: [...new Set(group.map((e) => e.testId))],
      bestScore: Math.max(...group.map((e) => e.candidates[0]?.normalizedScore ?? 0)),
      tier: first.resolvedTier,
    });
  }

  proposals.sort((a, b) => {
    const byFile = a.callsite.file.localeCompare(b.callsite.file);
    return byFile !== 0 ? byFile : a.callsite.line - b.callsite.line;
  });
  return { proposals, warnings };
}
