# Comparing parked hooks and TAKT execution environments

[日本語](EXPERIMENT.ja.md)

> Historical record. The prototype execution scripts have been removed. Commands and paths below describe the recorded experiment, not the current setup.

## Conclusion: editing worked with read-only inputs and separated AI-DLC controls

Verdict: **VERIFIED**.

On September 15, 2026, a real TAKT → Claude Code comparison rejected editing when Plan Approval Guard was inherited, while editing succeeded with separated control settings. Original requirements, state, and handoff inputs remained unchanged.

Parking does not always imply rejected edits. In direct hook tests, source edits were allowed when parked at Delivery Planning near the end of Inception. Rejection depended on CG stage/directive and approval state.

Measurements are in the [result JSON](results/2026-09-15.json); raw logs are at its `rawEvidenceDirectory`. Experimental data and upstream caches are excluded from Git.

## The live comparison used the same editing request in two environments

| Condition | Inherited AI-DLC controls | Separated controls |
|---|---|---|
| Input | Copy of requirements to set answer to 42 | Same contents |
| Initial code | `export const answer = 41;` | Same code |
| Execution | TAKT → Claude Code | TAKT → Claude Code |
| Approval guard | Registered in project PreToolUse | Not registered |
| Edit result | Rejected with exit code 2 | Succeeded |
| Final code | `answer = 41` | `answer = 42` |
| Input copy | Unchanged | Unchanged |
| Original requirements/state | Unchanged | Unchanged |
| TAKT exit code | 0 | 0 |
| Elapsed time | About 11.8 seconds | About 7.9 seconds |

Each live condition ran once. Times are reference observations, not a performance comparison.

The inherited case allowed two Read calls, then rejected Edit with `no matching v2 code-generation active directive`. Claude reported the rejection and stopped without altering settings or approvals to bypass it.

The workflow's completion condition was “attempt one edit and finish,” so both cases succeeded from TAKT's perspective. This was not a false implementation-success judgment. An automated integration must include required artifacts and verification-command results in its completion conditions.

## Model-free comparisons isolated rejection conditions

Actual hooks from the generated upstream runtime ran as subprocesses. The experiment applied a Write only after hook exit zero. This editing mechanism simulates a harness and is separate from the live Claude test.

| Condition / operation | Result |
|---|---|
| Write source during unapproved CG | Rejected, exit 2 |
| Park in the same stage, run `next`, then Write | Rejected, exit 2 |
| Read requirements after parking | Allowed, exit 0 |
| Request a source change through Bash redirection after parking | Rejected, exit 2 |
| Write upstream requirements after parking | Rejected, exit 2 |
| Write the CG plan after parking | Rejected, exit 2 |
| Write source while parked at Delivery Planning | Allowed by this approval guard, exit 0 |
| Park in autonomous mode | Engine returned `kind: error` |
| Change only CWD while inheriting original hook/project settings | Rejected, exit 2 |
| Run mock TAKT with separate inputs/controls | Source generated; inputs and original requirements/state unchanged |

`next` returned `kind: parked` after parking. Without an active CG directive, even the normal exception for creating an unapproved plan may be unavailable. The observed reason was the absence of a matching active CG directive, not merely a missing plan.

The engine process still exited zero when park was rejected. An integration must inspect the returned JSON `kind`, not rely only on process exit status.

## Pinned upstream implementation and no invented approvals

| Tool | Version |
|---|---|
| AI-DLC | v2.8.2 / `355903d6dc8eb07d3c77180be5d40ed679d6a40f` |
| TAKT | 0.65.0 |
| Claude Code | 2.1.270 |
| Bun | 1.3.13 |

AI-DLC state was synthetic experiment data, including unapproved CG, and was parked using actual `orchestrate park`. The experiment did not run all Inception stages or generate/fabricate human approval records.

Upstream source was not changed. The runtime came from official `package.ts claude`. To isolate the target behavior, the inherited live case registered only Plan Approval Guard. A configuration with every AI-DLC hook and Codex behavior were outside this experiment.

TAKT used private settings and `--pipeline --skip-git`. Claude read only experiment-project settings and was limited to Read, Write, and Edit. Original user settings and real-project guards were not disabled. Git commits only established a baseline in the synthetic project; this repository's changes were not committed as part of that experiment.

Inputs used read-only file modes and before/after hashes. The live trial also denied Write/Edit on inputs. This does not prove complete isolation from arbitrary malicious processes or immutability of all audit files.

## Historical reproduction commands

At the time of the experiment, run these from the repository root with Bun, Git, and TAKT installed. Initial setup fetched AI-DLC v2.8.2, checked its commit, and generated the runtime.

```sh
bun experiments/park-handoff/run.ts
```

Pass the printed runDir to the live trial. It requires Claude authentication and consumes model usage.

```sh
bun experiments/park-handoff/live.ts <runDir>
```

A live trial could run only once per runDir; retrying required new data from run.ts. Each condition had a 90-second process limit, plus Claude turn and spending limits.

Raw logs include prompts and local paths. The shared JSON extracts verdicts, versions, measurements, and hook exit codes.

## Next step identified at the time: automatic handoff after Inception approval

This experiment demonstrated rejection by a particular guard and TAKT execution with separated controls. Automatic park/startup after Inception approval was not yet implemented.

1. **Recommended: implement automatic handoff.** Connect artifact freezing, park JSON checks, TAKT startup, and acceptance validation.
2. **Expand tested scope first.** Repeat with all AI-DLC hooks and with Codex.

Keep input, control, and output management separate. Parking original AI-DLC alone does not establish permission for TAKT writes.
