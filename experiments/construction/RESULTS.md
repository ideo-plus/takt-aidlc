# Prototype Construction workflow results

[日本語](RESULTS.ja.md)

> Historical record. The prototype execution scripts have been removed. Commands and paths below describe the recorded experiment, not the current setup.

## Conclusion

On September 15, 2026, a workflow covering design, design review, implementation/tests, code review, and reporting completed with TAKT 0.65.0 and the real Claude provider. The verdict was **VERIFIED**. Reports and checks are recorded in the [machine-readable results](results/2026-09-15.json).

| Item | Result |
|---|---|
| Workflow execution | Successful, about 5m 20s |
| Main role sessions | Five; design, review, implementation, and reporting separated |
| Design review | approved |
| Code review | approved |
| Application validation | Three tests passed; line coverage 100% (1/1) |
| Final source | `export const answer = 42;` |
| Original source | Remained 41 |
| Original inputs, frozen snapshot, parked state | Hashes matched; unchanged |
| Automatic merge / deployment | Not performed |

Inputs were copies of Inception documents approved by a human in an earlier native AI-DLC session. This trial used synthetic state/approval events for its handoff boundary. Automatic startup from ordinary final approval was verified in a [separate native session](../native-session/STATUS.md).

## Revision and stopping behavior

Fixed mock responses, the actual TAKT engine, and verification commands checked that:

- Design findings return to design and require re-review before implementation.
- Test failures return to implementation; actual tests must pass before review.
- Code findings trigger fixes, retests, and re-review.
- Questions requiring human judgment during design or implementation are saved and stop as `needs_input`.
- Normal retry cannot advance `needs_input`.
- Reaching the step limit is not success.
- Changed code after review cannot reuse old validation results.
- Files written outside the design report prevent implementation.
- A relocated distribution can execute using its bundled workflow and gates.

The integration's 25 tests and 123 assertions passed, including preparation without an existing AI-DLC test runtime.

## Issues found with the live model

The first attempt wrote extra design documents into `.kiro/specs/` and was rejected by design-stage change detection. Instructions were updated so designers/reviewers return reports instead of writing files, and unnecessary `.kiro/` writes were restricted.

The next attempt's design reviewer found an incorrect description of TypeScript literal types and requested revision. After correction, implementation and tests ran, but code review hit the five-minute limit. The entire attempt was recorded as failed. Construction timeout became configurable, and the experiment used ten minutes.

A later attempt produced the successful result above. Failed attempts remain in the result JSON; partial progress was not counted as success.

## Limits of this trial

The subject was one constant change and three tests. Multi-unit applications, external services, CI generation, infrastructure provisioning, and return to Operation were not tested. The successful live attempt did not need a code-fix loop; correction branches were checked with deterministic mocks. This was not a comparative measurement of general code-quality improvement.
