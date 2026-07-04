import { describe, expect, it } from 'vitest';
import { classifyFailure, isHealable } from './failure.js';

function timeoutError(message: string): Error {
  const e = new Error(message);
  e.name = 'TimeoutError';
  return e;
}

describe('classifyFailure', () => {
  it('classifies element-not-found action timeouts as selector-not-found', () => {
    const e = timeoutError(
      "locator.click: Timeout 500ms exceeded.\nCall log:\n  - waiting for locator('#missing')\n",
    );
    expect(classifyFailure(e)).toBe('selector-not-found');
    expect(isHealable('selector-not-found')).toBe(true);
  });

  it('classifies strict mode violations as selector-ambiguous', () => {
    const e = new Error(
      'locator.click: Error: strict mode violation: locator(\'.dup\') resolved to 2 elements',
    );
    expect(classifyFailure(e)).toBe('selector-ambiguous');
    expect(isHealable('selector-ambiguous')).toBe(true);
  });

  it('never heals when the element existed but its state blocked the action', () => {
    const e = timeoutError(
      "locator.click: Timeout 500ms exceeded.\nCall log:\n  - waiting for locator('#btn')\n  - locator resolved to <button disabled>…</button>\n  - element is not enabled\n",
    );
    expect(classifyFailure(e)).toBe('element-state');
    expect(isHealable('element-state')).toBe(false);
  });

  it('never heals assertion failures, even timeout-flavored ones', () => {
    const e = timeoutError(
      "expect(received).toHaveText(expected)\n\nLocator: locator('#x')\nExpected string: \"a\"\nReceived string: \"b\"\nTimeout: 5000ms",
    );
    (e as { matcherResult?: unknown }).matcherResult = { pass: false };
    expect(classifyFailure(e)).toBe('assertion-failure');
    expect(isHealable('assertion-failure')).toBe(false);
  });

  it('classifies network and infrastructure failures as non-healable', () => {
    expect(classifyFailure(new Error('page.goto: net::ERR_CONNECTION_REFUSED at http://x/'))).toBe(
      'navigation-network',
    );
    expect(
      classifyFailure(new Error('locator.click: Target page, context or browser has been closed')),
    ).toBe('infrastructure');
  });

  it('defaults to unknown (non-healable) for anything else', () => {
    expect(classifyFailure(new Error('something odd'))).toBe('unknown');
    expect(classifyFailure('not an error')).toBe('unknown');
    expect(isHealable('unknown')).toBe(false);
  });
});
