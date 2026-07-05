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
- **Tier 3 — LLM disambiguation (planned).** Only the ambiguous residue
  (~30% in benchmarks) is sent — top-10 candidate property JSON, no
  screenshots, no DOM dumps — to a provider of your choice (Anthropic /
  OpenAI / Ollama for fully-local).

## Benchmark honesty

Our Tier 1 engine reproduces the published VON Similo results **exactly** on
the authors' [replication dataset](https://github.com/michelnass/SimiloLLM)
(48 real-world sites, 804 relocation oracles):

| Metric | Reference (Java) | Relocator (TS port) |
|---|---|---|
| Correct top-1 | 734 / 804 (91.3%) | **734 / 804 (91.3%)** |
| Deterministic gate resolves | — | 70% of cases at 95.9% precision |

CI fails if the reproduction ever drifts by a single case
(`pnpm bench:similo`).

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
| `packages/playwright` | `withRelocator` fixture, page/locator proxy, in-page bundle. |
| `packages/reporter` | Run summary + CI annotations. |
| `benchmarks` | VON Similo replication harness. |
| `spikes/playwright-proxy` | Proxy-integration validation suite (8 go/no-go checks). |

## Status

Early development, design-complete. Working today: record, Tier 1+2 heal,
audit events, reporter, exact benchmark reproduction. Planned: patch
proposals (ts-morph codemods → PR), LLM tier, policy profiles, VON merging,
iframe/shadow-DOM traversal.

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
