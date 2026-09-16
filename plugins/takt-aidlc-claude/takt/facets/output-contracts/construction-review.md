Return JSON only; write prose in Japanese.
{"verdict":"approved or changes_requested or blocked","reason":"reason for stopping","findings":[],"alignment":{"intent":"requirement coverage","stageDefinition":"native-stage alignment","conventions":"convention alignment","testingContract":"quality targets and verification"}}
For approved, leave findings empty.

Map built-in APPROVE to verdict approved and REJECT to changes_requested. Use blocked when contradictory inputs prevent a decision.
Each finding must contain finding_id, status (new or persists), target, reason, and fix. Retain IDs for the same problem and put resolved findings in resolvedFindings. approved requires empty findings.
