# Live verification of automatic handoff after final approval

[日本語](STATUS.ja.md)

> Historical record. The prototype execution scripts have been removed. Commands and paths below describe the recorded experiment, not the current setup.

## Latest result

On September 15, 2026, the corrected plugin completed **park, TAKT startup, implementation, and validation without manual recovery after final approval**. The [latest trial results](results/2026-09-15-recheck.json) are preserved.

| Check | Result |
|---|---|
| Actual final approval command | Succeeded once with a normal `done` response |
| Manual park, hook replay, or worker startup after approval | None |
| TAKT execution | One successful live Claude run |
| Application checks | Three tests passed; line coverage 100% (1/1) |
| Original code and approved inputs | Unchanged |
| Frozen snapshot and parked state | Hashes matched |
| Source experiment state | Unchanged |
| Bedrock settings | Removed from child processes |
| Automatic merge | Not performed |

Reverification copied real approved Inception artifacts into another environment and reopened Delivery Planning through AI-DLC's official backward jump. State and audit records were not manually rolled back. The five handoff documents matched those from the previous approval, and final approval was recorded through the normal UI based on the existing approval and reverification request.

**The verified scope is unattended execution after final approval.** This did not recreate Inception from scratch. Before approval, existing answers were transferred, and a failing native `review-brief` call was replaced by direct Bun execution of the bundled read-only tool to continue inspection. No core patch or stage omission was used.

## Earlier attempts

The first end-to-end trial completed normal Inception with real human answers/approvals, but the integration rejected a valid `done` response. Fixing the adapter and reprocessing the real approval response recovered implementation and validation. The [first result](results/2026-09-15.json) remains classified as requiring recovery.

The first reverification missed an approval command containing `echo` and redirection, requiring manual guidance to use a single command. That [result](results/2026-09-15-recheck-first.json) is also not classified as unattended success. The second reverification after strengthening detection produced the latest result above.

## Defect found at final approval

The native command `aidlc engine orchestrate report --stage delivery-planning --result approved --user-input "Approve"` records approval and returns `kind: done`. The integration expected a next-stage directive and incorrectly rejected it.

A regression test reproduced the failure using the actual response, and the adapter was changed to accept `done`. It still verifies state, approval/completion audit records, and preapproval input hashes rather than trusting the response alone. A hook-failure message tells the host not to continue Construction. Type checking and 19 tests with 97 assertions passed at this point.

After the initial failure, the AI-DLC session parked through the official command. Recovery replayed the actual PostToolUse response to the fixed plugin; its official park call also succeeded. Final approval was not repeated, and state/approval records were not manually edited.

## Connection used

Claude Code plugin hooks detect final approval, and the bundled CLI freezes inputs, parks, starts TAKT, and verifies output. No AI-DLC core patch was required.

TAKT receives approved Inception documents as read-only inputs and implements in another Git workspace. Original AI-DLC hooks stay with their session; TAKT child processes receive separate settings. Bedrock flags were removed for this experiment at the user's request.

Data is stored under `aidlc/takt-handoff/` because adding files under `.takt-aidlc/` or custom `.claude/` paths changed AI-DLC's source identity in live trials.

## Experiment scope

A single library unit formed one implementation increment. Normal conditional selection skipped User Stories, Refined Mockups, Domain Design, and Contract Design. The user actually approved assessment, practices, requirements, units, and final planning. Learning-record questions were answered with “nothing to add” under the user's explicit instruction.

This connection test used a one-step implementation workflow, without a detailed-design/review/correction loop. The Claude worker could operate on files; a fixed verification script executed tests through the integration CLI. The experiment did not measure quality improvement for full Construction.

## Execution data and resumption notes

| Item | Value |
|---|---|
| Experiment directory | `.experiments/native/2026-09-15T05-38-12.649Z/` |
| Handoff ID | `8569e363b1276a488f1f41ea` |
| tmux socket | `takt-aidlc-lab` |
| tmux session | `native-20260915-053812` |
| Claude session | `61d033c9-e09c-4ec1-b62a-6967ed3eadf2` |

Artifacts are in the experiment project's `aidlc/takt-handoff/runs/<ID>/attempts/1/work/`; test results are in its parent's `verification.json`. Original AI-DLC remains parked. Inspect results before continuing the experiment so AI-DLC does not implement the same work again.

## Directions identified at the time

1. **Recommended: expand the Construction workflow.** Define detailed design, implementation, review, correction, verification, and completion conditions.
2. **Prepare the integration for distribution.** Document installation, supported scope, and operational checks.

## Compound-command issue found during reverification

When rerunning the final stage in another environment, Claude appended `2>&1` and `echo` to the approval command. The single-command hook did not detect it, so only approval advanced. Resending a single command let TAKT succeed, but the manual guidance prevents classifying this as unattended success. The [attempt record](results/2026-09-15-recheck-first.json) is preserved.

PreToolUse was updated to reject recognized approval commands containing chaining or redirection before execution and explain the required form. Nineteen tests passed. The next reverification used a single approval command and completed without recovery. Plugin tests also verified the rejection response.

## Latest execution data

- Experiment directory: `.experiments/native-recheck/2026-09-15T09-28-11.704Z/`
- Handoff ID: `31b6e77267cc7d90c22fbe4f`
- tmux session: `recheck-1789464491835`, socket `takt-aidlc-lab`
- Claude session: `77b4e18e-b186-4d67-8179-3c8a65ee0e4f`
- Original AI-DLC session: stopped in parked state

The trial used `recheck.ts` for setup/startup and `collect-recheck.ts` for comparison. A checkpoint copied directly from the live environment immediately before final approval remains in the experiment directory. Those scripts did not directly invoke postapproval hooks.

## Subsequent Construction expansion

After the connection test, a dedicated workflow added design, review, and corrections and completed in a separate live-model trial. See its [results and scope](../construction/RESULTS.md).
