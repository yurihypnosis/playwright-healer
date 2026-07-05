/**
 * Cross-run cache for Tier 3 verdicts (design §6.4): the same broken
 * locator facing the same candidate structure gets the remembered verdict
 * instead of a fresh LLM call. Keyed by (pagePattern, locatorKey, a stable
 * hash of the candidate structure); cache entries store the chosen
 * candidate's identifying locator, not its index, so reordering between
 * runs cannot redirect the verdict. Node-only.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface CachedVerdict {
  /** suggestedLocator of the chosen candidate; null = "none of these". */
  chosenLocator: string | null;
  confidence: number;
  reason: string;
  provider: string;
  model: string;
  cachedAt: string;
}

interface CacheFile {
  version: number;
  entries: Record<string, CachedVerdict>;
}

/** Structure hash: order-insensitive over the candidates' identities. */
export function candidateStructureHash(candidateLocators: readonly string[]): string {
  const hash = createHash('sha256');
  hash.update([...candidateLocators].sort().join('\n'));
  return hash.digest('hex').slice(0, 16);
}

export class LLMVerdictCache {
  private readonly filePath: string;
  private entries: Record<string, CachedVerdict> = {};
  private loaded = false;
  private dirty = false;

  constructor(relocatorDir: string) {
    this.filePath = join(relocatorDir, 'llm-cache.json');
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as CacheFile;
      if (parsed.version === 1) this.entries = parsed.entries;
    } catch {
      // A corrupt cache only costs a re-ask.
    }
  }

  private key(pagePattern: string, locatorKey: string, structureHash: string): string {
    return `${pagePattern} ${locatorKey} ${structureHash}`;
  }

  get(pagePattern: string, locatorKey: string, structureHash: string): CachedVerdict | undefined {
    this.load();
    return this.entries[this.key(pagePattern, locatorKey, structureHash)];
  }

  set(
    pagePattern: string,
    locatorKey: string,
    structureHash: string,
    verdict: CachedVerdict,
  ): void {
    this.load();
    this.entries[this.key(pagePattern, locatorKey, structureHash)] = verdict;
    this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    this.load();
    // Merge-on-write like the fingerprint store: last writer wins per key.
    let onDisk: Record<string, CachedVerdict> = {};
    if (existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as CacheFile;
        if (parsed.version === 1) onDisk = parsed.entries;
      } catch {
        // ignore
      }
    }
    const merged: CacheFile = { version: 1, entries: { ...onDisk, ...this.entries } };
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    renameSync(tmpPath, this.filePath);
    this.dirty = false;
  }
}
