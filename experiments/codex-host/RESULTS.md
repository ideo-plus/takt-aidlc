# Codex host CG delegation trial

[日本語](RESULTS.ja.md)

## Result

**VERIFIED: a real Codex host entered native AI-DLC CG and completed CG validation through a mock TAKT worker.**

- Codex CLI 0.154.0, host model `gpt-5.6-luna`, reasoning effort `max`.
- AI-DLC 2.8.2, TAKT 0.65.0, Bun 1.3.13.
- Registered `dist/codex` as a local marketplace and installed the plugin through the real CLI.
- With native Codex hooks retained, the host executed `next` followed by `continue`.
- The plugin detected CG entry, parked through the official CLI, and launched TAKT.
- Exactly one TAKT run reached `verified`. Build, five tests, type checking, requirement mapping, and final build/test all passed.
- Original code remained `answer = 41`, frozen inputs were preserved, and the host ended its turn after the handoff notice without duplicate implementation.

The [machine-readable record](results/2026-09-15.json) includes reached scope and failed attempts.

## Trial boundary

The Intent, earlier-stage inputs, and CG-entry state were synthetic. This was not a test that created human approval records. TAKT worker responses were also mocked, so this does not establish a complete live-model CG run. The Codex host, plugin loading, native AI-DLC hooks, `next` / `continue` / `park`, TAKT engine, build, and tests were executed for real.

The trial used an isolated Codex configuration referencing an existing authentication file. Hook trust confirmation was bypassed only for this test invocation of the inspected hooks. Normal installation requires review and trust. Existing projects, global settings, and the personal marketplace were not modified.

## Differences found on the real host

The first attempt stopped before TAKT started: native CLI diagnostics and JSON shared the Bash output, so parsing the entire output as JSON failed.

The adapter was changed to allow only known `aidlc-orchestrate:` diagnostic lines and one unambiguous JSON response. It does not silently skip arbitrary output or multiple JSON objects. A retry in a new isolated project produced the successful result above.

Another short live test captured SessionStart, PreToolUse, and PostToolUse event shapes and confirmed that Bash `tool_response` is a string. The AI-DLC session prefix was checked against an actually rewritten command.

## Automated tests and reproduction

CI does not call models. It checks CLI plugin installation, relocated distributions, Codex-specific source injection, duplicate prevention, build/type-check corrections, and rejection of invalid prefixes, compound commands, other projects, and unfinished output.

The live host trial requires Codex authentication:

```sh
bun run experiment:codex-host
```

See [setup](../../docs/codex-host.md) and the separate [Luna Max worker trial](../code-generation/RESULTS.md). The latter's 30-minute timeout was not resolved by this successful host-connection test.
