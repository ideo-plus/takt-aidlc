import { beforeAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPlugin, output } from '../scripts/build-plugin';
import { cleanEnvironment, digest, readJson, writeJson } from '../src/handoff/io';
import { repo, testRoot } from './handoff-fixture';
import { phaseFixture } from '../experiments/construction-phase/fixture';
import { cgFixture } from '../experiments/code-generation/fixture';

let moved: string;
let hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
beforeAll(async () => {
  await buildPlugin();
  moved = join(testRoot, 'standalone plugin with spaces');
  cpSync(output, moved, { recursive: true });
  hooks = readJson<any>(join(moved, 'hooks/hooks.json')).hooks;
});

function invoke(project: string, eventName: string, payload: unknown) {
  return spawnSync('/bin/sh', ['-c', hooks[eventName][0].hooks[0].command], {
    cwd: project,
    env: { ...cleanEnvironment(), CLAUDE_PLUGIN_ROOT: moved, CLAUDE_PROJECT_DIR: project },
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 15000,
  });
}

test('ビルド結果は再現でき、リポジトリの絶対パスに依存しない', async () => {
  const original = digest(readFileSync(join(moved, 'scripts/handoff.js')));
  expect(readFileSync(join(moved, 'scripts/handoff.js'), 'utf8')).not.toContain(repo);
  await buildPlugin();
  expect(digest(readFileSync(join(output, 'scripts/handoff.js')))).toBe(original);
});

test('未設定のプロジェクトは承認コマンドを実行しても何も作らない', () => {
  const project = join(testRoot, 'unconfigured'); mkdirSync(project, { recursive: true });
  const payload = { tool_name: 'Bash', tool_input: { command: 'aidlc engine orchestrate report --stage delivery-planning --result approved' } };
  for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse']) {
    const result = invoke(project, event, { ...payload, hook_event_name: event });
    expect(result.status).toBe(0); expect(result.stdout).toBe('');
  }
  expect(existsSync(join(project, 'aidlc'))).toBe(false);
});

test('enabled:falseなら未完成の設定でも通常のAI-DLCを妨げない', () => {
  const project = join(testRoot, 'disabled'); mkdirSync(project, { recursive: true });
  writeJson(join(project, 'aidlc/takt-handoff/config.json'), { enabled: false });
  for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse']) {
    const result = invoke(project, event, { hook_event_name: event, tool_name: 'Bash', tool_input: { command: 'aidlc engine orchestrate report --stage delivery-planning --result approved' } });
    expect(result.status).toBe(0); expect(result.stdout).toBe('');
  }
  expect(existsSync(join(project, 'aidlc/takt-handoff/pending'))).toBe(false);
});

test('フック失敗時はConstructionを続行しないよう明示する', async () => {
  const f = await phaseFixture();
  const result = invoke(f.project, 'PostToolUse', { ...f.event, tool_response: { stdout: '{"kind":"error"}' } });
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('Constructionを進めず、このターンを終了');
  expect(existsSync(join(f.project, 'aidlc/takt-handoff/construction-phase-runs'))).toBe(false);
});

test('承認にechoやリダイレクトを付けたら実行前に形式修正を促す', async () => {
  const f = await phaseFixture();
  for (const command of [f.event.tool_input.command + ' 2>&1\necho "EXIT:$?"', 'echo before; ' + f.event.tool_input.command]) {
    const result = invoke(f.project, 'PreToolUse', { ...f.event, hook_event_name: 'PreToolUse', tool_input: { command } });
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout).hookSpecificOutput;
    expect(output.permissionDecision).toBe('deny');
    expect(output.permissionDecisionReason).toContain('まだ実行されていません');
    expect(existsSync(join(f.project, 'aidlc/takt-handoff/pending'))).toBe(false);
  }
  const harmless = invoke(f.project, 'PreToolUse', { ...f.event, hook_event_name: 'PreToolUse', tool_input: { command: `echo '${f.event.tool_input.command}'` } });
  expect(harmless.stdout).toBe('');
  for (const suffix of [' --single', ' --project-dir /another-project']) {
    const unrelated = invoke(f.project, 'PreToolUse', { ...f.event, hook_event_name: 'PreToolUse', tool_input: { command: f.event.tool_input.command + suffix + ' 2>&1' } });
    expect(unrelated.stdout).toBe('');
  }
});

test('CG設定はInception承認で起動せず、CG入口から一度だけ自動実行する', async () => {
  const f = await cgFixture();
  expect(existsSync(join(moved, 'scripts/code-generation-gate.ts'))).toBe(true);
  expect(existsSync(join(moved, 'takt/ja/workflows/aidlc-code-generation-stage.yaml'))).toBe(true);
  const denied = invoke(f.project, 'PreToolUse', { ...f.event, hook_event_name: 'PreToolUse', tool_input: { command: 'aidlc engine orchestrate next 2>&1; echo ok' } });
  expect(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  const inceptionResponse = invoke(f.project, 'PostToolUse', { ...f.event, tool_input: { command: 'aidlc engine orchestrate report --stage delivery-planning --result approved' }, tool_response: { stdout: '{"kind":"done"}' } });
  expect(inceptionResponse.stdout).toBe('');
  expect(existsSync(join(f.project, 'aidlc/takt-handoff/code-generation-stage-runs'))).toBe(false);
  for (let n = 0; n < 2; n++) {
    const started = invoke(f.project, 'PostToolUse', f.event);
    expect(started.status).toBe(0);
    expect(started.stdout).toContain('CG単体');
  }
  const { readdirSync } = await import('node:fs');
  const runs = join(f.project, 'aidlc/takt-handoff/code-generation-stage-runs');
  const ids = readdirSync(runs).filter(n => /^[a-f0-9]{24}$/.test(n)); expect(ids).toHaveLength(1);
  const path = join(runs, ids[0], 'status.json');
  const until = Date.now() + 25000;
  let state: any;
  do {
    state = readJson(path);
    if (['verified', 'failed', 'blocked'].includes(state.state)) break;
    await Bun.sleep(100);
  } while (Date.now() < until);
  expect(state.state).toBe('verified'); expect(state.attempts).toBe(1);
  expect(readFileSync(join(f.project, 'src/value.ts'), 'utf8')).toContain('41');
}, 60000);


test('Claude Codeの配布物もConstruction全体を委譲する',async()=>{
  const f=await phaseFixture({blocked:true});
  expect(invoke(f.project,'SessionStart',{}).stdout).toContain('Construction全体');
  expect(invoke(f.project,'PreToolUse',{...f.event,hook_event_name:'PreToolUse'}).status).toBe(0);f.approve();
  const r=invoke(f.project,'PostToolUse',f.event);expect(r.status).toBe(0);expect(r.stdout).toContain('Construction全体');
  const {readdirSync}=await import('node:fs');const root=join(f.project,'aidlc/takt-handoff/construction-phase-runs');const id=readdirSync(root).find(n=>/^[a-f0-9]{24}$/.test(n))!;
  let status:any;const deadline=Date.now()+20000;do{status=readJson(join(root,id,'status.json'));if(status.state==='blocked'||status.state==='failed')break;await Bun.sleep(100);}while(Date.now()<deadline);
  expect(status.state).toBe('blocked');
},60000);
