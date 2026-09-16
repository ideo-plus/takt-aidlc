# Choose the scope delegated to TAKT

[日本語](delegation-modes.ja.md)

## Design

Two scopes are available: the CG stage only, or the complete Construction phase. Choose the scope independently of the Claude Code / Codex host and the TAKT worker provider/model.

Both modes and both hosts are implemented. They share CG execution and quality gates. Completion of the entire phase with a live model remains unverified.

## The two modes

| Choice | CG stage only | Complete Construction phase |
|---|---|---|
| Delegation boundary | CG entry, after required designs | Final Inception approval, before Construction starts |
| AI-DLC owns | Inception and required Construction designs | Inception |
| TAKT owns | The current unit's plan, technical review, implementation, build/test/sensors, code review, corrections, and final requirement validation | Selected Construction designs, dependency-ordered implementation, reviews, build/test, corrections, and phase-wide requirement validation |
| Main inputs | Intent, Inception artifacts, current unit designs, CG definition, conventions, knowledge, and sensors | Intent, Inception artifacts, stage/unit plan, stage definitions, conventions, knowledge, and sensors |
| Suitable use | Review designs in AI-DLC and automate implementation | Automate design through verification from approved requirements |

Do not start both modes for the same Intent. Scope and inputs are frozen at entry and cannot be switched during a run.

## Shared behavior

- Park the original AI-DLC session through its official CLI and run TAKT in a separate workspace.
- Use HOTL inside TAKT: automatic technical reviews and corrections, without interactive approval after the walking skeleton or other steps.
- Stop as `blocked` with a reason when requirements are contradictory or insufficient for autonomous decisions. Do not invent human decisions or approval records.
- Require successful builds, tests, and applicable sensors before accepting generated code.
- Treat importing code, recording native completion, and resuming later stages as separate acceptance operations.

## Shared CG execution

CG-only delegation and CG inside Construction use the same quality conditions.

```text
CG only
  AI-DLC unit designs → shared CG execution → verified CG result

Complete Construction
  Inception artifacts
    → required designs and technical reviews
    → shared CG execution in unit dependency order
    → phase-wide build and tests
    → verified Construction result
```

The shared implementation resolves original sources and the Testing Contract, creates the CG plan and requirement mapping, and applies implementation/review contracts and quality gates. Host entry checks and parking are separate from execution on frozen inputs. Construction can therefore call CG without advancing the original AI-DLC state to CG.

Designs generated during Construction are frozen after technical review and added to CG's read-only inputs. The integration does not create native CG-start or human-approval audit records to satisfy this prerequisite.

## Configuration

The following shows the main selections. Inputs and verification scripts are also required; see [Construction setup](construction-phase.md).

```json
{
  "hostHarness": "codex",
  "delegationScope": "construction",
  "provider": "codex",
  "model": "gpt-5.6-luna",
  "codexReasoningEffort": "max"
}
```

- `hostHarness`: the host running AI-DLC, either `claude` or `codex`.
- `delegationScope`: the scope delegated to TAKT, either `code-generation` or `construction`.
- `provider` and model settings: the environment used by TAKT workers.

## Current behavior

Choose [CG only](code-generation-stage.md) or [full Construction](construction-phase.md). TAKT handles design revisions, CG corrections, and repair requests from phase-wide checks to the owning unit. Contradictory inputs and exhausted limits stop the run and are not accepted as successful completion.
