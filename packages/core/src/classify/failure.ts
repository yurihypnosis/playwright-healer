/**
 * Failure classifier (design doc §7): decides which failures are candidates
 * for healing. The prime directive is "when in doubt, don't heal" — anything
 * unclassifiable is treated as a real failure and left alone.
 *
 * Classification relies on structurally stable Playwright signals:
 * error.name === 'TimeoutError' for action timeouts, the literal
 * 'strict mode violation' marker, matcherResult / 'expect(received)' for the
 * assertion engine, 'net::ERR_' prefixes for network failures, and the
 * closed-target messages for infrastructure death.
 */

export type FailureClass =
  | 'selector-not-found'
  | 'selector-ambiguous'
  | 'element-state'
  | 'assertion-failure'
  | 'navigation-network'
  | 'infrastructure'
  | 'unknown';

const ELEMENT_STATE_PATTERNS = [
  'element is not visible',
  'element is not enabled',
  'element is outside of the viewport',
  'element is not stable',
  'intercepts pointer events',
  'element is disabled',
  'element is not editable',
  'locator resolved to',
];

export function classifyFailure(error: unknown): FailureClass {
  if (!(error instanceof Error)) return 'unknown';
  const message = error.message;

  // Assertion failures first: the assertion engine's output must never be
  // mistaken for anything heal-worthy.
  if (
    (error as { matcherResult?: unknown }).matcherResult !== undefined ||
    message.includes('expect(received)') ||
    message.includes('expect.') ||
    /^\s*expect\(/m.test(message)
  ) {
    return 'assertion-failure';
  }

  if (message.includes('strict mode violation')) return 'selector-ambiguous';

  if (message.includes('net::ERR_') || message.includes('Navigation failed')) {
    return 'navigation-network';
  }

  if (
    /Target (page, context or browser has been closed|crashed)/i.test(message) ||
    /browser has been closed/i.test(message) ||
    message.includes('Execution context was destroyed')
  ) {
    return 'infrastructure';
  }

  if (error.name === 'TimeoutError') {
    // "locator resolved to ..." in the call log means the element existed:
    // its state blocked the action, which may be an app bug — do not heal.
    if (ELEMENT_STATE_PATTERNS.some((p) => message.includes(p))) return 'element-state';
    if (message.includes('waiting for')) return 'selector-not-found';
    return 'unknown';
  }

  return 'unknown';
}

/** Only selector rot is healable; everything else must fail normally. */
export function isHealable(failureClass: FailureClass): boolean {
  return failureClass === 'selector-not-found' || failureClass === 'selector-ambiguous';
}
