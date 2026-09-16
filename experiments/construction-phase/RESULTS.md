# Complete Construction verification

[日本語](RESULTS.ja.md)

## Results

Synthetic inputs and mock workers exercised two successful paths. The [machine-readable record](results/2026-09-15.json) preserves stage order and final checks.

1. **Two units in dependency order.** Each ran Functional Design, NFR Requirements, NFR Design, Infrastructure Design, and shared CG, followed by global Build and Test and CI Pipeline. Design revisions and CG build/type-check failures were corrected before proceeding.
2. **Return from global verification to CG.** A consumer could pass its unit tests while violating the requirement to re-export from the earlier unit. Global verification failed, Build and Test requested repair by the owning unit, shared CG ran again, and global verification plus CI then passed.

Both paths passed every unit's build, tests, and type checking, followed by global build/tests on final source. Original inputs were preserved.

## Stop conditions checked

- Do not park without final Inception approval records.
- Reject conflicting scope settings and invalid unit dependencies.
- Do not succeed if original inputs change after parking.
- End unresolved designs as `blocked` without creating a wait for human answers.
- Mark failed final global tests as `failed`.
- Honor execution/skip choices, unit kinds, and Test Strategy.

## Hosts and distributions

Passing synthetic Inception approval events through both Claude Code and Codex distribution hooks started Construction workers. The Codex distribution was installed through the real CLI in isolated settings. Duplicate notifications still produced one run.

This full-phase test did not ask a live host model to perform Inception approval. Hook events and audit entries were explicitly synthetic. Product code does not create human-approval or native CG-start audit rows.

## What actually ran

The real TAKT engine, AI-DLC state/approval checks and official park, Bun build/tests, TypeScript checks, quality gates, and artifact/source hash checks were executed.

Fixed mock responses do not prove semantic design quality or full live-model completion. The test checks the structure that injects native stage definitions and routes artifacts through independent technical review.

Implementation uncovered a permissions error when publishing code from read-only frozen inputs into the store for later stages. The fix preserves frozen inputs and allows the controller to update only the store file receiving verified code.

## Reproduction

```sh
bun run experiment:construction-phase -- --codex --repairs
```

This uses native Codex runtime inputs, synthetic approval, and a mock TAKT worker. Model credentials are unnecessary. Logs go under `.experiments/`.

See [Construction setup](../../docs/construction-phase.md). Importing results into original AI-DLC and automatically starting Operation are not implemented.

## Validation differences found in live-model trials

A Functional Design produced by Luna Max passed the native traceability sensor but failed the initial integration gate for missing NFR IDs. The gate had reused CG's ID set for design stages and treated BR targets as simple filenames.

The integration now resolves IDs per stage and invokes the native sensor. CG IDs are resolved again from reviewed designs. Checks run in a private projection without writing original AI-DLC records. The first Luna artifact remains a regression fixture: it passes, while an added orphan BR is detected. See the [Luna Max live record](LIVE-2026-09-16.md): two design stages completed in one hour; CG was not reached.

The second live attempt passed Functional Design artifact validation but stopped when verbose review-start output exceeded the old wrapper's 2 MB cap. This was misclassified as a timeout and then masked by a missing-report error. Output is now streamed to files with bounded in-memory tails, and output limits are distinguished from time limits.
