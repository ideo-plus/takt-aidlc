# CG-only HOTL verification record

[日本語](RESULTS.ja.md)

## Conclusion

TAKT's CG workflow started with Codex CLI using `gpt-5.6-luna` and reasoning effort `max`. The consistent five-test trial reached plan review and timed out during corrections after 30 minutes. **A complete live-model CG run remains unverified.** Model-free tests covered successful execution including corrections after build and type-check failures.

This record is separate from the earlier successful Claude experiment for the full prototype Construction workflow. This trial covers CG only without human approval waits.

## Fixed conditions

- AI-DLC 2.8.2, TAKT 0.65.0, Bun 1.3.13, Codex CLI 0.154.0.
- `gpt-5.6-luna` with `model_reasoning_effort: max`, confirmed in both TAKT configuration and actual Codex sessions.
- Native CG, agent/shared knowledge, and sensor source contents expanded into instructions.
- Change 41 to 42; preserve the named export; five tests; at least 80% line coverage; build and type checking.
- Intent, designs, and the CG-start event were [synthetic inputs](input/PROVENANCE.md). No human approval records were created, and earlier approved experiment documents were not altered.

## Automated tests

At the time of this record, 30 tests and 162 assertions passed, as did type checking, plugin build, and Claude Code plugin validation.

Tests use fixed responses with the real TAKT engine. They do not assess model judgment quality. They verify that:

- Actual TAKT prompts include the Intent, native CG, and sensor source text.
- Planning, plan review, implementation, code review, and reporting advance automatically.
- Build failures and type-check results with exit zero but `pass: false` are corrected before success.
- Original source is preserved; changes to frozen inputs or reviewed code are rejected.
- Missing information produces `blocked` without human approval records.
- Non-CG responses do not start work, and duplicate events do not create duplicate runs.
- Unsupported TDD contracts are not silently converted to `test-after`.

## Findings from live models

| Trial | Result |
|---|---|
| Claude | Detected an actual usage limit and failed before CG completion |
| Luna Max, earlier three-test input | Detected a conflict with the native Standard requirement of five to eight tests and returned `blocked` |
| Luna Max, consistent five-test input | Corrected plan-format errors; received two technical-review findings; returned to planning and timed out at 30 minutes during corrections (`failed`) |

Review identified insufficient requirement mapping in the plan text and missing Brownfield impact analysis, intended differences, and baseline-test procedures. This demonstrates review using native source material, not completed CG execution.

A provenance-format check incorrectly rejected paths prefixed with `input/project/` and `input/context.json`; it was fixed. In a run where the latter issue remained, Luna Max revised the plan to cite original files directly and passed the planning gate. Frozen gates were not replaced during execution. Afterward, the conversion from plan JSON to Markdown was fixed to retain requirement IDs, and planning instructions explicitly added Brownfield prechecks. Automated tests covered these changes; Luna Max was not rerun afterward.

The [machine-readable results](results/2026-09-15.json) record model settings, reached stages, terminal states, and verified scope. Detailed logs and generated code remain in each local `.experiments/` directory. Raw logs that may contain credentials are not distributed.

## Unverified or unimplemented

- A complete journey from a real Claude Code AI-DLC CG entry through all Luna Max CG steps.
- Application to real applications, multiple units, TDD, or substantial dependency installation.
- Import into AI-DLC, native CG completion, and automatic resumption of later stages.

See the [setup guide](../../docs/getting-started.md) for reproduction guidance.
