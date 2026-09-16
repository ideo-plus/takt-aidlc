# takt-aidlc

[日本語](README.ja.md) · [Setup guide](docs/getting-started.md) · [Delegation modes](docs/delegation-modes.md)

Run AI-DLC's **Code Generation (CG) stage or entire Construction phase with TAKT**. Use Claude Code or Codex as the AI-DLC host. TAKT reads the native stage definitions, Intent, designs, and sensors, then implements and reviews the code with build and test gates.

Experimental integration for **AI-DLC 2.8.2 / TAKT 0.65.0**. AI-DLC is parked while TAKT works in a separate workspace; no core patch is required. Full Construction completion with a live model remains unverified.

## Install

**No manual clone, dependency install, or build of this repository is needed.** Both marketplaces include prebuilt plugins. The CLI downloads the repository for you over HTTPS.

Runtime requirements: macOS or Linux, Git, Bun **1.3.13**, Node.js **22.22.0+**, `aidlc` **2.8.2**, `takt` **0.65.0**, and the CLI for your chosen host and worker. Tested host versions: Claude Code **2.1.270** / Codex **0.154.0**. See [tool installation](docs/getting-started.md#supported-environment).

### Claude Code

```sh
claude plugin marketplace add https://github.com/ideo-plus/takt-aidlc.git
claude plugin install takt-aidlc@takt-aidlc
```

### Codex

```sh
codex plugin marketplace add https://github.com/ideo-plus/takt-aidlc.git
codex plugin add takt-aidlc@takt-aidlc
```

Start a new host session after installation. For Codex, [enable and trust hooks](docs/codex-host.md#インストール) before use. If you previously used the development plugin, [remove the duplicate registration](docs/getting-started.md#updating-and-migrating) first.

## Use in your project

1. In your target project, run `aidlc config --harness claude --yes` or `aidlc config --harness codex --yes`.
2. Follow the [setup guide](docs/getting-started.md#configure-an-ai-dlc-project) to configure inputs, source files, build/test scripts, and sensors in `aidlc/takt-handoff/config.json`. Select the matching `hostHarness` and a delegation scope below. The guide downloads the `takt/` bundle, including all facets, over HTTPS; no checkout is needed.
3. Start `claude` and use `/aidlc`, or start `codex` and use `$aidlc`. Complete the usual AI-DLC questions and approvals up to the selected boundary. TAKT starts automatically there.

| Delegation scope | When TAKT starts | Setup |
|---|---|---|
| `code-generation` | At CG entry, after the required designs | [CG setup](docs/getting-started.md#configure-cg-delegation-before-cg-entry) |
| `construction` | After final Inception approval; runs design through full verification | [Construction setup](docs/construction-phase.md#設定) |

**Installation alone does not enable delegation.** Configure the project before the selected boundary. `hostHarness` selects the AI-DLC host; `provider` independently selects the TAKT worker (Claude or Codex).

Both modes use HOTL (human-on-the-loop): automated technical reviews and bounded corrections, without interactive approvals inside TAKT. Build, tests, and applicable sensors must pass before a run becomes `verified`; unresolved input conflicts become `blocked`.

Inspect `aidlc/takt-handoff/cg-runs/<run-id>/status.json` or `phase-runs/<run-id>/status.json`. The original project remains parked. **Generated code is not automatically merged, and native AI-DLC completion/resumption is not automated.**

## Compatibility and verification

The current profile supports `test-after` and a single AI-DLC audit shard. Construction processes units in dependency order and reuses the CG workflow and quality gates.

- [CG verification](experiments/code-generation/RESULTS.md): mock and live evidence.
- [Codex host verification](experiments/codex-host/RESULTS.md): a live host and native hooks delegated to a mock worker.
- [Construction verification](experiments/construction-phase/RESULTS.md): mock coverage for multiple units, revisions, build/test corrections, and CI generation.
- [Luna Max live trial](experiments/construction-phase/LIVE-2026-09-16.md): completed two design stages within one hour; did not reach CG. Full live completion remains unverified.

## Documentation and help

- [Installation, configuration, updates, and troubleshooting](docs/getting-started.md)
- [CG-only / Construction delegation modes](docs/delegation-modes.md)
- [Claude Code host](docs/claude-plugin.md) · [Codex host](docs/codex-host.md)
- [TAKT workflows and facets](takt/README.md)
- [CG behavior and sensors](docs/code-generation.md) · [Construction behavior](docs/construction-phase.md)
- [Support and maintainers](docs/contributing.md#問い合わせ)

## Development

To change the plugin or reproduce experiments, see [development and distribution](docs/contributing.md). That guide covers cloning, building, testing, and refreshing the prebuilt marketplace bundles.

## License

Licensed under the [MIT License](LICENSE).
