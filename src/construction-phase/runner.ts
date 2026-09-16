import { executeConstructionSupervision } from './supervision';
import type { HookEvent } from '../hosts/events';
import { seedTraceProject, resolveTraceIds } from "./native-trace";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import {
  approvalCommand,
  approvalCommandIssue,
  approvedBoundary,
} from "../handoff/approval";
import {
  cleanEnvironment,
  command,
  digest,
  fileInside,
  readJson,
  requireSuccess,
  unchanged,
  writeJson,
  type Snapshot,
} from "../handoff/io";
import { executeCgWorkspace, type CgConfig } from "../code-generation/runner";
import { sources } from "../code-generation/code-generation-gate";
import { hostHarness } from "../hosts/harness";
import {
  stageApplies,
  phaseConfig,
  phaseContext,
  phaseEnabled,
  phaseFiles,
  phaseStorage,
  type PhaseConfig,
  type PhaseContext,
} from "./context";
import { executeStage } from "./stage";

type Pending = { configHash: string; files: Snapshot; context: PhaseContext };
type Manifest = Pending & {
  id: string;
  config: PhaseConfig;
  record: string;
  approval: string;
  statePath: string;
};
export type PhaseStatus = {
  state: "parked" | "running" | "verified" | "blocked" | "failed";
  attempts: number;
  stateHash: string;
  workspace?: string;
  reason?: string;
  steps?: {
    unit: string | null;
    stage: string;
    state: string;
    attempt: string;
  }[];
};
function pendingPath(project: string, event: HookEvent) {
  if (!event.session_id || !event.tool_use_id || event.cwd !== project)
    throw new Error("Constructionイベントの識別子または作業領域が不正です");
  return join(
    phaseStorage(project),
    "phase-pending",
    digest(event.session_id + ":" + event.tool_use_id) + ".json",
  );
}
export async function capturePhase(project: string, event: HookEvent) {
  if (!phaseEnabled(project)) return false;
  const issue = approvalCommandIssue(event.tool_input.command ?? "", project);
  if (issue) throw new Error(issue);
  if (!approvalCommand(event.tool_input.command ?? "", project)) return false;
  const version = await command(
    ["aidlc", "--version"],
    project,
    cleanEnvironment(),
    10000,
  );
  requireSuccess(version);
  if (!/^aidlc 2\.8\.2\b/.test(version.stdout))
    throw new Error("aidlc 2.8.2が必要です");
  const { c, configHash } = phaseConfig(project);
  const context = await phaseContext(project, c);
  const files = phaseFiles(project, c, context);
  writeJson(pendingPath(project, event), {
    configHash,
    files,
    context,
  } satisfies Pending);
  return true;
}
export async function preparePhase(project: string, event: HookEvent) {
  if (
    !phaseEnabled(project) ||
    !approvalCommand(event.tool_input.command ?? "", project)
  )
    return null;
  if (event.tool_response?.interrupted)
    throw new Error("承認コマンドが中断しました");
  const directive = JSON.parse(event.tool_response?.stdout ?? "{}");
  if (
    !["done", "run-stage", "load-steering", "parked"].includes(directive.kind)
  )
    throw new Error("Inceptionの承認処理が成功していません");
  const pending = readJson<Pending>(pendingPath(project, event));
  const { c, configHash } = phaseConfig(project);
  if (configHash !== pending.configHash)
    throw new Error("承認中にConstruction設定が変化しました");
  unchanged(project, pending.files);
  const boundary = await approvedBoundary(project, hostHarness(c.hostHarness));
  const id = digest(
    `${boundary.record}:${boundary.approval}:construction`,
  ).slice(0, 24);
  const base = join(phaseStorage(project), "construction-phase-runs"),
    run = join(base, id);
  mkdirSync(run, { recursive: true });
  const lock = join(base, "prepare.lock");
  closeSync(openSync(lock, "wx"));
  try {
    if (existsSync(join(run, "manifest.json"))) {
      const m = readJson<Manifest>(join(run, "manifest.json")),
        status = readJson<PhaseStatus>(join(run, "status.json"));
      if (
        m.configHash !== configHash ||
        JSON.stringify(m.files) !== JSON.stringify(pending.files) ||
        status.stateHash !== digest(readFileSync(boundary.statePath))
      )
        throw new Error("同じ承認に対するConstruction入力・状態が変化しました");
      return { id, run, status };
    }
    for (const p of Object.keys(pending.files)) {
      const out = join(run, "snapshot", p);
      mkdirSync(dirname(out), { recursive: true });
      copyFileSync(fileInside(project, p), out);
      chmodSync(out, 0o444);
    }
    writeJson(join(run, "manifest.json"), {
      ...pending,
      ...boundary,
      id,
      config: c,
    } satisfies Manifest);
    const parked = await command(
      ["aidlc", "engine", "orchestrate", "park", "--project-dir", project],
      project,
      cleanEnvironment(),
      10000,
    );
    writeJson(join(run, "park.json"), parked);
    requireSuccess(parked);
    if (JSON.parse(parked.stdout).kind !== "parked")
      throw new Error("Constructionのparkが拒否されました");
    const status: PhaseStatus = {
      state: "parked",
      attempts: 0,
      stateHash: digest(readFileSync(boundary.statePath)),
    };
    writeJson(join(run, "status.json"), status);
    return { id, run, status };
  } catch (e) {
    if (!existsSync(join(run, "status.json")))
      writeJson(join(run, "status.json"), {
        state: "failed",
        attempts: 0,
        stateHash: digest(readFileSync(boundary.statePath)),
        reason: String(e),
      });
    throw e;
  } finally {
    unlinkSync(lock);
  }
}
export async function executePhase(project: string, id: string) {
  if (!/^[a-f0-9]{24}$/.test(id))
    throw new Error("Construction run IDが不正です");
  const run = join(phaseStorage(project), "construction-phase-runs", id),
    statusPath = join(run, "status.json");
  const lock = join(run, "execute.lock");
  closeSync(openSync(lock, "wx"));
  try {
    const m = readJson<Manifest>(join(run, "manifest.json")),
      status = readJson<PhaseStatus>(statusPath);
    if (status.state === "verified") return status;
    if (status.state !== "parked")
      throw new Error(`Constructionを開始できません: ${status.state}`);
    const deadline = Date.now() + m.config.timeoutMs;
    const remaining = () => {
      const n = deadline - Date.now();
      if (n <= 0) throw new Error("Constructionの時間上限に到達しました");
      return n;
    };
    const base = join(run, "attempts", "1"),
      store = join(base, "store");
    mkdirSync(store, { recursive: true });
    const files: Snapshot = { ...m.files };
    const verify = () => {
      remaining();
      if (phaseConfig(project).configHash !== m.configHash)
        throw new Error("Construction設定が変化しました");
      unchanged(project, m.files);
      unchanged(join(run, "snapshot"), m.files);
      unchanged(store, files);
      if (digest(readFileSync(m.statePath)) !== status.stateHash)
        throw new Error("元のAI-DLC状態が変化しました");
    };
    try {
      for (const p of Object.keys(files)) {
        const out = join(store, p);
        mkdirSync(dirname(out), { recursive: true });
        copyFileSync(fileInside(join(run, "snapshot"), p), out);
      }
      const metadata = seedTraceProject(
        store,
        m.record,
        readFileSync(m.statePath, "utf8"),
      );
      for (const p of metadata) files[p] = digest(readFileSync(join(store, p)));
      verify();
      status.state = "running";
      status.attempts = 1;
      status.steps = [];
      writeJson(statusPath, status);
      let sourcePaths = [...m.config.sources],
        artifacts = [...m.context.artifacts];
      const publish = (root: string, p: string, target: string) => {
        const out = join(store, target);
        mkdirSync(dirname(out), { recursive: true });
        if (existsSync(out)) chmodSync(out, 0o644);
        copyFileSync(fileInside(root, p), out);
        chmodSync(out, 0o444);
        files[target] = digest(readFileSync(out));
      };
      let repairRequest:
        | { unit: string; reason: string; checks: unknown }
        | undefined;
      const stageRun = async (
        stage: PhaseContext["stages"][number],
        unit: string | null,
        repaired = false,
      ) => {
        const key = unit ?? "all",
          attempt = join(
            base,
            `${status.steps!.length + 1}-${key}-${stage.slug}`,
          );
        const cg = unit
          ? m.context.cg[unit]
          : {
              ...m.context.cg[m.context.order[0]],
              unit: null,
              requirementIds: [
                ...new Set(
                  Object.values(m.context.cg).flatMap(
                    (cg) => cg.requirementIds,
                  ),
                ),
              ],
            };
        const result = await executeStage({
          attempt,
          store,
          files,
          sourcePaths,
          artifacts,
          stage,
          unit,
          kind: m.context.units.find((u) => u.name === unit)?.kind,
          cg,
          c: m.config,
          verify,
          timeout: remaining(),
          units: m.context.order,
          repaired,
        });
        status.steps!.push({
          unit,
          stage: stage.slug,
          state: result.state,
          attempt,
        });
        writeJson(statusPath, status);
        if (result.state === "repair_required") {
          repairRequest = result;
          return false;
        }
        if (result.state === "blocked") {
          status.state = "blocked";
          status.reason = result.reason;
          return false;
        }
        for (const name of Object.keys(result.artifacts)) {
          const target = `${m.record}/construction/${unit ? unit + "/" : ""}${stage.slug}/${name}`;
          publish(result.artifactDir, name, target);
          if (!artifacts.includes(target)) artifacts.push(target);
        }
        for (const p of result.writes) {
          publish(result.workspace, p, p);
          if (!sourcePaths.includes(p)) sourcePaths.push(p);
        }
        return true;
      };
      const cgRun = async (unit: string, repair?: 'build' | 'supervise') => {
        const attempt = join(
          base,
          `${status.steps!.length + 1}-${unit}-code-generation`,
        );
        const nativeCg = m.context.cg[unit],
          cg = {
            ...nativeCg,
            requirementIds: resolveTraceIds(
              store,
              m.record,
              unit,
              "code-generation",
            ),
            files: [
              ...new Set([
                ...nativeCg.files,
                ...artifacts,
                m.config.phaseBuildScript,
                m.config.phaseVerifyScript,
              ]),
            ],
            roles: Object.fromEntries(
              Object.entries(nativeCg.roles).map(([role, paths]) => [
                role,
                [
                  ...new Set([
                    ...paths,
                    ...artifacts,
                    m.config.phaseBuildScript,
                    m.config.phaseVerifyScript,
                  ]),
                ],
              ]),
            ),
          };
        const check = m.config.unitChecks?.[unit] ?? m.config;
        const repairScenario = repair
          ? m.config.stageScenarios?.[`${unit}/code-generation-${repair === 'supervise' ? 'supervision-' : ''}repair`]
          : undefined;
        const config: CgConfig = {
          ...m.config,
          ...check,
          delegationScope: "code-generation",
          sources: sourcePaths,
          timeoutMs: remaining(),
          ...(repairScenario ? { mockScenario: repairScenario } : {}),
        };
        const result = await executeCgWorkspace({
          attempt,
          snapshotRoot: store,
          m: { config, files, cg },
          verifyOriginal: verify,
        });
        status.steps!.push({
          unit,
          stage: "code-generation",
          state: result.state,
          attempt,
        });
        status.workspace = result.workspace;
        if (result.state === "blocked") {
          status.state = "blocked";
          status.reason = result.result.reason;
          writeJson(statusPath, status);
          return false;
        }
        const next = sources(result.workspace);
        for (const p of sourcePaths)
          if (!(p in next)) {
            delete files[p];
            unlinkSync(join(store, p));
          }
        for (const p of Object.keys(next)) publish(result.workspace, p, p);
        sourcePaths = Object.keys(next);
        for (const name of [
          "code-generation-plan.md",
          "unit-test-instructions.md",
          "code-summary.md",
          "supervision.json",
          "traceability.json",
          "source-manifest.json",
          "sensors.json",
          "build.json",
          "test.json",
        ]) {
          const target = `${m.record}/construction/${unit}/code-generation/${name}`;
          publish(result.workspace, `cg/${name}`, target);
          if (!artifacts.includes(target)) artifacts.push(target);
        }
        writeJson(statusPath, status);
        return true;
      };
      for (const unit of m.context.order) {
        for (const stage of m.context.stages
          .filter(
            (s) =>
              !["code-generation", "build-and-test", "ci-pipeline"].includes(
                s.slug,
              ),
          )
          .filter((s) =>
            stageApplies(s, m.context.units.find((u) => u.name === unit)?.kind),
          ))
          if (!(await stageRun(stage, unit))) {
            writeJson(statusPath, status);
            return status;
          }
        if (!(await cgRun(unit))) {
          writeJson(statusPath, status);
          return status;
        }
      }
      let buildRepairUsed = false;
      const runGlobalStages = async (afterSupervision = false) => {
        for (const stage of m.context.stages.filter((s) =>
          ["build-and-test", "ci-pipeline"].includes(s.slug),
        )) {
          if (!(await stageRun(stage, null, afterSupervision))) {
            if (!repairRequest) {
              writeJson(statusPath, status);
              return false;
            }
            if (buildRepairUsed) throw new Error("全体検証からのCG修正上限に到達しました");
            buildRepairUsed = true;
            const request = repairRequest;
            repairRequest = undefined;
            const path = `${m.record}/construction/build-and-test/repair-request.json`;
            writeJson(join(store, path), request);
            files[path] = digest(readFileSync(join(store, path)));
            artifacts.push(path);
            if (!(await cgRun(request.unit, 'build'))) {
              writeJson(statusPath, status);
              return false;
            }
            if (!(await stageRun(stage, null, true))) {
              if (repairRequest)
                throw new Error("全体検証からのCG修正上限に到達しました");
              writeJson(statusPath, status);
              return false;
            }
          }
        }
        return true;
      };
      if (!(await runGlobalStages())) { writeJson(statusPath, status); return status; }
      let supervisedSourceHash: string | undefined;
      for (let round = 0; round < 2; round++) {
        const attempt = join(base, `${status.steps!.length + 1}-all-supervise`);
        const result = await executeConstructionSupervision({
          attempt, store, files, sourcePaths, units: m.context.order, config: m.config,
          repaired: round > 0, timeout: remaining(), verify,
          requirementIds: [...new Set(m.context.order.flatMap(unit => resolveTraceIds(store, m.record, unit, 'code-generation')))],
          inputPaths: [...new Set([
            ...m.context.artifacts,
            ...Object.values(m.context.cg).flatMap(cg => [cg.intentFile, ...cg.files.filter(path => /\/memory\/.*\.md$/.test(path))]),
            ...artifacts.filter(path => !/\/(?:build|test|sensors)\.json$|\/test-results\.md$/.test(path)),
          ])],
        });
        status.steps!.push({ unit: null, stage: 'supervise', state: result.verdict, attempt });
        status.workspace = result.workspace;
        writeJson(statusPath, status);
        if (result.verdict === 'blocked') {
          status.state = 'blocked'; status.reason = result.reason;
          writeJson(statusPath, status); return status;
        }
        if (result.verdict === 'approved') { supervisedSourceHash = result.sourceHash; break; }
        if (round === 1) throw new Error('Constructionのsupervise修正上限に到達しました');
        const path = `${m.record}/construction/supervision/repair-request.json`;
        writeJson(join(store, path), result);
        files[path] = digest(readFileSync(join(store, path))); artifacts.push(path);
        for (const unit of m.context.order.filter(unit => result.repairUnits.includes(unit))) {
          if (!(await cgRun(unit, 'supervise'))) { writeJson(statusPath, status); return status; }
        }
        if (!(await runGlobalStages(true))) { writeJson(statusPath, status); return status; }
      }
      const workspace = join(base, "result");
      mkdirSync(workspace, { recursive: true });
      for (const p of sourcePaths) {
        const out = join(workspace, p);
        mkdirSync(dirname(out), { recursive: true });
        copyFileSync(fileInside(store, p), out);
      }
      const finalBefore = sources(workspace);
      if (digest(JSON.stringify(finalBefore)) !== supervisedSourceHash) throw new Error("supervise対象と最終コードが不一致です");
      const unitChecks: Record<string, unknown> = {};
      for (const unit of m.context.order) {
        const check = m.config.unitChecks?.[unit] ?? m.config;
        const checks: Record<string, unknown> = {};
        for (const [name, p] of [
          ["build", check.buildScript],
          ["test", check.verifyScript],
          ...Object.entries(check.sensorScripts ?? {}),
        ]) {
          const r = await command(
            [process.execPath, fileInside(store, p)],
            workspace,
            cleanEnvironment(),
            Math.min(60000, remaining()),
          );
          checks[name] = r;
          unitChecks[unit] = checks;
          writeJson(join(base, "final-unit-checks.json"), unitChecks);
          requireSuccess(r);
          if (name === "linter" || name === "type-check")
            if (JSON.parse(r.stdout).pass !== true)
              throw new Error(`${unit}: 最終${name}が不合格です`);
        }
      }

      for (const [name, p] of [
        ["build", m.config.phaseBuildScript],
        ["test", m.config.phaseVerifyScript],
      ]) {
        const r = await command(
          [process.execPath, fileInside(store, p)],
          workspace,
          cleanEnvironment(),
          Math.min(60000, remaining()),
        );
        writeJson(join(base, `final-${name}.json`), r);
        requireSuccess(r);
      }
      if (JSON.stringify(sources(workspace)) !== JSON.stringify(finalBefore))
        throw new Error("最終検証中にソースが変化しました");
      verify();
      status.state = "verified";
      status.workspace = workspace;
      writeJson(join(base, "result.json"), {
        scope: "construction",
        mode: "hotl",
        units: m.context.order,
        skipped: m.context.skipped,
        steps: status.steps,
        sourceHashes: finalBefore,
        artifacts: Object.fromEntries(artifacts.map((p) => [p, files[p]])),
      });
    } catch (e) {
      status.state = "failed";
      status.reason = String(e);
    }
    writeJson(statusPath, status);
    return status;
  } finally {
    unlinkSync(lock);
  }
}
export function spawnPhase(
  project: string,
  id: string,
  run: string,
  cli: string,
) {
  const log = openSync(join(run, "worker.log"), "a", 0o600);
  const child = spawn(process.execPath, [cli, "phase-work", project, id], {
    cwd: project,
    env: cleanEnvironment(),
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.on("error", (e) => console.error(e.message));
  child.unref();
  closeSync(log);
}
