import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cgFixture } from "../code-generation/fixture";
import {
  phaseContext,
  stageApplies,
  type PhaseConfig,
} from "../../src/construction-phase/context";
import { readJson, writeJson } from "../../src/handoff/io";
import { put, repo } from "../../tests/handoff-fixture";
export async function phaseFixture(
  options: {
    host?: "claude" | "codex";
    twoUnits?: boolean;
    repairs?: boolean;
    blocked?: boolean;
    failFinal?: boolean;
    integrationRepair?: boolean;
  } = {},
) {
  const f = await cgFixture({
    hostHarness: options.host,
    constructionEntry: true,
    buildFailure: options.repairs,
    sensorFailure: options.repairs,
  });
  const record = f.artifact.split("/inception/")[0],
    control = "aidlc/takt-handoff";
  for (const name of [
    "requirements-analysis/requirements.md",
    "delivery-planning/bolt-plan.md",
  ]) {
    const p = join(f.project, record, "inception", name);
    put(
      p,
      readFileSync(p, "utf8")
        .replaceAll("CI設定", "アプリ固有の追加設定")
        .replaceAll("CI", "継続的デリバリー"),
    );
  }
  writeJson(
    join(f.project, record, "project-description.json"),
    "Construction全体の合成入力。answer=42の公開APIを実装・検証し、必要なCI設定を生成する。対話承認待ちを置かない。",
  );
  put(
    join(f.project, record, "inception/practices-discovery/team-practices.md"),
    "# 合成開発方針\n\n## 実装\n各Unitに5テスト、test-after、80%以上の行カバレッジ。依存とLint基盤は増やさず、最後にGitHub ActionsのCIを生成する。\n\n## 検証\nビルド、Unitテスト、型検査、全体ビルド・テストを必須とする。\n",
  );
  if (options.twoUnits) {
    put(
      join(
        f.project,
        record,
        "inception/units-generation/unit-of-work-dependency.md",
      ),
      "# Units\n\n## 依存関係\nanswer-consumerはanswer-value-updateに依存する。\n\n## 定義\n```yaml\nunits:\n  - name: answer-value-update\n    kind: library\n    depends_on: []\n  - name: answer-consumer\n    kind: library\n    depends_on: [answer-value-update]\n```\n",
    );
    put(
      join(f.project, record, "inception/units-generation/unit-of-work.md"),
      "# Units\n\n## ユニット一覧\n| Unit ID | Directory | 名前 |\n|---|---|---|\n| U1 | answer-value-update | AnswerValueUpdate |\n| U2 | answer-consumer | AnswerConsumer |\n\n## U1\nkind: library。src/value.tsと5テスト。\n\n## U2\nkind: library。src/consumer.tsからvalueのanswerを再exportし、5テスト。\n",
    );
  }
  put(
    join(f.project, control, "stage-workflow.yaml"),
    readFileSync(join(repo, "workflows/aidlc-construction-stage.yaml"), "utf8"),
  );
  put(
    join(f.project, control, "phase-build.ts"),
    `const r=await Bun.build({entrypoints:${JSON.stringify(options.twoUnits ? ["src/value.ts", "src/consumer.ts"] : ["src/value.ts"])},target:'bun',outdir:'cg/build'});if(!r.success)process.exit(1);console.log('phase build passed');\n`,
  );
  put(
    join(f.project, control, "phase-test.ts"),
    `import {spawnSync} from 'node:child_process';\n${options.failFinal ? "if(process.cwd().endsWith('/result'))process.exit(1);\n" : ""}${options.integrationRepair ? `if(!require('node:fs').readFileSync('src/consumer.ts','utf8').includes("from './value'")){console.error('consumer must re-export from value');process.exit(1);}` : ""}const r=spawnSync(process.execPath,['test','src','--coverage'],{stdio:'inherit'});process.exit(r.status??1);\n`,
  );
  const config: PhaseConfig = {
    ...f.config,
    provider: "mock",
    delegationScope: "construction",
    stageWorkflow: `${control}/stage-workflow.yaml`,
    phaseBuildScript: `${control}/phase-build.ts`,
    phaseVerifyScript: `${control}/phase-test.ts`,
    pipelinePaths: [".github/workflows/ci.yml"],
    stageScenarios: {},
    timeoutMs: 180000,
  } as any;
  delete (config as any).handoffStage;
  if (options.twoUnits) {
    for (const name of ["build", "test", "typecheck"])
      put(
        join(f.project, control, `consumer-${name}.ts`),
        readFileSync(
          join(
            f.project,
            control,
            `${name === "typecheck" ? "typecheck" : name}.ts`,
          ),
          "utf8",
        ).replaceAll("src/value", "src/consumer"),
      );
    config.unitChecks = {
      "answer-consumer": {
        buildScript: `${control}/consumer-build.ts`,
        verifyScript: `${control}/consumer-test.ts`,
        sensorScripts: { "type-check": `${control}/consumer-typecheck.ts` },
        sensorExceptions: config.sensorExceptions,
        mockScenario: `${control}/consumer-scenario.json`,
      },
    };
  }
  writeJson(join(f.project, control, "config.json"), config);
  const context = await phaseContext(f.project, config);
  if (options.twoUnits) {
    const scenario = readJson<any[]>(join(f.project, control, "scenario.json"));
    // 成功経路だけを使い、consumerが先行Unitのコードへ実際に依存する。
    const approved = {
      verdict: "approved",
      findings: [],
      alignment: {
        intent: "公開APIを確認",
        stageDefinition: "CG成果物を確認",
        conventions: "規約を確認",
        testingContract: "5テストを確認",
      },
    };
    const plan = JSON.parse(scenario[1].content);
    plan.steps.forEach((s: any) => {
      s.unit = "answer-consumer";
      s.files = s.files.map((p: string) => p.replace("value", "consumer"));
    });
    plan.testingContractHash =
      context.cg["answer-consumer"].testingContract.contract_sha256;
    plan.steps[0].requirementIds = context.cg["answer-consumer"].requirementIds;
    const original = scenario.filter((r) => r.file_writes).at(-1);
    const writes = original.file_writes.map((w: any) => ({
      path: w.path.replace("src/value", "src/consumer"),
      content:
        w.path === "src/value.ts"
          ? options.integrationRepair
            ? "export const answer = 42;\n"
            : "export { answer } from './value';\n"
          : w.content
              .replaceAll("src/value", "src/consumer")
              .replaceAll("'./value'", "'./consumer'")
              .replaceAll("answer-value-update", "answer-consumer"),
    }));
    const judge = {
      content: "",
      structured_output: { step: 1, reason: "synthetic phase fixture" },
    };
    writeJson(join(f.project, control, "consumer-scenario.json"), [
      { content: "計画" },
      { content: JSON.stringify(plan) },
      judge,
      { content: "確認" },
      { content: JSON.stringify(approved) },
      judge,
      { content: "実装", file_writes: writes },
      judge,
      { content: "確認" },
      { content: JSON.stringify(approved) },
      judge,
      { content: "完了" },
      {
        content: JSON.stringify({
          verdict: "complete",
          summary: "ビルドと5テストが成功",
          notReproduced: ["human-approval", "aidlc-lifecycle"],
        }),
      },
    ]);
  }
  if (options.integrationRepair) {
    const scenario = readJson<any[]>(
      join(f.project, control, "consumer-scenario.json"),
    );
    const response = scenario.find((r) => r.file_writes);
    response.file_writes = response.file_writes.filter(
      (w: any) => w.path !== "src/consumer.test.ts",
    );
    for (const w of response.file_writes) {
      if (w.path === "src/consumer.ts")
        w.content = "export { answer } from './value';\n";
      if (w.path === "cg/source-manifest.json") {
        const m = JSON.parse(w.content);
        m.writes = [{ path: "src/consumer.ts" }];
        w.content = JSON.stringify(m);
      }
    }
    const path = `${control}/consumer-repair-scenario.json`;
    config.stageScenarios!["answer-consumer/code-generation-repair"] = path;
    writeJson(join(f.project, path), scenario);
  }
  let upstream = [...context.artifacts];
  const stageScenario = (
    stage: (typeof context.stages)[number],
    unit: string | null,
  ) => {
    const key = `${unit ?? "all"}/${stage.slug}`,
      kind = context.units.find((u) => u.name === unit)?.kind;
    const required = stage.produces
      .filter(
        (n) =>
          !kind ||
          !stage.produces_kinds?.[n] ||
          stage.produces_kinds[n].includes(kind),
      )
      .map((n) =>
        n === "traceability"
          ? "traceability.json"
          : n === "build-test-results"
            ? "test-results.md"
            : `${n}.md`,
      );
    const ids = unit
      ? context.cg[unit].requirementIds
      : [
          ...new Set(
            Object.values(context.cg).flatMap((c) => c.requirementIds),
          ),
        ];
    const artifacts = Object.fromEntries(
      required.map((n) => [
        n,
        n === "traceability.json"
          ? JSON.stringify({
              stage: stage.slug,
              upstream_ids: ids,
              coverage: ids.map((id) => ({
                id,
                status: "OK",
                target: required.find((n) => n.endsWith(".md")),
              })),
            })
          : `# ${n}\n\n## 定義\n合成成果物: ${stage.slug} / ${unit ?? "all"}\n\n## 検証\n要求に対応し、固定のビルド・テストで確認する。\n`,
      ]),
    );
    const draft = {
      verdict:
        options.blocked && stage.slug === "functional-design"
          ? "blocked"
          : "ready",
      reason: "合成された未確定要件のため停止",
      artifacts,
      writes:
        stage.slug === "ci-pipeline"
          ? {
              ".github/workflows/ci.yml":
                "name: app\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: oven-sh/setup-bun@v2\n      - run: bun build src/value.ts --target bun --outdir cg/build\n      - run: bun test src\n",
            }
          : {},
      upstream: [...upstream],
      appliedRules: [
        {
          source: stage.file,
          rule: "本家の必須成果物を作る",
          application: "現在のUnitに適用する",
        },
      ],
    };
    const review = {
      verdict: "approved",
      findings: [],
      alignment: {
        intent: "要求に対応",
        stageDefinition: "原文に対応",
        conventions: "規約に対応",
        testingContract: "検証に対応",
      },
    };
    const report = (r: unknown, choice = 1) => [
      { content: "合成応答" },
      { content: JSON.stringify(r) },
      {
        content: "",
        structured_output: { step: choice, reason: "synthetic stage fixture" },
      },
    ];
    const scenario =
      options.repairs && stage.slug === "functional-design"
        ? [
            ...report(draft),
            ...report(
              {
                ...review,
                verdict: "changes_requested",
                findings: ["合成レビュー差し戻し"],
              },
              2,
            ),
            ...report(draft),
            ...report(review),
          ]
        : [
            ...report(draft, draft.verdict === "blocked" ? 2 : 1),
            ...report(review),
          ];
    const p = `${control}/stage-${unit ?? "all"}-${stage.slug}.json`;
    config.stageScenarios![key] = p;
    if (options.integrationRepair && stage.slug === "build-and-test") {
      const repairPath = `${record}/construction/build-and-test/repair-request.json`;
      const followup = `${control}/stage-build-after-repair.json`;
      config.stageScenarios!["all/build-and-test-after-repair"] = followup;
      writeJson(join(f.project, followup), [
        ...report({ ...draft, upstream: [...upstream, repairPath] }),
        ...report(review),
      ]);
      writeJson(join(f.project, p), [
        ...report(draft),
        ...report(
          {
            verdict: "repair_required",
            repairUnit: "answer-consumer",
            reason: "全体検証でconsumerの依存違反を検出",
          },
          3,
        ),
      ]);
      upstream.push(repairPath);
    } else writeJson(join(f.project, p), scenario);
    upstream.push(
      ...required.map(
        (n) =>
          `${record}/construction/${unit ? unit + "/" : ""}${stage.slug}/${n}`,
      ),
    );
  };
  for (const unit of context.order) {
    for (const stage of context.stages
      .filter(
        (s) =>
          !["code-generation", "build-and-test", "ci-pipeline"].includes(
            s.slug,
          ),
      )
      .filter((s) =>
        stageApplies(s, context.units.find((u) => u.name === unit)?.kind),
      ))
      stageScenario(stage, unit);
    upstream.push(
      ...[
        "code-generation-plan.md",
        "unit-test-instructions.md",
        "code-summary.md",
        "traceability.json",
        "source-manifest.json",
        "sensors.json",
        "build.json",
        "test.json",
      ].map((n) => `${record}/construction/${unit}/code-generation/${n}`),
    );
  }
  for (const stage of context.stages.filter((s) =>
    ["build-and-test", "ci-pipeline"].includes(s.slug),
  ))
    stageScenario(stage, null);
  writeJson(join(f.project, control, "config.json"), config);
  const event = {
    ...f.event,
    tool_input: {
      command:
        'aidlc engine orchestrate report --stage delivery-planning --result approved --user-input "Approve"',
    },
    tool_response: { stdout: '{"kind":"done"}' },
  };
  const approve = () => {
    f.audit.appendAuditEntry(
      "GATE_APPROVED",
      {
        Stage: "delivery-planning",
        "User Input": "SYNTHETIC PHASE TEST — not a human approval",
      },
      f.project,
    );
    f.audit.appendAuditEntry(
      "STAGE_COMPLETED",
      { Stage: "delivery-planning", Details: "SYNTHETIC PHASE TEST" },
      f.project,
    );
  };
  return { ...f, config, context, event, approve };
}
