# Support and development

[日本語](contributing.ja.md)

## Support

Report bugs and feature requests through [GitHub Issues](https://github.com/ideo-plus/takt-aidlc/issues). Include the AI-DLC, TAKT, and Bun versions; the stage being executed; and the expected and actual behavior. Do not include credentials or secrets in logs.

The repository is maintained by `ideo-plus`. Maintainers with repository access review contributions.

## Development

Install the [required tools](getting-started.md), then run:

```sh
git clone https://github.com/ideo-plus/takt-aidlc.git
cd takt-aidlc
bun install --frozen-lockfile
bun run typecheck
bun run check:takt
bun run test
bun run build:marketplace
```

`bun run test` prepares the AI-DLC 2.8.2 test runtime under `.experiments/cache/`. It does not depend on earlier local experiments. Synthetic CG inputs are included under `experiments/code-generation/input/`.

Tests use a mock provider and need no model credentials. They exercise the actual TAKT engine, AI-DLC state/approval checks, and quality gates. Install Codex CLI 0.154.0 as well: tests verify plugin installation with an isolated Codex configuration.

## Updating distributions and testing locally

Users install prebuilt plugins through the GitHub marketplace. Include regenerated distributions in the same change as their source.

| Path | Purpose |
|---|---|
| `takt/{ja,en}/workflows/` / `takt/{ja,en}/facets/` | Workflow YAML, local facets, and the rationale for built-in personas |
| `src/setup/` | Project initialization CLI; bundled as `scripts/setup.js` |
| `plugins/claude/` / `plugins/codex/` | Editable manifests and hooks |
| `dist/claude/` / `dist/codex/` | Local build output, excluded from Git |
| `plugins/takt-aidlc-claude/` / `plugins/takt-aidlc-codex/` | Committed distribution output; do not edit directly |
| `.claude-plugin/marketplace.json` / `.agents/plugins/marketplace.json` | Public Claude Code / Codex marketplace definitions |

When source, hooks, or TAKT definitions change, update the source plugin version and run `bun run build:marketplace`. The plugin-creator cachebuster helper can refresh the Codex development version. Use `bun run check:marketplace` to confirm that committed bundles match the source.

Use the following only for local development. Do not load the published version of the same plugin at the same time.

```sh
# Claude Code: run from the target project.
claude --plugin-dir /absolute/path/to/takt-aidlc/dist/claude

# Codex: register the local development marketplace.
codex plugin marketplace add /absolute/path/to/takt-aidlc/dist/codex
codex plugin add takt-aidlc@takt-aidlc-local
```

Once merged into main, the changes are available through the README's HTTPS installation commands. Marketplace entries reference prebuilt files; users do not build the plugin.

## CI

The [CI workflow](../.github/workflows/ci.yml) runs for pull requests and pushes to main. It pins tool versions on Ubuntu and checks types, tests, builds, Claude Code plugin validity, source/bundle consistency, and installation through both CLIs in isolated settings. It does not call models.

Select live experiments explicitly:

```sh
bun run experiment:cg -- --live --provider codex --model gpt-5.6-luna --reasoning-effort max
```

When reporting results, distinguish a normal native AI-DLC approval journey from a workflow test using synthetic CG entry and Intent/design inputs. Record failures and manual recovery separately from successful runs.

## Describing changes

Use English Conventional Commits messages. Write pull request descriptions in Japanese, covering behavior changes, validation, and unverified scope.

Keep English and Japanese versions together. TAKT definitions use matching paths under `takt/en/{facets,workflows}/` and `takt/ja/{facets,workflows}/`; Markdown filenames have no locale suffix there. Guides, experiment inputs, and records elsewhere use English `.md` and Japanese `.ja.md` pairs. Update both versions and their links together. Each workflow references its own language’s facets. Keep workflow step IDs, transitions, and report schemas identical across languages. Experiment helpers copy Japanese inputs to native AI-DLC filenames. Regenerate distribution copies after changing bundled Markdown.
