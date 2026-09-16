import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanEnvironment, command, digest, fileInside, quote, readJson, requireSuccess, snapshot, unchanged, withoutBedrock, writeJson, type Snapshot } from './io';
import { harnessDirectory, type HostHarness } from '../hosts/harness';
import { prepareConstruction } from '../construction/runtime';
import { workflowFiles } from '../takt/workflow';

export type Config = {
  enabled: true; artifacts: string[]; sources: string[]; workflow: string;
  verifyScript: string; provider: 'mock' | 'claude'; timeoutMs: number;
  mockScenario?: string;
  disableBedrock?: boolean;
  construction?: boolean;
};
export type HookEvent = { hook_event_name: string; session_id: string; tool_use_id: string; cwd: string; tool_name: string; tool_input: { command?: string }; tool_response?: { stdout?: string; interrupted?: boolean } };
type Pending = { configHash: string; files: Snapshot };
type Manifest = Pending & { id: string; record: string; approval: string; config: Config };
export type Status = { state: 'prepared' | 'parked' | 'running' | 'verified' | 'failed' | 'needs_input'; attempts: number; pid?: number; error?: string; workspace?: string; parkStateHash?: string; construction?: { state: string; reportsDir?: string; questions?: unknown[] } };

// AI-DLCのソース識別から除外される管理領域に独立した名前空間を置く。
// 先行PoCの保存先も読めるが、二重設定は曖昧なので拒否する。
export function storage(project: string) {
  const native = join(project, 'aidlc/takt-handoff');
  const legacy = join(project, '.takt-aidlc');
  if (existsSync(join(native, 'config.json')) && existsSync(join(legacy, 'config.json'))) throw new Error('連携設定の保存先が重複しています');
  return existsSync(join(native, 'config.json')) ? native : legacy;
}

export function handoffEnabled(project: string) {
  const path = join(storage(project), 'config.json');
  return existsSync(path) && readJson<{ enabled?: unknown }>(fileInside(project, relative(project, path))).enabled === true;
}

export function configuration(project: string) {
  const path = fileInside(project, relative(project, join(storage(project), 'config.json')));
  const c = readJson<Config>(path);
  if (c.enabled !== true || !['mock', 'claude'].includes(c.provider) || !Number.isInteger(c.timeoutMs) || c.timeoutMs < 1000 || c.timeoutMs > (c.construction === true ? 3600000 : 300000)) throw new Error('未対応または無効な設定です');
  if (c.disableBedrock !== undefined && typeof c.disableBedrock !== 'boolean') throw new Error('disableBedrockはbooleanで指定してください');
  if (c.construction !== undefined && typeof c.construction !== 'boolean') throw new Error('constructionはbooleanで指定してください');
  for (const paths of [c.artifacts, c.sources]) if (!Array.isArray(paths) || !paths.length || paths.some(p => typeof p !== 'string')) throw new Error('入力ファイル一覧が必要です');
  if (typeof c.verifyScript !== 'string' || !c.verifyScript) throw new Error('独立した検証スクリプトが必要です');
  for (const path of c.sources) if (/^(?:\.git|\.claude|\.codex|\.agents|\.takt|\.takt-aidlc|aidlc|input)(?:\/|$)/.test(path)) throw new Error(`制御設定をソースとしてコピーできません: ${path}`);
  if (c.construction && c.sources.some(path => /^(?:construction|coverage|\.handoff-coverage-[^/]+)(?:\/|$)/.test(path))) throw new Error('Constructionの出力先をソースとして指定できません');
  const paths = [...c.artifacts, ...c.sources, ...workflowFiles(project, c.workflow), c.verifyScript, ...(c.mockScenario ? [c.mockScenario] : [])];
  const files = snapshot(project, paths);
  return { c, files, configHash: digest(readFileSync(path)) };
}

// シェルの展開・連結・リダイレクトを認めず、単一の承認コマンドだけを扱う。
export function approvalCommand(commandText: string, project: string) {
  const tokens: string[] = [];
  let offset = 0;
  const token = /\s*(?:'([^']*)'|"([^"$`\\]*)"|([^\s'"\\;&|<>`$()]+))/y;
  while (offset < commandText.trimEnd().length) {
    if (offset > 0 && !/\s/.test(commandText[offset])) return false;
    token.lastIndex = offset;
    const match = token.exec(commandText);
    if (!match) return false;
    tokens.push(match[1] ?? match[2] ?? match[3]); offset = token.lastIndex;
  }
  let args: string[];
  if (tokens.slice(0, 4).join(' ') === 'aidlc engine orchestrate report') args = tokens.slice(4);
  else if (['bun', process.execPath].includes(tokens[0]) && ['.claude/tools/aidlc-orchestrate.ts', join(project, '.claude/tools/aidlc-orchestrate.ts')].includes(tokens[1]) && tokens[2] === 'report') args = tokens.slice(3);
  else if (['bun', process.execPath].includes(tokens[0]) && ['.claude/tools/aidlc.ts', join(project, '.claude/tools/aidlc.ts')].includes(tokens[1]) && tokens.slice(2, 5).join(' ') === 'engine orchestrate report') args = tokens.slice(5);
  else return false;
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--stage', '--result', '--user-input', '--project-dir'].includes(args[i]) || args[i + 1] === undefined || flags.has(args[i])) return false;
    flags.set(args[i], args[i + 1]);
  }
  if (flags.has('--project-dir') && flags.get('--project-dir') !== project) return false;
  return flags.get('--stage') === 'delivery-planning' && flags.get('--result') === 'approved';
}

// 実行許可の判定には使わない。承認らしい複合コマンドを黙って通過させないための検出。
export function approvalCommandIssue(commandText: string, project: string) {
  if (approvalCommand(commandText, project)) return null;
  // 認識済みの承認に構文が追加された場合だけを扱う。他プロジェクトや--singleは対象外。
  const hasApproval = commandText.split(/[;&|\n]/).some(part =>
    approvalCommand(part.replace(/\s+\d*[<>][\s\S]*$/, '').trim(), project));
  if (!hasApproval) return null;
  return 'TAKT連携の最終承認は、aidlc engine orchestrate report --stage delivery-planning --result approved --user-input "Approve" の単一コマンドで実行してください。リダイレクト・echo・連結コマンド・追加オプションは付けないでください。この要求はまだ実行されていません。同じ承認に基づいてコマンド形式を直し、再実行してください。';
}
async function engineLibrary(project: string, host: HostHarness = 'claude') {
  const version = await import(pathToFileURL(fileInside(project, `${harnessDirectory(host)}/tools/aidlc-version.ts`)).href);
  if (version.AIDLC_VERSION !== '2.8.2') throw new Error('このPoCはAI-DLC v2.8.2専用です');
  return import(pathToFileURL(fileInside(project, `${harnessDirectory(host)}/tools/aidlc-lib.ts`)).href);
}
export async function approvedBoundary(project: string, host: HostHarness = 'claude') {
  const lib = await engineLibrary(project, host);
  const statePath = lib.stateFilePath(project);
  const state = readFileSync(statePath, 'utf8');
  if (lib.getField(state, 'State Version') !== '8') throw new Error('AI-DLC v2.8.2のState Version 8だけに対応しています');
  if (lib.getField(state, 'Status') !== 'Running') throw new Error('実行中のIntentだけを引き継げます');
  const checks = lib.parseCheckboxes(state);
  const graph = lib.loadStageGraph();
  const inception = graph.filter((s: any) => s.phase === 'inception');
  if (!inception.length || inception.some((s: any) => !checks.some((c: any) => c.slug === s.slug && ['completed', 'skipped'].includes(c.state)))) throw new Error('Inceptionに未完了または未記録の工程があります');
  if (!checks.some((c: any) => c.slug === 'delivery-planning' && c.state === 'completed')) throw new Error('Delivery Planningの完了が必要です');
  const construction = new Set(graph.filter((s: any) => s.phase === 'construction').map((s: any) => s.slug));
  if (checks.some((c: any) => construction.has(c.slug) && ['completed', 'awaiting-approval', 'revising'].includes(c.state))) throw new Error('Constructionの作業が既に進んでいます');
  const current = lib.getField(state, 'Current Stage');
  if (!graph.some((s: any) => s.slug === current && s.phase === 'construction')) throw new Error('Construction開始前の境界ではありません');
  if (lib.getField(state, 'Construction Autonomy Mode') === 'autonomous') throw new Error('AI-DLCの自律Constructionは引き継げません');
  const rows = lib.readAuditShardEvents(project);
  // 複数担当者の監査記録の因果順序はこのPoCでは推定しない。
  if (!rows.length) throw new Error('現在のDelivery Planningに対応する承認・完了記録がありません');
  if (new Set(rows.map((r: any) => r.shard)).size !== 1) throw new Error('単一監査シャードのIntentだけに対応しています');
  const relevant = rows.filter((r: any) => r.event === 'WORKFLOW_STARTED' || lib.auditBlockField(r.block, 'Stage') === 'delivery-planning');
  const completed = relevant.findLast((r: any) => r.event === 'STAGE_COMPLETED');
  const approval = relevant.findLast((r: any) => ['WORKFLOW_STARTED', 'GATE_APPROVED', 'GATE_REJECTED', 'STAGE_JUMPED', 'STAGE_STARTED'].includes(r.event));
  if (!approval || approval.event !== 'GATE_APPROVED' || !completed || completed.pos <= approval.pos) throw new Error('現在のDelivery Planningに対応する承認・完了記録がありません');
  return { statePath, record: relative(project, dirname(statePath)), approval: digest(approval.block), current };
}
function pendingPath(project: string, e: HookEvent) {
  if (!e.session_id || !e.tool_use_id) throw new Error('session_idとtool_use_idが必要です');
  if (realpathSync(e.cwd) !== realpathSync(project)) throw new Error('イベントの作業領域が一致しません');
  return join(storage(project), 'pending', digest(e.session_id + ':' + e.tool_use_id) + '.json');
}
function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, 'wx', 0o600);
  writeFileSync(fd, String(process.pid)); closeSync(fd);
  return fn().finally(() => unlinkSync(path));
}
export function captureApproval(project: string, e: HookEvent) {
  if (!handoffEnabled(project)) return false;
  const issue = approvalCommandIssue(e.tool_input.command ?? '', project);
  if (issue) throw new Error(issue);
  if (!approvalCommand(e.tool_input.command ?? '', project)) return false;
  const { files, configHash } = configuration(project);
  writeJson(pendingPath(project, e), { files, configHash });
  return true;
}
export async function prepareHandoff(project: string, e: HookEvent) {
  if (!approvalCommand(e.tool_input.command ?? '', project) || !handoffEnabled(project)) return null;
  const response = e.tool_response;
  if (response?.interrupted || typeof response?.stdout !== 'string') throw new Error('承認コマンドのstdoutがありません');
  const directive = JSON.parse(response.stdout);
  // native reportは承認を記録した後、次工程を実行せずdoneを返す。
  // 応答だけでは信用せず、以下で状態・監査記録・固定入力も照合する。
  if (!['done', 'run-stage', 'load-steering', 'parked'].includes(directive.kind)) throw new Error(`承認処理が成功していません: ${directive.kind}`);
  const pending = readJson<Pending>(pendingPath(project, e));
  return withLock(join(storage(project), 'prepare.lock'), async () => {
    const { c, configHash } = configuration(project);
    if (configHash !== pending.configHash) throw new Error('承認中に連携設定が変化しました');
    unchanged(project, pending.files);
    const boundary = await approvedBoundary(project);
    if (c.artifacts.some(p => !p.startsWith(boundary.record + '/inception/'))) throw new Error('成果物は現在のIntentのInception内に限定してください');
    const id = digest(boundary.record + ':' + boundary.approval).slice(0, 24);
    const run = join(storage(project), 'runs', id);
    const manifestPath = join(run, 'manifest.json');
    if (existsSync(manifestPath)) {
      const previous = readJson<Manifest>(manifestPath);
      if (previous.configHash !== configHash || JSON.stringify(previous.files) !== JSON.stringify(pending.files)) throw new Error('同じ承認に対する依頼内容が変わっています');
    } else {
      mkdirSync(run, { recursive: true });
      for (const path of Object.keys(pending.files)) {
        const target = join(run, 'snapshot', path);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(fileInside(project, path), target); chmodSync(target, 0o444);
      }
      unchanged(join(run, 'snapshot'), pending.files);
      writeJson(manifestPath, { ...pending, ...boundary, id, config: c });
      writeJson(join(run, 'status.json'), { state: 'prepared', attempts: 0 });
    }
    const status = readJson<Status>(join(run, 'status.json'));
    if (status.state === 'prepared') {
      const env = { ...cleanEnvironment(), AIDLC_PROJECT_DIR: project, CLAUDE_PROJECT_DIR: project };
      const version = await command(['aidlc', '--version'], project, env, 10000);
      requireSuccess(version);
      if (!/^aidlc 2\.8\.2\b/.test(version.stdout)) throw new Error('aidlcコマンドも2.8.2にそろえてください');
      const result = await command(['aidlc', 'engine', 'orchestrate', 'park', '--project-dir', project], project, env, 10000);
      writeJson(join(run, 'park.json'), result); requireSuccess(result);
      if (JSON.parse(result.stdout).kind !== 'parked') throw new Error('parkが拒否されました。TAKTを起動しません');
      status.state = 'parked'; status.parkStateHash = digest(readFileSync(boundary.statePath));
      writeJson(join(run, 'status.json'), status);
    }
    return { id, run, status: readJson<Status>(join(run, 'status.json')) };
  });
}

export async function executeHandoff(project: string, id: string, retry = false) {
  if (!/^[a-f0-9]{24}$/.test(id)) throw new Error('不正なrun IDです');
  const run = join(storage(project), 'runs', id);
  return withLock(join(run, 'execute.lock'), async () => {
    const statusPath = join(run, 'status.json');
    const status = readJson<Status>(statusPath);
    if (status.state === 'verified') return status;
    if (status.state !== 'parked' && !(retry && status.state === 'failed')) throw new Error(`実行できない状態です: ${status.state}`);
    const m = readJson<Manifest>(join(run, 'manifest.json'));
    const c = m.config;
    try {
      const { configHash } = configuration(project);
      if (configHash !== m.configHash) throw new Error('連携設定が変更されています');
      unchanged(project, m.files); unchanged(join(run, 'snapshot'), m.files);
      const boundary = await approvedBoundary(project);
      if (boundary.approval !== m.approval || boundary.record !== m.record) throw new Error('承認対象が変わっています');
      if (digest(readFileSync(boundary.statePath)) !== status.parkStateHash) throw new Error('park後に元の状態が変化しています');
      status.state = 'running'; status.attempts++; status.pid = process.pid; delete status.error;
      const attempt = join(run, 'attempts', String(status.attempts));
      const workspace = join(attempt, 'work'); status.workspace = workspace;
      writeJson(statusPath, status);
      for (const path of c.sources) {
        const target = join(workspace, path); mkdirSync(dirname(target), { recursive: true });
        copyFileSync(fileInside(join(run, 'snapshot'), path), target); chmodSync(target, 0o644);
      }
      const input: Snapshot = {};
      for (const path of c.artifacts) {
        const target = join('input', relative(m.record, path));
        mkdirSync(dirname(join(workspace, target)), { recursive: true });
        copyFileSync(fileInside(join(run, 'snapshot'), path), join(workspace, target));
        chmodSync(join(workspace, target), 0o444); input[target] = m.files[path];
      }
      writeJson(join(workspace, 'input/manifest.json'), { id, artifacts: input, sourceHashes: Object.fromEntries(c.sources.map(p => [p, m.files[p]])) });
      input['input/manifest.json'] = digest(readFileSync(join(workspace, 'input/manifest.json')));
      const configDir = join(attempt, 'takt-config'); mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'config.yaml'), `provider: ${c.provider}\nlanguage: ja\n${c.construction ? 'workflow_command_gates:\n  custom_scripts: true\n' : ''}`);
      let env: NodeJS.ProcessEnv = { ...cleanEnvironment(), TAKT_CONFIG_DIR: configDir };
      if (c.provider === 'claude' && c.disableBedrock) env = withoutBedrock(env);
      if (c.provider === 'mock') {
        if (!c.mockScenario) throw new Error('mockScenarioが必要です');
        env.TAKT_MOCK_SCENARIO = fileInside(join(run, 'snapshot'), c.mockScenario);
      } else {
        const claude = Bun.which('claude'); if (!claude) throw new Error('Claude Codeが見つかりません');
        const wrapper = join(attempt, 'claude.sh');
        writeFileSync(wrapper, `#!/bin/sh\ncase "$1" in --help|--version) exec ${quote(claude)} "$@";; esac\nexec ${quote(claude)} --setting-sources project --strict-mcp-config --mcp-config '{"mcpServers":{}}' --tools Read,Write,Edit --max-turns ${c.construction ? 16 : 8} --max-budget-usd 1 "$@"\n`, { mode: 0o700 });
        env.TAKT_CLAUDE_CLI_PATH = wrapper;
      }
      writeJson(join(workspace, '.claude/settings.json'), { permissions: { deny: ['Edit(input/**)', 'Write(input/**)', 'Edit(.claude/**)', 'Write(.claude/**)', ...(c.construction ? ['Edit(.kiro/**)', 'Write(.kiro/**)'] : [])] } });
      writeFileSync(join(workspace, '.gitignore'), '\n.claude/\n.takt/\n', { flag: 'a' });
      for (const args of [['init', '-q'], ['config', 'core.hooksPath', '/dev/null'], ['add', '.'], ['-c', 'user.name=TAKT handoff', '-c', 'user.email=handoff@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'chore: seed handoff workspace']]) requireSuccess(await command(['git', ...args], workspace, env, 10000));
      const gate = c.construction ? prepareConstruction(attempt, workspace, fileInside(join(run, 'snapshot'), c.verifyScript), input) : undefined;
      const controlFiles = gate ? snapshot(dirname(gate), ['construction-gate.ts', 'context.json']) : undefined;
      const result = await command(['takt', '--pipeline', '--skip-git', '--provider', c.provider, '--workflow', fileInside(join(run, 'snapshot'), c.workflow), '--task', 'input/manifest.jsonとInception成果物を読み、指定Workflowを実行してください。入力は変更せず、成果物を作業領域に作ってください。'], workspace, env, c.timeoutMs);
      writeJson(join(attempt, 'takt.json'), result);
      if (gate && controlFiles) {
        unchanged(dirname(gate), controlFiles); unchanged(workspace, input); unchanged(project, m.files);
        if (digest(readFileSync(boundary.statePath)) !== status.parkStateHash) throw new Error('実行中に元のAI-DLC状態が変化しました');
        const evidence = await command([process.execPath, gate, 'result'], workspace, env, 10000);
        writeJson(join(attempt, 'construction.json'), evidence);
        if (evidence.code === 0) {
          status.construction = JSON.parse(evidence.stdout);
          if (status.construction?.state === 'needs_input' && !result.timedOut) {
            status.state = 'needs_input'; delete status.pid;
            writeJson(statusPath, status); return status;
          }
        }
        requireSuccess(result); requireSuccess(evidence);
      } else requireSuccess(result);
      unchanged(workspace, input); unchanged(project, m.files); unchanged(join(run, 'snapshot'), m.files);
      if (digest(readFileSync(boundary.statePath)) !== status.parkStateHash) throw new Error('実行中に元のAI-DLC状態が変化しました');
      const verification = await command([process.execPath, fileInside(join(run, 'snapshot'), c.verifyScript)], workspace, env, 30000);
      writeJson(join(attempt, 'verification.json'), verification); requireSuccess(verification);
      // 検証コマンドも入力を書き換えていないことを確認する。
      unchanged(workspace, input); unchanged(project, m.files); unchanged(join(run, 'snapshot'), m.files);
      if (digest(readFileSync(boundary.statePath)) !== status.parkStateHash) throw new Error('検証中に元のAI-DLC状態が変化しました');
      if (gate && controlFiles) {
        unchanged(dirname(gate), controlFiles);
        requireSuccess(await command([process.execPath, gate, 'result'], workspace, env, 10000));
      }
      status.state = 'verified'; delete status.pid;
    } catch (error) {
      status.state = 'failed'; status.error = String(error); delete status.pid;
    }
    writeJson(statusPath, status); return status;
  });
}
