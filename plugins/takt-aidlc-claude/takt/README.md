# TAKT workflows and facets

[日本語](README.ja.md)

This directory contains definitions for delegating AI-DLC work to TAKT. Workflow control and prompt components are separated by responsibility, following [TAKT's builtins](https://github.com/nrslib/takt/tree/main/builtins).

```text
takt/
├── workflows/
│   ├── aidlc-code-generation-stage.yaml   CG only; also reused by Construction
│   └── aidlc-construction-phase.yaml      Construction creation and review
└── facets/
    ├── instructions/       Step-specific procedures
    ├── policies/           HOTL, scope, and quality rules
    ├── personas/           Rationale for selecting built-in personas
    ├── knowledge/          Input, artifact, and verification concepts
    └── output-contracts/   Report formats and required fields
```

## YAML and Markdown responsibilities

YAML defines steps, transitions, permissions, quality gates, and facet references. Markdown holds instructions and report formats. Roles use TAKT's built-in personas; shared rules and knowledge are reused across steps.

Local files are declared under `policies`, `knowledge`, `instructions`, and `report_formats`, then referenced by alias. Personas are named directly: `planner`, `coder`, `architecture-reviewer`, `coding-reviewer`, `supervisor`, and `exec-assistant`. See the [selection rationale and upstream sources](facets/personas/README.md). Files referenced by `report_formats` live under `facets/output-contracts/`.

Distribution YAML lives in `takt/workflows/` and references `../facets/`. Before execution, the runner copies YAML and local facets into a private control area and rewrites relative references. TAKT resolves built-ins. The original directory layout is preserved.

Every Markdown file has English (`.md`) and Japanese (`.ja.md`) versions. Shipped workflows and runtime policy imports select Japanese variants to preserve the tested execution language. English variants document the same contracts.

## Reusing built-in facets

Reference TAKT 0.65.0 definitions by name without copying them.

| Kind | Built-ins | Use |
|---|---|---|
| instruction | `supervise` | Final Intent/acceptance validation and resolution of earlier findings |
| instruction | `coding-review` | Review code differences, contracts, and actual paths |
| instruction | `architecture-review` | Review plan, design, and Construction artifact structure |
| policy | `evidence-based-judgment` | Separate requirements, facts, proposals, and unverified matters |
| policy | `review`, `contract-change` | Code-review findings, stable IDs, and contract-change decisions |
| knowledge | `architecture`, `unit-testing` | Design and unit-testing reference knowledge |

Compose native instructions with AI-DLC-specific checks and JSON output contracts. Local filenames and YAML aliases use `code-generation-*`, `construction-*`, or shared `aidlc-*` prefixes.

General review and machine validation have separate responsibilities. An approved review cannot produce success when required builds, tests, or sensors fail. Built-in APPROVE/REJECT maps to approved/changes_requested in this integration's JSON; contradictions requiring human judgment produce blocked.

Sources: [built-in facets](https://github.com/nrslib/takt/tree/v0.65.0/builtins/ja/facets), [shared review policy](https://github.com/nrslib/takt/blob/v0.65.0/builtins/ja/facets/partials/policies/review-common.md). TAKT expands includes in built-ins. Local facets are self-contained files whose dependencies can be frozen.

## Placement of supervise

CG uses `code-review → supervise → finish`; rejection follows `fix → code-review → supervise`.
Construction runs supervision across all units after individual artifacts and reviews are complete. The runner uses the draft/review portion for individual stages and the supervise portion for the phase-final invocation.
A Construction rejection reruns owning-unit CG, Build and Test, applicable CI, and supervise once. External judgment produces blocked; failure to converge produces failed.

The supervisor judges requirements from code without reviewing build/test logs. Machine gates remain independently required. Approval is bound to source and report hashes and cannot be reused for changed code.

## Relationship to native AI-DLC sources

Local knowledge explains the integration; it does not replace native stage definitions, Intent, or unit designs. The runtime still freezes and injects original AI-DLC sources and the Testing Contract into the assigned steps.

HOTL adaptations live in `policies/code-generation-hotl.ja.md` and `policies/construction-hotl.ja.md`. The CLI embeds those same files and places them around original sources so native human-approval and state-update procedures are not executed accidentally.

## Project placement

Copy the complete `takt/`, including `facets/`, to `aidlc/takt-handoff/takt/` in the target project. Follow the [setup guide](https://github.com/ideo-plus/takt-aidlc/blob/main/docs/getting-started.md#download-the-takt-bundle). Copying YAML alone leaves missing references and stops delegation checks.

The runner records declared Markdown in the input inventory and hashes, copies facets from frozen inputs when relocating YAML, and checks their hashes after execution. Put custom file references in top-level YAML declarations. Expand local Markdown include/extends directives into self-contained files.

## Editing and verification

Edit this source directory, not distribution copies.

```sh
bun run check:takt
bun run test
bun run build:marketplace
bun run check:marketplace
```

`check:takt` resolves local dependencies and validates the original YAML with TAKT 0.65.0's `workflow doctor`. It calls no models and does not change user TAKT settings. Built-in personas avoid the need to relocate definitions just to satisfy persona path restrictions.

Tests cover facet resolution, relocated loading, input-change detection, and both delegation modes.
