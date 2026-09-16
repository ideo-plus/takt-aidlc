Implement the following plan in order, following native CG Step 4 (generation) and Step 5 (artifact recording).
{report:01-code-generation-plan.json}
Preserve the input Intent, unit designs, CG definition, development conventions, and Testing Contract without introducing new design decisions.
Save {"stage":"code-generation","version":1,"unit":"current unit","writes":[{"path":"relative path of a created, changed, or deleted source/test file"}]} to cg/source-manifest.json. List every change.
Save {"stage":"code-generation","unit":"current unit","upstream_ids":["all requirement IDs"],"coverage":[{"id":"requirement ID","status":"OK","target":"existing source or test file"}]} to cg/traceability.json. Use IDs from input/context.json.
After your response, fixed scripts run the build, tests, and configured sensors. On failure, read cg/build.json, cg/test.json, cg/linter.json, and cg/type-check.json and correct the cause.
If the issue cannot be resolved, save {"reason":"reason and missing information"} to cg/blocked.json and finish as blocked.
