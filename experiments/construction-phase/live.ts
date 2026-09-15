import { readFileSync } from "node:fs";
import { join } from "node:path";
import { phaseFixture } from "./fixture";
import { put, repo } from "../../tests/handoff-fixture";
import { writeJson } from "../../src/handoff/io";

export async function livePhaseFixture() {
  const f = await phaseFixture({ host: "codex", twoUnits: false });
  const record = f.context.record;
  for (const [source, target] of [
    ["requirements.md", "requirements-analysis/requirements.md"],
    ["practices.md", "practices-discovery/team-practices.md"],
    ["plan.md", "delivery-planning/bolt-plan.md"],
    ["components.md", "domain-design/components.md"],
  ]) {
    put(
      join(f.project, record, "inception", target),
      readFileSync(
        join(repo, "experiments/construction-phase/live-input", source),
        "utf8",
      ),
    );
  }
  writeJson(
    join(f.project, record, "project-description.json"),
    "合成入力を使ったConstruction全体の実モデル試験。answer-value-updateの4設計工程、CG、全体検証、GitHub Actions CI生成をHOTLで実行する。値42・5テスト・80%以上の行カバレッジ・型検査を維持する。",
  );
  Object.assign(f.config, {
    provider: "codex",
    model: "gpt-5.6-luna",
    codexReasoningEffort: "max",
    timeoutMs: 3600000,
  });
  delete f.config.mockScenario;
  delete f.config.stageScenarios;
  writeJson(join(f.project, "aidlc/takt-handoff/config.json"), f.config);
  return f;
}
