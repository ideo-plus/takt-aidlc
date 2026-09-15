import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanEnvironment, command, requireSuccess, writeJson } from '../../src/handoff/io';

const root = resolve(import.meta.dir, '../..');
const plugin = join(root, 'dist/claude');
const run = join(root, '.experiments/plugin-load', new Date().toISOString().replaceAll(':', '-'));
const project = join(run, 'project'); mkdirSync(project, { recursive: true });
requireSuccess(await command(['git', 'init', '-q'], project, cleanEnvironment(), 10000));
// 起動通知の検証用。承認コマンドを呼ばないため、実行用の入力は設定しない。
writeJson(join(project, 'aidlc/takt-handoff/config.json'), { enabled: true });
const configBefore = readFileSync(join(project, 'aidlc/takt-handoff/config.json'), 'utf8');
const result = await command(['claude', '--print', '--plugin-dir', plugin, '--debug', 'hooks', '--debug-file', join(run, 'hooks.log'), '--output-format', 'stream-json', '--verbose', '--setting-sources', 'project', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--permission-mode', 'acceptEdits', '--tools', 'Bash', '--allowedTools', 'Bash(aidlc --version)', '--max-turns', '3', '--max-budget-usd', '0.5', 'aidlc --versionをBashで一度だけ実行し、結果を短く報告してください。開発ワークフローや承認処理は開始しないでください。'], project, cleanEnvironment(), 90000);
writeJson(join(run, 'process.json'), result); requireSuccess(result);
const events = result.stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
const init = events.find(e => e.type === 'system' && e.subtype === 'init');
const hook = events.find(e => e.type === 'system' && e.subtype === 'hook_response' && String(e.stdout ?? e.output ?? '').includes('takt-aidlc連携が有効'));
const final = events.findLast(e => e.type === 'result');
const loaded = Array.isArray(init?.plugins) && init.plugins.some((p: any) => p.name === 'takt-aidlc');
const configUnchanged = readFileSync(join(project, 'aidlc/takt-handoff/config.json'), 'utf8') === configBefore;
const summary = { verdict: loaded && hook?.exit_code === 0 && configUnchanged ? 'VERIFIED' : 'INCONCLUSIVE', plugin: init?.plugins, sessionStartHook: hook ? { name: hook.hook_name, code: hook.exit_code, outcome: hook.outcome } : null, configUnchanged, result: final?.result, run, limitations: ['確認対象はプラグインの読み込みと起動通知。通常のAI-DLCでの最終承認からの通し確認は別途必要。'] };
writeJson(join(run, 'summary.json'), summary);
console.log(JSON.stringify(summary, null, 2));
assert.equal(summary.verdict, 'VERIFIED');
