import { beforeAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildPlugin, codexOutput } from '../scripts/build-plugin';
import { cleanEnvironment, digest, readJson, writeJson } from '../src/handoff/io';
import { codexCommand, codexStdout, codexDirective } from '../src/hosts/codex';
import { phaseFixture } from '../experiments/construction-phase/fixture';
import { cgFixture } from '../experiments/code-generation/fixture';
import { repo, testRoot } from './handoff-fixture';

const session = '01a0a51c-1115-79d0-8218-76d497c5779d';
const prefix = `export AIDLC_SESSION_OVERRIDE='${session}' AIDLC_SESSION_OVERRIDE_SOURCE='payload'; `;
let installed: string;
let hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
beforeAll(async () => {
  await buildPlugin();
  const moved = join(testRoot, 'codex marketplace with spaces');
  cpSync(dirname(dirname(codexOutput)), moved, { recursive: true });
  const home = join(testRoot, 'codex-install-home'); mkdirSync(home, { recursive: true });
  const env = { ...cleanEnvironment(), CODEX_HOME: home };
  for (const args of [['plugin', 'marketplace', 'add', moved, '--json'], ['plugin', 'add', 'takt-aidlc@takt-aidlc-local', '--json']]) {
    const r = spawnSync('codex', args, { env, encoding: 'utf8', timeout: 30000 });
    expect(r.status).toBe(0);
    if (args[1] === 'add') installed = JSON.parse(r.stdout).installedPath;
  }
  expect(installed).toBeTruthy();
  expect(readFileSync(join(installed, 'scripts/handoff.js'), 'utf8')).not.toContain(repo);
  expect(digest(readFileSync(join(installed, 'scripts/code-generation-gate.ts')))).toBe(digest(readFileSync(join(repo, 'src/code-generation/code-generation-gate.ts'))));
  hooks = readJson<any>(join(installed, 'hooks/hooks.json')).hooks;
}, 60000);

function invoke(project: string, eventName: string, payload: unknown) {
  return spawnSync('/bin/sh', ['-c', hooks[eventName][0].hooks[0].command], {
    cwd: project, env: { ...cleanEnvironment(), PLUGIN_ROOT: installed },
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 15000,
  });
}

test('実際のCodex CLIでインストールした配布物からCGを一度だけ起動する', async () => {
  const f = await cgFixture({ hostHarness: 'codex', buildFailure: true, sensorFailure: true });
  expect(existsSync(join(f.project, '.claude'))).toBe(false);
  const event = { ...f.event, session_id: session, tool_input: { command: prefix + 'aidlc engine orchestrate next' }, tool_response: JSON.stringify(f.directive) };
  const notice = invoke(f.project, 'SessionStart', { ...event, hook_event_name: 'SessionStart' });
  expect(notice.status).toBe(0); expect(notice.stdout).toContain('CG単体');
  const pre = invoke(f.project, 'PreToolUse', { ...event, hook_event_name: 'PreToolUse' });
  expect(pre.status).toBe(0);
  for (let i = 0; i < 2; i++) {
    const r = invoke(f.project, 'PostToolUse', event);
    expect(r.status).toBe(0); expect(JSON.parse(r.stdout).continue).toBe(false);
  }
  const root = join(f.project, 'aidlc/takt-handoff/code-generation-stage-runs');
  const ids = readdirSync(root).filter(n => /^[a-f0-9]{24}$/.test(n)); expect(ids).toHaveLength(1);
  const run = join(root, ids[0]);
  let status: any;
  const deadline = Date.now() + 30000;
  do {
    status = readJson(join(run, 'status.json'));
    if (['verified', 'failed', 'blocked'].includes(status.state)) break;
    await Bun.sleep(100);
  } while (Date.now() < deadline);
  expect(status.state).toBe('verified'); expect(status.attempts).toBe(1);
  expect(readFileSync(join(f.project, 'src/value.ts'), 'utf8')).toContain('41');
  const injection = readJson<any>(join(run, 'attempts/1/control/injection.json'));
  const paths = injection.implement.sources.map((s: any) => s.path);
  expect(paths).toContain('.codex/aidlc-common/stages/construction/code-generation.md');
  expect(paths).toContain('.codex/sensors/aidlc-type-check.md');
  expect(paths.some((p: string) => p.startsWith('.claude/'))).toBe(false);
  const ledger = readJson<any[]>(join(run, 'attempts/1/control/ledger.json'));
  expect(ledger.some(r => r.phase === 'build' && r.verdict === 'failed')).toBe(true);
  expect(ledger.some(r => r.phase === 'sensor' && r.verdict === 'failed')).toBe(true);
}, 60000);

test('Codexの不一致・複合コマンド・未完了出力では委譲しない', async () => {
  const f = await cgFixture({ hostHarness: 'codex' });
  const event = { ...f.event, session_id: session, tool_response: JSON.stringify(f.directive) };
  for (const cmd of ['aidlc engine orchestrate next; echo ok', prefix + 'aidlc engine orchestrate next 2>&1', 'aidlc engine orchestrate next --project-dir /another-project']) {
    const r = invoke(f.project, 'PreToolUse', { ...event, hook_event_name: 'PreToolUse', tool_input: { command: cmd } });
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  }
  for (const changed of [
    { tool_input: { command: prefix.replace(session, 'wrong-session') + 'aidlc engine orchestrate next' } },
    { tool_response: { stdout: JSON.stringify(f.directive), exit_code: 1 } },
    { tool_response: { stdout: JSON.stringify(f.directive), session_id: 42 } },
    { cwd: repo },
  ]) expect(invoke(f.project, 'PostToolUse', { ...event, ...changed }).status).toBe(2);
  const otherStage = invoke(f.project, 'PostToolUse', { ...event, tool_response: '{"kind":"run-stage","stage":"functional-design"}' });
  expect(otherStage.status).toBe(0); expect(otherStage.stdout).toBe('');
  expect(existsSync(join(f.project, 'aidlc/takt-handoff/code-generation-stage-runs'))).toBe(false);
  writeJson(join(f.project, 'aidlc/takt-handoff/config.json'), { enabled: false });
  expect(invoke(f.project, 'PostToolUse', event).stdout).toBe('');
}, 30000);

test('観測したCodexのstdout文字列と既知のセッション前置きを正規化する', () => {
  expect(codexDirective('aidlc-orchestrate: runtime-graph.json bolt_dag is missing or stale; recomputed 1 unit batch(es)\n{"kind":"load-steering"}\n')).toEqual({kind: 'load-steering'});
  expect(() => codexDirective('unrecognized output\n{"kind":"run-stage"}')).toThrow();
  expect(() => codexDirective('{}\n{}')).toThrow();
  expect(codexStdout('{"kind":"run-stage","stage":"code-generation"}')).toContain('run-stage');
  expect(codexCommand(prefix + 'aidlc engine orchestrate next', session)).toBe('aidlc engine orchestrate next');
  expect(() => codexCommand(prefix + 'aidlc engine orchestrate next', 'wrong')).toThrow();
  expect(() => codexStdout({ stdout: '{}', interrupted: true, exit_code: 0 })).toThrow();
});


test('CodexのInception承認からConstructionを一度だけ委譲する',async()=>{
  const f=await phaseFixture({host:'codex',blocked:true});
  const event={...f.event,session_id:session,tool_input:{command:prefix+f.event.tool_input.command},tool_response:f.event.tool_response.stdout};
  expect(invoke(f.project,'SessionStart',{...event,hook_event_name:'SessionStart'}).stdout).toContain('Construction全体');
  expect(invoke(f.project,'PreToolUse',{...event,hook_event_name:'PreToolUse'}).status).toBe(0);f.approve();
  for(let i=0;i<2;i++){const r=invoke(f.project,'PostToolUse',event);expect(r.status).toBe(0);expect(JSON.parse(r.stdout).continue).toBe(false);}
  const root=join(f.project,'aidlc/takt-handoff/construction-phase-runs');const ids=readdirSync(root).filter(n=>/^[a-f0-9]{24}$/.test(n));expect(ids).toHaveLength(1);
  let status:any;const deadline=Date.now()+20000;do{status=readJson(join(root,ids[0],'status.json'));if(status.state==='blocked'||status.state==='failed')break;await Bun.sleep(100);}while(Date.now()<deadline);
  expect(status.state).toBe('blocked');expect(status.attempts).toBe(1);
},60000);
