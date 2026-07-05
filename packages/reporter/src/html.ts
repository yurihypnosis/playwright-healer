/**
 * Self-contained HTML heal report (design §11.1): healed = amber, rejected
 * and unresolved visible, every event expandable to its candidate table
 * with per-property score-contribution bars. No external assets.
 */

import type { HealingEvent } from '@relocator/core/store';
import { summarize } from './summary.js';

function esc(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const OUTCOME_META: Record<string, { label: string; color: string }> = {
  healed: { label: 'healed', color: '#b45309' },
  rejected: { label: 'rejected', color: '#6b7280' },
  unresolved: { label: 'unresolved', color: '#b91c1c' },
  'skipped-by-policy': { label: 'skipped (policy)', color: '#6b7280' },
};

function candidateTable(event: HealingEvent): string {
  if (event.candidates.length === 0) return '<p class="muted">no candidates recorded</p>';
  const rows = event.candidates
    .map((c, i) => {
      const bars = Object.entries(c.breakdown)
        .filter(([, v]) => v > 0)
        .sort(([, a], [, b]) => b - a)
        .map(
          ([key, value]) =>
            `<span class="bar" title="${esc(key)}: ${value.toFixed(2)}">` +
            `<i style="width:${Math.min(100, value * 28)}px"></i>${esc(key)}</span>`,
        )
        .join('');
      return `<tr class="${i === 0 ? 'top' : ''}">
        <td>${i + 1}</td>
        <td><code>${esc(c.suggestedLocator)}</code><div class="muted">${esc(c.elementSummary)}</div></td>
        <td class="num">${(c.normalizedScore * 100).toFixed(0)}%</td>
        <td class="bars">${bars}</td>
      </tr>`;
    })
    .join('');
  return `<table class="cands"><thead><tr><th>#</th><th>candidate</th><th>score</th><th>contributions</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function eventBlock(event: HealingEvent, index: number): string {
  const meta = OUTCOME_META[event.outcome] ?? { label: event.outcome, color: '#6b7280' };
  const llm = event.llm
    ? `<div class="llm">Tier 3: ${esc(event.llm.provider)} / ${esc(event.llm.model)} — ` +
      `confidence ${(event.llm.confidence * 100).toFixed(0)}%, "${esc(event.llm.reason)}"</div>`
    : '';
  const adopted = event.adoptedLocator
    ? `<span class="arrow">→</span> <code>${esc(event.adoptedLocator)}</code>`
    : '';
  const site = event.callsite
    ? `<span class="muted">${esc(event.callsite.file.replace(/^file:\/\//, ''))}:${event.callsite.line}</span>`
    : '';
  return `<details class="event" style="border-left-color:${meta.color}">
    <summary>
      <span class="badge" style="background:${meta.color}">${meta.label}</span>
      <span class="badge tier">tier ${event.resolvedTier}</span>
      <code>${esc(event.originalLocator)}</code> ${adopted}
      <span class="lat">${event.totalLatencyMs.toFixed(0)}ms</span>
    </summary>
    <div class="body">
      <div>${site} — ${esc(event.failureClass)} on <code>${esc(event.pagePattern)}</code></div>
      ${llm}
      ${candidateTable(event)}
    </div>
  </details>
  ${index === 0 ? '' : ''}`;
}

export function renderHtmlReport(events: readonly HealingEvent[]): string {
  const summary = summarize(events);
  const tierText =
    [...summary.tierCounts.entries()].map(([t, n]) => `${t}: ${n}`).join(', ') || '—';
  const blocks = events
    .slice()
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    .map(eventBlock)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Relocator heal report</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.5 -apple-system, "Segoe UI", sans-serif; margin: 2rem auto; max-width: 70rem; padding: 0 1rem; color: #1f2937; }
  h1 { font-size: 1.4rem; }
  .stats { display: flex; gap: 1.5rem; flex-wrap: wrap; margin: 1rem 0 2rem; }
  .stat { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: .6rem 1rem; }
  .stat b { display: block; font-size: 1.3rem; }
  .event { border: 1px solid #e5e7eb; border-left: 4px solid; border-radius: 6px; margin: .5rem 0; }
  .event summary { cursor: pointer; padding: .55rem .8rem; display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; }
  .event .body { padding: .4rem .9rem 1rem; border-top: 1px solid #f3f4f6; }
  .badge { color: #fff; border-radius: 999px; padding: .05rem .6rem; font-size: .75rem; }
  .badge.tier { background: #374151; }
  .lat { margin-left: auto; color: #6b7280; font-size: .8rem; }
  .muted { color: #6b7280; font-size: .82rem; }
  .llm { background: #eff6ff; border-radius: 6px; padding: .4rem .6rem; margin: .5rem 0; }
  code { background: #f3f4f6; padding: .05rem .3rem; border-radius: 4px; font-size: .85em; }
  table.cands { border-collapse: collapse; width: 100%; margin-top: .6rem; }
  .cands th, .cands td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  .cands tr.top { background: #fffbeb; }
  .cands td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .bars { max-width: 22rem; }
  .bar { display: inline-flex; align-items: center; gap: .25rem; margin: 0 .5rem .2rem 0; font-size: .72rem; color: #6b7280; }
  .bar i { display: inline-block; height: .55rem; background: #f59e0b; border-radius: 2px; }
  .arrow { color: #b45309; font-weight: 600; }
</style>
</head>
<body>
<h1>Relocator heal report</h1>
<div class="stats">
  <div class="stat"><b>${summary.healed.length}</b>healed</div>
  <div class="stat"><b>${summary.rejected.length}</b>rejected</div>
  <div class="stat"><b>${summary.unresolved.length}</b>unresolved</div>
  <div class="stat"><b>${tierText}</b>tier distribution</div>
  <div class="stat"><b>${summary.meanHealLatencyMs.toFixed(0)}ms</b>mean heal latency</div>
</div>
${blocks || '<p class="muted">No healing activity in this run.</p>'}
</body>
</html>`;
}
