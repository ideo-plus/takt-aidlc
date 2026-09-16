# Construction stage inputs and artifacts

input/construction-context.json describes the current stage, unit, required artifacts, requirement IDs, upstream artifacts, and CI output targets.
input/construction-output contains actual files for technical review. input/phase-checks.json contains measured phase-wide results.
Functional Design targets are BRx.y IDs that exist in rules.md. Detailed NFRx.y IDs from NFR Requirements are carried into the corresponding text in NFR Design and later stages.
repair_required requests one return to the owning unit's CG after a phase-wide check fails. It is not a successful verification result.
