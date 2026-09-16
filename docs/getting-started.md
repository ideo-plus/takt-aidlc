# Installation and project setup

## Install the plugin

Install the prebuilt plugin from the GitHub marketplace. You do not need to clone this repository, run `bun install`, or build it.

Claude Code:

```sh
claude plugin marketplace add https://github.com/ideo-plus/takt-aidlc.git
claude plugin install takt-aidlc@takt-aidlc
```

Codex:

```sh
codex plugin marketplace add https://github.com/ideo-plus/takt-aidlc.git
codex plugin add takt-aidlc@takt-aidlc
```

The CLIs fetch the Git repository themselves; Git and HTTPS access to GitHub are required. Start a new session after installation. For Codex, enable and trust hooks as described in the [host guide](codex-host.md#インストール). Then configure the target project below; installing the plugin alone does not enable delegation.

The remote source formats are documented in the [Claude Code marketplace guide](https://code.claude.com/docs/en/discover-plugins) and [OpenAI plugin guide](https://developers.openai.com/plugins/build/plugins).

## Supported environment

The integration currently targets macOS and Linux, AI-DLC 2.8.2, TAKT 0.65.0, Bun 1.3.13, and Node.js 22.22.0 or newer. Claude Code and Codex CLI support both delegation modes. TAKT workers can use Claude or Codex. Tested CLI versions are Claude Code 2.1.270 and Codex 0.154.0.

Install Bun, Node.js, and Git through your usual tool manager. Install TAKT and the CLI(s) used by your chosen host and worker:

```sh
npm install --global takt@0.65.0
# Install Claude Code if you use a Claude host or worker.
npm install --global @anthropic-ai/claude-code@2.1.270
# Install Codex if you use a Codex host or worker.
npm install --global @openai/codex@0.154.0
```

For AI-DLC, use the versioned [official release](https://github.com/awslabs/aidlc-workflows/releases/tag/v2.8.2). Its installer provides both the native executable and matching harness runtime:

```sh
curl --fail --location https://github.com/awslabs/aidlc-workflows/releases/download/v2.8.2/install.sh --output /tmp/install-aidlc-2.8.2.sh
sh /tmp/install-aidlc-2.8.2.sh --version 2.8.2
```

Check `aidlc --version` and `takt --version`. An already-installed newer AI-DLC release is not a compatible replacement for this prototype.

Authenticate the CLI(s) selected as host and worker. For Codex, run `codex login` and confirm with `codex login status`. Build and tests of this plugin are contributor tasks; see [development](contributing.md#開発).

## Configure an AI-DLC project

Choose the host independently of the TAKT worker. For Codex, follow the [Codex host guide](codex-host.md). The following setup uses Claude Code; both hosts share the CG configuration below.

Run the following in the target project before starting Inception:

```sh
aidlc config --harness claude --yes
```

AI-DLC's default Claude settings request Bedrock. If you use standard Claude authentication, remove `CLAUDE_CODE_USE_BEDROCK` and Bedrock-specific `ANTHROPIC_DEFAULT_*_MODEL` values from that project's `.claude/settings.json`. Keep AI-DLC's hooks. Do this before its source assessment; changing project settings later can invalidate that assessment.

After preparing the delegation configuration below, start a new Claude Code session:

```sh
claude
```

Run `/aidlc` normally. Use the usual questions and approval gates up to the selected delegation boundary. In CG mode, TAKT starts at CG entry; in Construction mode, it starts after final Inception approval.

## Choose the delegation scope

Use `delegationScope: "code-generation"` for CG only, or `delegationScope: "construction"` for the whole phase after Inception approval. Both hosts support both modes. See the [Construction guide](construction-phase.md) for phase and per-unit checks; the configuration below is for CG only.

## Download the TAKT bundle

Copy the installed plugin's entire `takt/` directory into the target project. This uses the exact installed version and needs neither a Git checkout nor a build.

Find the installation path with `claude plugin list --json` (`installPath` for `takt-aidlc@takt-aidlc`) or `codex plugin add takt-aidlc@takt-aidlc --json` (`installedPath`). The Codex command also ensures the plugin is installed. Then use that path:

```sh
mkdir -p aidlc/takt-handoff
cp -R /path/from-the-cli/takt aidlc/takt-handoff/
```

Alternatively, download the repository archive over HTTPS with an authenticated GitHub CLI (`gh auth login`). This also works while the repository is private; anonymous `curl` access does not. Your account must have repository access.

```sh
(
  set -e
  mkdir -p aidlc/takt-handoff
  takt_download_dir=$(mktemp -d)
  trap 'rm -rf "$takt_download_dir"' EXIT
  gh api repos/ideo-plus/takt-aidlc/tarball/main > "$takt_download_dir/source.tar.gz"
  takt_archive_root=$(tar -tzf "$takt_download_dir/source.tar.gz" | sed -n '1s@/.*@@p')
  tar -xzf "$takt_download_dir/source.tar.gz" --strip-components=1 -C aidlc/takt-handoff "$takt_archive_root/takt"
)
```

`delegationScope` is required; only `code-generation` and `construction` are supported.

Both methods create `aidlc/takt-handoff/takt/`. YAML files in `takt/workflows/` reference `../facets/`; copying a YAML file alone is insufficient. If the marketplace is pinned to a tag or commit, use the installed copy or replace `main` with the same ref in the API command.

The [TAKT directory guide](../takt/README.md) explains instructions, policies, personas, knowledge, and output contracts. Personas use the built-ins shipped with TAKT 0.65.0; local Markdown files contain the AI-DLC-specific instructions, policies, knowledge, and report formats. Prepare or customize these files before delegation; referenced Markdown files are frozen and checked alongside the YAML.

## Configure CG delegation before CG entry

Download the bundle above before entering CG.

Add trusted Bun scripts for your application's build, unit tests, and applicable sensors. These scripts run from frozen copies with the generated workspace as their working directory.

Create `aidlc/takt-handoff/config.json`. This is a template: replace `<intent-dir>`, list every required source/config file, and implement the named scripts for your application.

```json
{
  "enabled": true,
  "delegationScope": "code-generation",
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
  "workflow": "aidlc/takt-handoff/takt/workflows/aidlc-code-generation-stage.yaml",
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

Loading the plugin without an enabled CG config does not start delegation. The workflow requires the runner's context and quality gates and cannot be invoked standalone.

## Inspect a run

When the normal conductor's single `aidlc engine orchestrate next` or `continue` command returns a CG directive, the hook freezes inputs, parks AI-DLC, and starts TAKT. Do not append redirection, `echo`, or shell chaining. Recognized compound entry commands are rejected before execution.

The hook returns a run ID. Inspect it with:

```sh
cat aidlc/takt-handoff/cg-runs/<run-id>/status.json
```

Results are under `aidlc/takt-handoff/cg-runs/<run-id>/`. `status.json` records `parked`, `running`, `verified`, `blocked`, or `failed`. The generated code is in `attempts/1/work/`; CG artifacts are in its `cg/` directory, and validation records are in `attempts/1/control/`.

`verified` means this TAKT CG execution passed its checks. The original AI-DLC project stays parked at CG. Importing the result, completing native CG, and resuming downstream stages are not automated. Do not run the original CG concurrently. CG retry and automatic stale-lock recovery are not implemented.

## Updating and migrating

Claude Code:

```sh
claude plugin marketplace update takt-aidlc
claude plugin update takt-aidlc@takt-aidlc
```

Codex:

```sh
codex plugin marketplace upgrade takt-aidlc
codex plugin add takt-aidlc@takt-aidlc
```

Restart the host after updating. Prepare a matching `takt/` bundle, including facets, for new runs; do not change an active run's frozen inputs. The former repository-level `workflows/` directory has moved to `takt/workflows/`. When switching to these templates, update `workflow` and (for Construction) `constructionWorkflow` in the config.

For migration from the previous local development setup:

- Claude Code: stop launching with `--plugin-dir .../dist/claude` when using the installed plugin. Remove only old manually registered takt-aidlc hooks; keep AI-DLC's native hooks.
- Codex: run `codex plugin remove takt-aidlc@takt-aidlc-local` and `codex plugin marketplace remove takt-aidlc-local` before installing the remote marketplace. The old local marketplace and the new remote marketplace are separate sources; leaving both enabled duplicates hooks.

Local builds and live experiments are documented in [development](contributing.md).

## Limits and troubleshooting

See [CG behavior and limits](code-generation.md) and [verification results](../experiments/code-generation/RESULTS.md). The initial profile supports `test-after` only; it rejects other Testing Contracts before parking. Model limits, unresolved input conflicts, and failed checks are recorded as failures or `blocked`, never successful generation.

If a run stops progressing, inspect its status, TAKT logs, and quality-gate logs before recovery. Changing frozen files invalidates a run. Process isolation and source hashes are not an OS security boundary against arbitrary code running as the same user.
