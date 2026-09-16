# Requirements: synthetic Construction live-model input

## Functional requirements

- FR1: Change answer in src/value.ts from 41 to 42.
- FR1.1: Expose only the named answer export and preserve its numeric-constant form.
- FR2: Create five unit tests in src/value.test.ts.
- FR2.1: Check value 42, numeric type, and that it differs from 41.
- FR2.2: Check that answer is the only public export and is a finite integer.

## Nonfunctional requirements

- NFR1: Pass the Bun build and tests, achieve at least 80% line coverage for src/value.ts, and pass fixed type checking.
- NFR2: Do not introduce application runtime dependencies or package.json. Create GitHub Actions CI at .github/workflows/ci.yml. Do not add a lint framework.

## Out of scope

New business features, databases, network APIs, cloud resources, deployment, performance measurement, and real-environment security testing are excluded. Do not invent undefined numerical targets beyond normal library verification. No publication destination or credentials are needed.
