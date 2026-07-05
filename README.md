# Relocator

**Self-healing selectors for Playwright — deterministic first, LLM last.**

When a locator breaks because the UI changed, Relocator re-locates the
semantically-same element at runtime in milliseconds, lets the test continue
(marked `healed`, never silently), and proposes the locator fix for human
review after the run.

```ts
// fixtures.ts — the entire integration
import { test as base } from '@playwright/test';
import { withRelocator } from '@relocator/playwright';

export const test = withRelocator(base);
export { expect } from '@playwright/test';
```

Existing test code is untouched: `page.getByRole()`, `page.locator()`, chains,
web-first assertions — everything keeps working. No Docker, no database, no
API key required.

## How it works

```
green run                 failure                    after the run
─────────────             ──────────────────────     ─────────────────
Phase A: RECORD           Phase B: HEAL               Phase C: PATCH (planned)
capture multi-attribute   classify the failure        aggregate healing events
fingerprints of elements  (assertion failures are     -> codemod -> diff / PR
on every green action     NEVER healed)               for human review
(sampled, fire-and-       -> score all candidates
forget, git-committable   in-page with 18 weighted
JSON store)               properties (Similo-family)
                          -> statistical outlier gate
                          -> adopt & retry, or refuse
```

- **Tier 1 — deterministic scoring.** A faithful TypeScript port of the
  [Similo / VON Similo](https://arxiv.org/abs/2208.00677) multi-attribute
  similarity algorithm (TOSEM 2023), extended with first-class ARIA
  properties (`role`, accessible name) and neighbor-text triangulation.
  Runs inside the page in a single round-trip; observed heal latency ~13ms.
- **Tier 2 — outlier gate.** The top candidate is adopted only when it is
  statistically unambiguous (absolute score, gap, and ratio thresholds).
  If nothing similar exists, Relocator **refuses to heal** — a deleted
  feature must fail its test.
- **Tier 3 — LLM disambiguation (optional).** Only the ambiguous residue
  (~30% in benchmarks) is sent — top-10 candidate property JSON, no
  screenshots, no DOM dumps — to a provider of your choice (Anthropic, or
  Ollama for fully-local). One call per heal, strict JSON verdict,
  `chosen: null` allowed, per-run call cap, confidence threshold. Without a
  provider, ambiguous cases simply fail — Tiers 1–2 need no API key.

## Benchmark honesty

**1. Algorithm reproduction.** Our Tier 1 engine reproduces the published
VON Similo results **exactly** on the authors'
[replication dataset](https://github.com/michelnass/SimiloLLM)
(48 real-world sites, 804 relocation oracles):

| Metric | Reference (Java) | Relocator (TS port) |
|---|---|---|
| Correct top-1 | 734 / 804 (91.3%) | **734 / 804 (91.3%)** |

CI fails if the reproduction ever drifts by a single case
(`pnpm bench:similo`).

**2. Mutation harness with ground truth** (`pnpm bench:mutations`): a
realistic page (16 targets incl. near-identical sibling buttons) under 8
scripted rot mutations — id renames, testid removal, CSS-in-JS class
hashing, wrapper divs, sibling reordering, text rewording, all combined,
and true element removal. Every verdict is checked against a
`data-truth` key the engine cannot see:

| Metric | Goal | Measured |
|---|---|---|
| False heals (wrong element adopted) | < 1% | **0.00%** (0/128) |
| Truly-removed targets refused | all | **4/4** |
| Tier 2 deterministic heal rate | — | 71.0% |
| Ambiguous residue escalated to Tier 3 | ~30% (paper) | ~28%, top-1 nearly always correct |
| Full-cascade ceiling (Tier 2 + Tier 3) | ≥ 90% | **99.2%** |
| In-page scoring latency | p50 < 50ms | **p50 ~3ms / p95 ~6ms** |

(The page includes a password form; security masking (§13) deliberately
strips text context near sensitive inputs, which costs a few points of
deterministic heal rate there — refusing to remember sensitive text is
the intended trade.)

These quality gates run in CI: a false-heal rate ≥ 2%, a deterministic
rate < 70%, or a cascade ceiling < 90% fails the build.

## What never gets healed

Healing hides failures if applied carelessly, so classification comes first:

| Failure | Healed? |
|---|---|
| Selector not found (timeout) | ✅ candidate |
| Strict-mode violation (ambiguous selector) | ✅ candidate |
| `expect()` assertion failure | ❌ never — the test did its job |
| Element exists but disabled/hidden | ❌ possible app bug |
| Network / navigation / crashed browser | ❌ |
| Anything unclassifiable | ❌ when in doubt, don't heal |

Every heal is audited: JSONL events with per-property score breakdowns,
candidate lists, callsites, and latency — plus a run summary and GitHub
Actions warnings on the exact test-file lines that need updating.

## Repository layout

| Package | Purpose |
|---|---|
| `packages/core` | Scoring engine, outlier gate, failure classifier, stores. Pure TS, browser-safe scoring — the same code runs in benchmarks and inside the page. |
| `packages/playwright` | `withRelocator` fixture, page/locator proxy, in-page bundle, healing cascade, policy profiles. |
| `packages/llm` | Tier 3 providers: Anthropic (structured outputs) and Ollama (local). |
| `packages/patch` | `relocator-patch` CLI: healing events → reviewable locator diffs (ts-morph). |
| `packages/reporter` | Run summary + CI annotations. |
| `benchmarks` | VON Similo replication harness. |
| `spikes/playwright-proxy` | Proxy-integration validation suite (8 go/no-go checks). |

## Environment profiles

Behavior per environment is declared once and switched with
`RELOCATOR_PROFILE`:

```ts
export const test = withRelocator(base, {
  llm: { provider: new AnthropicProvider() },
  profiles: {
    ci: { maxTier: 2, record: false },          // deterministic only, don't touch baselines
    nightly: { record: true },                   // refresh baselines on green main
    monitoring: { maxTier: 0 },                  // detect, never heal
  },
});
```

## Status

Working today: record (Phase A), Tier 1+2+3 heal with full audit events,
patch proposals (`relocator-patch` → diff, `--write` to apply), run
reporter with GitHub Actions annotations, policy profiles, and both
benchmarks (replication + mutation harness) gated in CI. Planned: VON
merging, iframe/shadow-DOM traversal, PR-comment/auto-PR patch modes,
HTML report drill-down, npm publish.

Positioning: complementary to Playwright's official dev-time Healer agent —
Relocator is the runtime safety net (`ms`-scale, deterministic, no agent
loop). Compared to Healenium: no Docker/PostgreSQL, git-committable store.
Compared to LLM-first healers: the LLM is the last resort, not the engine.

## Development

```sh
pnpm install
pnpm build
pnpm test                 # unit + integration
./benchmarks/fetch-data.sh && pnpm bench:similo
```

License: Apache-2.0 (planned).
