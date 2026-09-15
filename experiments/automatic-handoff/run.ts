import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, repo, testRoot } from '../../tests/handoff-fixture';
import { digest, readJson, writeJson, cleanEnvironment } from '../../src/handoff/io';
import type { Status } from '../../src/handoff/bridge';

const live = process.argv.includes('--live');
const f = await fixture({ provider: live ? 'claude' : 'mock' });
const cli = join(repo, 'src/handoff/cli.ts');
const sourceBefore = digest(readFileSync(join(f.project, 'src/value.ts')));
const requirementsBefore = digest(readFileSync(join(f.project, f.artifact)));
function invoke(event: string) {
  const result = spawnSync(process.execPath, [cli, 'hook', f.project], { cwd: f.project, env: cleanEnvironment(), input: JSON.stringify({ ...f.event, hook_event_name: event }), encoding: 'utf8', timeout: 15000 });
  writeJson(join(testRoot, event + '.json'), { code: result.status, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
invoke('PreToolUse');
const first = invoke('PostToolUse');
assert.equal(JSON.parse(first).hookSpecificOutput.hookEventName, 'PostToolUse');
// 同じ通知を再送しても、TAKTが二重に動かないことを確認する。
invoke('PostToolUse');
const runs = readdirSync(join(f.project, '.takt-aidlc/runs'));
assert.equal(runs.length, 1);
const run = join(f.project, '.takt-aidlc/runs', runs[0]);
console.log(`承認後イベントから自動起動しました: ${run}`);
const started = Date.now();
let status: Status;
while (true) {
  status = readJson<Status>(join(run, 'status.json'));
  if (['failed', 'verified'].includes(status.state)) break;
  if (Date.now() - started > 120000) throw new Error(`待機時間を超えました。状態: ${run}`);
  await Bun.sleep(250);
}
const result = {
  verdict: status.state === 'verified' ? 'VERIFIED' : 'NOT VERIFIED',
  upstream: 'AI-DLC v2.8.2 / 355903d6dc8eb07d3c77180be5d40ed679d6a40f',
  provider: live ? 'claude' : 'mock', trigger: 'synthetic approved boundary and hook payload; real hook handler',
  run, status,
  originalSourceUnchanged: digest(readFileSync(join(f.project, 'src/value.ts'))) === sourceBefore,
  originalRequirementsUnchanged: digest(readFileSync(join(f.project, f.artifact))) === requirementsBefore,
  parked: readFileSync(f.state, 'utf8').includes('**Parked**'),
  output: status.workspace && existsSync(join(status.workspace, 'src/value.ts')) ? readFileSync(join(status.workspace, 'src/value.ts'), 'utf8') : null,
  verification: existsSync(join(run, 'attempts', String(status.attempts), 'verification.json')) ? readJson(join(run, 'attempts', String(status.attempts), 'verification.json')) : null,
};
writeJson(join(testRoot, 'result.json'), result);
console.log(JSON.stringify(result, null, 2));
assert.equal(status.state, 'verified', status.error ?? '完了状態が不正です');
assert.equal(status.attempts, 1);
assert.equal(result.output, 'export const answer = 42;\n');
assert.ok(result.originalSourceUnchanged && result.originalRequirementsUnchanged && result.parked);
