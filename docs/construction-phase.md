# Delegate the complete Construction phase to TAKT

[日本語](construction-phase.ja.md)

## Execution flow

Set `delegationScope: "construction"` to delegate Construction after final Inception approval. Both Claude Code and Codex hosts are supported. The official CLI parks the original AI-DLC session, and work continues in a separate workspace.

```text
Final Inception approval
  → Freeze inputs, stage selection, and unit dependencies; park AI-DLC
  → Process units in dependency order
      → Functional Design
      → NFR Requirements / NFR Design
      → Infrastructure Design
      → Shared CG: plan, review, implement, build/test/sensors, correct
  → Build and Test across all units, followed by technical review
      → If needed, repair the owning unit once through CG and recheck
  → Generate and review applicable CI pipelines
  → Supervise the complete Intent, requirements, and unit integration
      → If needed, rerun owning-unit CG and global stages once, then reassess
  → Rerun every unit check and the full build/tests on the approved source
```

Design and CI stages follow the original Stage Progress selection. Stages marked `[S]` or `SKIP` are not run. Artifact applicability follows unit kinds. Required testing documents follow the Minimal, Standard, or Comprehensive strategy.

TAKT performs automatic technical review, not human approval. There is no interactive gate after the walking skeleton. Unresolvable inputs produce `blocked` with a reason. The integration does not create native approval, CG-start, or stage-completion audit rows.

## Shared implementation with CG-only mode

Native CG entry validation is separate from `executeCgWorkspace`, which operates on frozen inputs. Construction calls the same CG executor, workflow, and quality gates for each unit.

- Inject the original CG definition, Intent, conventions, knowledge, sensors, and Testing Contract.
- Freeze earlier designs after technical review and add them to CG's read-only inputs.
- Review the same code that passed build, tests, and applicable sensors.
- Pass generated code to dependent units before implementing them.
- Rerun each unit's fixed build, tests, and sensors on the final source.

Design and phase-wide stages receive their native Markdown, author/reviewer definitions and knowledge, upstream artifacts, and fixed scripts. Each stage records provenance and hashes in `control/injection.json`.

## Configuration

Follow [shared setup](getting-started.md) and the [Codex host guide](codex-host.md). Configure the project before final Inception approval.

Adapt these paths and scripts to the target project:

```json
{
  "enabled": true,
  "hostHarness": "codex",
  "delegationScope": "construction",
  "language": "ja",
  "provider": "codex",
  "model": "gpt-5.6-luna",
  "codexReasoningEffort": "max",
  "artifacts": [
    "aidlc/spaces/default/intents/<intent>/inception/requirements-analysis/requirements.md"
  ],
  "sources": ["src/value.ts"],
  "workflow": "aidlc/takt-handoff/takt/ja/workflows/aidlc-code-generation-stage.yaml",
  "constructionWorkflow": "aidlc/takt-handoff/takt/ja/workflows/aidlc-construction-phase.yaml",
  "buildScript": "aidlc/takt-handoff/unit-build.ts",
  "verifyScript": "aidlc/takt-handoff/unit-test.ts",
  "sensorScripts": {
    "type-check": "aidlc/takt-handoff/unit-typecheck.ts"
  },
  "sensorExceptions": {
    "linter": {
      "reason": "The approved practices exclude adding a lint framework",
      "source": "aidlc/spaces/default/intents/<intent>/inception/practices-discovery/team-practices.md"
    }
  },
  "phaseBuildScript": "aidlc/takt-handoff/full-build.ts",
  "phaseVerifyScript": "aidlc/takt-handoff/full-test.ts",
  "pipelinePaths": [".github/workflows/ci.yml"],
  "timeoutMs": 3600000
}
```

`language` accepts `ja` (the default) or `en`. For English execution, set `language: "en"` and point `workflow` and, in Construction mode, `constructionWorkflow` to `takt/en/workflows/`. Built-in facets and injected runtime policies use the same language. Original AI-DLC sources remain frozen inputs without translation.

Follow [TAKT bundle download](getting-started.md#download-the-takt-bundle) and place the complete `takt/`, including both language trees, under `aidlc/takt-handoff/`. No clone or build of this repository is required.
Use `takt/ja/workflows/aidlc-code-generation-stage.yaml` for CG and `takt/ja/workflows/aidlc-construction-phase.yaml` for artifact creation and review. Local instructions, policies, knowledge, and output contracts are frozen inputs. Personas use TAKT 0.65.0 built-ins.

`hostHarness` selects the host, `delegationScope` the scope, and `provider` the worker. Scope is required and must be `code-generation` or `construction`.

### Per-unit checks

Use unit names as keys in `unitChecks` to override `buildScript`, `verifyScript`, `sensorScripts`, and `sensorExceptions`. Units without overrides use the corresponding top-level settings.

Define each unit's checks so that an earlier unit does not require a later, unimplemented unit. Put combined checks in `phaseBuildScript` and `phaseVerifyScript`. Fixed scripts enforce coverage and other quality targets.

### Sensors for design artifacts

- `required-sections`: require at least two H2 headings and any headings specified by a custom template.
- `upstream-coverage`: require a complete inventory of frozen upstream artifacts.
- `traceability`: use native `aidlc engine sensor-traceability`. Functional Design checks FR/AC-to-BR mappings and orphan rules; NFR stages use their corresponding NFR IDs. Resolve IDs again before CG to include BR and detailed NFR IDs introduced by design.
- `linter` / `type-check`: TS/JS code snippets require the corresponding `stageSensorScripts` entry, exit code zero, and JSON `pass: true`.

Native sensors receive a private projection of the original parked state and reviewed upstream artifacts. This is a checking copy, not an advancement of original state or an invented approval.

Design scripts receive the artifact directory through `AIDLC_ARTIFACTS_DIR`. When there are no TS/JS snippets and no configured script, record `not_applicable` with a reason. This is separate from checking application code during CG.

CI may write only files listed in `pipelinePaths`. YAML must parse, and full build/test and technical review must pass. This does not claim that the CI service ran a job or deployed anything.

## Final requirement validation

The built-in `supervisor` and `supervise` compare all units' final code with the Intent, Inception requirements, designs, and unit assessments. Individual stage reviews and phase-final supervision run in separate sessions.

- approved: record code evidence for every requirement and unit, then proceed to final machine checks.
- changes_requested: return `repairUnits` to CG in dependency order, repeat Build and Test and applicable CI, then supervise again.
- blocked: record the required external decision and stop without waiting for interaction.

Supervision permits one repair round; another rejection produces failed. Build and Test also permits one repair round for the whole phase.
Changed code cannot reuse an earlier judgment. Even approved supervision does not produce verified if the final build, tests, or applicable sensors fail.

## Results

```sh
cat aidlc/takt-handoff/construction-phase-runs/<run-id>/status.json
```

Records are stored under `aidlc/takt-handoff/construction-phase-runs/<run-id>/`.

| Location | Contents |
|---|---|
| `manifest.json` / `snapshot/` | Inputs and settings frozen at approval |
| `status.json` | `parked` → `running` → `verified` / `blocked` / `failed` |
| `attempts/1/<stage>/` | TAKT execution, provenance, reports, reviews, checks |
| `attempts/1/store/` | Code and reviewed artifacts passed to later stages |
| `attempts/1/result/` | Final generated source |
| `attempts/1/final-unit-checks.json` | Unit checks on the final source |
| `attempts/1/final-build.json` / `final-test.json` | Final phase-wide checks |
| `attempts/1/result.json` | Stages, units, artifacts, and hashes |

The original AI-DLC session remains parked even after verified. Code import, native Construction completion, and automatic transition to Operation are not implemented.

## Verification and limits

See the [verification record](../experiments/construction-phase/RESULTS.md). Synthetic inputs and mock workers exercise multiple units, design revisions, build/type-check corrections, CI generation, and both hosts' hooks. This is separate from completing the entire phase with a live model.

- Requires AI-DLC 2.8.2, State Version 8, a single audit shard, and entry immediately after Inception completion.
- Requires a valid unit dependency DAG, CG and Build and Test in the selected scope, an agreed Test Strategy, and `test-after`. Zero-unit and CG-skipping scopes are unsupported.
- Units run serially in dependency order. Stages have time and step limits. Full TAKT output is saved to `takt-output.stdout.log` / `takt-output.stderr.log`; `takt.json` keeps the last 64,000 characters. One TAKT invocation has a combined 100 MB log limit. Output limits and timeouts are reported separately.
- Designs and CG are corrected within their workflows. A measured Build and Test failure can return `repair_required` and its owning unit for one shared-CG repair and recheck. Stop if it still fails or ownership cannot be determined from inputs.
- Enumerate regular source files. `node_modules` and `.venv` are treated as temporary dependencies and excluded from differences. Mid-run resumption, automatic lock recovery, and complete OS isolation are not implemented.

## Live-model trial

```sh
bun run experiment:construction-phase -- --live
```

Requires Codex authentication. The trial uses Luna Max (`gpt-5.6-luna`, `max`), one unit, all seven native stages, and a one-hour limit. It uses dedicated synthetic inputs and a synthetic approval boundary, with a live TAKT worker. It cannot be combined with `--repairs`.

Inspect progress with:

```sh
bun experiments/construction-phase/inspect.ts /absolute/path/to/construction-phase-runs/<run-id>
```
