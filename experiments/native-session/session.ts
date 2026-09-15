import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanEnvironment, command, requireSuccess, withoutBedrock, writeJson } from '../../src/handoff/io';

const repo = resolve(import.meta.dir, '../..');
const plugin = join(repo, 'dist/claude');
if (!existsSync(join(plugin, 'scripts/handoff.js'))) throw new Error('先に bun run build:plugin を実行してください');
const [mode, pathArgument, replyFile] = process.argv.slice(2);
let run: string;
if (mode === 'start') {
  run = join(repo, '.experiments/native', new Date().toISOString().replaceAll(':', '-'));
  const project = join(run, 'project'); mkdirSync(project, { recursive: true });
  const version = await command(['aidlc', '--version'], project, cleanEnvironment(), 10000);
  requireSuccess(version);
  if (!/^aidlc 2\.8\.2\b/.test(version.stdout)) throw new Error('aidlc 2.8.2が必要です');
  const installation = await command(['aidlc', 'config', '--harness', 'claude', '--yes'], project, cleanEnvironment(), 30000);
  writeJson(join(run, 'installation.json'), installation); requireSuccess(installation);
  const settingsPath = join(project, '.claude/settings.json');
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  // 実験端末の通常のClaude認証を利用する。AI-DLCの全フックは保持する。
  const removedEnvKeys = Object.keys(settings.env ?? {}).filter(key => key !== 'AWS_AIDLC_DEFAULT_SCOPE');
  settings.env = { AWS_AIDLC_DEFAULT_SCOPE: 'classic' };
  settings.permissions.allow.push('Bash(aidlc *)');
  writeJson(settingsPath, settings);
  mkdirSync(join(project, 'src'), { recursive: true });
  writeFileSync(join(project, 'src/value.ts'), 'export const answer = 41;\n');
  writeFileSync(join(project, '.gitignore'), '.claude/\naidlc/\n.takt-aidlc/\n');
  for (const args of [['init', '-q'], ['config', 'core.hooksPath', '/dev/null'], ['add', '.'], ['-c', 'user.name=Experiment', '-c', 'user.email=experiment@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'test: seed native workflow experiment']]) requireSuccess(await command(['git', ...args], project, cleanEnvironment(), 10000));
  writeJson(join(run, 'session.json'), { project, sessionId: randomUUID(), turns: 0, plugin, removedEnvKeys, nativeHookGroups: Object.fromEntries(Object.entries(settings.hooks).map(([name, hooks]) => [name, (hooks as unknown[]).length])) });
} else if (mode === 'reply' || mode === 'continue') {
  run = realpathSync(pathArgument);
  if (!run.startsWith(join(repo, '.experiments/native') + '/')) throw new Error('native実験のパスを指定してください');
} else throw new Error('usage: bun experiments/native-session/session.ts start | continue <runDir> | reply <runDir> <verbatim-user-reply-file>');

const session = JSON.parse(readFileSync(join(run, 'session.json'), 'utf8'));
const migratedSettings = join(run, 'plugin-migration/effective-settings.json');
const settingsArgs = existsSync(migratedSettings) ? ['--setting-sources', 'project', '--settings', migratedSettings] : ['--setting-sources', 'project'];
let prompt: string;
if (mode === 'start') {
  prompt = `/aidlc --scope classic この実験用Gitリポジトリで、src/value.tsがexportするanswerを41から42へ変更する開発を進めてください。外部サービス、UI、DB、デプロイは不要です。言語はTypeScript、確認はBunで十分です。要求と成果物は日本語で書いてください。目的は通常のAI-DLC Inceptionの承認後にTAKTへConstructionを引き継ぐ実機確認です。Inceptionまでは通常のAI-DLCに従い、Delivery Planningの最終承認後のparkと引き継ぎは登録済みの連携フックが担当します。まだ実装しないでください。\n\nこれはCodexから転送した実験依頼です。人の質問回答や承認はこのセッションへ別途転送します。人に代わってLooks correct、Approve、Nothing to addなどを選択せず、必要な質問を提示して停止してください。承認・監査記録を捏造したりガードを解除したりしないでください。現在の作業領域の外は変更しないでください。`;
} else if (mode === 'continue') {
  prompt = '/aidlc --resume 前回は実験スクリプト側の時間上限で中断されました。同じ実験依頼の続きとして、既存の状態から再開してください。これは運用上の再開指示で、工程の承認や質問への回答ではありません。必要な質問・承認は提示して停止し、人の回答を待ってください。';
} else {
  if (!replyFile) throw new Error('実際のユーザー返答を保存したファイルが必要です');
  prompt = readFileSync(replyFile, 'utf8');
  if (!prompt.trim()) throw new Error('空の返答は送信しません');
}
session.turns++;
writeJson(join(run, 'session.json'), session);
const turnDir = join(run, 'turns', String(session.turns)); mkdirSync(turnDir, { recursive: true });
writeFileSync(join(turnDir, 'prompt.txt'), prompt, { mode: 0o600 });
writeJson(join(turnDir, 'provenance.json'), { origin: mode === 'reply' ? 'verbatim-user-reply' : 'operator-instruction', mode });
const args = ['--print', ...(mode === 'start' ? ['--session-id', session.sessionId] : ['--resume', session.sessionId]), '--plugin-dir', plugin, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash(aidlc *)', ...settingsArgs, '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--max-turns', '60', '--max-budget-usd', '4', prompt];
console.log(`実AI-DLCセッション: ${run}`);
const result = await new Promise<{ code: number | null; timedOut: boolean; stdout: string; stderr: string }>((done, fail) => {
  const child = spawn('claude', args, { cwd: session.project, env: withoutBedrock(cleanEnvironment()), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timedOut = false;
  const stop = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} };
  const timer = setTimeout(() => { timedOut = true; stop(); }, 600000);
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  child.stdout.on('data', chunk => { stdout += chunk; writeFileSync(join(turnDir, 'events.jsonl'), stdout, { mode: 0o600 }); });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', e => { clearTimeout(timer); fail(e); });
  child.on('close', code => { clearTimeout(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); done({ code, timedOut, stdout, stderr }); });
});
writeJson(join(turnDir, 'process.json'), { code: result.code, timedOut: result.timedOut, stderr: result.stderr });
const events = result.stdout.trim().split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
const final = events.findLast(e => e.type === 'result');
writeJson(join(turnDir, 'result.json'), final ?? { error: 'resultイベントなし' });
console.log(JSON.stringify({ runDir: run, turn: session.turns, code: result.code, timedOut: result.timedOut, result: final?.result, errors: final?.errors }, null, 2));
if (result.code !== 0 || result.timedOut) process.exitCode = 1;
