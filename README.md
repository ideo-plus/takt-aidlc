# takt-aidlc

[日本語](README.ja.md) · [Setup](docs/getting-started.md) · [Construction workflow](docs/construction-workflow.md)

Hand off approved AI-DLC Inception work to TAKT, without patching AI-DLC. A Claude Code plugin parks the original workflow, starts TAKT in a separate workspace, and verifies the result against frozen inputs.

This is an experimental integration for AI-DLC **2.8.2** and TAKT **0.65.0**.

## Highlights

- The normal Inception questions and approval gates stay in AI-DLC.
- The final approval triggers the handoff; no separate terminal command is needed afterward.
- The Construction workflow includes detailed design, design review, implementation, tests, code review, and bounded correction loops.
- Tests run through a fixed verification script. Source hashes prevent stale review results from being accepted.
- New requirements or unresolved decisions produce `needs_input`; the integration does not invent human approval.
- Original code and AI-DLC records stay separate. There is no automatic merge or deployment.

## Quickstart

Requirements: **Bun 1.3.13**, **Node.js 22.22.0+**, Git, `aidlc` **2.8.2**, and `takt` **0.65.0**, on macOS or Linux. See [tool installation](docs/getting-started.md). These tests use the mock provider and need no model credentials.

```sh
git clone https://github.com/ideo-plus/takt-aidlc.git
cd takt-aidlc
bun install --frozen-lockfile
bun run test
bun run build:plugin
```

The test command prepares the matching AI-DLC runtime under `.experiments/cache/`. The plugin is built into `dist/claude/` and can be copied to another location.

## Usage

Configure the target project's handoff inputs **before** approving Delivery Planning, then start Claude Code from that project:

```sh
claude --plugin-dir /absolute/path/to/takt-aidlc/dist/claude
```

Loading the plugin alone does not enable execution. The project must have `aidlc/takt-handoff/config.json` with `enabled: true`, input paths, a workflow, and a verification script. Follow the [setup guide](docs/getting-started.md).

Set `construction: true` to use the bundled six-step Construction workflow. Set `disableBedrock: true` when the TAKT child should use normal Claude authentication instead of inherited Bedrock settings.

To exercise the correction paths locally without calling a model:

```sh
bun run experiment:construction -- --repairs
```

## Validation and scope

The native final-approval-to-handoff path has completed without manual recovery. The expanded workflow has also completed with a live Claude provider: three application tests passed with 100% line coverage. Deterministic tests cover design revisions, failed tests, code fixes, unresolved questions, and execution limits. [Recorded experiments](experiments/native-session/STATUS.md) distinguish successful runs from earlier failures and recovery attempts.

The workflow uses one workspace and processes units serially. It does not recreate every AI-DLC Construction gate, manage parallel unit workspaces, or resume AI-DLC Operation. The current evidence comes from a small constant-change application; it does not establish a general improvement in code quality.

## Documentation

- [Installation and project setup](docs/getting-started.md)
- [Claude Code plugin](docs/claude-plugin.md) — Japanese
- [Construction workflow and result states](docs/construction-workflow.md) — Japanese
- [Handoff configuration and limitations](docs/handoff-poc.md) — Japanese
- [Integration design](docs/automatic-handoff.md) — Japanese
- [Expanded workflow experiment](experiments/construction/RESULTS.md) — Japanese

## Getting help and contributing

See [support and contribution notes](docs/contributing.md). Run `bun run typecheck` and `bun run test` before submitting changes. CI runs these checks and builds the plugin without model credentials. Live-model experiments are separate, opt-in commands.

## License

No project license has been specified yet.
