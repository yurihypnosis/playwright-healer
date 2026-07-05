/**
 * In-page capture and scoring script. Bundled by build-inpage.mjs into a
 * string and evaluated inside the page, so candidate collection plus scoring
 * costs a single round-trip (design doc §6.1).
 *
 * CRITICAL: this file and everything it imports must stay browser-safe.
 * It imports the same @relocator/core scoring functions the benchmarks
 * validate — that shared code path is the accuracy guarantee.
 */

import {
  RELOCATOR_PROPERTIES,
  calcSimilarityScore,
  fingerprintToWidgetProps,
  rankCandidates,
  type ElementFingerprint,
  type WidgetProps,
} from '@relocator/core';

export interface CaptureOptions {
  testIdAttribute: string;
}

export interface ScoreRequest {
  target: WidgetProps;
  testIdAttribute: string;
  topN: number;
  maxCandidates: number;
}

export interface ScoredElement {
  score: number;
  normalizedScore: number;
  breakdown: Record<string, number>;
  /** Full property bag — the Tier 3 disambiguation payload (design §6.4). */
  props: WidgetProps;
  xpath: string;
  /**
   * Race-free, shadow-piercing adoption selector: the candidate element is
   * tagged with a one-off data attribute at scoring time, so adoption can't
   * be misdirected by DOM changes between scoring and retry, and works for
   * elements inside open shadow roots (where XPath cannot reach).
   */
  adoptSelector: string;
  suggestedLocator: string;
  summary: string;
}

export interface ScoreResponse {
  candidates: ScoredElement[];
  candidateCount: number;
  targetMaxScore: number;
}

function normalizeWs(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function xpathSegment(el: Element): string {
  const tag = el.tagName.toLowerCase();
  let index = 1;
  let sibling = el.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === el.tagName) index++;
    sibling = sibling.previousElementSibling;
  }
  return `${tag}[${index}]`;
}

function absoluteXPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    parts.unshift(xpathSegment(node));
    node = node.parentElement;
  }
  return `/html[1]/${parts.join('/')}`;
}

function idRelativeXPath(el: Element): string | null {
  if (el.id) return `//*[@id='${el.id}']`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    const parent: Element | null = node.parentElement;
    parts.unshift(xpathSegment(node));
    if (parent && parent.id) return `//*[@id='${parent.id}']/${parts.join('/')}`;
    node = parent;
  }
  return null;
}

const INPUT_ROLES: Record<string, string> = {
  checkbox: 'checkbox',
  radio: 'radio',
  button: 'button',
  submit: 'button',
  reset: 'button',
  range: 'slider',
  number: 'spinbutton',
  search: 'searchbox',
};

function implicitRole(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'a':
      return el.hasAttribute('href') ? 'link' : null;
    case 'button':
      return 'button';
    case 'select':
      return 'combobox';
    case 'textarea':
      return 'textbox';
    case 'input': {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase();
      return INPUT_ROLES[type] ?? 'textbox';
    }
    case 'nav':
      return 'navigation';
    case 'main':
      return 'main';
    case 'form':
      return 'form';
    case 'img':
      return 'img';
    case 'ul':
    case 'ol':
      return 'list';
    case 'li':
      return 'listitem';
    case 'table':
      return 'table';
    case 'option':
      return 'option';
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    default:
      return null;
  }
}

function computeRole(el: Element): string | null {
  return el.getAttribute('role') ?? implicitRole(el);
}

function labelText(el: Element): string | null {
  if (el.id) {
    const label = document.querySelector(`label[for='${el.id.replace(/'/g, "\\'")}']`);
    if (label) return normalizeWs(label.textContent ?? '');
  }
  const wrapping = el.closest('label');
  if (wrapping) return normalizeWs(wrapping.textContent ?? '');
  return null;
}

function accessibleName(el: Element, role: string | null): string | null {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return normalizeWs(ariaLabel);
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const texts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .map(normalizeWs)
      .filter((t) => t.length > 0);
    if (texts.length > 0) return texts.join(' ');
  }
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    const label = labelText(el);
    if (label) return label;
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return normalizeWs(placeholder);
  }
  const alt = el.getAttribute('alt');
  if (alt) return normalizeWs(alt);
  const title = el.getAttribute('title');
  if (title) return normalizeWs(title);
  if (role === 'button' || role === 'link' || role === 'heading' || role === 'option') {
    const text = normalizeWs(el.textContent ?? '');
    if (text) return truncate(text, 64);
  }
  return null;
}

function isElementVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

function neighborTexts(el: Element): string[] {
  const parent = el.parentElement;
  if (!parent) return [];
  const text = normalizeWs(parent.textContent ?? '').toLowerCase();
  if (!text) return [];
  return truncate(text, 128).split(' ').filter((w) => w.length > 0);
}

/** Capture the page-side fields of a fingerprint; meta fields are filled by Node. */
export function captureElement(el: Element, options: CaptureOptions): ElementFingerprint {
  const role = computeRole(el);
  const rect = el.getBoundingClientRect();
  const attr = (name: string): string | null => el.getAttribute(name);
  const visibleText = normalizeWs(el.textContent ?? '');
  let siblingIndex = 0;
  let sib = el.previousElementSibling;
  while (sib) {
    siblingIndex++;
    sib = sib.previousElementSibling;
  }
  let depth = 0;
  for (let n = el.parentElement; n; n = n.parentElement) depth++;

  return {
    locatorKey: '',
    pagePattern: '',
    role,
    accessibleName: accessibleName(el, role),
    tag: el.tagName.toLowerCase(),
    visibleText: visibleText ? truncate(visibleText, 64) : null,
    neighborText: neighborTexts(el),
    id: el.id || null,
    name: attr('name'),
    classList: [...el.classList],
    testId: attr(options.testIdAttribute),
    placeholder: attr('placeholder'),
    href: attr('href'),
    alt: attr('alt'),
    type: attr('type'),
    absoluteXPath: absoluteXPath(el),
    idRelativeXPath: idRelativeXPath(el),
    siblingIndex,
    depth,
    rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    isVisible: isElementVisible(el),
    capturedAt: '',
    runId: '',
    captureCount: 0,
    callsite: null,
  };
}

function cssQuote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function suggestLocator(fp: ElementFingerprint): string {
  if (fp.testId) return `getByTestId('${cssQuote(fp.testId)}')`;
  if (fp.id) return `locator('#${cssQuote(fp.id)}')`;
  if (fp.role && fp.accessibleName) {
    return `getByRole('${fp.role}', { name: '${cssQuote(fp.accessibleName)}' })`;
  }
  if (fp.visibleText && fp.visibleText.length <= 32) {
    return `getByText('${cssQuote(fp.visibleText)}')`;
  }
  return `locator('xpath=${fp.absoluteXPath}')`;
}

function summarize(el: Element): string {
  const clone = el.cloneNode(false) as Element;
  const open = clone.outerHTML.replace(/<\/[^>]+>$/, '');
  const text = normalizeWs(el.textContent ?? '');
  return truncate(`${open}${text ? truncate(text, 40) : ''}`, 160);
}

function candidateSelector(testIdAttribute: string): string {
  return `a,button,input,select,textarea,label,[role],[onclick],[tabindex],[contenteditable],[${testIdAttribute}]`;
}

/** Weight ceiling given the properties the target actually knows. */
function targetMaxScore(target: WidgetProps): number {
  let sum = 0;
  for (const spec of RELOCATOR_PROPERTIES) {
    if (target[spec.key] !== undefined) sum += spec.weight;
  }
  return sum;
}

/** Collect operable elements from the document and all open shadow roots. */
function collectOperableElements(selector: string, maxCandidates: number): Element[] {
  const out: Element[] = [];
  const visit = (root: Document | ShadowRoot): void => {
    root.querySelectorAll(selector).forEach((el) => {
      if (isElementVisible(el)) out.push(el);
    });
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) visit(el.shadowRoot);
    });
  };
  visit(document);
  return out.slice(0, maxCandidates);
}

const ADOPT_ATTR = 'data-relocator-c';
let adoptNonce = 0;

export function collectAndScore(request: ScoreRequest): ScoreResponse {
  const elements = collectOperableElements(
    candidateSelector(request.testIdAttribute),
    request.maxCandidates,
  );

  const options: CaptureOptions = { testIdAttribute: request.testIdAttribute };
  const captured = elements.map((el) => ({ el, fp: captureElement(el, options) }));
  const ranked = rankCandidates(
    request.target,
    captured,
    (c) => fingerprintToWidgetProps(c.fp),
    RELOCATOR_PROPERTIES,
  );

  const max = targetMaxScore(request.target);
  adoptNonce++;
  const top = ranked.slice(0, request.topN).map((r, i) => {
    const tag = `h${adoptNonce}-${i}`;
    r.widget.el.setAttribute(ADOPT_ATTR, tag);
    return {
      score: r.score,
      normalizedScore: max > 0 ? r.score / max : 0,
      breakdown: r.breakdown,
      props: fingerprintToWidgetProps(r.widget.fp),
      xpath: r.widget.fp.absoluteXPath,
      adoptSelector: `[${ADOPT_ATTR}="${tag}"]`,
      suggestedLocator: suggestLocator(r.widget.fp),
      summary: summarize(r.widget.el),
    };
  });

  return { candidates: top, candidateCount: captured.length, targetMaxScore: max };
}

declare global {
  // eslint-disable-next-line no-var
  var __relocatorInpage: {
    captureElement: typeof captureElement;
    collectAndScore: typeof collectAndScore;
  };
}

globalThis.__relocatorInpage = { captureElement, collectAndScore };

// Reference calcSimilarityScore so the shared scoring path is never tree-shaken
// out from under future refactors of rankCandidates.
void calcSimilarityScore;
