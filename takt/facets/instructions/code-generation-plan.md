Follow Steps 1 and 2 in the attached native code-generation.md and return the current unit's CG plan and unit-test-instructions.
Use the input Intent, requirements, and unit designs to turn functional and infrastructure designs into implementation steps.
For Brownfield work, also plan how to inspect the existing impact area, intended changes, and baseline tests. Record the absence of existing tests when applicable.
Assign every requirement ID from input/context.json to the plan's steps and record the frozen Testing Contract hash.
Read the fixed scripts under input/project listed in checks, and describe test procedures that match their actual targets and methods.
Include execution instructions and expected results for the single unit in unit-test-instructions, with at least two H2 headings. Follow custom template headings when supplied.
The next step is automatic plan review. If missing implementation prerequisites cannot be resolved from the inputs, return blocked with a reason.
