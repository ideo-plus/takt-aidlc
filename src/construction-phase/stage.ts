import {
  seedTraceProject,
  resolveTraceIds,
  nativeTraceSource,
} from "./native-trace";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  command,
  digest,
  fileInside,
  readJson,
  requireSuccess,
  snapshot,
  unchanged,
  writeJson,
  type Snapshot,
} from "../handoff/io";
import { prepareProvider } from "../handoff/provider";
import { sources, cgGateSource } from "../code-generation/cg-gate";
import type { CgContext } from "../code-generation/context";
import type { PhaseConfig, StageDefinition } from "./context";

export async function executeStage(args: {
  attempt: string;
  store: string;
  files: Snapshot;
  sourcePaths: string[];
  artifacts: string[];
  stage: StageDefinition;
  unit: string | null;
  kind?: string;
  units: string[];
  repaired?: boolean;
  cg: CgContext;
  c: PhaseConfig;
  verify: () => void;
  timeout: number;
}) {
  const {
    attempt,
    store,
    files,
    sourcePaths,
    artifacts,
    stage,
    unit,
    kind,
    cg,
    c,
    verify,
    timeout,
  } = args;
  const workspace = join(attempt, "work"),
    control = join(attempt, "control");
  mkdirSync(control, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  const copy = (path: string, target: string) => {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(fileInside(store, path), target);
  };
  for (const path of sourcePaths) {
    copy(path, join(workspace, path));
    chmodSync(join(workspace, path), 0o644);
  }
  const paths = [
    ...new Set([
      ...cg.files,
      ...stage.files,
      ...artifacts,
      c.phaseBuildScript,
      c.phaseVerifyScript,
      ...Object.values(c.stageSensorScripts ?? {}),
    ]),
  ];
  const inputs: Snapshot = {};
  for (const path of paths) {
    const rel = `input/project/${path}`;
    copy(path, join(workspace, rel));
    inputs[rel] = files[path];
  }
  const required = stage.produces
    .filter(
      (name) =>
        !kind ||
        !stage.produces_kinds?.[name] ||
        stage.produces_kinds[name].includes(kind),
    )
    .map((name) =>
      name === "traceability"
        ? "traceability.json"
        : name === "build-test-results"
          ? "test-results.md"
          : `${name}.md`,
    );
  const sensorScripts = Object.fromEntries(
    Object.entries(c.stageSensorScripts ?? {}).map(([id, p]) => [
      id,
      { path: fileInside(store, p), hash: files[p] },
    ]),
  );
  const checks = Object.fromEntries(
    [
      ["build", c.phaseBuildScript],
      ["test", c.phaseVerifyScript],
    ].map(([id, p]) => [id, { path: fileInside(store, p), hash: files[p] }]),
  );
  const requirementIds =
    unit && stage.sensors.includes("traceability")
      ? resolveTraceIds(store, cg.record, unit, stage.slug)
      : cg.requirementIds;
  const traceProject = join(control, "trace-project");
  const metadata = seedTraceProject(
    traceProject,
    cg.record,
    readFileSync(join(store, cg.record, "aidlc-state.md"), "utf8"),
  );
  const traceInputs = [...metadata];
  const currentStageDir = `${cg.record}/construction/${unit ? unit + "/" : ""}${stage.slug}/`;
  for (const path of artifacts.filter((p) => !p.startsWith(currentStageDir))) {
    copy(path, join(traceProject, path));
    traceInputs.push(path);
  }
  const data = {
    workspace,
    traceProject,
    record: cg.record,
    inputs,
    initialSources: sources(workspace),
    stage,
    unit,
    required,
    upstreamArtifacts: artifacts,
    requirementIds,
    units: args.units,
    sensorScripts,
    checks,
    pipelinePaths: stage.slug === "ci-pipeline" ? (c.pipelinePaths ?? []) : [],
  };
  writeJson(join(workspace, "input/stage-context.json"), {
    stage,
    unit,
    required,
    upstreamArtifacts: artifacts,
    requirementIds,
    units: args.units,
    pipelinePaths: data.pipelinePaths,
    checks: { build: c.phaseBuildScript, test: c.phaseVerifyScript },
  });
  inputs["input/stage-context.json"] = digest(
    readFileSync(join(workspace, "input/stage-context.json")),
  );
  writeJson(join(control, "stage-context.json"), data);
  copyFileSync(
    join(import.meta.dir, "stage-gate.ts"),
    join(control, "stage-gate.ts"),
  );
  copyFileSync(cgGateSource, join(control, "cg-gate.ts"));
  copyFileSync(nativeTraceSource, join(control, "native-trace.ts"));
  const workflow = Bun.YAML.parse(
    readFileSync(fileInside(store, c.stageWorkflow), "utf8"),
  ) as any;
  const contract = `# Construction HOTLの実行契約\n現在の工程は${stage.slug}、Unitは${unit ?? "全Unit"}です。入力のIntent・本家工程定義・規約・知識・センサーを使います。対話承認、ウォーキングスケルトン後の承認、学びの質問、ネイティブの状態・監査記録の更新は行いません。技術レビューへ置き換え、入力から決められないことはblockedで終了してください。成果物の元のrecordパスはinput/projectの固定コピーへ対応します。ファイルは応答のartifacts/writesから検証ゲートが生成します。品質条件を弱めず、実測していない検査を成功と記録しないでください。\n`;
  const bundlePaths = paths.filter(
    (path) =>
      path !== cg.stageFile && !/^\.(?:claude|codex)\/tools\//.test(path),
  );
  const bundle =
    contract +
    bundlePaths
      .map(
        (p) =>
          `\n## Original source: ${p}\nSHA256: ${files[p]}\n${readFileSync(fileInside(store, p), "utf8")}\n`,
      )
      .join("") +
    `\n${cg.testingContractText}\n` +
    contract;
  writeFileSync(join(control, "sources.md"), bundle);
  workflow.instructions = {
    ...(workflow.instructions ?? {}),
    upstream: "sources.md",
  };
  for (const step of workflow.steps) {
    if (!["draft", "review"].includes(step.name))
      throw new Error("工程Workflowが不正です");
    step.instruction = ["upstream", contract, step.instruction];
  }
  writeFileSync(join(control, "workflow.yaml"), Bun.YAML.stringify(workflow));
  writeJson(
    join(control, "injection.json"),
    bundlePaths.map((path) => ({ path, sha256: files[path] })),
  );
  const protectedFiles = snapshot(control, [
    "stage-context.json",
    "stage-gate.ts",
    "cg-gate.ts",
    "sources.md",
    "workflow.yaml",
    "injection.json",
    "native-trace.ts",
    ...traceInputs.map((p) => `trace-project/${p}`),
  ]);
  const key = `${unit ?? "all"}/${stage.slug}`;
  const scenario =
    c.stageScenarios?.[args.repaired ? `${key}-after-repair` : key] ??
    c.stageScenarios?.[key];
  if (c.provider === "mock" && !scenario)
    throw new Error(`mock応答がありません: ${key}`);
  const env = prepareProvider(
    attempt,
    { ...c, delegationScope: "code-generation" },
    scenario ? fileInside(store, scenario) : undefined,
  );
  for (const a of [
    ["init", "-q"],
    ["config", "core.hooksPath", "/dev/null"],
    ["add", "."],
    [
      "-c",
      "user.name=TAKT",
      "-c",
      "user.email=takt@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "chore: seed stage workspace",
    ],
  ])
    requireSuccess(await command(["git", ...a], workspace, env, 10000));
  verify();
  const run = await command(
    [
      "takt",
      "--pipeline",
      "--skip-git",
      "--provider",
      c.provider,
      "--workflow",
      join(control, "workflow.yaml"),
      "--task",
      `Constructionの${stage.slug}をHOTLで実行し、成果物と検証結果を技術レビューする`,
    ],
    workspace,
    env,
    timeout,
  );
  writeJson(join(attempt, "takt.json"), run);
  verify();
  unchanged(workspace, inputs);
  unchanged(control, protectedFiles);
  const evidence = await command(
    [process.execPath, join(control, "stage-gate.ts"), "result"],
    workspace,
    env,
    10000,
  );
  writeJson(join(attempt, "result.json"), evidence);
  requireSuccess(evidence);
  const result = JSON.parse(evidence.stdout);
  if (result.state === "verified") requireSuccess(run);
  return { ...result, workspace };
}
