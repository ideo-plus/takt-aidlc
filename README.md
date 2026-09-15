# takt-aidlc

[日本語](README.ja.md) · [Setup](docs/getting-started.md) · [CG workflow](docs/code-generation.md)

Delegate AI-DLC's **Code Generation (CG) stage** to TAKT. A Claude Code host plugin captures the CG entry, parks AI-DLC, and runs planning, review, implementation, and verification in a separate workspace. No AI-DLC core patch is required.

Experimental integration for **AI-DLC 2.8.2 / TAKT 0.65.0**. TAKT workers can use Claude or Codex, including **Luna Max**.

## Highlights

- Injects the actual CG stage definition, Intent, unit designs, conventions, agent knowledge, and sensor definitions into TAKT instructions.
- Runs CG as **HOTL (human-on-the-loop)**: automatic technical review and bounded corrections, with no approval prompts inside TAKT. Unresolved conflicts terminate as `blocked`.
- Requires successful build, tests, applicable sensor checks, and review of the same source before returning `verified`.
- Keeps the original project parked. Generated code and CG reports remain available for inspection in a separate workspace.

## Quickstart

Requirements: Bun **1.3.13**, Node.js **22.22.0+**, Git, `aidlc` **2.8.2**, and `takt` **0.65.0** on macOS or Linux. See [tool installation](docs/getting-started.md). Tests use mock responses and need no model credentials.

```sh
git clone https://github.com/ideo-plus/takt-aidlc.git
cd takt-aidlc
bun install --frozen-lockfile
bun run test
bun run build:plugin
```

Tests prepare the matching AI-DLC runtime under `.experiments/cache/`. The portable Claude Code plugin is built into `dist/claude/`.

## Usage

Configure the target project's inputs, source files, build/test scripts, and sensors before CG entry using the [setup guide](docs/getting-started.md). Start its normal AI-DLC session with:

```sh
claude --plugin-dir /absolute/path/to/takt-aidlc/dist/claude
```

The host stays Claude Code; `provider: "codex"` selects Codex for TAKT workers. Loading the plugin alone does not enable delegation.

Run a separate, synthetic CG experiment with Codex CLI:

```sh
bun run experiment:cg -- --live --provider codex --model gpt-5.6-luna --reasoning-effort max
```

This requires an authenticated Codex CLI. For deterministic build and type-check correction tests, use `bun run experiment:cg -- --build-failure --sensor-failure`.

## Scope and evidence

Current support is CG only, `test-after`, one active unit/workspace, and one AI-DLC audit shard. Human plan approval is replaced by automatic technical review. Native lifecycle completion and audit receipts are not reproduced. **`verified` does not mark native AI-DLC CG complete or import code into the original project.**

See [CG verification results](experiments/code-generation/RESULTS.md) for mock and live evidence. Earlier [Inception handoff](experiments/native-session/STATUS.md) and [full Construction](experiments/construction/RESULTS.md) experiments are historical, separate results.

## Documentation

- [Installation and configuration](docs/getting-started.md)
- [CG behavior, sensors, and limits](docs/code-generation.md)
- [Claude Code host plugin](docs/claude-plugin.md)

## Getting help

Use the support links and reporting checklist in [Help and development](docs/contributing.md).

## Contributing

Run `bun run typecheck`, `bun run test`, and `bun run build:plugin`. CI validates the plugin on Ubuntu without model credentials. Maintainers and contribution guidance are in [Help and development](docs/contributing.md).

## License

A license has not been selected. No license grant is implied.
