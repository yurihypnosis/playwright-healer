/**
 * Shadow DOM heal (design §9.5): the v2 app moves the button inside an
 * open shadow root (web-component migration). XPath cannot address shadow
 * content, so adoption goes through the tagged attribute selector, which
 * Playwright's CSS engine pierces.
 */

import { rmSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { withRelocator } from '../src/index.js';

const STORE_DIR = '.relocator-shadow-test';
const test = withRelocator(base, { dir: STORE_DIR });

const APP_V1 = `
  <html><body>
    <h1>Widgets</h1>
    <button id="launch" class="btn primary"
            onclick="document.getElementById('out').textContent='launched'">Launch widget</button>
    <p id="out"></p>
  </body></html>`;

// v2: the button now lives inside a web component's open shadow root,
// with rotted id/class. The output element stays in the light DOM.
const APP_V2 = `
  <html><body>
    <h1>Widgets</h1>
    <widget-toolbar></widget-toolbar>
    <p id="out"></p>
    <script>
      class WidgetToolbar extends HTMLElement {
        connectedCallback() {
          const root = this.attachShadow({ mode: 'open' });
          const btn = document.createElement('button');
          btn.id = 'launch-v2';
          btn.className = 'css-x1y2z3';
          btn.textContent = 'Launch widget';
          btn.addEventListener('click', () => {
            document.getElementById('out').textContent = 'launched';
          });
          root.appendChild(btn);
        }
      }
      customElements.define('widget-toolbar', WidgetToolbar);
    </script>
  </body></html>`;

test.beforeAll(() => {
  rmSync(STORE_DIR, { recursive: true, force: true });
});

test.describe.serial('shadow DOM migration', () => {
  test('v1: record the light-DOM button', async ({ page }) => {
    await page.setContent(APP_V1);
    await page.locator('#launch').click();
    await expect(page.locator('#out')).toHaveText('launched');
  });

  test('v2: heals into the open shadow root', async ({ page }) => {
    await page.setContent(APP_V2);

    await page.locator('#launch').click();
    await expect(page.locator('#out')).toHaveText('launched');

    const healed = test.info().annotations.filter((a) => a.type === 'healed');
    expect(healed).toHaveLength(1);
  });
});
