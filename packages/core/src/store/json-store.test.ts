import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FingerprintStore } from './json-store.js';
import type { ElementFingerprint } from '../fingerprint/types.js';

function fp(overrides: Partial<ElementFingerprint>): ElementFingerprint {
  return {
    locatorKey: "locator('#a')",
    pagePattern: 'https://app.example/*',
    role: 'button',
    accessibleName: 'Submit',
    tag: 'button',
    visibleText: 'Submit',
    neighborText: ['form'],
    id: 'a',
    name: null,
    classList: ['btn'],
    testId: null,
    placeholder: null,
    href: null,
    alt: null,
    type: null,
    absoluteXPath: '/html[1]/body[1]/button[1]',
    idRelativeXPath: null,
    siblingIndex: 0,
    depth: 2,
    rect: { x: 1, y: 2, w: 30, h: 40 },
    isVisible: true,
    capturedAt: '2026-07-04T00:00:00.000Z',
    runId: 'run-1',
    captureCount: 1,
    callsite: null,
    ...overrides,
  };
}

describe('FingerprintStore', () => {
  it('round-trips fingerprints and accumulates captureCount', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relocator-store-'));
    const store = new FingerprintStore(dir);
    store.record(fp({}));
    store.record(fp({}));
    store.flush();

    const reloaded = new FingerprintStore(dir);
    const got = reloaded.get('https://app.example/*', "locator('#a')");
    expect(got?.captureCount).toBe(2);
  });

  it('merges with on-disk state instead of clobbering (parallel workers)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relocator-store-'));
    const workerA = new FingerprintStore(dir);
    const workerB = new FingerprintStore(dir);

    workerA.record(fp({ locatorKey: "locator('#a')" }));
    workerA.flush();
    workerB.record(fp({ locatorKey: "locator('#b')" }));
    workerB.flush();

    const reloaded = new FingerprintStore(dir);
    expect(reloaded.get('https://app.example/*', "locator('#a')")).toBeDefined();
    expect(reloaded.get('https://app.example/*', "locator('#b')")).toBeDefined();
  });

  it('writes deterministically sorted, versioned JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'relocator-store-'));
    const store = new FingerprintStore(dir);
    store.record(fp({ locatorKey: "locator('#z')" }));
    store.record(fp({ locatorKey: "locator('#a')" }));
    store.flush();

    const raw = JSON.parse(readFileSync(join(dir, 'fingerprints.json'), 'utf8'));
    expect(raw.version).toBe(1);
    const keys = raw.fingerprints.map((f: ElementFingerprint) => f.locatorKey);
    expect(keys).toEqual(["locator('#a')", "locator('#z')"]);
  });
});
