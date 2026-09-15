import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanEnvironment, withoutBedrock, quote } from "./io";
import type { CgConfig } from "../code-generation/runner";

export function prepareProvider(
  attempt: string,
  config: CgConfig,
  scenario?: string,
) {
  const control = join(attempt, "control");
  mkdirSync(control, { recursive: true });
  const configDir = join(attempt, "takt-config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "config.yaml"),
    Bun.YAML.stringify({
      provider: config.provider,
      language: "ja",
      workflow_command_gates: { custom_scripts: true },
      ...(config.model ? { model: config.model } : {}),
      ...(config.codexReasoningEffort
        ? {
            provider_options: {
              codex: { reasoning_effort: config.codexReasoningEffort },
            },
          }
        : {}),
    }),
  );
  let env = {
    ...cleanEnvironment(),
    TAKT_CONFIG_DIR: configDir,
  } as NodeJS.ProcessEnv;
  if (config.disableBedrock) env = withoutBedrock(env);
  if (config.provider === "mock") env.TAKT_MOCK_SCENARIO = scenario!;
  else if (config.provider === "claude") {
    const claude = Bun.which("claude");
    if (!claude) throw new Error("Claude Codeが見つかりません");
    const wrapper = join(control, "claude.sh");
    writeFileSync(
      wrapper,
      `#!/bin/sh\ncase "$1" in --help|--version) exec ${quote(claude)} "$@";; esac\nexec ${quote(claude)} --setting-sources project --strict-mcp-config --mcp-config '{"mcpServers":{}}' --tools Read,Glob,Grep,Write,Edit --max-turns 20 --max-budget-usd 2 "$@"\n`,
      { mode: 0o700 },
    );
    env.TAKT_CLAUDE_CLI_PATH = wrapper;
  } else {
    const codex = Bun.which("codex");
    if (!codex) throw new Error("Codex CLIが見つかりません");
    // sandboxと非対話設定はTAKTのCodexプロバイダーが担当する。モデルは利用者の既定を維持する。
    env.TAKT_CODEX_CLI_PATH = codex;
  }
  return env;
}
