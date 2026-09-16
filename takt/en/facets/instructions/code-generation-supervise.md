Independently compare the current unit's Intent, requirements, and designs with the actual code to judge requirement fulfillment.
{report:01-code-generation-plan.json}
{report:03-code-generation-code-review.json}
For every requirementId in input/context.json, identify current source or tests and explain why the code satisfies the acceptance condition. An ID mapping alone is insufficient.
Check earlier findings against their original acceptance conditions and record the overall Intent assessment in intentAssessment.
Return changes_requested for correctable gaps, blocked when external judgment is necessary, or approved when all requirements are met. Do not review build/test logs.
