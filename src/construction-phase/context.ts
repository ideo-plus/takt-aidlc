import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  collectCgContext,
  intentRecord,
  type CgContext,
} from "../code-generation/context";
import type { CgConfig } from "../code-generation/runner";
import {
  delegationScope,
  hostHarness,
  harnessDirectory,
} from "../hosts/harness";
import { digest, fileInside, readJson, snapshot } from "../handoff/io";
import { workflowFiles } from "../takt/workflow";

export type UnitChecks = Pick<
  CgConfig,
  "buildScript" | "verifyScript" | "sensorScripts" | "sensorExceptions"
> & { mockScenario?: string };
export type PhaseConfig = Omit<CgConfig, "delegationScope" | "handoffStage"> & {
  delegationScope: "construction";
  stageWorkflow: string;
  phaseBuildScript: string;
  phaseVerifyScript: string;
  unitChecks?: Record<string, UnitChecks>;
  stageSensorScripts?: Partial<Record<"linter" | "type-check", string>>;
  pipelinePaths?: string[];
  stageScenarios?: Record<string, string>;
};
export type StageDefinition = {
  slug: string;
  file: string;
  produces: string[];
  produces_kinds?: Record<string, string[]>;
  sensors: string[];
  roles: string[];
  templates: Record<string, string>;
  files: string[];
};
export type PhaseContext = {
  record: string;
  testStrategy: string;
  order: string[];
  units: { name: string; depends_on: string[]; kind?: string }[];
  stages: StageDefinition[];
  skipped: string[];
  cg: Record<string, CgContext>;
  artifacts: string[];
};
export const phaseStorage = (project: string) =>
  join(project, "aidlc/takt-handoff");
export function phaseEnabled(project: string) {
  const path = join(phaseStorage(project), "config.json");
  if (!existsSync(path)) return false;
  const c = readJson<any>(path);
  return c.enabled === true && delegationScope(c) === "construction";
}
export function phaseConfig(project: string) {
  const path = fileInside(project, "aidlc/takt-handoff/config.json");
  const c = readJson<PhaseConfig>(path);
  hostHarness(c.hostHarness);
  if (!c.enabled || delegationScope(c) !== "construction")
    throw new Error("Construction設定が無効です");
  if (
    !["mock", "claude", "codex"].includes(c.provider) ||
    !Number.isInteger(c.timeoutMs) ||
    c.timeoutMs < 1000 ||
    c.timeoutMs > 3600000
  )
    throw new Error("providerまたは時間上限が不正です");
  if (c.model !== undefined && (typeof c.model !== "string" || !c.model.trim()))
    throw new Error("modelが不正です");
  if (
    c.codexReasoningEffort !== undefined &&
    (c.provider !== "codex" ||
      typeof c.codexReasoningEffort !== "string" ||
      !c.codexReasoningEffort.trim())
  )
    throw new Error("Codex推論強度が不正です");
  if (
    !Array.isArray(c.artifacts) ||
    !c.artifacts.length ||
    !Array.isArray(c.sources) ||
    !c.sources.length
  )
    throw new Error("入力とソースを指定してください");
  for (const p of [...c.sources, ...(c.pipelinePaths ?? [])]) {
    if (
      p.split('/').some(name => name === 'node_modules' || name === '.venv') ||
      /^(?:node_modules|\.venv|\.git|\.claude|\.codex|\.agents|\.takt|aidlc|input|cg|phase)(?:\/|$)/.test(
        p,
      ) ||
      p.startsWith("/") ||
      p.split("/").some((s) => !s || s === "." || s === "..")
    )
      throw new Error(`制御領域または不正なソース: ${p}`);
  }
  for (const key of [
    "workflow",
    "stageWorkflow",
    "buildScript",
    "verifyScript",
    "phaseBuildScript",
    "phaseVerifyScript",
  ] as const)
    fileInside(project, c[key]);
  return { c, configHash: digest(readFileSync(path)) };
}
export function filesBelow(project: string, dir: string): string[] {
  if (!existsSync(join(project, dir))) return [];
  return readdirSync(join(project, dir), { withFileTypes: true }).flatMap(
    (e) => {
      if (e.isSymbolicLink())
        throw new Error(`symlinkは対象外: ${dir}/${e.name}`);
      const p = `${dir}/${e.name}`;
      return e.isDirectory() ? filesBelow(project, p) : e.isFile() ? [p] : [];
    },
  );
}
export async function phaseContext(
  project: string,
  c: PhaseConfig,
): Promise<PhaseContext> {
  const { record, space } = intentRecord(project),
    shell = harnessDirectory(hostHarness(c.hostHarness));
  const lib = await import(
    pathToFileURL(fileInside(project, `${shell}/tools/aidlc-lib.ts`)).href
  );
  const dependency = `${record}/inception/units-generation/unit-of-work-dependency.md`;
  const dag = lib.parseBoltDag(
    readFileSync(fileInside(project, dependency), "utf8"),
  );
  if (!dag.ok) throw new Error(`Unit依存関係が不正: ${dag.detail}`);
  if (dag.units.some((u: any) => !/^[\w-]+$/.test(u.name)))
    throw new Error("Unit名が不正です");
  const state = readFileSync(
    fileInside(project, `${record}/aidlc-state.md`),
    "utf8",
  );
  const progress = lib.parseCheckboxes(state);
  const testStrategy = lib.getField(state, "Test Strategy").toLowerCase();
  if (!["minimal", "standard", "comprehensive"].includes(testStrategy))
    throw new Error("Test Strategyが未確定です");
  const known = [
    "functional-design",
    "nfr-requirements",
    "nfr-design",
    "infrastructure-design",
    "code-generation",
    "build-and-test",
    "ci-pipeline",
  ];
  const selected = lib
    .loadStageGraph()
    .filter((s: any) => s.phase === "construction");
  if (selected.some((s: any) => !known.includes(s.slug)))
    throw new Error("未対応のConstruction工程があります");
  const skipped: string[] = [];
  const stages: StageDefinition[] = [];
  for (const node of selected) {
    const row = progress.find((p: any) => p.slug === node.slug);
    if (!row) throw new Error(`工程の実行方針がありません: ${node.slug}`);
    if (row.state === "skipped" || /^SKIP\b/.test(row.suffix)) {
      skipped.push(node.slug);
      continue;
    }
    const file = `${shell}/aidlc-common/stages/construction/${node.slug}.md`;
    const body = readFileSync(fileInside(project, file), "utf8");
    const definition = Bun.YAML.parse(
      body.match(/^---\n([\s\S]*?)\n---/)![1],
    ) as any;
    const roles = [
      ...new Set<string>([
        definition.lead_agent,
        ...(definition.support_agents ?? []),
        definition.reviewer ?? "aidlc-quality-agent",
      ]),
    ];
    const files = [
      file,
      ...roles.flatMap((role) => [
        `${shell}/agents/${role}.md`,
        ...filesBelow(project, `${shell}/knowledge/${role}`).filter((p) =>
          p.endsWith(".md"),
        ),
        ...filesBelow(
          project,
          `aidlc/spaces/${space}/knowledge/${role}`,
        ).filter((p) => p.endsWith(".md")),
      ]),
      ...(definition.sensors ?? []).map(
        (id: string) => `${shell}/sensors/aidlc-${id}.md`,
      ),
    ];
    if (
      (definition.sensors ?? []).some(
        (id: string) =>
          ![
            "required-sections",
            "upstream-coverage",
            "traceability",
            "linter",
            "type-check",
          ].includes(id),
      )
    )
      throw new Error(`未対応センサー: ${node.slug}`);
    const templates: Record<string, string> = {};
    for (const name of definition.produces ?? []) {
      const path = `aidlc/spaces/${space}/memory/templates/${name}.md`;
      if (existsSync(join(project, path))) {
        templates[
          `${name === "build-test-results" ? "test-results" : name}.md`
        ] = path;
        files.push(path);
      }
    }
    for (const p of files) fileInside(project, p);
    stages.push({
      slug: node.slug,
      file,
      produces:
        node.slug === "build-and-test"
          ? definition.produces.filter(
              (name: string) =>
                !(
                  [
                    "performance-test-instructions",
                    "security-test-instructions",
                  ].includes(name) && testStrategy !== "comprehensive"
                ) &&
                !(
                  name === "integration-test-instructions" &&
                  testStrategy === "minimal"
                ),
            )
          : definition.produces,
      produces_kinds: definition.produces_kinds,
      sensors: definition.sensors ?? [],
      roles,
      templates,
      files,
    });
  }
  if (
    !stages.some((s) => s.slug === "code-generation") ||
    !stages.some((s) => s.slug === "build-and-test")
  )
    throw new Error("CGとBuild and Testを含むConstructionが必要です");
  if (stages.some((s) => s.slug === "ci-pipeline") && !c.pipelinePaths?.length)
    throw new Error("CI工程には生成するpipelinePathsを指定してください");
  const artifacts = [
    ...new Set([
      ...c.artifacts,
      ...filesBelow(project, `${record}/inception`).filter((p) =>
        /\.(md|json)$/.test(p),
      ),
    ]),
  ];
  const cg: Record<string, CgContext> = {};
  for (const unit of dag.units) {
    const checks = c.unitChecks?.[unit.name] ?? c;
    for (const id of ["linter", "type-check"] as const)
      if (!checks.sensorScripts?.[id] && !checks.sensorExceptions?.[id]?.source)
        throw new Error(`${unit.name}: ${id}の設定がありません`);
    cg[unit.name] = collectCgContext(
      project,
      artifacts,
      unit.name,
      {
        build: checks.buildScript,
        test: checks.verifyScript,
        ...checks.sensorScripts,
      },
      hostHarness(c.hostHarness),
    );
  }
  return {
    record,
    testStrategy,
    order: dag.batches.flat(),
    units: dag.units,
    stages,
    skipped,
    cg,
    artifacts,
  };
}
export function phaseFiles(project: string, c: PhaseConfig, ctx: PhaseContext) {
  return snapshot(project, [
    ...Object.values(ctx.cg).flatMap((cg) => cg.files),
    ...ctx.stages.flatMap((s) => s.files),
    ...c.sources,
    ...workflowFiles(project, c.workflow),
    ...workflowFiles(project, c.stageWorkflow),
    c.phaseBuildScript,
    c.phaseVerifyScript,
    ...Object.values(c.stageSensorScripts ?? {}),
    ...Object.values(c.stageScenarios ?? {}),
    ...(c.mockScenario ? [c.mockScenario] : []),
    ...Object.values(c.unitChecks ?? {}).flatMap((u) => [
      u.buildScript,
      u.verifyScript,
      ...Object.values(u.sensorScripts ?? {}),
      ...(u.mockScenario ? [u.mockScenario] : []),
    ]),
  ]);
}

export function stageApplies(stage: StageDefinition, kind?: string) {
  return stage.produces.some(
    (name) =>
      !kind ||
      !stage.produces_kinds?.[name] ||
      stage.produces_kinds[name].includes(kind),
  );
}
