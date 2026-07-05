/**
 * M4 Tier 3 wiring test: when the outlier gate is ambiguous (two
 * near-identical candidates), a configured LLM provider breaks the tie —
 * and low-confidence verdicts are refused. Uses a deterministic fake
 * provider, so no API key is needed.
 *
 * The v2 DOM has two visually identical "Add" buttons distinguishable only
 * by their `name` attribute — which the v1 target never had, so it cannot
 * contribute to similarity scoring (both-present rule), keeping the scores
 * tied while remaining visible to the provider.
 */

import { rmSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import type { DisambiguationInput, DisambiguationResult, LLMProvider } from '@relocator/core';
import { withRelocator } from '../src/index.js';

const STORE_DIR = '.relocator-llm-test';

const calls: DisambiguationInput[] = [];
let nextConfidence = 0.95;

const fakeProvider: LLMProvider = {
  name: 'fake',
  model: 'fake-1',
  async disambiguate(input: DisambiguationInput): Promise<DisambiguationResult> {
    calls.push(input);
    const chosen = input.candidates.find((c) => c.props['name'] === 'add-note');
    return {
      chosen: chosen?.index ?? null,
      confidence: nextConfidence,
      reason: 'name attribute identifies the note-add button',
    };
  },
};

const test = withRelocator(base, { dir: STORE_DIR, llm: { provider: fakeProvider } });

const APP_V1 = `
  <html><body>
    <h1>Notes</h1>
    <div class="toolbar">
      <button id="add" class="btn" onclick="addNote()">Add</button>
    </div>
    <ul id="list"></ul>
    <script>
      function addNote() {
        const li = document.createElement('li');
        li.textContent = 'note';
        document.getElementById('list').appendChild(li);
      }
    </script>
  </body></html>`;

const APP_V2 = `
  <html><body>
    <h1>Notes</h1>
    <div class="toolbar">
      <button name="add-draft" class="css-a1b2c3" onclick="addDraft()">Add</button>
      <button name="add-note" class="css-a1b2c3" onclick="addNote()">Add</button>
    </div>
    <ul id="list"></ul>
    <script>
      function addNote() {
        const li = document.createElement('li');
        li.textContent = 'note';
        document.getElementById('list').appendChild(li);
      }
      function addDraft() {
        const li = document.createElement('li');
        li.textContent = 'DRAFT';
        document.getElementById('list').appendChild(li);
      }
    </script>
  </body></html>`;

test.beforeAll(() => {
  rmSync(STORE_DIR, { recursive: true, force: true });
});

test.describe.serial('tier 3 disambiguation', () => {
  test('record on v1', async ({ page }) => {
    await page.setContent(APP_V1);
    await page.locator('#add').click();
    await expect(page.locator('#list li')).toHaveText(['note']);
  });

  test('ambiguous candidates escalate to the LLM and heal to its choice', async ({ page }) => {
    calls.length = 0;
    nextConfidence = 0.95;
    await page.setContent(APP_V2);

    await page.locator('#add').click();

    // The provider was consulted and its pick (the note button) was used.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.actionType).toBe('click');
    await expect(page.locator('#list li')).toHaveText(['note']);

    const healed = test.info().annotations.filter((a) => a.type === 'healed');
    expect(healed).toHaveLength(1);
    expect(healed[0]!.description).toContain('tier 3');
  });

  test('low-confidence verdicts are refused — the failure surfaces', async ({ page }) => {
    calls.length = 0;
    nextConfidence = 0.3;
    await page.setContent(APP_V1);
    await page.locator('#add').click(); // re-record in this worker

    await page.setContent(APP_V2);
    await expect(page.locator('#add').click({ timeout: 1_000 })).rejects.toThrow();
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(test.info().annotations.filter((a) => a.type === 'healed')).toHaveLength(0);
  });
});
