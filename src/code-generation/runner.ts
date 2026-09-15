import { spawn } from 'node:child_process';
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanEnvironment, command, digest, fileInside, readJson, requireSuccess, snapshot, unchanged, writeJson, type Snapshot } from '../handoff/io';
import { adaptation, collectCgContext, type CgContext } from './context';
import { prepareProvider } from '../handoff/provider';
import { sources } from './cg-gate';
import { hostHarness, harnessDirectory, delegationScope, type HostHarness } from '../hosts/harness';

export type CgConfig = {
  hostHarness?: HostHarness;
  enabled: boolean; handoffStage?: 'code-generation'; delegationScope?: 'code-generation'; provider: 'mock' | 'claude' | 'codex';
  artifacts: string[]; sources: string[]; workflow: string; buildScript: string; verifyScript: string;
  sensorScripts: Partial<Record<'linter' | 'type-check', string>>;
  sensorExceptions?: Partial<Record<'linter' | 'type-check', { reason: string; source: string }>>;
  timeoutMs: number; disableBedrock?: boolean; mockScenario?: string;
  model?: string; codexReasoningEffort?: string;
};
export type CgManifest = { id: string; config: CgConfig; configHash: string; files: Snapshot; cg: CgContext; statePath: string; entryHash: string };
export type CgStatus = { state: 'parked' | 'running' | 'verified' | 'failed' | 'blocked'; attempts: number; stateHash: string; workspace?: string; error?: string; result?: unknown };

export const cgStorage = (project: string) => join(project, 'aidlc/takt-handoff');
export function cgEnabled(project: string) {
  const p = join(cgStorage(project), 'config.json');
  if (!existsSync(p)) return false;
  const c = readJson<any>(p);
  return c.enabled === true && delegationScope(c) === 'code-generation';
}
export function loadConfig(project: string) {
  const configPath = fileInside(project, 'aidlc/takt-handoff/config.json');
  const c = readJson<CgConfig>(configPath);
  hostHarness(c.hostHarness);
  if (!c.enabled || delegationScope(c) !== 'code-generation' || !['claude', 'codex', 'mock'].includes(c.provider)) throw new Error('CG設定が無効です');
  if (!Number.isInteger(c.timeoutMs) || c.timeoutMs < 1000 || c.timeoutMs > 3600000) throw new Error('CGの時間上限は1秒〜1時間です');
  if (c.model !== undefined && (typeof c.model !== 'string' || !c.model.trim())) throw new Error('modelが不正です');
  if (c.codexReasoningEffort !== undefined && (c.provider !== 'codex' || typeof c.codexReasoningEffort !== 'string' || !c.codexReasoningEffort.trim())) throw new Error('codexReasoningEffortはCodex用の空でない文字列です');
  if (!Array.isArray(c.artifacts) || !c.artifacts.length || !Array.isArray(c.sources) || !c.sources.length) throw new Error('CGの入力とソースを指定してください');
  for (const p of c.sources) if (p.split('/').some(name => name === 'node_modules' || name === '.venv') || /^(?:node_modules|\.venv|\.git|\.claude|\.codex|\.agents|\.takt|aidlc|input|cg)(?:\/|$)/.test(p)) throw new Error(`制御領域をソースにできません: ${p}`);
  for (const key of ['workflow', 'buildScript', 'verifyScript'] as const) fileInside(project, c[key]);
  for (const id of ['linter', 'type-check'] as const) {
    if (c.sensorScripts?.[id]) fileInside(project, c.sensorScripts[id]!);
    else if (!c.sensorExceptions?.[id]?.reason || !c.sensorExceptions[id]?.source) throw new Error(`${id}の検査スクリプト、または根拠付きの適用外設定が必要です`);
  }
  return { c, configHash: digest(readFileSync(configPath)) };
}
export function isCgEntryCommand(text: string, project?: string) {
  const words: string[] = [];
  const token = /\s*(?:'([^']*)'|"([^"$`\\]*)"|([^\s'"\\;&|<>`$()]+))/y;
  let pos = 0;
  while (pos < text.trimEnd().length) {
    if (pos && !/\s/.test(text[pos])) return false;
    token.lastIndex = pos; const m = token.exec(text); if (!m) return false;
    words.push(m[1] ?? m[2] ?? m[3]); pos = token.lastIndex;
  }
  const projects = words.map((word, i) => word === '--project-dir' ? i : -1).filter(i => i >= 0);
  if (project && (projects.length > 1 || projects.some(i => words[i + 1] !== project))) return false;
  return words.slice(0, 3).join(' ') === 'aidlc engine orchestrate' && ['next', 'continue'].includes(words[3]) && (words[3] !== 'continue' || words.length >= 5);
}
export function cgEntryCommandIssue(text: string, project?: string) {
  return /^\s*aidlc engine orchestrate (?:next|continue)\b/.test(text) && !isCgEntryCommand(text, project)
    ? 'CG委譲ではnext/continueのJSON応答を使います。元のaidlcコマンドを単独で実行し、リダイレクト・echo・シェル連結は付けないでください。まだ実行されていません。'
    : null;
}

export async function prepareCg(project: string, directive: any) {
  if (directive?.kind !== 'run-stage' || directive.stage !== 'code-generation') return null;
  if (directive.single) throw new Error('単独runnerのAI-DLC状態はCG自動引き継ぎの対象外です');
  const { c, configHash } = loadConfig(project);
  const cg = collectCgContext(project, c.artifacts, typeof directive.unit === 'string' ? directive.unit : null, { build: c.buildScript, test: c.verifyScript, ...c.sensorScripts }, hostHarness(c.hostHarness));
  const statePath = join(project, cg.record, 'aidlc-state.md');
  const state = readFileSync(statePath, 'utf8');
  if (!/\*\*State Version\*\*:\s*8\b/.test(state) || !/\*\*Current Stage\*\*:\s*code-generation\b/.test(state) || !/\*\*Status\*\*:\s*Running\b/.test(state)) throw new Error('AI-DLC 2.8.2のCG入口ではありません');
  if (/\*\*Construction Autonomy Mode\*\*:\s*autonomous\b/.test(state)) throw new Error('AI-DLC自身の自律CGと同時には実行できません');
  const version = await command(['aidlc', '--version'], project, cleanEnvironment(), 10000);
  requireSuccess(version); if (!/^aidlc 2\.8\.2\b/.test(version.stdout)) throw new Error('aidlc 2.8.2が必要です');
  const files = snapshot(project, [...cg.files, ...c.sources, c.workflow, c.buildScript, c.verifyScript, ...Object.values(c.sensorScripts ?? {}), ...(c.mockScenario ? [c.mockScenario] : [])]);
  const lib = await import(pathToFileURL(fileInside(project, `${harnessDirectory(cg.hostHarness)}/tools/aidlc-lib.ts`)).href);
  const rows = lib.readAuditShardEvents(project);
  if (new Set(rows.map((row: any) => row.shard)).size !== 1) throw new Error('CG初版は単一の監査シャードのみ対応しています');
  const start = rows.findLast((row: any) => row.event === 'STAGE_STARTED' && lib.auditBlockField(row.block, 'Stage') === 'code-generation');
  if (!start) throw new Error('現在のCG開始記録がありません');
  const entryHash = digest(start.block.trim());
  const id = digest(JSON.stringify({ entryHash, unit: cg.unit, files, configHash })).slice(0, 24);
  const base = join(cgStorage(project), 'cg-runs'); mkdirSync(base, { recursive: true });
  const run = join(base, id); mkdirSync(run, { recursive: true });
  const lock = join(base, 'prepare.lock'); const fd = openSync(lock, 'wx'); closeSync(fd);
  try {
    if (existsSync(join(run, 'manifest.json'))) {
      const previous = readJson<CgStatus>(join(run, 'status.json'));
      if (previous.stateHash !== digest(readFileSync(statePath))) throw new Error('既存CG実行後にAI-DLC状態が変化しています');
      return { id, run, status: previous };
    }
    for (const path of Object.keys(files)) {
      const target = join(run, 'snapshot', path); mkdirSync(dirname(target), { recursive: true });
      copyFileSync(fileInside(project, path), target); chmodSync(target, 0o444);
    }
    writeJson(join(run, 'manifest.json'), { id, config: c, configHash, files, cg, statePath, entryHash } satisfies CgManifest);
    writeJson(join(run, 'directive.json'), directive);
    unchanged(project, files);
    const parked = await command(['aidlc', 'engine', 'orchestrate', 'park', '--project-dir', project], project, cleanEnvironment(), 10000);
    writeJson(join(run, 'park.json'), parked); requireSuccess(parked);
    if (JSON.parse(parked.stdout).kind !== 'parked') throw new Error('CGのparkが拒否されました');
    const status: CgStatus = { state: 'parked', attempts: 0, stateHash: digest(readFileSync(statePath)) };
    writeJson(join(run, 'status.json'), status);
    return { id, run, status };
  } catch (error) {
    if (existsSync(join(run, 'manifest.json')) && !existsSync(join(run, 'status.json'))) {
      writeJson(join(run, 'status.json'), { state: 'failed', attempts: 0, stateHash: digest(readFileSync(statePath)), error: String(error) } satisfies CgStatus);
    }
    throw error;
  } finally { unlinkSync(lock); }
}

export async function executeCg(project: string, id: string) {
  if (!/^[a-f0-9]{24}$/.test(id)) throw new Error('不正なCG run IDです');
  const run = join(cgStorage(project), 'cg-runs', id);
  const m = readJson<CgManifest>(join(run, 'manifest.json'));
  const statusPath = join(run, 'status.json');
  const status = readJson<CgStatus>(statusPath);
  if (status.state === 'verified') return status;
  if (status.state !== 'parked') throw new Error(`CGを開始できません: ${status.state}`);
  const lock = join(run, 'execute.lock'); const fd = openSync(lock, 'wx'); closeSync(fd);
  try {
    const verifyOriginal = () => {
      if (loadConfig(project).configHash !== m.configHash) throw new Error('CG設定が変化しました');
      unchanged(project, m.files); unchanged(join(run, 'snapshot'), m.files);
      if (digest(readFileSync(m.statePath)) !== status.stateHash) throw new Error('AI-DLC状態が変化しました');
    };
    verifyOriginal();
    status.state = 'running'; status.attempts++;
    const attempt = join(run, 'attempts', String(status.attempts));
    status.workspace = join(attempt, 'work'); writeJson(statusPath, status);
    const result = await executeCgWorkspace({ attempt, snapshotRoot: join(run, 'snapshot'), m, verifyOriginal });
    Object.assign(status, result);

  } catch (error) { status.state = 'failed'; status.error = String(error); }
  finally { unlinkSync(lock); }
  writeJson(statusPath, status); return status;
}

// ネイティブCG入口とConstruction内のCGが同じ実行・検証を使う。
export async function executeCgWorkspace({ attempt, snapshotRoot, m, verifyOriginal }: {
  attempt: string; snapshotRoot: string; m: Pick<CgManifest, 'config' | 'files' | 'cg'>; verifyOriginal: () => void;
}) {
    const workspace = join(attempt, 'work'), control = join(attempt, 'control');

    mkdirSync(control, { recursive: true }); mkdirSync(join(workspace, 'cg'), { recursive: true });
    const inputs: Snapshot = {};
    for (const path of m.config.sources) {
      const target = join(workspace, path); mkdirSync(dirname(target), { recursive: true });
      copyFileSync(fileInside(snapshotRoot, path), target); chmodSync(target, 0o644);
    }
    for (const path of m.cg.files) {
      const rel = `input/project/${path}`, target = join(workspace, rel);
      mkdirSync(dirname(target), { recursive: true }); copyFileSync(fileInside(snapshotRoot, path), target); chmodSync(target, 0o444); inputs[rel] = m.files[path];
    }
    writeJson(join(workspace, 'input/context.json'), m.cg);
    inputs['input/context.json'] = digest(readFileSync(join(workspace, 'input/context.json')));
    writeJson(join(workspace, 'input/manifest.json'), { stage: 'code-generation', mode: 'hotl', files: inputs, unit: m.cg.unit });
    inputs['input/manifest.json'] = digest(readFileSync(join(workspace, 'input/manifest.json')));
    const gate = join(control, 'cg-gate.ts'); copyFileSync(join(import.meta.dir, 'cg-gate.ts'), gate);
    const frozen = (path: string) => fileInside(snapshotRoot, path);
    const cgConfig = m.config;
    writeJson(join(control, 'context.json'), {
      workspace, inputs, cg: m.cg, initialSources: sources(workspace),
      buildScript: frozen(cgConfig.buildScript), buildHash: m.files[cgConfig.buildScript],
      verifyScript: frozen(cgConfig.verifyScript), verifyHash: m.files[cgConfig.verifyScript],
      sensorScripts: Object.fromEntries(Object.entries(cgConfig.sensorScripts ?? {}).map(([name, path]) => [name, { path: frozen(path), hash: m.files[path] }])),
      sensorExceptions: cgConfig.sensorExceptions ?? {},
    });
    const workflow = Bun.YAML.parse(readFileSync(frozen(cgConfig.workflow), 'utf8')) as any;
    const roleFor: Record<string, string> = { plan: 'plan', 'plan-review': 'review', implement: 'implement', fix: 'implement', 'code-review': 'review', finish: 'report' };
    const injection: Record<string, unknown> = {};
    const bundleFiles: string[] = [];
    workflow.instructions ??= {};
    for (const [role, rolePaths] of Object.entries(m.cg.roles)) {
      const paths = [...new Set(rolePaths)];
      const originals = paths.map(path => `\n## Original source: ${path}\nCopy: input/project/${path}\nSHA256: ${m.files[path]}\n\n${readFileSync(frozen(path), 'utf8')}`).join('\n');
      const content = `${adaptation}\n${originals}\n## Frozen Testing Contract\n${m.cg.testingContractText}\n${adaptation}`;
      const bundle = `context/${role}.md`; mkdirSync(join(control, 'context'), { recursive: true });
      writeFileSync(join(control, bundle), content); bundleFiles.push(bundle);
      workflow.instructions[`cg-source-${role}`] = bundle;
    }
    for (const step of workflow.steps) {
      const role = roleFor[step.name]; if (!role) throw new Error(`CG外の工程: ${step.name}`);
      const paths = [...new Set(m.cg.roles[role])];
      step.instruction = [`cg-source-${role}`, adaptation, step.instruction];
      injection[step.name] = { sources: paths.map(path => ({ path, sha256: m.files[path] })), sourceBundleHash: digest(readFileSync(join(control, `context/${role}.md`))) };
    }
    writeFileSync(join(control, 'workflow.yaml'), Bun.YAML.stringify(workflow));
    writeJson(join(control, 'injection.json'), injection);
    const protectedControl = snapshot(control, ['cg-gate.ts', 'context.json', 'workflow.yaml', 'injection.json', ...bundleFiles]);
    const env = prepareProvider(attempt, cgConfig, cgConfig.mockScenario ? frozen(cgConfig.mockScenario) : undefined);
    writeJson(join(workspace, '.claude/settings.json'), { permissions: { deny: ['Edit(input/**)', 'Write(input/**)', 'Edit(.claude/**)', 'Write(.claude/**)', 'Edit(.kiro/**)', 'Write(.kiro/**)'] } });
    const ignore = join(workspace, '.gitignore');
    writeFileSync(ignore, `${existsSync(ignore) ? readFileSync(ignore, 'utf8') : ''}\n.claude/\n.takt/\ncg/\n`);
    // .gitignoreも初期ソースの基準へ含める。
    const ctx = readJson<any>(join(control, 'context.json')); ctx.initialSources = sources(workspace); writeJson(join(control, 'context.json'), ctx);
    protectedControl['context.json'] = digest(readFileSync(join(control, 'context.json')));
    for (const args of [['init', '-q'], ['config', 'core.hooksPath', '/dev/null'], ['add', '.'], ['-c', 'user.name=TAKT CG', '-c', 'user.email=cg@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'chore: seed CG workspace']]) requireSuccess(await command(['git', ...args], workspace, env, 10000));
    const result = await command(['takt', '--pipeline', '--skip-git', '--provider', cgConfig.provider, '--workflow', join(control, 'workflow.yaml'), '--task', 'AI-DLCのCG単体をHOTLで実行。inputのIntent・設計と、注入された本家CG/知識/センサー定義に従い、ビルド・テスト成功まで完了しないこと。'], workspace, env, cgConfig.timeoutMs);
    writeJson(join(attempt, 'takt.json'), result);
    verifyOriginal(); unchanged(workspace, inputs); unchanged(control, protectedControl);
    const evidence = await command([process.execPath, gate, 'result'], workspace, env, 10000); writeJson(join(attempt, 'cg-result.json'), evidence);
    if (evidence.code === 0) {
      const result = JSON.parse(evidence.stdout);
      if (result.state === 'blocked') return { state: 'blocked' as const, workspace, result };
    }
    requireSuccess(result); requireSuccess(evidence);
    // 最終レビュー後にも同じコードを再ビルド・再テストする。
    for (const [name, script] of [['build', cgConfig.buildScript], ['test', cgConfig.verifyScript]]) {
      const check = await command([process.execPath, frozen(script)], workspace, env, 60000);
      writeJson(join(attempt, `final-${name}.json`), check); requireSuccess(check);
    }
    verifyOriginal(); unchanged(workspace, inputs); unchanged(control, protectedControl);
    requireSuccess(await command([process.execPath, gate, 'result'], workspace, env, 10000));
    return { state: 'verified' as const, workspace, result: JSON.parse(evidence.stdout) };
}

export function spawnCg(project: string, id: string, run: string, cli: string) {
  const log = openSync(join(run, 'worker.log'), 'a', 0o600);
  const child = spawn(process.execPath, [cli, 'cg-work', project, id], { cwd: project, env: cleanEnvironment(), detached: true, stdio: ['ignore', log, log] });
  child.on('error', error => console.error(error.message)); child.unref(); closeSync(log);
}
