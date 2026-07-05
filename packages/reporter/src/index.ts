/**
 * Playwright reporter that surfaces healing activity (design doc §11):
 * terminal summary after the run and GitHub Actions warning annotations
 * placed on the exact test-file lines that need locator updates.
 *
 * Usage in playwright.config.ts:
 *   reporter: [['list'], ['@relocator/reporter', { dir: '.relocator' }]]
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Reporter } from '@playwright/test/reporter';
import type { HealingEvent } from '@relocator/core/store';
import { formatGithubAnnotations, formatSummary, summarize } from './summary.js';

export { formatGithubAnnotations, formatSummary, summarize } from './summary.js';
export type { HealSummary } from './summary.js';

export interface RelocatorReporterOptions {
  /** Relocator store directory (same as the fixture's `dir`). Default '.relocator'. */
  dir?: string;
}

export default class RelocatorReporter implements Reporter {
  private readonly eventsDir: string;
  private startTime = 0;

  constructor(options: RelocatorReporterOptions = {}) {
    this.eventsDir = join(options.dir ?? '.relocator', 'events');
  }

  onBegin(): void {
    this.startTime = Date.now();
  }

  private readRunEvents(): HealingEvent[] {
    if (!existsSync(this.eventsDir)) return [];
    const events: HealingEvent[] = [];
    for (const name of readdirSync(this.eventsDir)) {
      if (!name.endsWith('.jsonl')) continue;
      const path = join(this.eventsDir, name);
      // Only files touched by this run; older runs stay archived on disk.
      if (statSync(path).mtimeMs < this.startTime - 1_000) continue;
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line) as HealingEvent);
        } catch {
          // Skip torn lines; the log is append-only best-effort.
        }
      }
    }
    return events;
  }

  onEnd(): void {
    const events = this.readRunEvents();
    if (events.length === 0) return;
    const summary = summarize(events);
    console.log(`\n${formatSummary(summary)}`);
    if (process.env['GITHUB_ACTIONS']) {
      for (const line of formatGithubAnnotations(summary)) console.log(line);
    }
  }

  printsToStdio(): boolean {
    return true;
  }
}
