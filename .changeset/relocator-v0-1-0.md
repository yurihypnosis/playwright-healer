---
"@relocator/core": minor
"@relocator/playwright": minor
"@relocator/llm": minor
"@relocator/patch": minor
"@relocator/reporter": minor
---

Initial release: self-healing selectors for Playwright — deterministic first, LLM last.

- Tier 1 in-page multi-attribute scoring (exact VON Similo reproduction: 734/804) with VON overlap merging, shadow-DOM traversal, and per-frame fingerprint spaces
- Tier 2 threshold gate with dynamic-value auto-demotion; refuses to heal removed elements (0.00% false heals on the mutation harness)
- Tier 3 LLM disambiguation (Anthropic / Ollama) with cross-run verdict caching, per-run call caps, and confidence thresholds
- `withRelocator(test)` one-line fixture, environment profiles, detect-only monitoring mode, security masking of sensitive context
- Audit: JSONL healing events, run summary, GitHub Actions annotations, recurring-heal quarantine detection, self-contained HTML report
- `relocator-patch` CLI: healing events → reviewable diffs or PR-comment markdown
