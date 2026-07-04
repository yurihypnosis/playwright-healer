/**
 * Canonical keys (design doc day-1 decisions): locatorKey is reconstructed
 * deterministically from the builder calls the proxy intercepts — never from
 * Locator#toString(), whose format is not a Playwright API contract.
 * pagePattern normalizes volatile URL segments so fingerprints survive
 * different ids/sessions.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^[0-9a-f]{16,}$/i;
const NUMERIC_RE = /^\d+$/;

export function normalizePagePattern(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol === 'about:' || parsed.protocol === 'data:') return parsed.protocol + parsed.pathname;
  const segments = parsed.pathname
    .split('/')
    .map((seg) => (NUMERIC_RE.test(seg) || UUID_RE.test(seg) || HEX_RE.test(seg) ? '*' : seg));
  return `${parsed.origin}${segments.join('/')}`;
}

function serializeValue(value: unknown): string {
  if (value instanceof RegExp) return value.toString();
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys
    .map((k) => {
      const v = record[k];
      const locatorKey = (v as { __relocatorKey?: string } | null | undefined)?.__relocatorKey;
      return `${JSON.stringify(k)}:${locatorKey !== undefined ? JSON.stringify(locatorKey) : serializeValue(v)}`;
    })
    .join(',');
  return `{${body}}`;
}

/** e.g. getByRole("button",{"name":"Submit"}) — deterministic across runs. */
export function serializeCall(method: string, args: readonly unknown[]): string {
  return `${method}(${args.map(serializeValue).join(',')})`;
}

export function chainKey(parentKey: string | undefined, call: string): string {
  return parentKey ? `${parentKey}.${call}` : call;
}
