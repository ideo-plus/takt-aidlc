# Requirements: synthetic CG test input

## Functional requirements

- FR1: Change answer in src/value.ts from 41 to 42.
- FR1.1: Expose only answer and preserve it as a named numeric constant export.
- FR2: Add five tests in src/value.test.ts within the Standard strategy.
- FR2.1: Check the value 42, numeric type, and that the value is not the old value 41.
- FR2.2: Also check the public export shape and that the value is a finite integer.

## Nonfunctional requirements

- NFR1: Build and test the single unit with Bun and achieve at least 80% line coverage.
- NFR2: Do not add application package.json, external dependencies, CI, or lint settings. Use fixed integration tooling for type checking.
