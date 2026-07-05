/**
 * Playwright reporter that surfaces healing activity (design doc §11):
 * terminal summary after the run and GitHub Actions warning annotations
 * placed on the exact test-file lines that need locator updates.
 *
 * Usage in playwright.config.ts:
 *   reporter: [['list'], ['@relocator/reporter', { dir: '.relocator' }]]
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Reporter } from '@playwright/test/reporter';
import type { HealingEvent } from '@relocator/core/store';
import {
  findRecurringHeals,
  formatGithubAnnotations,
  formatRecurringHeals,
  formatSummary,
  summarize,
} from './summary.js';

export {
  findRecurringHeals,
  formatGithubAnnotations,
  formatRecurringHeals,
  formatSummary,
  summarize,
} from './summary.js';
export type { HealSummary, RecurringHeal } from './summary.js';
export { renderHtmlReport } from './html.js';
import { renderHtmlReport } from './html.js';

export interface RelocatorReporterOptions {
  /** Relocator store directory (same as the fixture's `dir`). Default '.relocator'. */
  dir?: string;
  /** Write a self-contained HTML heal report to this path after the run. */
  html?: string;
}

export default class RelocatorReporter implements Reporter {
  private readonly eventsDir: string;
  private readonly htmlPath: string | undefined;
  private startTime = 0;

  constructor(options: RelocatorReporterOptions = {}) {
    this.eventsDir = join(options.dir ?? '.relocator', 'events');
    this.htmlPath = options.html;
  }

  onBegin(): void {
    this.startTime = Date.now();
  }

  private readEvents(sinceMs: number | null): HealingEvent[] {
    if (!existsSync(this.eventsDir)) return [];
    const events: HealingEvent[] = [];
    for (const name of readdirSync(this.eventsDir)) {
      if (!name.endsWith('.jsonl')) continue;
      const path = join(this.eventsDir, name);
      // For the run summary, only files touched by this run; the full
      // history feeds recurring-heal detection.
      if (sinceMs !== null && statSync(path).mtimeMs < sinceMs) continue;
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
    const events = this.readEvents(this.startTime - 1_000);
    if (events.length === 0) return;
    const summary = summarize(events);
    console.log(`\n${formatSummary(summary)}`);
    const recurring = findRecurringHeals(this.readEvents(null));
    if (recurring.length > 0) console.log(formatRecurringHeals(recurring));
    if (this.htmlPath) {
      mkdirSync(dirname(this.htmlPath), { recursive: true });
      writeFileSync(this.htmlPath, renderHtmlReport(events), 'utf8');
      console.log(`Relocator HTML report: ${this.htmlPath}`);
    }
    if (process.env['GITHUB_ACTIONS']) {
      for (const line of formatGithubAnnotations(summary)) console.log(line);
    }
  }

  printsToStdio(): boolean {
    return true;
  }
}
