# Development practices: synthetic input

## Implementation and verification

Preserve export const and semicolons. Under test-after, change the value, write five tests, then run the fixed Bun build, single-unit tests, and TypeScript checks. Preserve value 42, the public API, and the 80% minimum line coverage.

Use Bun 1.3.13 and TypeScript 6.0.3. Do not add application package.json, external runtime dependencies, or a lint framework. Type checking uses fixed integration tooling.

## Design documents

This trial documents functional, nonfunctional, and infrastructure applicability for one constant module across four design stages. Do not invent unnecessary databases, APIs, or cloud resources; record why they do not apply. The trial plan explicitly selects the stages for execution.

Use prose, tables, JSON, or YAML for design examples. Generate TypeScript/JavaScript implementation snippets during CG. Design snippet type checks therefore have no applicable target, while type checking of the generated application and tests remains required.

## CI

On GitHub Actions push and pull_request events, check out the repository, set up Bun 1.3.13, build the app, run five unit tests and coverage checks, and type-check source. Do not automatically merge into main or deploy.

Use actions/checkout@11d5960a326750d5838078e36cf38b85af677262 and oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6. CI may temporarily fetch typescript@6.0.3 to check src/value.ts. The fixed local checker also checks test files. Do not embed local experiment directories or absolute paths in CI.
