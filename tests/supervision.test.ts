import { expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cgFixture } from '../experiments/code-generation/fixture';
import { phaseFixture } from '../experiments/construction-phase/fixture';
import { prepareCg, executeCg } from '../src/code-generation/runner';
import { capturePhase, preparePhase, executePhase } from '../src/construction-phase/runner';
import { command, cleanEnvironment, readJson, writeJson } from '../src/handoff/io';

// answer === 42 のビルド・テストは通るが、Intentの「6 * 7の式」は初回に欠けている。
test('CGのsuperviseが要件漏れを差し戻し、修正・再レビュー・再判定後に完了する', async () => {
  const f = await cgFixture({ supervisionRepair: true });
  const h = (await prepareCg(f.project, f.directive))!;
  const result = await executeCg(f.project, h.id);
  if (result.state !== 'verified') console.error(result.error);
  expect(result.state).toBe('verified');
  expect(readFileSync(join(result.workspace!, 'src/value.ts'), 'utf8')).toContain('6 * 7');
  const control = join(h.run, 'attempts/1/control');
  const ledger = readJson<any[]>(join(control, 'ledger.json'));
  expect(ledger.filter(r => r.phase === 'supervise').map(r => r.verdict)).toEqual(['changes_requested', 'approved']);
  expect(ledger.filter(r => r.phase === 'code-review')).toHaveLength(2);
  expect(ledger.filter(r => r.phase === 'build').every(r => r.verdict === 'passed')).toBe(true);
  const gate = join(control, 'code-generation-gate.ts');
  const root = join(result.workspace!, '.takt/runs');
  const reportPath = join(root, readdirSync(root)[0], 'reports/04-code-generation-supervision.json');
  const original = readFileSync(reportPath, 'utf8');
  writeJson(reportPath, { ...JSON.parse(original), requirements: [] });
  expect((await command([process.execPath, gate, 'supervise'], result.workspace!, cleanEnvironment(), 10000)).code).not.toBe(0);
  writeFileSync(reportPath, original);
  writeJson(join(control, 'ledger.json'), [...ledger, ledger.findLast(r => r.phase === 'code-review')]);
  const stale = await command([process.execPath, gate, 'finish'], result.workspace!, cleanEnvironment(), 10000);
  expect(stale.code).not.toBe(0);
  expect(stale.stderr).toContain('最新レビュー後のsuperviseが必要');
  writeJson(join(control, 'ledger.json'), ledger.filter(r => r.phase !== 'supervise'));
  expect((await command([process.execPath, gate, 'finish'], result.workspace!, cleanEnvironment(), 10000)).code).not.toBe(0);
  expect(readFileSync(join(f.project, 'src/value.ts'), 'utf8')).toContain('41');
}, 60000);

test('CGのsuperviseがblockedなら完了報告を生成しない', async () => {
  const f = await cgFixture({ supervisionBlocked: true });
  const h = (await prepareCg(f.project, f.directive))!;
  const result = await executeCg(f.project, h.id);
  expect(result.state).toBe('blocked');
  expect(existsSync(join(result.workspace!, 'cg/code-summary.md'))).toBe(false);
}, 30000);

test('Construction全体のsuperviseから所有Unitを修正し、全体工程と判定をやり直す', async () => {
  const f = await phaseFixture({ supervisionRepair: true });
  await capturePhase(f.project, f.event); f.approve();
  const h = (await preparePhase(f.project, f.event))!;
  const result = await executePhase(f.project, h.id);
  if (result.state !== 'verified') console.error(result.reason);
  expect(result.state).toBe('verified');
  expect(result.steps!.filter(s => s.stage === 'supervise').map(s => s.state)).toEqual(['changes_requested', 'approved']);
  expect(result.steps!.filter(s => s.stage === 'code-generation')).toHaveLength(2);
  expect(result.steps!.filter(s => s.stage === 'build-and-test')).toHaveLength(2);
  expect(result.steps!.filter(s => s.stage === 'ci-pipeline')).toHaveLength(2);
  expect(readFileSync(join(result.workspace!, 'src/value.ts'), 'utf8')).toContain('6 * 7');
  const supervisor = result.steps!.at(-1)!;
  const work = join(supervisor.attempt, 'work');
  writeFileSync(join(work, 'src/value.ts'), 'export const answer = 42;\n');
  const gate = join(supervisor.attempt, 'control/construction-supervision-gate.ts');
  expect((await command([process.execPath, gate], work, cleanEnvironment(), 10000)).code).not.toBe(0);
}, 180000);

test('Constructionのsuperviseがblockedなら人間承認待ちにせず終了する', async () => {
  const f = await phaseFixture({ supervisionBlocked: true });
  await capturePhase(f.project, f.event); f.approve();
  const h = (await preparePhase(f.project, f.event))!;
  const result = await executePhase(f.project, h.id);
  expect(result.state).toBe('blocked');
  expect(result.steps!.at(-1)?.stage).toBe('supervise');
  expect(existsSync(join(h.run, 'attempts/1/result'))).toBe(false);
}, 120000);

test('Constructionのsupervise差し戻しが収束しなければ上限で失敗する', async () => {
  const f = await phaseFixture({ supervisionRepair: true, supervisionRejectAgain: true });
  await capturePhase(f.project, f.event); f.approve();
  const h = (await preparePhase(f.project, f.event))!;
  const result = await executePhase(f.project, h.id);
  expect(result.state).toBe('failed');
  expect(result.reason).toContain('supervise修正上限');
  expect(result.steps!.filter(s => s.stage === 'supervise')).toHaveLength(2);
  expect(existsSync(join(h.run, 'attempts/1/result'))).toBe(false);
}, 180000);

test('superviseを省略したWorkflowは両モードともpark前に拒否する', async () => {
  const cg = await cgFixture();
  const cgState = readFileSync(cg.state, 'utf8');
  const cgPath = join(cg.project, cg.config.workflow);
  const cgWorkflow = Bun.YAML.parse(readFileSync(cgPath, 'utf8')) as any;
  cgWorkflow.steps = cgWorkflow.steps.filter((step: any) => step.name !== 'supervise');
  writeFileSync(cgPath, Bun.YAML.stringify(cgWorkflow));
  await expect(prepareCg(cg.project, cg.directive)).rejects.toThrow('supervise');
  expect(readFileSync(cg.state, 'utf8')).toBe(cgState);
  const phase = await phaseFixture();
  const state = readFileSync(phase.state, 'utf8');
  const path = join(phase.project, phase.config.constructionWorkflow);
  const original = readFileSync(path, 'utf8');
  const workflow = Bun.YAML.parse(original) as any;
  workflow.steps = workflow.steps.filter((step: any) => step.name !== 'supervise');
  writeFileSync(path, Bun.YAML.stringify(workflow));
  await expect(capturePhase(phase.project, phase.event)).rejects.toThrow('supervise');
  expect(readFileSync(phase.state, 'utf8')).toBe(state);
  writeFileSync(path, original);
  const phaseCgPath = join(phase.project, phase.config.workflow);
  const phaseCg = Bun.YAML.parse(readFileSync(phaseCgPath, 'utf8')) as any;
  phaseCg.steps = phaseCg.steps.filter((step: any) => step.name !== 'supervise');
  writeFileSync(phaseCgPath, Bun.YAML.stringify(phaseCg));
  await expect(capturePhase(phase.project, phase.event)).rejects.toThrow('supervise');
  expect(readFileSync(phase.state, 'utf8')).toBe(state);
}, 30000);
