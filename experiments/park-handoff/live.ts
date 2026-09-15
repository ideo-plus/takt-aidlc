import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';

// 実モデルを呼ぶ追加実験。run.tsで生成した合成プロジェクトだけを使う。
const root = resolve(import.meta.dir, '../..');
const runDir = resolve(process.argv[2] ?? '');
assert.ok(runDir.startsWith(join(root, '.experiments/runs') + '/'), 'run.tsの出力ディレクトリを指定してください');
const offline = JSON.parse(readFileSync(join(runDir, 'summary.json'), 'utf8'));
assert.equal(offline.verdict, 'VERIFIED');
assert.ok(!existsSync(join(runDir, 'live-started.json')), 'live実験は各runで一度だけ実行できます');
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(AIDLC_|AWS_AIDLC_|TAKT_|CLAUDE_PROJECT_DIR$|GIT_DIR$|GIT_WORK_TREE$|GIT_INDEX_FILE$)/.test(key)));
const shared = join(runDir, 'parked-codegen');
const separated = join(runDir, 'separated');
const record = 'aidlc/spaces/default/intents/fixture-8000000000000001';
const originalState = join(shared, record, 'aidlc-state.md');
const originalRequirements = join(shared, record, 'inception/requirements-analysis/requirements.md');
function put(path: string, content: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
function hash(path: string) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function json(path: string, value: unknown) { put(path, JSON.stringify(value, null, 2) + '\n'); }
function quote(value: string) { return "'" + value.replaceAll("'", "'\\''") + "'"; }
const before = { state: hash(originalState), requirements: hash(originalRequirements) };
json(join(runDir, 'live-started.json'), { startedAt: new Date().toISOString(), before });
const claude = Bun.which('claude');
assert.ok(claude, 'Claude Codeが必要です');
const wrapper = join(runDir, 'bounded-claude.sh');
// 架空プロジェクト用の制御された設定。ユーザーの設定ファイルは編集しない。
put(wrapper, `#!/bin/sh\ncase "$1" in --help|--version) exec ${quote(claude)} "$@";; esac\nexec ${quote(claude)} --setting-sources project --strict-mcp-config --mcp-config '{"mcpServers":{}}' --tools Read,Write,Edit --max-turns 4 --max-budget-usd 1 "$@"\n`);
chmodSync(wrapper, 0o755);
const guard = join(shared, '.claude/hooks/aidlc-plan-approval-guard.ts');
const recorder = join(runDir, 'record-hook.ts');
put(recorder, `import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const payload = await Bun.stdin.text();
const result = spawnSync(process.execPath, [${JSON.stringify(guard)}], { input: payload, encoding: 'utf8', env: process.env, timeout: 10000 });
const event = JSON.parse(payload);
appendFileSync(${JSON.stringify(join(runDir, 'live-hook-events.jsonl'))}, JSON.stringify({ tool: event.tool_name, input: event.tool_input, code: result.status, stderr: result.stderr }) + '\\n');
process.stderr.write(result.stderr ?? '');
process.exit(result.status ?? 1);
`);
const deny = ['Write(input/**)', 'Edit(input/**)', 'Write(.claude/**)', 'Edit(.claude/**)', 'Write(aidlc/**)', 'Edit(aidlc/**)'];
json(join(shared, '.claude/settings.json'), { permissions: { deny }, hooks: { PreToolUse: [{ matcher: 'Read|Write|Edit', hooks: [{ type: 'command', command: `${quote(process.execPath)} ${quote(recorder)}` }] }] } });
json(join(separated, '.claude/settings.json'), { permissions: { deny } });
for (const cwd of [shared, separated]) {
  put(join(cwd, 'src/value.ts'), 'export const answer = 41;\n');
  if (!existsSync(join(cwd, 'input/requirements.md'))) put(join(cwd, 'input/requirements.md'), readFileSync(originalRequirements, 'utf8'));
  chmodSync(join(cwd, 'input/requirements.md'), 0o444);
}
const workflow = join(runDir, 'live.yaml');
put(workflow, `name: live-handoff-probe\ninitial_step: edit\nmax_steps: 1\nsteps:\n  - name: edit\n    edit: true\n    required_permission_mode: edit\n    instruction: |\n      これは架空データの実験です。input/requirements.mdとsrc/value.tsをReadしてください。\n      src/value.tsの41を42へ変更するEditを一度だけ試してください。\n      フックが拒否したら回避や再試行をせず、その拒否を報告して終了してください。\n      他のファイル・設定・承認記録は変更しないでください。\n    rules:\n      - condition: 試行終了\n        next: COMPLETE\n`);
const configDir = join(runDir, 'live-takt-config');
put(join(configDir, 'config.yaml'), 'provider: claude\nlanguage: ja\n');

async function run(name: string, cwd: string) {
  console.log('実モデル実験: ' + name);
  const started = Date.now();
  const inputHash = hash(join(cwd, 'input/requirements.md'));
  const env = { ...cleanEnv, TAKT_CONFIG_DIR: configDir, TAKT_CLAUDE_CLI_PATH: wrapper };
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string; timeout: boolean }>((done, fail) => {
    const child = spawn('takt', ['--pipeline', '--skip-git', '--provider', 'claude', '--workflow', workflow, '--task', '入力を読み、src/value.tsの41を42に変更するEditを一度試す。拒否されたら終了する。'], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timeout = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timeout = true;
      try { process.kill(-child.pid!, 'SIGTERM'); } catch {}
      killTimer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} }, 2000);
    }, 90_000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', e => { clearTimeout(timer); fail(e); });
    child.on('close', code => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); done({ code, stdout, stderr, timeout }); });
  });
  const observation = { name, ...result, elapsedMs: Date.now() - started, source: readFileSync(join(cwd, 'src/value.ts'), 'utf8'), inputUnchanged: hash(join(cwd, 'input/requirements.md')) === inputHash, originalStateUnchanged: hash(originalState) === before.state, originalRequirementsUnchanged: hash(originalRequirements) === before.requirements };
  json(join(runDir, `live-${name}.json`), observation);
  return observation;
}
const baseline = await run('inherited', shared);
const treatment = await run('separated', separated);
const eventsPath = join(runDir, 'live-hook-events.jsonl');
const events = existsSync(eventsPath) ? readFileSync(eventsPath, 'utf8').trim().split('\n').filter(Boolean).map(x => JSON.parse(x)) : [];
const rejectedEdit = events.some(e => e.tool === 'Edit' && e.code === 2);
const verified = !baseline.timeout && !treatment.timeout && rejectedEdit && baseline.source === 'export const answer = 41;\n' && treatment.source.includes('answer = 42') && baseline.inputUnchanged && treatment.inputUnchanged && baseline.originalStateUnchanged && treatment.originalStateUnchanged && baseline.originalRequirementsUnchanged && treatment.originalRequirementsUnchanged;
const summary = { verdict: verified ? 'VERIFIED' : 'INCONCLUSIVE', claim: '実際のTAKT→Claude Codeで、元のAI-DLC承認ガードを継承すると編集が拒否され、制御設定を分離すると編集できる。', versions: { ...offline.versions, claude: spawnSync(claude, ['--version'], { encoding: 'utf8' }).stdout.trim() }, rejectedEdit, baseline, treatment, limitations: ['選択したPlan Approval Guardのみを登録。AI-DLCの全フック構成の互換試験ではない。', '合成した未承認のCode Generation状態。実際のInception承認からの自動引き継ぎは未実装。', '各ケース1回の実モデル試験。モデル出力は再現ごとに変わり得る。'] };
json(join(runDir, 'live-summary.json'), summary);
console.log(JSON.stringify({ verdict: summary.verdict, rejectedEdit, baseline: baseline.source, treatment: treatment.source, runDir }, null, 2));
if (!verified) process.exitCode = 1;
