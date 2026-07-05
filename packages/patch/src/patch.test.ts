import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HealingEvent } from '@relocator/core/store';
import { aggregateEvents, type PatchProposal } from './aggregate.js';
import { applyProposals } from './codemod.js';

function healedEvent(overrides: Partial<HealingEvent>): HealingEvent {
  return {
    eventId: Math.random().toString(36).slice(2),
    runId: 'r1',
    testId: 't1',
    timestamp: '2026-07-05T00:00:00.000Z',
    originalLocator: 'getByTestId("add-btn")',
    pagePattern: 'about:blank',
    failureClass: 'selector-not-found',
    resolvedTier: 2,
    outcome: 'healed',
    candidates: [
      {
        score: 8,
        normalizedScore: 0.72,
        breakdown: {},
        elementSummary: '<button>',
        suggestedLocator: "locator('#add-item-button')",
      },
    ],
    adoptedLocator: "locator('#add-item-button')",
    totalLatencyMs: 10,
    callsite: { file: 'file:///repo/tests/a.spec.ts', line: 4, column: 14 },
    ...overrides,
  };
}

describe('aggregateEvents', () => {
  it('groups converging heals and counts them', () => {
    const { proposals, warnings } = aggregateEvents([
      healedEvent({}),
      healedEvent({ testId: 't2' }),
    ]);
    expect(warnings).toHaveLength(0);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.healCount).toBe(2);
    expect(proposals[0]!.testIds).toEqual(['t1', 't2']);
  });

  it('refuses to propose when heals diverge to different locators', () => {
    const { proposals, warnings } = aggregateEvents([
      healedEvent({}),
      healedEvent({ adoptedLocator: "getByRole('button', { name: 'Add' })" }),
    ]);
    expect(proposals).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.reason).toContain('unstable');
  });

  it('ignores rejected/unresolved events', () => {
    const { proposals } = aggregateEvents([
      healedEvent({ outcome: 'rejected', adoptedLocator: null }),
      healedEvent({ outcome: 'unresolved', adoptedLocator: null }),
    ]);
    expect(proposals).toHaveLength(0);
  });
});

describe('applyProposals', () => {
  const SPEC = `import { test, expect } from './fixtures';
test('adds a todo', async ({ page }) => {
  await page.locator('#new-todo').fill('buy milk');
  await page.getByTestId('add-btn').click();
  await page.getByRole('button', { name: 'Submit' }).click();
});
`;

  function proposal(overrides: Partial<PatchProposal>, file: string): PatchProposal {
    return {
      callsite: { file, line: 4, column: 8 },
      originalLocator: 'getByTestId("add-btn")',
      adoptedLocator: "locator('#add-item-button')",
      healCount: 1,
      testIds: ['t1'],
      bestScore: 0.72,
      tier: 2,
      ...overrides,
    };
  }

  it('rewrites the exact builder call and preserves the receiver and chain', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relocator-patch-'));
    const file = join(dir, 'a.spec.ts');
    writeFileSync(file, SPEC);

    const { edits, warnings } = applyProposals([
      proposal({}, file),
      proposal(
        {
          callsite: { file, line: 3, column: 8 },
          originalLocator: 'locator("#new-todo")',
          adoptedLocator: "getByRole('textbox', { name: 'What needs to be done?' })",
        },
        file,
      ),
      // getByRole with options object round-trips through canonicalization
      proposal(
        {
          callsite: { file, line: 5, column: 8 },
          originalLocator: 'getByRole("button",{"name":"Submit"})',
          adoptedLocator: "getByRole('button', { name: 'Send' })",
        },
        file,
      ),
    ]);

    expect(warnings).toHaveLength(0);
    expect(edits).toHaveLength(3);
    expect(edits[0]!.after).toContain(
      "await page.getByRole('textbox', { name: 'What needs to be done?' }).fill('buy milk');",
    );
    expect(edits[1]!.after).toContain("await page.locator('#add-item-button').click();");
    expect(edits[2]!.after).toContain("await page.getByRole('button', { name: 'Send' }).click();");
  });

  it('writes to disk only with write: true', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relocator-patch-'));
    const file = join(dir, 'a.spec.ts');
    writeFileSync(file, SPEC);

    applyProposals([proposal({}, file)]);
    expect(readFileSync(file, 'utf8')).toBe(SPEC);

    applyProposals([proposal({}, file)], { write: true });
    expect(readFileSync(file, 'utf8')).toContain("locator('#add-item-button')");
  });

  it('warns instead of guessing on chained keys and missing callsites', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relocator-patch-'));
    const file = join(dir, 'a.spec.ts');
    writeFileSync(file, SPEC);

    const { edits, warnings } = applyProposals([
      proposal({ originalLocator: 'locator("ul").getByText("x")' }, file),
      proposal({ originalLocator: 'locator("#not-in-file")' }, file),
    ]);
    expect(edits).toHaveLength(0);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]!.reason).toContain('chained');
    expect(warnings[1]!.reason).toContain('could not find');
  });
});
