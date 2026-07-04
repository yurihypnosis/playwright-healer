/**
 * Element fingerprint model (design doc §5.1) and its projection onto the
 * scoring engine's property bag. Browser-safe: the in-page script constructs
 * these and the Node side stores them.
 */

import type { PropertySpec, WidgetProps } from '../scoring/similo.js';
import { SIMILO_PROPERTIES } from '../scoring/similo.js';

export interface ElementRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Callsite {
  file: string;
  line: number;
  column: number;
}

export interface ElementFingerprint {
  /** Canonical locator string, e.g. `getByRole("button",{"name":"Submit"})`. */
  locatorKey: string;
  /** Normalized page URL pattern (query/hash stripped, volatile segments wildcarded). */
  pagePattern: string;

  // Semantic layer
  role: string | null;
  accessibleName: string | null;
  tag: string;
  visibleText: string | null;
  neighborText: string[];

  // Attribute layer
  id: string | null;
  name: string | null;
  classList: string[];
  testId: string | null;
  placeholder: string | null;
  href: string | null;
  alt: string | null;
  type: string | null;

  // Structural layer
  absoluteXPath: string;
  idRelativeXPath: string | null;
  siblingIndex: number;
  depth: number;

  // Visual layer
  rect: ElementRect;
  isVisible: boolean;

  // Meta
  capturedAt: string;
  runId: string;
  captureCount: number;
  callsite: Callsite | null;
}

/**
 * Relocator property set: the validated Similo-14 plus first-class
 * accessibility properties (design doc §6.1 — the role/accessibleName pair
 * carries a combined weight of 2.0).
 */
export const RELOCATOR_PROPERTIES: readonly PropertySpec[] = [
  ...SIMILO_PROPERTIES,
  { key: 'role', weight: 1.0, kind: 'exact' },
  { key: 'accessible_name', weight: 1.0, kind: 'string' },
  { key: 'test_id', weight: 1.5, kind: 'exact' },
  { key: 'placeholder', weight: 0.5, kind: 'string' },
];

/** Project a fingerprint onto the WidgetProps bag the scoring engine consumes. */
export function fingerprintToWidgetProps(fp: ElementFingerprint): WidgetProps {
  const props: WidgetProps = {};
  const set = (key: string, value: string | null | undefined) => {
    if (value !== null && value !== undefined && value.length > 0) props[key] = value;
  };
  set('tag', fp.tag);
  set('class', fp.classList.join(' '));
  set('name', fp.name);
  set('id', fp.id);
  set('href', fp.href);
  set('alt', fp.alt);
  set('xpath', fp.absoluteXPath);
  set('idxpath', fp.idRelativeXPath);
  props['is_button'] =
    fp.tag === 'button' || fp.role === 'button' || (fp.tag === 'input' && fp.type === 'submit')
      ? 'yes'
      : 'no';
  set('location', `${Math.round(fp.rect.x)},${Math.round(fp.rect.y)}`);
  set('area', String(Math.round(fp.rect.w * fp.rect.h)));
  set('shape', String(Math.round((fp.rect.w * 100) / Math.max(fp.rect.h, 1))));
  set('visible_text', fp.visibleText);
  set('neighbor_text', fp.neighborText.join(' '));
  set('role', fp.role);
  set('accessible_name', fp.accessibleName);
  set('test_id', fp.testId);
  set('placeholder', fp.placeholder);
  return props;
}
