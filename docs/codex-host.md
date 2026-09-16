# Delegate AI-DLC work from a Codex host

[日本語](codex-host.ja.md)

## Supported scope

The host integration supports CG-only and full Construction delegation with Codex CLI 0.154.0, AI-DLC 2.8.2, and TAKT 0.65.0. AI-DLC runs on Codex and is parked at the chosen boundary. TAKT proceeds without interactive approval, with the same build, test, and sensor requirements as the Claude Code host.

Host and worker are separate choices: `hostHarness: "codex"` selects the AI-DLC host, while `provider: "codex"` selects the TAKT worker. See the [Construction guide](construction-phase.md) for full-phase configuration. The following example uses CG-only delegation.

## Installation

Download the prebuilt plugin over HTTPS. A manual clone or build is not required.

```sh
codex plugin marketplace add https://github.com/ideo-plus/takt-aidlc.git
codex plugin add takt-aidlc@takt-aidlc
```

Enable `hooks = true` under `[features]` in the user `config.toml`. Add it to the existing table if one is already present. Start a new Codex session after installation, review the AI-DLC and plugin hooks, and trust them. Installation alone does not activate untrusted hooks. See the [Codex hook documentation](https://learn.chatgpt.com/docs/hooks).

## AI-DLC project setup

Set up the Codex runtime in the target Git repository before starting the workflow:

```sh
aidlc config --harness codex --yes
```

AI-DLC places stage definitions, agent Markdown/TOML, knowledge, sensors, and tools under `.codex/`. Its skill is installed under `.agents/skills/aidlc/`.

AI-DLC's distributed settings default to Bedrock. For standard OpenAI authentication, inspect the project's `.codex/config.toml` and relevant agent settings, select the matching host provider, and authenticate with `codex login`. The handoff setting `disableBedrock` affects child processes; it does not change host authentication.

Follow the [shared CG setup](getting-started.md#configure-cg-delegation-before-cg-entry) to create `aidlc/takt-handoff/config.json`. Add the host setting below along with the required inputs, sources, and verification scripts:

```json
{
  "enabled": true,
  "delegationScope": "code-generation",
  "hostHarness": "codex",
  "provider": "codex",
  "model": "gpt-5.6-luna",
  "codexReasoningEffort": "max"
}
```

Omitting `hostHarness` selects `claude`. The integration does not infer the host from the worker provider. A plugin whose host differs from the configuration does not start delegation.

Run `codex` in the project and use `$aidlc`. AI-DLC handles the required designs and approvals before CG.

## Hooks and tool output

- SessionStart announces the CG delegation policy.
- PreToolUse normalizes AI-DLC's session-binding prefix and inspects the remaining `next` / `continue` command. Arbitrary shell chaining is rejected.
- PostToolUse verifies the native CG response, current state, and start record before freezing inputs. It parks AI-DLC through the official CLI, starts TAKT, and replaces the original CG directive with a handoff notice.
- Codex CLI 0.154.0 returns Bash output as a string that may include stderr. The adapter strips only known `aidlc-orchestrate:` diagnostic lines and requires one unambiguous JSON response. Unknown mixed output or multiple JSON responses are rejected.
- Metadata that indicates failure, interruption, or an unfinished command prevents delegation. A raw string has no exit code, so command recognition and native state/audit checks are also required.

`continue: false` replaces the tool result but does not guarantee the end of a Codex turn. The integration combines a handoff notice with parked state. In the live host trial, the turn ended after the notice and the host did not duplicate implementation.

## Inspecting a run

```sh
cat aidlc/takt-handoff/code-generation-stage-runs/<run-id>/status.json
```

Results are stored under `aidlc/takt-handoff/code-generation-stage-runs/<run-id>/`. `verified` means TAKT completed CG validation. Importing code, completing native CG, and resuming later stages are not automated.

## Verification

The [live host record](../experiments/codex-host/RESULTS.md) uses a synthetic Intent, a real Codex host, native AI-DLC hooks, and a mock TAKT worker. It does not demonstrate a complete live-model CG execution.

To reproduce it in an authenticated environment, run this from the repository:

```sh
bun run experiment:codex-host
```

The script creates an isolated project and Codex configuration. It references the existing authentication file and bypasses hook trust confirmation only for that test invocation, using the hooks already inspected for this experiment. Normal use follows the trust procedure above. Existing user projects and global configuration are not modified.
