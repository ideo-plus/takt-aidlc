# Persona selection

[日本語](../../../ja/facets/personas/README.md)

Workflows name personas shipped with TAKT 0.65.0 directly in `persona`. No custom persona is defined here. This directory records selection rationale without duplicating upstream definitions.

| Responsibility | Built-in persona | Reason |
|---|---|---|
| CG planning / Construction artifact creation | `planner` | Analyzes requirements and plans design/implementation without implementing code |
| Implementation / corrections | `coder` | Implements agreed designs, writes tests, and addresses findings |
| Plan, design, and Construction stage review | `architecture-reviewer` | Checks structure, design, and specification alignment without editing code |
| Code review | `coding-reviewer` | Identifies bugs, regressions, and missing tests using code differences and evidence |
| Final requirement validation | `supervisor` | Independently compares current code with original requirements, acceptance conditions, and earlier findings |
| Completion report | `exec-assistant` | Provides a general reporting role with exact checks and format supplied by instructions |

`supervisor` is used in supervise steps. It judges requirement fulfillment and finding resolution, not machine-gate execution status/results/logs. `exec-assistant` summarizes those logs in the completion report.
AI-DLC-specific restrictions, HOTL adaptations, scope, quality criteria, and formats are specified in policies, instructions, and output contracts.

## Resolution and verification

TAKT resolves names through project, global, then built-in facets. Delegation runs with a private TAKT configuration and a new workspace.
Tests run `workflow inspect` on original YAML and relocated execution copies and require every step's persona to resolve as `source: builtin` under native `builtins/en/facets/personas/`.
Built-ins are dependencies of TAKT, not local input Markdown snapshots. The supported version is pinned to 0.65.0.

## Upstream sources inspected

- [Built-in personas at v0.65.0](https://github.com/nrslib/takt/tree/v0.65.0/builtins/en/facets/personas)
- [Persona/facet loader](https://github.com/nrslib/takt/blob/v0.65.0/src/infra/config/loaders/resource-resolver.ts)
- [Resolution order](https://github.com/nrslib/takt/blob/v0.65.0/src/infra/config/loaders/workflowPackageScope.ts)

The main-branch catalog was also checked; behavior was validated against the definitions shipped with the supported 0.65.0 installation.
