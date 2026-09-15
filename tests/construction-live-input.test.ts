import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { livePhaseFixture } from "../experiments/construction-phase/live";
import { phaseContext } from "../src/construction-phase/context";

test("Construction実モデル用入力はLuna Maxを指定し、旧CG限定条件を引き継がない", async () => {
  const f = await livePhaseFixture();
  expect(f.config.provider).toBe("codex");
  expect(f.config.model).toBe("gpt-5.6-luna");
  expect(f.config.codexReasoningEffort).toBe("max");
  expect(f.config.mockScenario).toBeUndefined();
  expect(f.config.stageScenarios).toBeUndefined();
  const ctx = await phaseContext(f.project, f.config);
  expect(ctx.stages.map((s) => s.slug)).toEqual([
    "functional-design",
    "nfr-requirements",
    "nfr-design",
    "infrastructure-design",
    "code-generation",
    "build-and-test",
    "ci-pipeline",
  ]);
  const plan = readFileSync(
    join(f.project, ctx.record, "inception/delivery-planning/bolt-plan.md"),
    "utf8",
  );
  expect(plan).toContain("TAKTがFunctional Design");
  expect(plan).not.toContain("TAKTはCG単体");
  const req = readFileSync(
    join(
      f.project,
      ctx.record,
      "inception/requirements-analysis/requirements.md",
    ),
    "utf8",
  );
  expect(req).toContain("CI設定は.github/workflows/ci.ymlに作成");
}, 30000);

test("実際のLuna成果物を本家センサーで検査し、CGには設計由来のIDも渡す", async () => {
  const f = await livePhaseFixture();
  const { mkdirSync, writeFileSync, copyFileSync } = await import("node:fs");
  const { seedTraceProject, resolveTraceIds, nativeTrace } = await import(
    "../src/construction-phase/native-trace"
  );
  const record = f.context.record,
    unit = f.unit,
    view = join(f.project, "trace-regression-view");
  seedTraceProject(view, record, readFileSync(f.state, "utf8"));
  const { dirname } = await import("node:path");
  for (const p of f.context.artifacts) {
    const out = join(view, p);
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(join(f.project, p), out);
  }
  const expected = resolveTraceIds(view, record, unit, "functional-design");
  expect(expected).toEqual(["FR1", "FR1.1", "FR2", "FR2.1", "FR2.2"]);
  const fixture = JSON.parse(
    readFileSync(
      join(import.meta.dir, "fixtures/luna-functional-design.json"),
      "utf8",
    ),
  );
  const dir = join(view, record, "construction", unit, "functional-design");
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(fixture.artifacts))
    writeFileSync(join(dir, name), content as string);
  expect(
    nativeTrace(view, join(dir, "traceability.json"), "functional-design").pass,
  ).toBe(true);
  writeFileSync(
    join(dir, "rules.md"),
    fixture.artifacts["rules.md"] + "\nBR1.99: 未対応の派生ルール\n",
  );
  expect(
    nativeTrace(view, join(dir, "traceability.json"), "functional-design")
      .orphans,
  ).toContain("BR1.99");
  writeFileSync(join(dir, "rules.md"), fixture.artifacts["rules.md"]);
  const nfr = join(
    view,
    record,
    "construction",
    unit,
    "nfr-requirements/security-requirements.md",
  );
  mkdirSync(dirname(nfr), { recursive: true });
  writeFileSync(nfr, "# NFR\n\n## NFR1.1\n品質条件\n\n## NFR2.1\n依存条件\n");
  expect(resolveTraceIds(view, record, unit, "nfr-design")).toEqual([
    "NFR1.1",
    "NFR2.1",
  ]);
  const cg = resolveTraceIds(view, record, unit, "code-generation");
  expect(cg).toContain("BR1.1");
  expect(cg).toContain("NFR1.1");
  expect(cg).toContain("NFR1");
}, 30000);
