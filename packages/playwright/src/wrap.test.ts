import { describe, expect, it } from 'vitest';
import { computeInitialActionTimeout, withInitialTimeout } from './wrap.js';

describe('computeInitialActionTimeout', () => {
  it('takes 60% of large timeouts', () => {
    expect(computeInitialActionTimeout(30_000)).toBe(18_000);
  });

  it('floors at 5s so slow-but-valid locators are not healed prematurely', () => {
    expect(computeInitialActionTimeout(6_000)).toBe(5_000);
  });

  it('never exceeds the configured timeout itself', () => {
    expect(computeInitialActionTimeout(2_000)).toBe(2_000);
  });

  it('leaves "no action timeout" (0) unsplit', () => {
    expect(computeInitialActionTimeout(0)).toBeUndefined();
  });
});

describe('withInitialTimeout', () => {
  it('appends an options object when none was passed', () => {
    expect(withInitialTimeout('click', [], 5_000)).toEqual([{ timeout: 5_000 }]);
    expect(withInitialTimeout('fill', ['hello'], 5_000)).toEqual(['hello', { timeout: 5_000 }]);
  });

  it('merges into an existing options object', () => {
    expect(withInitialTimeout('click', [{ force: true }], 5_000)).toEqual([
      { force: true, timeout: 5_000 },
    ]);
  });

  it('respects an explicit caller timeout', () => {
    const args = [{ timeout: 123 }];
    expect(withInitialTimeout('click', args, 5_000)).toBe(args);
  });

  it('never mutates payload-first method payloads', () => {
    // selectOption({label}) — the object is values, not options.
    expect(withInitialTimeout('selectOption', [{ label: 'x' }], 5_000)).toEqual([
      { label: 'x' },
      { timeout: 5_000 },
    ]);
    // With an explicit options arg, that one is merged.
    expect(withInitialTimeout('selectOption', [{ label: 'x' }, { force: true }], 5_000)).toEqual([
      { label: 'x' },
      { force: true, timeout: 5_000 },
    ]);
    expect(
      withInitialTimeout('setInputFiles', [{ name: 'a.txt', mimeType: 'text/plain', buffer: 'x' }], 5_000),
    ).toEqual([{ name: 'a.txt', mimeType: 'text/plain', buffer: 'x' }, { timeout: 5_000 }]);
  });

  it('appends after class instances (e.g. dragTo target locators)', () => {
    class FakeLocator {}
    const target = new FakeLocator();
    expect(withInitialTimeout('dragTo', [target], 5_000)).toEqual([target, { timeout: 5_000 }]);
  });
});
