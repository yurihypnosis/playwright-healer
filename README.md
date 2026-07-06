# Relocator

[![CI](https://github.com/yurihypnosis/playwright-healer/actions/workflows/ci.yml/badge.svg)](https://github.com/yurihypnosis/playwright-healer/actions/workflows/ci.yml)

**Self-healing selectors for Playwright.**

A UI refactor renames an id, and a dozen tests go red — the app still works,
only the selectors rotted. Relocator finds the same element again at runtime
(~10ms), keeps the test running, and hands you the one-line fix to review.
Real bugs still fail. Only selector rot gets healed.

![How Relocator heals a rotted selector](docs/demo.gif)

## Setup

```ts
// fixtures.ts — this is the entire integration
import { test as base } from '@playwright/test';
import { withRelocator } from '@relocator/playwright';

export const test = withRelocator(base);
export { expect } from '@playwright/test';
```

Your test code stays untouched — `page.getByRole()`, `page.locator()`,
chains, assertions all work as-is. No Docker, no database, no API key.

## How it works

1. **Remember.** While tests are green, it fingerprints every element you
   interact with — role, text, attributes, structure, position — into a
   git-committable JSON file.
2. **Heal.** When a locator fails, it scores every element on the page
   against the fingerprint (the [Similo](https://arxiv.org/abs/2208.00677)
   algorithm, TOSEM 2023; runs in-page in ~3ms) and adopts the winner only
   when it is a statistically clear match. No clear match → the test fails
   normally: a removed feature must stay red.
3. **Fix.** After the run, `relocator-patch` turns the heals into a
   reviewable diff (`--write` to apply, `--format md` for a PR comment).

Ambiguous ties can optionally go to an LLM (Anthropic, or Ollama fully
local) — one small JSON call with the top candidates, no screenshots, no
DOM dumps, cached across runs. Without a provider, ambiguous cases just
fail; the deterministic tiers need no API key.

## Measured, not promised

| Claim | Evidence |
|---|---|
| The algorithm matches the published research | Reproduces the authors' [dataset](https://github.com/michelnass/SimiloLLM) result **exactly**: 734/804, case for case |
| It heals the right element | **0.00% wrong-element heals** across 8 kinds of selector rot, verified against ground-truth markers the engine can't see |
| It refuses when the element is gone | **4/4** deleted targets refused |
| It heals almost everything else | **100%** heal rate on the same harness (id renames, testid removal, class hashing, wrapper divs, reordering, text edits, all combined) |
| It's fast | p50 **3ms** in-page scoring; ~10ms end-to-end heal |

Both benchmarks run in CI and fail the build on any regression
(`pnpm bench:similo`, `pnpm bench:mutations`).

## What never gets healed

Assertion failures, disabled/hidden elements, network errors, crashes —
anything that is not selector rot. When in doubt, it doesn't heal.
Passwords and credit-card context are never captured or sent anywhere.

Nothing is silent: every heal writes an audit event (score breakdown,
candidates, callsite) and shows up in the run summary, GitHub Actions
annotations on the exact test line, and an optional HTML report.

## Tuning (optional)

```ts
export const test = withRelocator(base, {
  preset: 'conservative',                      // default 'standard'
  llm: { provider: new AnthropicProvider() },  // enable Tier 3
  redact: ['.user-secret'],                    // extra masking selectors
  profiles: {                                  // switch with RELOCATOR_PROFILE
    ci: { maxTier: 2, record: false },         //   deterministic only
    monitoring: { detectOnly: true },          //   report, never touch
  },
});
```

## Packages

| Package | What |
|---|---|
| `@relocator/playwright` | The fixture — this is what you install |
| `@relocator/core` | Scoring engine (same code runs in benchmarks and in-page) |
| `@relocator/llm` | Optional Tier 3 providers (Anthropic / Ollama) |
| `@relocator/patch` | `relocator-patch` CLI: heals → reviewable diffs |
| `@relocator/reporter` | Run summary, CI annotations, HTML report |

## Development

```sh
pnpm install && pnpm build && pnpm test
./benchmarks/fetch-data.sh && pnpm bench:similo && pnpm bench:mutations
```

Requires Playwright ≥ 1.53 (verified by a CI compatibility matrix).
License: Apache-2.0.
