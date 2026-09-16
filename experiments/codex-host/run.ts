import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { cgFixture } from '../code-generation/fixture';
import { buildPlugin, codexOutput } from '../../scripts/build-plugin';
import { cleanEnvironment, command, readJson, requireSuccess, writeJson } from '../../src/handoff/io';

// 合成Intent/CG入口 + 実際のCodexホストとAI-DLCフック + TAKT mock。
// 人間承認や実モデルによるCG生成を実証する試験ではない。
await buildPlugin();
const f = await cgFixture({ hostHarness: 'codex' });
const base = resolve(f.project, '..', 'codex-host'); mkdirSync(base, { recursive: true });
const home = join(base, 'home'); mkdirSync(home, { mode: 0o700 });
const authHome = process.env.CODEX_HOME ?? join(homedir(), '.codex');
for (const name of ['auth.json', 'models_cache.json']) {
  if (existsSync(join(authHome, name))) symlinkSync(join(authHome, name), join(home, name));
}
const env = { ...cleanEnvironment(), CODEX_HOME: home };
writeFileSync(join(home, 'config.toml'), `model = "gpt-5.6-luna"\nmodel_reasoning_effort = "max"\n[features]\nhooks = true\nremote_plugin = false\n[projects.${JSON.stringify(f.project)}]\ntrust_level = "trusted"\n`);
// 実験用ホストのBedrock設定だけを置き換える。ネイティブhooks.jsonはそのまま使う。
writeFileSync(join(f.project, '.codex/config.toml'), '[shell_environment_policy]\nset = { AIDLC_RULES_DIR = "aidlc/spaces/default/memory" }\n');
for (const argv of [
  ['git', 'init', '-q', f.project],
  ['codex', 'plugin', 'marketplace', 'add', resolve(codexOutput, '../..'), '--json'],
  ['codex', 'plugin', 'add', 'takt-aidlc@takt-aidlc-local', '--json'],
]) requireSuccess(await command(argv, f.project, env, 30000));
console.log(JSON.stringify({ project: f.project, base }));
const prompt = 'これは合成Intentを使うCG入口の接続試験です。まず aidlc engine orchestrate next を単独のコマンドで実行してください。load-steeringなら規約を読み、返されたcontinue_tokenで aidlc engine orchestrate continue <token> を単独実行してください。TAKT委譲のフック通知が来たら、設計・実装・承認操作をせず、委譲した旨だけ返してターンを終了してください。人の承認を作らず、他のエージェントを起動せず、入力ファイルを変更しないでください。';
const host = await command(['codex', 'exec', '--dangerously-bypass-hook-trust', '-C', f.project, '-s', 'workspace-write', '--json', prompt], f.project, env, 180000);
writeJson(join(base, 'host.json'), host);
const runs = join(f.project, 'aidlc/takt-handoff/code-generation-stage-runs');
const ids = existsSync(runs) ? readdirSync(runs).filter(n => /^[a-f0-9]{24}$/.test(n)) : [];
let status: any;
if (ids.length === 1) {
  const deadline = Date.now() + 30000;
  do {
    status = readJson(join(runs, ids[0], 'status.json'));
    if (['verified', 'failed', 'blocked'].includes(status.state)) break;
    await Bun.sleep(100);
  } while (Date.now() < deadline);
}
const result = { scope: 'Real Codex host and native AI-DLC hooks; synthetic Intent/entry; TAKT mock worker', model: 'gpt-5.6-luna', reasoningEffort: 'max', hostExitCode: host.code, hostTimedOut: host.timedOut, runIds: ids, state: status?.state ?? 'not-started', originalSource: readFileSync(join(f.project, 'src/value.ts'), 'utf8'), project: f.project };
writeJson(join(base, 'result.json'), result); console.log(JSON.stringify(result));
assert.equal(host.code, 0); assert.equal(status?.state, 'verified');
