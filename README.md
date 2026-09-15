# takt-aidlc

[日本語](README.ja.md) · [Setup](docs/getting-started.md) · [Delegation modes](docs/delegation-modes.md)

Delegate AI-DLC work to TAKT through a host plugin. The project supports **Claude Code and Codex hosts** with two delegation modes: **Code Generation (CG) only** and **the entire Construction phase**. AI-DLC is parked while TAKT works in a separate workspace; no AI-DLC core patch is required.

Experimental integration for **AI-DLC 2.8.2 / TAKT 0.65.0**. Host, delegation scope, and TAKT worker provider are separate choices. **See the implementation status and verification limits below.**

## Design and implementation status

| Choice | Option | Current status |
|---|---|---|
| AI-DLC host | Claude Code | Host plugin implemented; build output: `dist/claude/` |
| AI-DLC host | Codex | CG and Construction host integration implemented; plugin and local distribution manifest generated in `dist/codex/` |
| Delegation scope | CG stage only | Workflow, source injection, and build/test/sensor gates implemented |
| Delegation scope | Entire Construction phase | Dependency-ordered design, shared CG, full verification, and applicable CI stage implemented |
| TAKT worker | Claude / Codex | CG workers support both; Codex can use `gpt-5.6-luna` with reasoning effort `max` |

Both delegation modes run as HOTL, without interactive approval inside TAKT, and require successful build, tests, and applicable sensor checks. The Construction mode reuses the same CG implementation. See [delegation modes](docs/delegation-modes.md) and the [Codex host guide](docs/codex-host.md).

## Shared features

- Injects the actual CG stage definition, Intent, unit designs, conventions, agent knowledge, and sensor definitions into TAKT instructions.
- Runs CG as **HOTL (human-on-the-loop)**: automatic technical review and bounded corrections, with no approval prompts inside TAKT. Unresolved conflicts terminate as `blocked`.
- Requires successful build, tests, applicable sensor checks, and review of the same source before returning `verified`.
- Keeps the original project parked. Generated code and CG reports remain available for inspection in a separate workspace.

## Quickstart

Requirements: Bun **1.3.13**, Node.js **22.22.0+**, Git, `aidlc` **2.8.2**, `takt` **0.65.0**, and Codex CLI **0.154.0** on macOS or Linux. See [tool installation](docs/getting-started.md). Tests use mock responses and need no model credentials.

```sh
git clone https://github.com/ideo-plus/takt-aidlc.git
cd takt-aidlc
bun install --frozen-lockfile
bun run test
bun run build:plugin
```

Tests prepare the matching AI-DLC runtime under `.experiments/cache/`. Both host distributions are generated in `dist/claude/` and `dist/codex/`. Tests also install the Codex plugin using an isolated Codex configuration.

## Usage

### Claude Code host

Configure the target project's inputs, source files, build/test scripts, and sensors before the selected delegation boundary using the [setup guide](docs/getting-started.md). Start its normal AI-DLC session with:

```sh
claude --plugin-dir /absolute/path/to/takt-aidlc/dist/claude
```

Use `hostHarness: "claude"` for this host (the default when omitted). Loading the plugin alone does not enable delegation.

### Codex host

```sh
codex plugin marketplace add /absolute/path/to/takt-aidlc/dist/codex
codex plugin add takt-aidlc@takt-aidlc-local
```

Prepare the target project with `aidlc config --harness codex --yes` and set `hostHarness: "codex"` in the handoff config. Enable and trust its hooks, start a new Codex session, and use `$aidlc`. See the [Codex setup guide](docs/codex-host.md).

`provider` selects the TAKT worker independently of either host.

### Choose the delegation scope

- `delegationScope: "code-generation"`: complete the required designs in AI-DLC and delegate at CG entry.
- `delegationScope: "construction"`: delegate after final Inception approval and run design through phase-wide verification.

Construction mode requires the stage workflow, per-unit checks, and full-project checks. Follow the [Construction setup guide](docs/construction-phase.md).

### Try a Codex worker

Run a separate, synthetic CG experiment with Codex CLI, without a running Claude host:

```sh
bun run experiment:cg -- --live --provider codex --model gpt-5.6-luna --reasoning-effort max
```

This requires an authenticated Codex CLI. For deterministic build and type-check correction tests, use `bun run experiment:cg -- --build-failure --sensor-failure`.

## Scope and evidence

The implemented CG profile supports `test-after`, one active unit/workspace, and one AI-DLC audit shard. Human plan approval is replaced by automatic technical review. Native lifecycle completion and audit receipts are not reproduced. **`verified` does not mark native AI-DLC CG complete or import code into the original project.**

See [CG verification results](experiments/code-generation/RESULTS.md) for mock and live evidence. Earlier [Inception handoff](experiments/native-session/STATUS.md) and [full Construction](experiments/construction/RESULTS.md) experiments are separate results. They are separate from verification of the new Construction mode.

The [live Codex host test](experiments/codex-host/RESULTS.md) passed with a Luna Max host, native AI-DLC hooks, and a TAKT mock worker, including build and tests. This is separate from completing all CG steps with a live model worker.

[Construction verification](experiments/construction-phase/RESULTS.md) uses synthetic inputs and mock workers to cover multiple units, design revisions, CG corrections, full verification, and CI generation. A complete live-model run remains unverified.

## Documentation

- [Construction setup and behavior](docs/construction-phase.md)
- [CG-only and Construction delegation modes](docs/delegation-modes.md)
- [Codex host setup, behavior, and validation](docs/codex-host.md)
- [Installation and configuration](docs/getting-started.md)
- [CG behavior, sensors, and limits](docs/code-generation.md)
- [Claude Code host plugin](docs/claude-plugin.md)

## Getting help

Use the support links and reporting checklist in [Help and development](docs/contributing.md).

## Contributing

Run `bun run typecheck`, `bun run test`, and `bun run build:plugin`. CI validates the plugin on Ubuntu without model credentials. Maintainers and contribution guidance are in [Help and development](docs/contributing.md).

## License

A license has not been selected. No license grant is implied.
