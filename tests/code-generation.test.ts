import { expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { cgFixture } from '../experiments/code-generation/fixture';
import { executeCg, isCgEntryCommand, prepareCg } from '../src/code-generation/runner';
import { collectCgContext } from '../src/code-generation/context';
import { command, cleanEnvironment, readJson } from '../src/handoff/io';
import { put } from './handoff-fixture';

test('CG原文を展開し、ビルド失敗・型検査不合格を修正してから完了する', async () => {
  const f = await cgFixture({ buildFailure: true, sensorFailure: true });
  const h = (await prepareCg(f.project, f.directive))!;
  expect((await prepareCg(f.project, f.directive))!.id).toBe(h.id);
  const result = await executeCg(f.project, h.id);
  expect(result.state).toBe('verified');
  expect(readFileSync(join(result.workspace!, 'cg/code-generation-plan.md'), 'utf8')).toContain('Requirements: FR1');
  expect(readFileSync(join(result.workspace!, 'cg/code-generation-plan.md'), 'utf8')).toContain('- [x] Step 1');
  const control = join(h.run, 'attempts/1/control');
  const ledger = readJson<any[]>(join(control, 'ledger.json'));
  expect(ledger.filter(x => x.phase === 'build').map(x => x.verdict)).toEqual(['failed', 'passed', 'passed']);
  expect(ledger.filter(x => x.phase === 'sensor').map(x => x.verdict)).toEqual(['failed', 'passed']);
  const injection = readJson<any>(join(control, 'injection.json'));
  expect(injection.implement.sources.some((x: any) => x.path === f.context.stageFile)).toBe(true);
  expect(injection.implement.sources.some((x: any) => x.path === f.context.intentFile)).toBe(true);
  expect(injection.implement.sources.some((x: any) => x.path.endsWith('/aidlc-type-check.md'))).toBe(true);
  const runs = join(result.workspace!, '.takt/runs');
  const logs = join(runs, readdirSync(runs)[0], 'logs');
  const events = readFileSync(join(logs, readdirSync(logs).find(n => n.endsWith('.jsonl'))!), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const prompt = events.find(e => e.type === 'phase_start' && e.step === 'plan' && e.phase === 1).instruction;
  expect(prompt).toContain('CG-INTENT-SENTINEL');
  expect(prompt).toContain('# type-check sensor');
  expect(prompt).toContain('### Critical Rules');
  expect(readFileSync(join(f.project, 'src/value.ts'), 'utf8')).toBe('export const answer = 41;\n');
  expect(f.lib.readAuditShardEvents(f.project).some((r: any) => r.event === 'PLAN_APPROVAL_RECORDED' || r.event === 'GATE_APPROVED')).toBe(false);
  put(join(result.workspace!, 'src/value.ts'), 'export const answer = 43;\n');
  const stale = await command([process.execPath, join(control, 'cg-gate.ts'), 'result'], result.workspace!, cleanEnvironment(), 10000);
  expect(stale.code).not.toBe(0);
}, 60000);

test('CG外の指示は委譲せず、解決不能なCGは対話待ちでなくblockedで終了する', async () => {
  const f = await cgFixture({ blocked: true });
  expect(await prepareCg(f.project, { kind: 'run-stage', stage: 'functional-design' })).toBeNull();
  const h = (await prepareCg(f.project, f.directive))!;
  const result = await executeCg(f.project, h.id);
  expect(result.state).toBe('blocked');
  expect(readFileSync(join(result.workspace!, 'src/value.ts'), 'utf8')).toContain('41');
  await expect(executeCg(f.project, h.id)).rejects.toThrow('開始できません');
}, 30000);

test('本家のセンサー定義の欠落と入力変化を拒否する', async () => {
  const f = await cgFixture();
  const sensor = join(f.project, '.claude/sensors/aidlc-traceability.md');
  const original = readFileSync(sensor, 'utf8'); unlinkSync(sensor);
  await expect(prepareCg(f.project, f.directive)).rejects.toThrow();
  expect(readFileSync(f.state, 'utf8')).not.toContain('**Parked**');
  put(sensor, original);
  const h = (await prepareCg(f.project, f.directive))!;
  put(join(f.project, f.context.intentFile), '"changed intent"');
  expect((await executeCg(f.project, h.id)).state).toBe('failed');
  expect(existsSync(join(h.run, 'attempts/1/work'))).toBe(false);
}, 30000);

test('未対応のTesting Contractをtest-afterへ勝手に変更しない', async () => {
  const f = await cgFixture();
  put(join(f.project, 'aidlc/spaces/default/memory/team.md'), '# Team\n\n## Testing Posture\n- **Methodology**: TDD\n- **Ordering**: Red, Green, Refactor.\n');
  expect(() => collectCgContext(f.project, f.config.artifacts, f.unit)).toThrow();
  expect(isCgEntryCommand('aidlc engine orchestrate next --stage code-generation')).toBe(true);
  expect(isCgEntryCommand('aidlc engine orchestrate next 2>&1; echo ok')).toBe(false);
});
