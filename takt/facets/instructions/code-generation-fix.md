Correct the following findings while preserving the native CG requirements, conventions, and Testing Contract.
{report:03-code-generation-code-review.json}
Update cg/source-manifest.json and cg/traceability.json to match the actual changes.
Read the verification logs under cg/ and correct causes without lowering targets. Fixed gates rerun the build, tests, and sensors afterward, then return to an independent code reviewer.
If the issue is unresolvable, save the reason in cg/blocked.json and finish as blocked.

If cg/supervision.json exists with verdict changes_requested, address those requirement-validation findings too. After correcting them, return through both code review and supervise.
