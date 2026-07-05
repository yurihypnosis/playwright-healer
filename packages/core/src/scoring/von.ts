/**
 * VON merge (design §6.2, VON Similo arXiv:2301.03863): visually
 * overlapping DOM nodes (IoU > 0.85) are merged into one virtual candidate
 * whose property values are ' || '-joined — the scoring engine's
 * max-pairwise comparison then treats a match on ANY constituent as a
 * match. This absorbs the "clickable div wraps the meaningful button"
 * split common in component frameworks.
 *
 * Browser-safe pure functions; runs in-page before scoring.
 */

import { VON_SEPARATOR, type WidgetProps } from './similo.js';

export interface VonRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const VON_IOU_THRESHOLD = 0.85;

export function intersectionOverUnion(a: VonRect, b: VonRect): number {
  const areaA = a.w * a.h;
  const areaB = b.w * b.h;
  if (areaA <= 0 || areaB <= 0) return 0;
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const intersection = ix * iy;
  return intersection / (areaA + areaB - intersection);
}

export interface VonGroup<T> {
  /** Constituent members, in input (document) order. */
  members: T[];
  /** OR-merged property bag: multi-values joined with ' || '. */
  props: WidgetProps;
}

/**
 * Union-find style grouping over the IoU relation, then per-group property
 * merge. Location/area/shape keep the FIRST member's value (they are
 * near-identical by construction — that's what IoU > 0.85 means); everything
 * else accumulates distinct values with the VON separator.
 */
export function mergeOverlapping<T>(
  items: readonly T[],
  getRect: (item: T) => VonRect,
  getProps: (item: T) => WidgetProps,
  iouThreshold: number = VON_IOU_THRESHOLD,
): VonGroup<T>[] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  const rects = items.map(getRect);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (intersectionOverUnion(rects[i]!, rects[j]!) > iouThreshold) union(i, j);
    }
  }

  const groups = new Map<number, T[]>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(items[i]!);
    else groups.set(root, [items[i]!]);
  }

  const SINGLE_VALUED = new Set(['location', 'area', 'shape', 'is_button']);
  return [...groups.values()].map((members) => {
    if (members.length === 1) {
      return { members, props: getProps(members[0]!) };
    }
    const merged: WidgetProps = {};
    for (const member of members) {
      const props = getProps(member);
      for (const [key, value] of Object.entries(props)) {
        if (value === undefined) continue;
        const existing = merged[key];
        if (existing === undefined) {
          merged[key] = value;
        } else if (!SINGLE_VALUED.has(key) && !existing.split(VON_SEPARATOR).includes(value)) {
          merged[key] = existing + VON_SEPARATOR + value;
        }
      }
    }
    return { members, props: merged };
  });
}
