import { describe, expect, it } from 'vitest';
import type { HealingEvent } from '@relocator/core/store';
import {
  findRecurringHeals,
  formatGithubAnnotations,
  formatRecurringHeals,
  formatSummary,
  summarize,
} from './summary.js';

function event(overrides: Partial<HealingEvent>): HealingEvent {
  return {
    eventId: 'e1',
    runId: 'r1',
    testId: 't1',
    timestamp: '2026-07-04T00:00:00.000Z',
    originalLocator: "getByTestId('add-btn')",
    pagePattern: 'https://app/*',
    failureClass: 'selector-not-found',
    resolvedTier: 2,
    outcome: 'healed',
    candidates: [
      {
        score: 8,
        normalizedScore: 0.76,
        breakdown: {},
        elementSummary: '<button id="add-item-button">Add',
        suggestedLocator: "getByRole('button', { name: 'Add' })",
      },
    ],
    adoptedLocator: "getByRole('button', { name: 'Add' })",
    totalLatencyMs: 42,
    callsite: { file: 'file:///repo/tests/heal.spec.ts', line: 83, column: 16 },
    ...overrides,
  };
}

describe('summarize + formatSummary', () => {
  it('groups outcomes and reports tier distribution and latency', () => {
    const events = [
      event({}),
      event({ eventId: 'e2', resolvedTier: 2, totalLatencyMs: 58 }),
      event({ eventId: 'e3', outcome: 'rejected', adoptedLocator: null }),
      event({ eventId: 'e4', outcome: 'unresolved', adoptedLocator: null }),
    ];
    const summary = summarize(events);
    expect(summary.healed).toHaveLength(2);
    expect(summary.tierCounts.get('tier2')).toBe(2);
    expect(summary.meanHealLatencyMs).toBe(50);

    const text = formatSummary(summary, '/repo');
    expect(text).toContain('2 healed (tier2: 2), 1 rejected, 1 unresolved');
    expect(text).toContain("✚ getByTestId('add-btn') → getByRole('button', { name: 'Add' }) score 0.76 [tests/heal.spec.ts:83]");
    expect(text).toContain('∅');
    expect(text).toContain('✖');
  });
});

describe('formatGithubAnnotations', () => {
  it('emits ::warning lines with repo-relative file and line', () => {
    const summary = summarize([event({}), event({ eventId: 'e2', outcome: 'unresolved' })]);
    const lines = formatGithubAnnotations(summary, '/repo');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      "::warning file=tests/heal.spec.ts,line=83,col=16,title=Relocator::Selector healed at runtime: getByTestId('add-btn') → getByRole('button', { name: 'Add' }). Update the locator.",
    );
    expect(lines[1]).toContain('could not be healed');
  });
});

describe('findRecurringHeals', () => {
  it('flags locators healed across >= minRuns distinct runs, newest adoption wins', () => {
    const events = [
      event({ runId: 'r1', timestamp: '2026-07-01T00:00:00Z' }),
      event({ runId: 'r2', timestamp: '2026-07-02T00:00:00Z' }),
      event({
        runId: 'r3',
        timestamp: '2026-07-03T00:00:00Z',
        adoptedLocator: "locator('#latest')",
      }),
      // Different locator healed in only one run — not recurring.
      event({ runId: 'r3', originalLocator: "locator('#other')" }),
      // Rejected events never count.
      event({ runId: 'r4', outcome: 'rejected', adoptedLocator: null }),
    ];
    const recurring = findRecurringHeals(events, 3);
    expect(recurring).toHaveLength(1);
    expect(recurring[0]!.runCount).toBe(3);
    expect(recurring[0]!.lastAdopted).toBe("locator('#latest')");

    const text = formatRecurringHeals(recurring, '/repo');
    expect(text).toContain('healed in 3 runs');
    expect(text).toContain('quarantine');
    expect(text).toContain('[tests/heal.spec.ts:83]');
  });

  it('stays silent below the threshold', () => {
    const recurring = findRecurringHeals([event({ runId: 'r1' }), event({ runId: 'r2' })], 3);
    expect(recurring).toHaveLength(0);
    expect(formatRecurringHeals(recurring)).toBe('');
  });
});

describe('renderHtmlReport', () => {
  it('renders a self-contained page with stats, drill-down, and escaping', async () => {
    const { renderHtmlReport } = await import('./html.js');
    const html = renderHtmlReport([
      event({}),
      event({
        eventId: 'e2',
        outcome: 'rejected',
        adoptedLocator: null,
        originalLocator: 'getByText("<script>alert(1)</script>")',
      }),
    ]);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Relocator heal report');
    expect(html).toContain('healed'); // stat + badge
    expect(html).toContain("getByRole('button', { name: 'Add' })");
    expect(html).toContain('&lt;script&gt;'); // escaped, not executable
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('src='); // no external assets
    expect(html).toContain('76%'); // normalized score drill-down
  });
});
