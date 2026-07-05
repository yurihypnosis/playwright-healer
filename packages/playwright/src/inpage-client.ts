/**
 * Node-side client for the in-page script: installs the bundle lazily per
 * page and forwards capture/score calls.
 */

import type { ElementHandle, Page } from '@playwright/test';
import type { ElementFingerprint } from '@relocator/core';
import { INPAGE_BUNDLE } from './inpage-bundle.generated.js';
import type { ScoreRequest, ScoreResponse } from './inpage/main.js';

type InpageGlobal = typeof globalThis & {
  __relocatorInpage?: {
    captureElement: (
      el: Element,
      opts: { testIdAttribute: string; redact?: string[] | undefined },
    ) => ElementFingerprint;
    collectAndScore: (req: ScoreRequest) => ScoreResponse;
  };
};

async function ensureInstalled(page: Page): Promise<void> {
  await page.evaluate(
    `(() => { if (!globalThis.__relocatorInpage) { ${INPAGE_BUNDLE} } })()`,
  );
}

export async function captureFingerprint(
  page: Page,
  handle: ElementHandle,
  testIdAttribute: string,
  redact?: string[],
): Promise<ElementFingerprint> {
  await ensureInstalled(page);
  return handle.evaluate(
    (el, opts) => (globalThis as InpageGlobal).__relocatorInpage!.captureElement(el as Element, opts),
    { testIdAttribute, redact },
  );
}

export async function collectAndScore(page: Page, request: ScoreRequest): Promise<ScoreResponse> {
  await ensureInstalled(page);
  return page.evaluate(
    (req) => (globalThis as InpageGlobal).__relocatorInpage!.collectAndScore(req),
    request,
  );
}
