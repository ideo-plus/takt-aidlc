# Claude Code host plugin

[日本語](claude-plugin.ja.md)

## Installation and startup

```sh
claude plugin marketplace add https://github.com/ideo-plus/takt-aidlc.git
claude plugin install takt-aidlc@takt-aidlc
```

The CLI downloads a prebuilt plugin. No manual clone or build is required. Complete the [project setup](getting-started.md), start a new `claude` session in that project, and run `/aidlc`. Normal use does not require `--plugin-dir`.

The distribution includes hooks, `scripts/handoff.js`, quality gates, TAKT workflows, and the MIT license. See [development](contributing.md) for loading local builds.

## Hook responsibilities

| Hook | Behavior in CG mode |
|---|---|
| SessionStart | Explains CG delegation and tells the host to end its turn after handoff |
| PreToolUse | Rejects recognized `next` / `continue` commands with shell chaining before execution |
| PostToolUse | Verifies the CG directive, current state, and start record; freezes inputs, parks AI-DLC, and starts TAKT |

Enable delegation with `enabled: true` in `aidlc/takt-handoff/config.json`, and choose `delegationScope: "code-generation"` or `"construction"`. CG mode starts at CG entry; Construction mode starts after final Inception approval. Repeated events for the same boundary do not create another TAKT run.

See [setup](getting-started.md), [CG behavior](code-generation-stage.md), and [Construction behavior](construction-phase.md). Select the TAKT worker provider independently as Claude or Codex. To run AI-DLC itself on Codex, use the [Codex host plugin](codex-host.md).

## Inspecting a run

```sh
cat aidlc/takt-handoff/code-generation-stage-runs/<run-id>/status.json
```

CG retry through the CLI is not implemented. Setting `enabled: false` prevents new handoffs but does not stop an active worker.

For standard Claude authentication, follow the Bedrock adjustments in [setup](getting-started.md). `disableBedrock: true` affects TAKT child processes.

## Verification

Automated tests start a mock CG run through hooks in a relocated distribution, reject unrelated stages, and check duplicate events. See the [CG verification record](../experiments/code-generation/RESULTS.md) for live-model evidence.
