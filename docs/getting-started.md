# Installation and project setup

## Supported environment

The integration currently targets macOS and Linux, AI-DLC 2.8.2, TAKT 0.65.0, Bun 1.3.13, and Node.js 22.22.0 or newer. Claude Code and Codex CLI are supported CG host environments. TAKT workers can use Claude or Codex. Tested CLI versions are Claude Code 2.1.270 and Codex 0.154.0.

Install Bun, Node.js, and Git through your usual tool manager. Install the pinned TAKT and Claude Code CLIs:

```sh
npm install --global takt@0.65.0 @anthropic-ai/claude-code@2.1.270 @openai/codex@0.154.0
```

For AI-DLC, use the versioned [official release](https://github.com/awslabs/aidlc-workflows/releases/tag/v2.8.2). Its installer provides both the native executable and matching harness runtime:

```sh
curl --fail --location https://github.com/awslabs/aidlc-workflows/releases/download/v2.8.2/install.sh --output /tmp/install-aidlc-2.8.2.sh
sh /tmp/install-aidlc-2.8.2.sh --version 2.8.2
```

Check `aidlc --version` and `takt --version`. An already-installed newer AI-DLC release is not a compatible replacement for this prototype.

## Build and test

From this repository:

```sh
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run build:plugin
claude plugin validate dist/claude
```

Tests prepare a runtime cache with the native `aidlc config` command, then run TAKT with deterministic mock responses. They do not need model credentials. Live experiments require authentication for the selected provider and are explicitly selected with `--live`. For Codex, install `@openai/codex@0.154.0` and run `codex login`; confirm with `codex login status`.

## Configure an AI-DLC project

Choose the host independently of the TAKT worker. For Codex, follow the [Codex host guide](codex-host.md). The following setup uses Claude Code; both hosts share the CG configuration below.

Run the following in the target project before starting Inception:

```sh
aidlc config --harness claude --yes
```

AI-DLC's default Claude settings request Bedrock. If you use standard Claude authentication, remove `CLAUDE_CODE_USE_BEDROCK` and Bedrock-specific `ANTHROPIC_DEFAULT_*_MODEL` values from that project's `.claude/settings.json`. Keep AI-DLC's hooks. Do this before its source assessment; changing project settings later can invalidate that assessment.

Start Claude Code with the built plugin:

```sh
claude --plugin-dir /absolute/path/to/takt-aidlc/dist/claude
```

Run `/aidlc` normally. Use the usual questions and approval gates through Inception and the required Construction design stages. TAKT starts only at CG entry.

## Configure CG delegation before CG entry

Create `aidlc/takt-handoff/` in the target project and copy `dist/claude/workflows/aidlc-code-generation.yaml` to `aidlc/takt-handoff/workflow.yaml`. Add trusted Bun scripts for your application's build, unit tests, and applicable sensors. These scripts run from frozen copies with the generated workspace as their working directory.

Create `aidlc/takt-handoff/config.json`. This is a template: replace `<intent-dir>`, list every required source/config file, and implement the named scripts for your application.

```json
{
  "enabled": true,
  "handoffStage": "code-generation",
  "hostHarness": "claude",
  "provider": "codex",
  "model": "gpt-5.6-luna",
  "codexReasoningEffort": "max",
  "artifacts": [
    "aidlc/spaces/default/intents/<intent-dir>/inception/requirements-analysis/requirements.md",
    "aidlc/spaces/default/intents/<intent-dir>/inception/practices-discovery/team-practices.md",
    "aidlc/spaces/default/intents/<intent-dir>/inception/units-generation/unit-of-work.md",
    "aidlc/spaces/default/intents/<intent-dir>/inception/units-generation/unit-of-work-dependency.md",
    "aidlc/spaces/default/intents/<intent-dir>/inception/delivery-planning/bolt-plan.md"
  ],
  "sources": ["src/value.ts"],
  "workflow": "aidlc/takt-handoff/workflow.yaml",
  "buildScript": "aidlc/takt-handoff/build.ts",
  "verifyScript": "aidlc/takt-handoff/test.ts",
  "sensorScripts": {
    "type-check": "aidlc/takt-handoff/typecheck.ts",
    "linter": "aidlc/takt-handoff/lint.ts"
  },
  "disableBedrock": true,
  "timeoutMs": 1800000
}
```

The integration adds the current Intent, unit designs, native CG definition, knowledge, sensors, memory, and templates to these explicit artifacts. Source paths are individual regular files, not globs. Include package manifests, lockfiles, and required configuration for real applications; dependency installation is your build script's responsibility.

Build and test scripts must exit nonzero on failure. Enforce the agreed coverage target in the test script. Sensor scripts must print one JSON object with `pass: true` on success and exit zero; a JSON `pass: false` fails even with exit zero. Each script has a 60-second limit. Build outputs should go under `cg/`; do not generate unplanned application files.

If a sensor does not apply, omit its script and explicitly provide a reason with a source from the fixed inputs:

```json
{
  "sensorExceptions": {
    "linter": {
      "reason": "The agreed project practices exclude adding a lint tool for this experiment.",
      "source": "aidlc/spaces/default/intents/<intent-dir>/inception/practices-discovery/team-practices.md"
    }
  }
}
```

To use Claude workers, set `provider` to `claude` and remove `codexReasoningEffort`. Set `model` to an available Claude model or omit it. `disableBedrock: true` removes inherited Bedrock flags/model overrides only in the child process; it does not reconfigure the host's authentication.

Loading the plugin without an enabled CG config does not start delegation. The workflow requires the runner's context and quality gates and cannot be invoked standalone. The legacy `construction: true` config is not the current CG mode.

## Inspect a run

When the normal conductor's single `aidlc engine orchestrate next` or `continue` command returns a CG directive, the hook freezes inputs, parks AI-DLC, and starts TAKT. Do not append redirection, `echo`, or shell chaining. Recognized compound entry commands are rejected before execution.

The hook returns a run ID. Inspect it with:

```sh
bun /absolute/path/to/takt-aidlc/dist/claude/scripts/handoff.js cg-status /absolute/path/to/target-project <run-id>
```

Results are under `aidlc/takt-handoff/cg-runs/<run-id>/`. `status.json` records `parked`, `running`, `verified`, `blocked`, or `failed`. The generated code is in `attempts/1/work/`; CG artifacts are in its `cg/` directory, and validation records are in `attempts/1/control/`.

`verified` means this TAKT CG execution passed its checks. The original AI-DLC project stays parked at CG. Importing the result, completing native CG, and resuming downstream stages are not automated. Do not run the original CG concurrently. CG retry and automatic stale-lock recovery are not implemented.

## Try Codex independently of the Claude host

From this repository, use the coherent synthetic five-test fixture:

```sh
bun run experiment:cg -- --live --provider codex --model gpt-5.6-luna --reasoning-effort max
```

This calls a real TAKT workflow and real build, tests, and type checks, but starts from a synthetic CG entry and synthetic Intent/design inputs. It does not require the Claude host to be running and does not demonstrate a native AI-DLC session end to end. The default live provider without `--provider codex` is Claude.

For a model-free correction experiment:

```sh
bun run experiment:cg -- --build-failure --sensor-failure
```

## Limits and troubleshooting

See [CG behavior and limits](code-generation.md) and [verification results](../experiments/code-generation/RESULTS.md). The initial profile supports `test-after` only; it rejects other Testing Contracts before parking. Model limits, unresolved input conflicts, and failed checks are recorded as failures or `blocked`, never successful generation.

If a run stops progressing, inspect its status, TAKT logs, and quality-gate logs before recovery. Changing frozen files invalidates a run. Process isolation and source hashes are not an OS security boundary against arbitrary code running as the same user.
