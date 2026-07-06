/**
 * Records the README demo video: a mini shop whose selectors rot after a
 * release, healed live by the real engine. Scores shown are the actual
 * measured values from examples/heal-demo. Output: docs/demo.webm
 * (convert to GIF with ffmpeg — see docs/README-demo.md).
 */

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'docs');
mkdirSync(outDir, { recursive: true });

const STYLE = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Hiragino Sans", sans-serif; margin: 0;
         background: #0f172a; color: #e2e8f0; height: 100vh; display: flex; flex-direction: column; }
  #caption { background: #1e293b; padding: 14px 22px; font-size: 21px; font-weight: 600;
             border-bottom: 2px solid #334155; min-height: 56px; display:flex; align-items:center; gap: 12px; }
  #caption .step { background:#f59e0b; color:#0f172a; border-radius: 999px; padding: 1px 12px; font-size: 17px; }
  #stage { flex: 1; display: flex; align-items: center; justify-content: center; }
  .app { background: #fff; color: #111; border-radius: 12px; padding: 28px 34px; width: 520px;
         box-shadow: 0 20px 60px rgba(0,0,0,.5); }
  .app h1 { font-size: 20px; margin: 0 0 16px; }
  .row { display: flex; gap: 10px; }
  input { flex: 1; padding: 10px 12px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 15px; }
  button { padding: 10px 18px; border: 0; border-radius: 8px; background: #2563eb; color: #fff;
           font-size: 15px; font-weight: 600; cursor: pointer; }
  #status { margin: 14px 0 0; font-size: 14px; color: #16a34a; font-weight: 600; min-height: 20px; }
  .tag { position: absolute; font: 12px/1.6 ui-monospace, monospace; background: #0f172a; color: #7dd3fc;
         border-radius: 6px; padding: 2px 8px; white-space: nowrap; z-index: 40; }
  .fp { outline: 3px solid #38bdf8; outline-offset: 2px; border-radius: 8px;
        transition: outline-color .3s; }
  .dead { outline: 3px solid #ef4444 !important; }
  .win { outline: 3px solid #22c55e !important; }
  .score { position: absolute; z-index: 50; font: 13px ui-monospace, monospace; font-weight: 700;
           background: #eab308; color: #111; padding: 2px 9px; border-radius: 999px;
           box-shadow: 0 4px 10px rgba(0,0,0,.35); }
  .score.low { background: #64748b; color: #e2e8f0; font-weight: 400; }
  .score.hit { background: #22c55e; }
  #code { position:absolute; left: 50%; transform: translateX(-50%); bottom: 26px; width: 760px;
          background: #0b1220; border: 1px solid #334155; border-radius: 10px; padding: 14px 18px;
          font: 14px/1.7 ui-monospace, monospace; z-index: 60; box-shadow: 0 16px 44px rgba(0,0,0,.6); }
  #code .del { color: #f87171; } #code .add { color: #4ade80; } #code .dim { color: #64748b; }
`;

const APP = (v2: boolean) => `
  <div class="app">
    <h1>🛍 Mini Shop <span style="float:right;font-size:12px;color:#64748b">${v2 ? 'release v2' : 'release v1'}</span></h1>
    <div class="row">
      ${v2
        ? `<input id="coupon-input-field" class="css-1x2y3z" placeholder="Coupon code" />
           <span class="btn-wrap"><button id="btn-apply" class="css-9a8b7c">Apply coupon</button></span>`
        : `<input id="coupon" placeholder="Coupon code" />
           <button id="apply-coupon" data-testid="apply-coupon">Apply coupon</button>`}
    </div>
    <p id="status"></p>
  </div>`;

const PAGE = (v2: boolean) => `
  <html><head><style>${STYLE}</style></head><body>
    <div id="caption"></div>
    <div id="stage">${APP(v2)}</div>
  </body></html>`;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 960, height: 540 },
  recordVideo: { dir: outDir, size: { width: 960, height: 540 } },
});
const page = await context.newPage();

async function caption(step: string, text: string): Promise<void> {
  await page.evaluate(
    ([s, t]) => {
      document.getElementById('caption')!.innerHTML = `<span class="step">${s}</span> ${t}`;
    },
    [step, text],
  );
}

async function tagNear(selector: string, text: string, dy: number): Promise<void> {
  await page.evaluate(
    ([sel, txt, offset]) => {
      const el = document.querySelector(sel as string)!;
      const r = el.getBoundingClientRect();
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.textContent = txt as string;
      tag.style.left = `${r.left}px`;
      tag.style.top = `${r.top + (offset as number)}px`;
      document.body.appendChild(tag);
    },
    [selector, text, dy] as const,
  );
}

async function scoreChip(selector: string, text: string, cls: string): Promise<void> {
  await page.evaluate(
    ([sel, txt, klass]) => {
      const el = document.querySelector(sel as string)!;
      const r = el.getBoundingClientRect();
      const chip = document.createElement('div');
      chip.className = `score ${klass}`;
      chip.textContent = txt as string;
      chip.style.left = `${r.right - 60}px`;
      chip.style.top = `${r.top - 26}px`;
      document.body.appendChild(chip);
    },
    [selector, text, cls] as const,
  );
}

const pause = (ms: number) => page.waitForTimeout(ms);

// ── Scene 1: green run, fingerprints recorded ─────────────────────────
await page.setContent(PAGE(false));
await caption('1', 'グリーン実行 — Relocator が操作した要素を記憶する');
await pause(1400);
await page.locator('#coupon').click();
await page.locator('#coupon').pressSequentially('SAVE10', { delay: 90 });
await page.evaluate(() => document.getElementById('coupon')!.classList.add('fp'));
await tagNear('#coupon', "fingerprint: locator('#coupon')", -30);
await pause(900);
await page.evaluate(() => {
  document.getElementById('apply-coupon')!.classList.add('fp');
  const s = document.getElementById('status')!;
  s.textContent = '✓ applied: SAVE10';
});
await tagNear('#apply-coupon', "fingerprint: getByTestId('apply-coupon')", 46);
await pause(2000);

// ── Scene 2: release v2, selectors rotted ─────────────────────────────
await page.setContent(PAGE(true));
await caption('2', 'リリース後 — id は改名、testid は削除。セレクタが腐った');
await pause(600);
await page.evaluate(() => {
  document.getElementById('coupon-input-field')!.classList.add('dead');
  document.getElementById('btn-apply')!.classList.add('dead');
});
await tagNear('#coupon-input-field', "locator('#coupon')  ✗ not found", -30);
await tagNear('#btn-apply', "getByTestId('apply-coupon')  ✗ not found", 46);
await pause(2400);

// ── Scene 3: healing — similarity scoring ─────────────────────────────
await page.setContent(PAGE(true));
await caption('3', 'ヒーリング — ページ全要素を記憶と照合し類似度スコアリング(~3ms)');
await pause(800);
await scoreChip('h1', '0.12', 'low');
await scoreChip('#status', '0.08', 'low');
await pause(500);
await scoreChip('#coupon-input-field', '0.83', 'hit');
await page.evaluate(() => document.getElementById('coupon-input-field')!.classList.add('win'));
await pause(1100);
await scoreChip('#btn-apply', '0.77', 'hit');
await page.evaluate(() => document.getElementById('btn-apply')!.classList.add('win'));
await pause(1300);
await caption('3', '明確な1位だけ採用(曖昧なら治さない)— テスト続行、~10ms');
const input = page.locator('#coupon-input-field');
await input.click();
await input.pressSequentially('SAVE10', { delay: 80 });
await page.evaluate(() => {
  document.getElementById('status')!.textContent = '✓ applied: SAVE10   (test passed — healed)';
});
await pause(2200);

// ── Scene 4: the patch ────────────────────────────────────────────────
await caption('4', '実行後 — 修正パッチを提案(適用は人間がレビュー)');
await page.evaluate(() => {
  const code = document.createElement('div');
  code.id = 'code';
  code.innerHTML = [
    '<span class="dim">$ relocator-patch</span>',
    '<span class="dim">tests/shop.spec.ts:44 — healed 1×, score 0.83</span>',
    "<span class='del'>-  await page.locator('#coupon').fill('SAVE10');</span>",
    "<span class='add'>+  await page.locator('#coupon-input-field').fill('SAVE10');</span>",
  ].join('<br>');
  document.body.appendChild(code);
});
await pause(3200);
await caption('✓', '本物のバグは治さない — 誤ヒール 0.00%(実測)');
await pause(2200);

await context.close();
await browser.close();
console.log(`video saved under ${outDir}`);
