import { describe, expect, it } from 'vitest';
import type { DisambiguationInput } from '@relocator/core';
import { buildUserPrompt, parseVerdict } from './prompt.js';

const input: DisambiguationInput = {
  fingerprint: {
    locatorKey: "getByTestId('add-btn')",
    pagePattern: 'https://app/*',
    role: 'button',
    accessibleName: 'Add',
    tag: 'button',
    visibleText: 'Add',
    neighborText: ['notes', 'add'],
    id: 'add',
    name: null,
    classList: ['btn'],
    testId: 'add-btn',
    placeholder: null,
    href: null,
    alt: null,
    type: null,
    absoluteXPath: '/html[1]/body[1]/button[1]',
    idRelativeXPath: null,
    siblingIndex: 0,
    depth: 2,
    rect: { x: 10, y: 20, w: 80, h: 32 },
    isVisible: true,
    capturedAt: '2026-07-05T00:00:00.000Z',
    runId: 'r1',
    captureCount: 3,
    callsite: null,
  },
  candidates: [
    {
      index: 0,
      props: { tag: 'button', name: 'add-note', visible_text: 'Add' },
      suggestedLocator: "getByRole('button', { name: 'Add' })",
      normalizedScore: 0.61,
    },
    {
      index: 1,
      props: { tag: 'button', name: 'add-draft', visible_text: 'Add' },
      suggestedLocator: "locator('xpath=/html[1]/body[1]/button[2]')",
      normalizedScore: 0.6,
    },
  ],
  testName: 'adds a note',
  actionType: 'click',
};

describe('buildUserPrompt', () => {
  it('includes test context, original element, and indexed candidates', () => {
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain('Test: adds a note');
    expect(prompt).toContain('Action being attempted: click');
    expect(prompt).toContain('"testId": "add-btn"');
    expect(prompt).toContain('"add-note"');
    expect(prompt).toContain('"add-draft"');
    expect(prompt).toContain('"chosen"');
  });

  it('never includes screenshots or raw DOM (payload stays small)', () => {
    const prompt = buildUserPrompt(input);
    expect(prompt.length).toBeLessThan(5_000);
    expect(prompt).not.toContain('<html');
  });
});

describe('parseVerdict', () => {
  it('parses a valid verdict and clamps confidence', () => {
    expect(parseVerdict('{"chosen": 1, "confidence": 1.4, "reason": "x"}')).toEqual({
      chosen: 1,
      confidence: 1,
      reason: 'x',
    });
  });

  it('accepts an explicit null choice', () => {
    expect(parseVerdict('{"chosen": null, "confidence": 0.9, "reason": "gone"}')).toEqual({
      chosen: null,
      confidence: 0.9,
      reason: 'gone',
    });
  });

  it('degrades malformed fields to the safe non-heal verdict', () => {
    expect(parseVerdict('{"chosen": "2", "confidence": "high", "reason": 5}')).toEqual({
      chosen: null,
      confidence: 0,
      reason: '',
    });
  });
});
