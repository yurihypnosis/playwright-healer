/**
 * Healing event log (design doc §5.2/§5.3): append-only JSONL, one file per
 * (run, worker) so parallel workers never contend. Node-only.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Callsite } from '../fingerprint/types.js';
import type { FailureClass } from '../classify/failure.js';

export interface HealingCandidateRecord {
  score: number;
  normalizedScore: number;
  breakdown: Record<string, number>;
  elementSummary: string;
  suggestedLocator: string;
}

export interface HealingEvent {
  eventId: string;
  runId: string;
  testId: string;
  timestamp: string;
  originalLocator: string;
  pagePattern: string;
  failureClass: FailureClass;
  resolvedTier: 0 | 1 | 2 | 3 | 'unresolved';
  outcome: 'healed' | 'rejected' | 'unresolved' | 'skipped-by-policy';
  candidates: HealingCandidateRecord[];
  adoptedLocator: string | null;
  totalLatencyMs: number;
  callsite: Callsite | null;
}

export class EventLog {
  private readonly filePath: string;
  private dirReady = false;

  constructor(relocatorDir: string, runId: string, workerId: string) {
    this.filePath = join(relocatorDir, 'events', `${runId}.${workerId}.jsonl`);
  }

  append(event: HealingEvent): void {
    if (!this.dirReady) {
      mkdirSync(dirname(this.filePath), { recursive: true });
      this.dirReady = true;
    }
    appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, 'utf8');
  }
}
