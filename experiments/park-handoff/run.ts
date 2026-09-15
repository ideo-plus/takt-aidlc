import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

// 実験専用。実際の承認を作らず、未承認の合成データを使う。
const root = resolve(import.meta.dir, '../..');
const cache = join(root, '.experiments/cache/aidlc-v2.8.2');
const revision = '355903d6dc8eb07d3c77180be5d40ed679d6a40f';
const runDir = join(root, '.experiments/runs', new Date().toISOString().replaceAll(':', '-') + '-' + process.pid);
mkdirSync(runDir, { recursive: true });
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(AIDLC_|AWS_AIDLC_|TAKT_|CLAUDE_PROJECT_DIR$|GIT_DIR$|GIT_WORK_TREE$|GIT_INDEX_FILE$)/.test(key)));
type Result = { code: number | null; signal: string | null; stdout: string; stderr: string; error?: string };
function exec(cmd: string, args: string[], cwd: string, env = {}, input?: string, timeout = 30_000): Result {
  const r = spawnSync(cmd, args, { cwd, env: { ...cleanEnv, ...env }, input, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 });
  return { code: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ...(r.error ? { error: r.error.message } : {}) };
}
function must(r: Result) { assert.equal(r.code, 0, JSON.stringify(r)); return r; }
function put(path: string, data: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); }
function json(path: string, data: unknown) { put(path, JSON.stringify(data, null, 2) + '\n'); }
function hash(path: string) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function log(name: string, result: unknown) { json(join(runDir, name + '.json'), result); }
function projectEnv(project: string) { return { AIDLC_PROJECT_DIR: project, CLAUDE_PROJECT_DIR: project, AIDLC_HARNESS_DIR: '.claude' }; }

if (!existsSync(cache)) {
  mkdirSync(dirname(cache), { recursive: true });
  must(exec('git', ['clone', '--depth', '1', '--branch', 'v2.8.2', 'https://github.com/awslabs/aidlc-workflows.git', cache], root, {}, undefined, 60_000));
}
assert.equal(must(exec('git', ['rev-parse', 'HEAD'], cache)).stdout.trim(), revision);
assert.equal(must(exec('git', ['status', '--porcelain', '--untracked-files=no'], cache)).stdout.trim(), '', '上流の追跡ファイルが変更されている');
// 生成物も毎回更新し、過去の実験の変更が混ざらないようにする。
log('package', must(exec(process.execPath, ['scripts/package.ts', 'claude'], cache)));
const runtime = join(cache, 'dist/claude');
const lib = await import(pathToFileURL(join(runtime, '.claude/tools/aidlc-lib.ts')).href);
const recordRel = 'aidlc/spaces/default/intents/fixture-8000000000000001';
const originalSource = 'export const answer = 41;\n';
const changedSource = 'export const answer = 42;\n';
const observations: Record<string, unknown>[] = [];

function fixture(name: string, stage: string, autonomy = 'gated') {
  const project = join(runDir, name);
  mkdirSync(project, { recursive: true });
  for (const part of ['tools', 'hooks']) cpSync(join(runtime, '.claude', part), join(project, '.claude', part), { recursive: true });
  cpSync(join(runtime, 'aidlc'), join(project, 'aidlc'), { recursive: true });
  put(join(project, 'aidlc/active-space'), 'default\n');
  put(join(project, 'aidlc/.aidlc-clone-id'), 'experimentclone01\n');
  put(join(project, 'aidlc/spaces/default/intents/active-intent'), 'fixture-8000000000000001\n');
  json(join(project, 'aidlc/spaces/default/intents/intents.json'), [{ uuid: '00000000-0000-7000-8000-000000000001', slug: 'fixture', dirName: 'fixture-8000000000000001', status: 'in-flight' }]);
  put(join(project, 'src/value.ts'), originalSource);
  put(join(project, recordRel, 'inception/requirements-analysis/requirements.md'), '# 要求\n\n## 受入条件\nanswerが42になる。\n');
  put(join(project, '.gitignore'), '.claude/\naidlc/\n.takt/\n');
  must(exec('git', ['init', '-q'], project));
  must(exec('git', ['config', 'core.hooksPath', '/dev/null'], project));
  must(exec('git', ['add', 'src/value.ts', '.gitignore'], project));
  must(exec('git', ['-c', 'user.name=Experiment', '-c', 'user.email=experiment@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'test: seed experiment fixture'], project));
  const state = join(project, recordRel, 'aidlc-state.md');
  put(state, `# AI-DLC State Tracking\n\n## Project Information\n- **State Version**: 8\n- **Project**: isolated experiment\n- **Scope**: poc\n- **Project Root**: ${project}\n\n## Current Status\n- **Status**: Running\n- **Lifecycle Phase**: ${stage === 'delivery-planning' ? 'INCEPTION' : 'CONSTRUCTION'}\n- **Current Stage**: ${stage}\n\n## Runtime State\n- **Construction Autonomy Mode**: ${autonomy}\n\n## Stage Progress\n- [-] ${stage}\n`);
  lib.writeActiveDirectiveMarker(project, { kind: 'run-stage', stage, state_sha256: lib.stateDigest(readFileSync(state, 'utf8')) });
  return { project, state, source: join(project, 'src/value.ts'), requirements: join(project, recordRel, 'inception/requirements-analysis/requirements.md') };
}
type Fixture = ReturnType<typeof fixture>;
function park(f: Fixture) {
  const r = exec(process.execPath, [join(f.project, '.claude/tools/aidlc-orchestrate.ts'), 'park', '--project-dir', f.project], f.project, projectEnv(f.project));
  log(f.project.split('/').at(-1) + '-park', r);
  return r;
}
function hook(f: Fixture, tool: string, input: Record<string, unknown>) {
  return exec(process.execPath, [join(f.project, '.claude/hooks/aidlc-plan-approval-guard.ts')], f.project, projectEnv(f.project), JSON.stringify({ hook_event_name: 'PreToolUse', cwd: f.project, session_id: 'experiment', tool_name: tool, tool_input: input }));
}
function probe(name: string, f: Fixture, tool: string, input: Record<string, unknown>, expected: number) {
  const before = hash(f.source);
  const result = hook(f, tool, input);
  log(name, result);
  assert.equal(result.code, expected, name + ': ' + JSON.stringify(result));
  // ハーネスの判定を模した編集。実ハーネス検証とは区別する。
  if (result.code === 0 && tool === 'Write') put(String(input.file_path), String(input.content));
  observations.push({ name, layer: 'real-hook/subprocess; Write applied by experiment host only on exit 0', exitCode: result.code, sourceChanged: before !== hash(f.source), stderr: result.stderr.trim() });
}

const active = fixture('active-codegen', 'code-generation');
probe('active-codegen-write', active, 'Write', { file_path: active.source, content: changedSource }, 2);
const parked = fixture('parked-codegen', 'code-generation');
assert.equal(JSON.parse(must(park(parked)).stdout).kind, 'parked');
assert.match(readFileSync(parked.state, 'utf8'), /\*\*Parked\*\*/);
const next = exec(process.execPath, [join(parked.project, '.claude/tools/aidlc-orchestrate.ts'), 'next', '--project-dir', parked.project], parked.project, projectEnv(parked.project));
log('parked-next', must(next));
assert.equal(JSON.parse(next.stdout).kind, 'parked');
probe('parked-codegen-write', parked, 'Write', { file_path: parked.source, content: changedSource }, 2);
probe('parked-codegen-read', parked, 'Read', { file_path: parked.requirements }, 0);
probe('parked-codegen-bash', parked, 'Bash', { command: 'printf changed > src/value.ts' }, 2);
probe('parked-codegen-upstream-write', parked, 'Write', { file_path: parked.requirements, content: '# 書き換え\n' }, 2);
probe('parked-codegen-plan-write', parked, 'Write', { file_path: join(parked.project, recordRel, 'construction/code-generation/code-generation-plan.md'), content: '# 未承認の計画\n' }, 2);
const inception = fixture('parked-inception', 'delivery-planning');
assert.equal(JSON.parse(must(park(inception)).stdout).kind, 'parked');
probe('parked-inception-source-write', inception, 'Write', { file_path: inception.source, content: changedSource }, 0);
const autonomous = fixture('autonomous-codegen', 'code-generation', 'autonomous');
const refusal = park(autonomous);
assert.equal(JSON.parse(refusal.stdout).kind, 'error');
assert.match(refusal.stdout + refusal.stderr, /autonomous/);
observations.push({ name: 'autonomous-park', layer: 'real-engine/subprocess', exitCode: refusal.code, directiveKind: JSON.parse(refusal.stdout).kind, sourceChanged: false });

// 元環境に到達する環境変数が残ると、CWDだけの分離は無効になる。
const separated = join(runDir, 'separated');
mkdirSync(separated, { recursive: true });
put(join(separated, 'src/value.ts'), originalSource);
const inherited = exec(process.execPath, [join(parked.project, '.claude/hooks/aidlc-plan-approval-guard.ts')], separated, projectEnv(parked.project), JSON.stringify({ hook_event_name: 'PreToolUse', cwd: separated, session_id: 'experiment', tool_name: 'Write', tool_input: { file_path: join(separated, 'src/value.ts'), content: changedSource } }));
log('separated-with-inherited-hook', inherited);
assert.equal(inherited.code, 2, JSON.stringify(inherited));
observations.push({ name: 'separated-with-inherited-hook', layer: 'real-hook/subprocess', exitCode: inherited.code });

// TAKT実CLI + mock。AIは呼ばず、起動と成果物受け渡しだけを確認する。
const input = join(separated, 'input/requirements.md');
put(input, readFileSync(parked.requirements, 'utf8'));
chmodSync(input, 0o444);
const stateBefore = hash(parked.state);
const upstreamBefore = hash(parked.requirements);
const inputBefore = hash(input);
const configDir = join(runDir, 'takt-config');
put(join(configDir, 'config.yaml'), 'provider: mock\nlanguage: ja\n');
put(join(separated, '.gitignore'), '.takt/\n');
must(exec('git', ['init', '-q'], separated));
must(exec('git', ['config', 'core.hooksPath', '/dev/null'], separated));
must(exec('git', ['add', '.'], separated));
must(exec('git', ['-c', 'user.name=Experiment', '-c', 'user.email=experiment@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'test: seed separated fixture'], separated));
const workflow = join(runDir, 'experiment.yaml');
put(workflow, `name: handoff-experiment\ninitial_step: implement\nmax_steps: 2\nsteps:\n  - name: implement\n    edit: true\n    required_permission_mode: edit\n    instruction: |\n      input/requirements.mdを読み、src/value.tsのanswerを42にしてください。\n      inputとAI-DLCの記録は変更しないでください。\n    rules:\n      - condition: 作業終了\n        next: COMPLETE\n`);
const scenario = join(runDir, 'mock-scenario.json');
json(scenario, [{ status: 'done', content: '作業終了。[[RULE:1]]', file_condition: { filename: 'requirements.md', state: 'readable', includes: '42' }, mismatch_content: '入力が不正', file_writes: [{ path: 'src/value.ts', content: changedSource }] }]);
const takt = exec('takt', ['--pipeline', '--skip-git', '--provider', 'mock', '--workflow', workflow, '--task', '入力の受入条件に従ってanswerを42にする'], separated, { TAKT_CONFIG_DIR: configDir, TAKT_MOCK_SCENARIO: scenario, TAKT_MOCK_CALL_LOG: join(runDir, 'mock-calls.jsonl') }, undefined, 60_000);
log('takt-mock', takt);
must(takt);
assert.equal(readFileSync(join(separated, 'src/value.ts'), 'utf8'), changedSource);
assert.equal(hash(input), inputBefore);
assert.equal(hash(parked.state), stateBefore);
assert.equal(hash(parked.requirements), upstreamBefore);
observations.push({ name: 'takt-separated-mock', layer: 'real-TAKT-CLI/mock-provider', exitCode: takt.code, sourceChanged: true, inputUnchanged: true, originalStateUnchanged: true, originalRequirementsUnchanged: true });

const summary = { verdict: 'VERIFIED', claim: 'Code Generation未承認ではpark後も編集が拒否される。入力と実行環境を分ければTAKTの実CLIで成果物を生成できる。', upstreamRevision: revision, versions: { bun: Bun.version, takt: must(exec('takt', ['--version'], root)).stdout.trim() }, runDir: realpathSync(runDir), observations, limitations: ['合成状態と実際のparkコマンドを使用。Inception全工程の実行・承認は行っていない。', 'mockプロバイダーはClaude Codeのフックを実行しない。TAKTから実モデルを呼ぶ試験は別途必要。', '入力のchmodとハッシュ一致は、任意の悪意あるプロセスへの完全な保護を意味しない。'] };
log('summary', summary);
console.log(JSON.stringify(summary, null, 2));
