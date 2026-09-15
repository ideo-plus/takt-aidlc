import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cleanEnvironment, command, digest, quote, requireSuccess, withoutBedrock, writeJson } from '../../src/handoff/io';

// 承認済みの実プロジェクトを複製し、公式の工程再実行を通常のClaude UIから開始する。
// 状態・監査記録の巻き戻しや、フックイベントの生成・再送は行わない。
const repo = resolve(import.meta.dir, '../..');
const [mode, argument] = process.argv.slice(2);
if (mode === 'launch') {
  const run = realpathSync(argument);
  assert.ok(run.startsWith(join(repo, '.experiments/native-recheck') + '/'));
  const session = JSON.parse(readFileSync(join(run, 'session.json'), 'utf8'));
  const child = Bun.spawn(['claude', '--session-id', session.sessionId,
    '--plugin-dir', join(repo, 'dist/claude'), '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Bash(aidlc *)', '--setting-sources', 'project',
    '--settings', join(run, 'effective-settings.json'), '--strict-mcp-config',
    '--mcp-config', '{"mcpServers":{}}', '--debug', 'hooks', '--debug-file', join(run, 'hooks.log'),
    readFileSync(join(run, 'prompt.txt'), 'utf8')], {
    cwd: session.project, env: withoutBedrock(cleanEnvironment()), stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
  });
  process.exitCode = await child.exited;
} else if (mode === 'prepare') {
  const sourceRun = realpathSync(argument);
  assert.ok(sourceRun.startsWith(join(repo, '.experiments/native') + '/'));
  const sourceProject = join(sourceRun, 'project');
  const run = join(repo, '.experiments/native-recheck', new Date().toISOString().replaceAll(':', '-'));
  const project = join(run, 'project');
  mkdirSync(run, { recursive: true });
  const controller = join(sourceProject, 'aidlc/takt-handoff');
  const excluded = ['runs', 'pending', 'prepare.lock'].map(name => join(controller, name));
  cpSync(sourceProject, project, { recursive: true, filter: path => !excluded.some(root => path === root || path.startsWith(root + '/')) });
  const state = 'aidlc/spaces/default/intents/260915-answer-value-update/aidlc-state.md';
  assert.equal(digest(readFileSync(join(project, state))), digest(readFileSync(join(sourceProject, state))));
  assert.equal(readFileSync(join(project, 'src/value.ts'), 'utf8'), 'export const answer = 41;\n');
  assert.ok(!existsSync(join(project, 'aidlc/takt-handoff/runs')));
  writeJson(join(run, 'effective-settings.json'), { env: { TAKT_AIDLC_PLUGIN_ONLY: '1' } });
  const session = { project, sessionId: randomUUID(), socket: 'takt-aidlc-lab', session: 'recheck-' + Date.now(), sourceRun };
  writeJson(join(run, 'session.json'), session);
  writeJson(join(run, 'provenance.json'), {
    method: 'Copy of real approved project; native stage re-entry required before fresh final approval',
    sourceStateHash: digest(readFileSync(join(sourceProject, state))),
    pluginHash: digest(readFileSync(join(repo, 'dist/claude/scripts/handoff.js'))),
    excluded: excluded.map(path => path.slice(sourceProject.length + 1)),
    userInstruction: '接続部分を固める（修正後の無介入実行を確認する）という選択肢1をユーザーが選択',
  });
  // プロンプトは起動前に呼び出し側が保存し、転送した既存判断を区別して記録する。
  console.log(JSON.stringify({ run, ...session }));
} else if (mode === 'start') {
  const run = realpathSync(argument);
  assert.ok(run.startsWith(join(repo, '.experiments/native-recheck') + '/'));
  const session = JSON.parse(readFileSync(join(run, 'session.json'), 'utf8'));
  assert.ok(existsSync(join(run, 'prompt.txt')));
  requireSuccess(await command(['tmux', '-L', session.socket, 'new-session', '-d', '-s', session.session,
    '-c', session.project, [process.execPath, import.meta.path, 'launch', run].map(quote).join(' ')], repo, cleanEnvironment(), 10000));
  console.log(JSON.stringify(session));
} else throw new Error('usage: recheck.ts prepare <native-run> | start <recheck-run> | launch <recheck-run>');
