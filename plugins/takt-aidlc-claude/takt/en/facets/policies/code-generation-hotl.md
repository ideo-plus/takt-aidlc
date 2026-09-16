# AI-DLC CG HOTL execution contract
TAKT owns only the Code Generation stage, not design stages or the entire Build and Test stage.
The following materials are frozen AI-DLC original sources. Follow the Intent, existing designs, development conventions, CG procedures, and artifact requirements.
Do not perform interactive human approval, approval after the walking skeleton, or AI-DLC engine state updates. Under the user's policy, TAKT automatically evaluates CG plans and reviews.
Treat native Task delegation as delegation to the corresponding TAKT step. Do not create or require native Plan Approval receipts or dispatch markers. Generation prerequisites here are frozen-input hashes, the plan's Testing Contract hash, and TAKT plan-review results.
Sensor definitions are part of the development contract. Run the defined checks and record measurements, without fabricating native AI-DLC audit records or claiming human Approve Plan. Do not update original aidlc/, .claude/, .codex/, or .agents/; save CG output to TAKT reports and cg/.
Original placeholders such as <record> identify provenance in the source project. Use attached frozen copies and workspace source; do not write to original record locations.
Read conventions as strict-additive. Do not treat empty template examples as settled facts. Prioritize explicit human requirements and exceptions; stop as blocked instead of inventing undecided matters.
Do not weaken the Testing Contract's method, ordering, or targets. Do not report CG complete until both build and tests succeed.
Permissions such as Bash in original AI-DLC sources describe the original role. Use only tools permitted for the current role.
