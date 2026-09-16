Return JSON only; write prose in English.
{"verdict":"approved or changes_requested or blocked","reason":"reason for stopping","findings":[{"target":"target location","reason":"evidence","fix":"requested correction"}],"alignment":{"intent":"code alignment with the Intent","stageDefinition":"CG artifact and sensor requirements","conventions":"convention alignment","testingContract":"measured build/tests and method/ordering alignment"}}
For approved, leave findings empty.

Map built-in APPROVE to verdict approved and REJECT to changes_requested. Use blocked when contradictory inputs prevent a decision.
Each finding must contain finding_id, status (new or persists), target, reason, and fix. Retain IDs for the same problem and put resolved findings in resolvedFindings. approved requires empty findings.
