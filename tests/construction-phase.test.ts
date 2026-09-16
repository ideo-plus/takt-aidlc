import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { phaseFixture } from "../experiments/construction-phase/fixture";
import {
  capturePhase,
  preparePhase,
  executePhase,
} from "../src/construction-phase/runner";
import { readJson, writeJson } from "../src/handoff/io";

test("Constructionは依存順に設計・共通CGを実行し、全体検証とCIまで完了する", async () => {
  const f = await phaseFixture({ twoUnits: true, repairs: true, language: "en" });
  await capturePhase(f.project, f.event);
  f.approve();
  const h = (await preparePhase(f.project, f.event))!;
  expect((await preparePhase(f.project, f.event))!.id).toBe(h.id);
  const result = await executePhase(f.project, h.id);
  if (result.state !== "verified") console.error(result.reason);
  expect(result.state).toBe("verified");
  expect(result.attempts).toBe(1);
  expect(
    result.steps
      ?.filter((s) => s.stage === "code-generation")
      .map((s) => s.unit),
  ).toEqual(["answer-value-update", "answer-consumer"]);
  expect(result.steps?.at(-1)?.stage).toBe("supervise");
  expect(
    readFileSync(join(result.workspace!, "src/consumer.ts"), "utf8"),
  ).toContain("from './value'");
  expect(existsSync(join(result.workspace!, ".github/workflows/ci.yml"))).toBe(
    true,
  );
  expect(readFileSync(join(f.project, "src/value.ts"), "utf8")).toContain("41");
  expect(
    f.lib
      .readAuditShardEvents(f.project)
      .some(
        (r: any) =>
          r.event === "PLAN_APPROVAL_RECORDED" || r.event === "STAGE_STARTED",
      ),
  ).toBe(false);
  for (const step of result.steps!) {
    const config = Bun.YAML.parse(readFileSync(join(step.attempt, "takt-config/config.yaml"), "utf8")) as any;
    expect(config.language).toBe("en");
    const sourceBundle = step.stage === "code-generation" ? "context/plan.md" : step.stage === "supervise" ? "supervision-sources.md" : "sources.md";
    const bundle = readFileSync(join(step.attempt, "control", sourceBundle), "utf8");
    expect(bundle).toStartWith(step.stage === "code-generation" ? "# AI-DLC CG HOTL execution contract" : step.stage === "supervise" ? "# AI-DLC requirement validation" : "# Construction HOTL execution contract");
  }
  const first = result.steps![0];
  const ledger = readJson<any[]>(
    join(first.attempt, "control/construction-ledger.json"),
  );
  expect(
    ledger.filter((r) => r.phase === "review").map((r) => r.verdict),
  ).toEqual(["changes_requested", "approved"]);
}, 180000);

test("未確定の設計は対話待ちでなくblockedで終了する", async () => {
  const f = await phaseFixture({ host: "codex", blocked: true });
  await capturePhase(f.project, f.event);
  f.approve();
  const h = (await preparePhase(f.project, f.event))!;
  const result = await executePhase(f.project, h.id);
  expect(result.state).toBe("blocked");
  expect(result.steps).toHaveLength(1);
  expect(readFileSync(join(f.project, "src/value.ts"), "utf8")).toContain("41");
}, 60000);

test("Inception承認がない場合と最終の全体テスト失敗を成功にしない", async () => {
  const f = await phaseFixture({ failFinal: true });
  await capturePhase(f.project, f.event);
  await expect(preparePhase(f.project, f.event)).rejects.toThrow(
    "承認・完了記録",
  );
  f.approve();
  const h = (await preparePhase(f.project, f.event))!;
  const result = await executePhase(f.project, h.id);
  expect(result.state).toBe("failed");
  expect(result.steps?.at(-1)?.stage).toBe("supervise");
  expect(readJson<any>(join(h.run, "attempts/1/final-test.json")).code).toBe(1);
}, 120000);

test("不正なscope・Unitの不正な依存・park後の入力変更を拒否する", async () => {
  const f = await phaseFixture();
  const path = join(f.project, "aidlc/takt-handoff/config.json");
  writeJson(path, { ...f.config, delegationScope: "unknown" });
  await expect(capturePhase(f.project, f.event)).rejects.toThrow("delegationScope");
  writeJson(path, { ...f.config, language: 'fr' });
  await expect(capturePhase(f.project, f.event)).rejects.toThrow("language");
  writeJson(path, f.config);
  const dependency = join(
    f.project,
    f.context.record,
    "inception/units-generation/unit-of-work-dependency.md",
  );
  const original = readFileSync(dependency, "utf8");
  const fs = await import("node:fs");
  fs.writeFileSync(
    dependency,
    original.replace("depends_on: []", "depends_on: [answer-value-update]"),
  );
  await expect(capturePhase(f.project, f.event)).rejects.toThrow(
    "Unit依存関係",
  );
  fs.writeFileSync(dependency, original);
  await capturePhase(f.project, f.event);
  f.approve();
  const h = (await preparePhase(f.project, f.event))!;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(f.project, "src/value.ts"), "export const answer = 7;\n");
  expect((await executePhase(f.project, h.id)).state).toBe("failed");
  expect(existsSync(join(h.run, "attempts/1/result"))).toBe(false);
}, 30000);

test("全体検証の失敗を所有Unitの共通CGへ戻し、修正後に再検証する", async () => {
  const f = await phaseFixture({ twoUnits: true, integrationRepair: true });
  await capturePhase(f.project, f.event);
  f.approve();
  const h = (await preparePhase(f.project, f.event))!;
  const result = await executePhase(f.project, h.id);
  if (result.state !== "verified") console.error(result.reason);
  expect(result.state).toBe("verified");
  expect(
    result.steps
      ?.filter((s) => s.stage === "code-generation")
      .map((s) => s.unit),
  ).toEqual(["answer-value-update", "answer-consumer", "answer-consumer"]);
  expect(
    result.steps
      ?.filter((s) => s.stage === "build-and-test")
      .map((s) => s.state),
  ).toEqual(["repair_required", "verified"]);
  expect(
    readFileSync(join(result.workspace!, "src/consumer.ts"), "utf8"),
  ).toContain("from './value'");
}, 180000);

test("工程選択・Unit種別・Test Strategyに合わせて実行対象を絞る", async () => {
  const f = await phaseFixture();
  const fs = await import("node:fs");
  fs.writeFileSync(
    f.state,
    readFileSync(f.state, "utf8")
      .replace("**Test Strategy**: Standard", "**Test Strategy**: Minimal")
      .replace("- [ ] ci-pipeline", "- [S] ci-pipeline"),
  );
  const { phaseContext, stageApplies } = await import(
    "../src/construction-phase/context"
  );
  const ctx = await phaseContext(f.project, { ...f.config, pipelinePaths: [] });
  expect(ctx.skipped).toContain("ci-pipeline");
  expect(
    ctx.stages.find((s) => s.slug === "build-and-test")?.produces,
  ).not.toContain("integration-test-instructions");
  expect(
    stageApplies(
      ctx.stages.find((s) => s.slug === "functional-design")!,
      "packaging",
    ),
  ).toBe(false);
}, 30000);
