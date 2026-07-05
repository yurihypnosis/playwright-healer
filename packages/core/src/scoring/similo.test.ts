import { describe, expect, it } from 'vitest';
import {
  SIMILO_PROPERTIES,
  calcMaxSimilarityScore,
  calcSimilarityScore,
  rankCandidates,
  type WidgetProps,
} from './similo.js';
import { evaluateGate, iqrUpperOutlierThreshold } from '../gate/outlier.js';

describe('calcSimilarityScore', () => {
  it('gives full weight on identical widgets, doubling visible_text', () => {
    const w: WidgetProps = {
      tag: 'button',
      class: 'btn primary',
      name: 'submit',
      id: 'login-btn',
      href: 'https://example.com/login',
      alt: 'login',
      xpath: '/html[1]/body[1]/button[1]',
      idxpath: "//*[@id='login-btn']",
      is_button: 'yes',
      location: '10,20',
      area: '4000',
      shape: '250',
      visible_text: 'Log in',
      neighbor_text: 'welcome back',
    };
    // All 14 props present: sum of weights 12, +1.5 for exact visible_text bonus.
    expect(calcSimilarityScore(w, w)).toBeCloseTo(13.5, 10);
    expect(calcMaxSimilarityScore(w)).toBeCloseTo(12, 10);
  });

  it('skips properties absent on either side', () => {
    const target: WidgetProps = { tag: 'a', id: 'x' };
    const candidate: WidgetProps = { tag: 'a' };
    expect(calcSimilarityScore(target, candidate)).toBeCloseTo(1.5, 10);
  });

  it('takes the max pairwise similarity across VON-merged values', () => {
    const target: WidgetProps = { tag: 'div' };
    const candidate: WidgetProps = { tag: 'span || div' };
    expect(calcSimilarityScore(target, candidate)).toBeCloseTo(1.5, 10);
  });

  it('compares tags exactly, not by string distance', () => {
    const target: WidgetProps = { tag: 'input' };
    const candidate: WidgetProps = { tag: 'inputx' };
    expect(calcSimilarityScore(target, candidate)).toBe(0);
  });

  it('scores 2D location by pixel distance with a 200px horizon', () => {
    const target: WidgetProps = { location: '0,0' };
    const near: WidgetProps = { location: '30,40' }; // distance 50
    const far: WidgetProps = { location: '300,400' }; // distance 500
    expect(calcSimilarityScore(target, near)).toBeCloseTo(0.5 * (150 / 200), 10);
    expect(calcSimilarityScore(target, far)).toBe(0);
  });

  it('replicates Java integer division in string similarity', () => {
    // "abcdefghij" vs "abcdefghiX": levenshtein 1 over length 10 -> trunc(9*100/10)/100 = 0.9
    const target: WidgetProps = { href: 'abcdefghij' };
    const candidate: WidgetProps = { href: 'abcdefghiX' };
    expect(calcSimilarityScore(target, candidate)).toBeCloseTo(0.5 * 0.9, 10);
  });

  it('rejects comma-containing strings as integers like Java parseInt', () => {
    const target: WidgetProps = { area: '116,0' };
    const candidate: WidgetProps = { area: '116' };
    // toIntStrict("116,0") -> 0, max(0,116)=116, trunc((116-116)*1000/116) = 0
    expect(calcSimilarityScore(target, candidate)).toBe(0);
  });
});

describe('rankCandidates', () => {
  it('sorts best-first and keeps input order on sub-0.001 ties', () => {
    const target: WidgetProps = { tag: 'button', visible_text: 'OK' };
    const candidates = [
      { name: 'weak', props: { tag: 'div' } as WidgetProps },
      { name: 'tieA', props: { tag: 'button' } as WidgetProps },
      { name: 'tieB', props: { tag: 'button' } as WidgetProps },
      { name: 'best', props: { tag: 'button', visible_text: 'OK' } as WidgetProps },
    ];
    const ranked = rankCandidates(target, candidates, (c) => c.props);
    expect(ranked.map((r) => r.widget.name)).toEqual(['best', 'tieA', 'tieB', 'weak']);
    expect(ranked[0]!.breakdown['visible_text']).toBeCloseTo(3, 10);
  });
});

describe('outlier gate', () => {
  it('flags a clear winner as the unique outlier', () => {
    const scores = [9, 3, 2.8, 2.5, 2.2, 2.0, 1.8, 1.5, 1.2, 1.0, 0.5];
    const gate = evaluateGate(scores);
    expect(gate.unique).toBe(true);
    expect(gate.outlierCount).toBe(1);
  });

  it('is ambiguous when two candidates stand out together', () => {
    const scores = [9, 8.9, 2.8, 2.5, 2.2, 2.0, 1.8, 1.5, 1.2, 1.0];
    const gate = evaluateGate(scores);
    expect(gate.unique).toBe(false);
  });

  it('zero-pads to ten scores like the reference implementation', () => {
    // 3 candidates: top array [5,1,1,0,0,0,0,0,0,0], q3=median(5,1,1,0,0)=1,
    // q1=median(0,0,0,0,0)=0, threshold = 1 + 1.5*1 = 2.5
    expect(iqrUpperOutlierThreshold([5, 1, 1])).toBeCloseTo(2.5, 10);
  });
});

describe('SIMILO_PROPERTIES', () => {
  it('matches the reference weight table', () => {
    const total = SIMILO_PROPERTIES.reduce((s, p) => s + p.weight, 0);
    expect(total).toBeCloseTo(12, 10);
    expect(SIMILO_PROPERTIES).toHaveLength(14);
  });
});

describe('unstable-prop demotion in projection', () => {
  it('fingerprintToWidgetProps omits demoted properties from scoring', async () => {
    const { fingerprintToWidgetProps } = await import('../fingerprint/types.js');
    const fp = {
      locatorKey: 'x', pagePattern: 'y',
      role: 'button', accessibleName: 'Add', tag: 'button',
      visibleText: 'Add', neighborText: [],
      id: 'ember-999', name: null, classList: ['css-hash'], testId: null,
      placeholder: null, href: null, alt: null, type: null,
      absoluteXPath: '/html[1]/body[1]/button[1]', idRelativeXPath: null,
      siblingIndex: 0, depth: 1,
      rect: { x: 0, y: 0, w: 10, h: 10 }, isVisible: true,
      capturedAt: '', runId: '', captureCount: 3,
      unstableProps: ['id', 'class'],
      callsite: null,
    };
    const props = fingerprintToWidgetProps(fp);
    expect(props['id']).toBeUndefined();
    expect(props['class']).toBeUndefined();
    expect(props['tag']).toBe('button');
    expect(props['accessible_name']).toBe('Add');
  });
});
