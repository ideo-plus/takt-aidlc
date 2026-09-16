# Team practices: Practices Discovery Step 5 final integration

> This is the final document from Practices Discovery Step 5 (Lead Integration). It combines the Step 2 lead draft, independent quality/developer/DevSecOps reviews in Step 3, and human interview answers in Step 4. Explicit human decisions take priority; inferences remain only as supporting rationale.
>
> See `evidence.md` for investigation evidence and `discovered-rules.md` for Mandated/Forbidden constraints.

## Way of Working

- **Decision:** follow the trunk-based default in `aidlc/spaces/default/memory/org.md`: short-lived feature branches squash-merged to `main`. Whether to use pull request review or direct main commits is deliberately undecided for this Intent and left to a future Intent, as explicitly answered by the human.
- **No automatic merge** in this experiment, per the confirmed human answer.
- **Evidence:** the repository has one commit (`db4bc05 test: seed native workflow experiment`), only `main`, and no remote (`git remote -v` is empty). There is no operational evidence for a branch/review process. The decision is limited to this one-line constant change, not a permanent team convention.

## Walking Skeleton

- **Decision:** none. The human confirmed that a separate skeleton is unnecessary for this one-line change.
- **Evidence:** scope is `classic`, and implementation is limited to one line in `src/value.ts`; no separate end-to-end connectivity check is needed.

## Testing Posture

- **Methodology:** test-after.
- **Ordering:** change 41 to 42 in `src/value.ts`, then run `bun test` to check (1) `answer === 42`, (2) `typeof answer === "number"`, and (3) no return to the old value 41.
- Provide a minimal test environment and automate with `bun test`, as confirmed by the human. **Do not create package.json** or add external dependencies; invoke Bun directly. Bun can run `bun test src/value.test.ts` or discover tests through `bun test` without a package manifest.
- Put tests in `src/value.test.ts`, adopting the developer review suggestion to follow Bun's adjacent-test convention.
- **Coverage:** use `bun test --coverage`, as confirmed by the human. The one-line/one-export target reaches 100% line coverage when any of these tests executes it, formally satisfying org.md's 80% floor for `classic` scope.
- **CI deviation:** use local `bun test` evidence in place of a CI execution gate and do not add a CI workflow, per the human's confirmed answer. This differs from org.md's `classic` default requiring CI before merge. Record it as an explicit agreement limited to this Intent. A future CI/CD Intent should reconsider returning to the default.
- **Error handling:** not applicable. As the developer review noted, the one-line constant export has no integration boundary: no API calls, database operations, file I/O, or external services.

## Deployment

Deployment is outside this Intent. The description explicitly excludes external services, UI, databases, and deployment, so org.md's default staging deployment on merge does not apply.

## Code Style

- **Decision:** do not add linting or formatting tools for this Intent; defer them to future work, as confirmed by the human.
- Preserve the existing `src/value.ts` format: no indentation and a trailing semicolon. Introduce no new style rules.
- The historical DevSecOps review assessed this static constant export as having no attack surface: no inputs, communication, persistence, authentication, or authorization. It therefore did not require adding lint/SAST infrastructure for this Intent.
