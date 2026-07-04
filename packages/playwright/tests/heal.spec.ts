/**
 * M1 end-to-end demo: a green run records fingerprints (Phase A), then the
 * same locators run against a mutated DOM and heal at runtime (Phase B).
 *
 * V2 mutations (the classic selector-rot menu):
 * - button: data-testid removed, id renamed, wrapped in an extra div
 * - input: id renamed, classes hashed (CSS-in-JS style)
 * - assertion-relevant behavior unchanged — tests must stay green via healing
 */

import { rmSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { withRelocator } from '../src/index.js';

const STORE_DIR = '.relocator-test';

const test = withRelocator(base, { dir: STORE_DIR });

const APP_V1 = `
  <html><body>
    <h1>Todos</h1>
    <div class="entry">
      <input id="new-todo" class="input-main" placeholder="What needs to be done?" />
      <button id="add" class="btn btn-primary" data-testid="add-btn"
              onclick="addTodo()">Add</button>
      <button id="clear" class="btn" onclick="clearTodos()">Clear</button>
    </div>
    <ul id="list"></ul>
    <script>
      function addTodo() {
        const input = document.querySelector('#new-todo, [data-input]');
        const li = document.createElement('li');
        li.textContent = input.value || '(empty)';
        document.getElementById('list').appendChild(li);
        input.value = '';
      }
      function clearTodos() { document.getElementById('list').innerHTML = ''; }
    </script>
  </body></html>`;

const APP_V2 = `
  <html><body>
    <h1>Todos</h1>
    <div class="entry entry--v2">
      <input data-input class="css-x7k2q9" placeholder="What needs to be done?" />
      <div class="btn-wrap">
        <button id="add-item-button" class="css-9dk3ma" onclick="addTodo()">Add</button>
      </div>
      <button id="clear-all" class="css-1a2b3c" onclick="clearTodos()">Clear</button>
    </div>
    <ul id="list"></ul>
    <script>
      function addTodo() {
        const input = document.querySelector('#new-todo, [data-input]');
        const li = document.createElement('li');
        li.textContent = input.value || '(empty)';
        document.getElementById('list').appendChild(li);
        input.value = '';
      }
      function clearTodos() { document.getElementById('list').innerHTML = ''; }
    </script>
  </body></html>`;

test.beforeAll(() => {
  rmSync(STORE_DIR, { recursive: true, force: true });
});

test.describe.serial('record then heal', () => {
  test('green run on v1 records fingerprints', async ({ page }) => {
    await page.setContent(APP_V1);

    await page.locator('#new-todo').fill('buy milk');
    await page.getByTestId('add-btn').click();

    await expect(page.locator('#list li')).toHaveText(['buy milk']);
    expect(test.info().annotations.filter((a) => a.type === 'healed')).toHaveLength(0);
  });

  test('same locators heal against the mutated v2 DOM', async ({ page }) => {
    await page.setContent(APP_V2);

    // Both selectors are rotten in v2; the engine must relocate them.
    await page.locator('#new-todo').fill('buy milk');
    await page.getByTestId('add-btn').click();

    // Behavior still works end-to-end through the healed locators.
    await expect(page.locator('#list li')).toHaveText(['buy milk']);

    const healed = test.info().annotations.filter((a) => a.type === 'healed');
    expect(healed).toHaveLength(2);
    expect(healed.map((a) => a.description).join('\n')).toContain('add-btn');
  });

  test('healing refuses when the element is really gone', async ({ page }) => {
    await page.setContent(APP_V1);
    await page.getByTestId('add-btn').click(); // extra recording for stability

    const NO_BUTTON = APP_V2.replace(/<div class="btn-wrap">[\s\S]*?<\/div>/, '');
    await page.setContent(NO_BUTTON);

    // The Add button no longer exists at all: healing must NOT pick some
    // other button; the failure must surface.
    await expect(page.getByTestId('add-btn').click({ timeout: 1_000 })).rejects.toThrow();
  });
});
