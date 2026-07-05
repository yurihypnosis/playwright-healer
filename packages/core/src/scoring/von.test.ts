import { describe, expect, it } from 'vitest';
import { intersectionOverUnion, mergeOverlapping } from './von.js';
import { calcSimilarityScore, type WidgetProps } from './similo.js';

describe('intersectionOverUnion', () => {
  it('is 1 for identical rects and 0 for disjoint ones', () => {
    const r = { x: 0, y: 0, w: 100, h: 40 };
    expect(intersectionOverUnion(r, r)).toBe(1);
    expect(intersectionOverUnion(r, { x: 500, y: 0, w: 100, h: 40 })).toBe(0);
  });

  it('is fractional for partial overlap and 0 for zero-area rects', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    const b = { x: 50, y: 0, w: 100, h: 100 };
    expect(intersectionOverUnion(a, b)).toBeCloseTo(50_00 / 150_00, 10);
    expect(intersectionOverUnion(a, { x: 0, y: 0, w: 0, h: 0 })).toBe(0);
  });
});

interface Item {
  name: string;
  rect: { x: number; y: number; w: number; h: number };
  props: WidgetProps;
}

const item = (name: string, rect: Item['rect'], props: WidgetProps): Item => ({ name, rect, props });

describe('mergeOverlapping', () => {
  it('merges the classic div-wraps-button split into one virtual candidate', () => {
    const items = [
      item('wrapper', { x: 10, y: 10, w: 104, h: 44 }, { tag: 'div', class: 'btn-wrap', id: 'w1' }),
      item('button', { x: 12, y: 12, w: 100, h: 40 }, { tag: 'button', id: 'submit', visible_text: 'Send' }),
      item('elsewhere', { x: 500, y: 500, w: 100, h: 40 }, { tag: 'a', id: 'nav' }),
    ];
    const groups = mergeOverlapping(items, (i) => i.rect, (i) => i.props);
    expect(groups).toHaveLength(2);

    const merged = groups.find((g) => g.members.length === 2)!;
    expect(merged.props['tag']).toBe('div || button');
    expect(merged.props['id']).toBe('w1 || submit');
    expect(merged.props['visible_text']).toBe('Send');

    // Max-pairwise scoring: a target that was the plain button matches fully.
    const target: WidgetProps = { tag: 'button', id: 'submit' };
    expect(calcSimilarityScore(target, merged.props)).toBeCloseTo(1.5 + 1.5, 10);
  });

  it('keeps single-valued visual props unjoined and dedupes repeated values', () => {
    const items = [
      item('a', { x: 0, y: 0, w: 100, h: 40 }, { tag: 'button', location: '0,0', area: '4000', class: 'btn' }),
      item('b', { x: 1, y: 1, w: 99, h: 39 }, { tag: 'button', location: '1,1', area: '3861', class: 'btn' }),
    ];
    const [group] = mergeOverlapping(items, (i) => i.rect, (i) => i.props);
    expect(group!.members).toHaveLength(2);
    expect(group!.props['location']).toBe('0,0');
    expect(group!.props['area']).toBe('4000');
    expect(group!.props['tag']).toBe('button');
    expect(group!.props['class']).toBe('btn');
  });

  it('chains transitively (a~b, b~c → one group) and respects the threshold', () => {
    const items = [
      item('a', { x: 0, y: 0, w: 100, h: 100 }, { id: 'a' }),
      item('b', { x: 2, y: 2, w: 100, h: 100 }, { id: 'b' }),
      item('c', { x: 4, y: 4, w: 100, h: 100 }, { id: 'c' }),
      item('half', { x: 50, y: 0, w: 100, h: 100 }, { id: 'half' }), // IoU ~0.33 with a
    ];
    const groups = mergeOverlapping(items, (i) => i.rect, (i) => i.props);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.members.length === 3)!.props['id']).toBe('a || b || c');
  });
});
