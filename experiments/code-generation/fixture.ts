import { cpSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, put, repo } from '../../tests/handoff-fixture';
import { testRuntime, codexTestRuntime, prepareTestRuntime } from '../../scripts/test-runtime';
import { writeJson } from '../../src/handoff/io';
import { collectCgContext } from '../../src/code-generation/context';
import { testSource as baseTests } from '../construction/fixture';
const testSource = baseTests + `\nimport * as api from './value';\ntest('public API is unchanged', () => expect(Object.keys(api)).toEqual(['answer']));\ntest('answer is a finite integer', () => expect(Number.isFinite(answer) && Number.isInteger(answer)).toBe(true));\n`;

export async function cgFixture(options: { constructionEntry?: boolean; hostHarness?: 'claude' | 'codex'; live?: boolean; provider?: 'claude' | 'codex'; model?: string; reasoningEffort?: string; buildFailure?: boolean; sensorFailure?: boolean; blocked?: boolean; maxSteps?: number } = {}) {
  const f = await fixture({ approved: false });
  rmSync(join(f.project, '.takt-aidlc'), { recursive: true });
  for (const directory of ['aidlc-common', 'agents', 'knowledge', 'sensors']) cpSync(join(testRuntime, '.claude', directory), join(f.project, '.claude', directory), { recursive: true });
  if (options.hostHarness === 'codex') {
    await prepareTestRuntime('codex');
    cpSync(join(codexTestRuntime, '.codex'), join(f.project, '.codex'), { recursive: true });
    rmSync(join(f.project, '.claude'), { recursive: true });
  }
  const record = f.artifact.split('/inception/')[0];
  const unit = 'answer-value-update';
  let state = readFileSync(f.state, 'utf8').replace('**Scope**: feature', '**Scope**: classic\n- **Project Type**: Brownfield\n- **Test Strategy**: Standard').replace('**Current Stage**: functional-design', '**Current Stage**: code-generation');
  for (const stage of ['functional-design', 'nfr-requirements', 'nfr-design', 'infrastructure-design']) state = state.replace(new RegExp(`- \\[[^\\]]+\\] ${stage} — EXECUTE`), `- [S] ${stage} — EXECUTE`);
  if(options.constructionEntry) {
    state = state.replace('**Current Stage**: code-generation','**Current Stage**: functional-design').replaceAll('- [S]','- [ ]').replace('- [ ] functional-design','- [-] functional-design');
  } else state = state.replace('- [ ] code-generation', '- [-] code-generation');
  put(f.state, state);
  if(!options.constructionEntry) f.audit.appendAuditEntry('STAGE_STARTED', { Stage: 'code-generation', Details: 'SYNTHETIC CG ENTRY — not a human approval' }, f.project);
  const names = ['requirements-analysis/requirements.md', 'practices-discovery/team-practices.md', 'units-generation/unit-of-work.md', 'units-generation/unit-of-work-dependency.md', 'delivery-planning/bolt-plan.md'];
  for (const name of names) put(join(f.project, record, 'inception', name), readFileSync(join(repo, 'experiments/code-generation/input', name), 'utf8'));
  writeJson(join(f.project, record, 'project-description.json'), 'CG-INTENT-SENTINEL: 合成テスト入力。answerを41から42へ変更する。既存の設計・規約に従い、CG単体をHOTLで実行する。standardの5テストとビルドを必ず通す。');
  put(join(f.project, 'aidlc/spaces/default/memory/team.md'), '# Team\n\n## Testing Posture\n- **Methodology**: test-after\n- **Ordering**: 値を変更してから5件のテストを作り、ビルドと単一Unitのテストを実行する。\n- standard戦略に従って5テストを使い、行カバレッジ80%以上を満たす。\n\n## Code Style\n既存の名前付きexportを維持する。Lint基盤は追加しない。\n');
  const control = 'aidlc/takt-handoff';
  let workflow = readFileSync(join(repo, 'workflows/aidlc-code-generation.yaml'), 'utf8');
  if (options.maxSteps) workflow = workflow.replace('max_steps: 20', `max_steps: ${options.maxSteps}`);
  put(join(f.project, control, 'workflow.yaml'), workflow);
  put(join(f.project, control, 'build.ts'), `import { join } from 'node:path';\nconst result = await Bun.build({entrypoints:[join(process.cwd(),'src/value.ts')],target:'bun',outdir:join(process.cwd(),'cg/build')});\nif(!result.success){console.error(result.logs);process.exit(1)}\nconsole.log('Bun build passed');\n`);
  put(join(f.project, control, 'test.ts'), readFileSync(join(repo, 'experiments/native-session/verify-app.ts'), 'utf8').replace("['test', '--coverage'", "['test', 'src/value.test.ts', '--coverage'"));
  put(join(f.project, control, 'typecheck.ts'), `import {spawnSync} from 'node:child_process';\nconst r=spawnSync(process.execPath,[${JSON.stringify(join(repo, 'node_modules/typescript/bin/tsc'))},'--ignoreConfig','--noEmit','--strict','--skipLibCheck','--target','esnext','--module','esnext','--moduleResolution','bundler','--types','bun-types','src/value.ts','src/value.test.ts'],{encoding:'utf8'});\nconsole.log(JSON.stringify({pass:r.status===0,errors:r.stdout||r.stderr}));\n`);
  const artifacts = names.map(name => `${record}/inception/${name}`);
  const config = { hostHarness: options.hostHarness ?? 'claude', enabled: true, handoffStage: 'code-generation', artifacts, sources: ['src/value.ts'], workflow: `${control}/workflow.yaml`, buildScript: `${control}/build.ts`, verifyScript: `${control}/test.ts`, sensorScripts: { 'type-check': `${control}/typecheck.ts` }, sensorExceptions: { linter: { reason: 'このIntentの確定方針でLintを導入しない', source: `${record}/inception/practices-discovery/team-practices.md` } }, provider: options.live ? (options.provider ?? 'claude') : 'mock', disableBedrock: true, timeoutMs: 900000, mockScenario: `${control}/scenario.json` };
  if (options.live && options.provider === 'codex') Object.assign(config, { model: options.model ?? 'gpt-5.6-luna', codexReasoningEffort: options.reasoningEffort ?? 'max', timeoutMs: 1800000 });
  else if (options.model) Object.assign(config, { model: options.model });
  writeJson(join(f.project, control, 'config.json'), config);
  const context = collectCgContext(f.project, artifacts, unit, {}, options.hostHarness);
  const plan = { verdict: 'ready', testingContractHash: context.testingContract.contract_sha256,
    steps: [{ id: 1, unit, action: 'answerを42へ変更する', requirementIds: context.requirementIds, files: ['src/value.ts'] }, { id: 2, unit, action: '5件のテストを作り実行する', requirementIds: ['FR2'], files: ['src/value.test.ts'] }],
    unitTestInstructions: '## 実行方法\nbun test src/value.test.ts\n## 期待結果\n5件成功、行カバレッジ80%以上。',
    appliedRules: [{ source: `input/project/${context.stageFile}`, rule: 'テストをCGの計画に含める', application: 'Step 2で5テストを実装する' }, { source: 'input/context.json', rule: '固定Testing Contractを維持する', application: 'test-afterで実行する' }],
  };
  const approved = { verdict: 'approved', findings: [], alignment: { intent: '値42の要求に適合', stageDefinition: 'CGの計画と成果物に適合', conventions: '既存exportと追加依存なしを維持', testingContract: 'test-afterと品質目標を維持' } };
  const judge = (step: number) => ({ content: '', structured_output: { step, reason: 'deterministic CG fixture' } });
  const report = (data: unknown, choice = 1) => [{ content: 'CGの原文と入力を照合しました' }, { content: JSON.stringify(data) }, judge(choice)];
  const writes = (source: string) => [{ content: 'CG実装完了', file_writes: [
    { path: 'src/value.ts', content: source }, { path: 'src/value.test.ts', content: testSource },
    { path: 'cg/source-manifest.json', content: JSON.stringify({ stage: 'code-generation', version: 1, unit, writes: [{ path: 'src/value.ts' }, { path: 'src/value.test.ts' }] }) },
    { path: 'cg/traceability.json', content: JSON.stringify({ stage: 'code-generation', unit, upstream_ids: context.requirementIds, coverage: context.requirementIds.map(id => ({ id, status: 'OK', target: 'src/value.test.ts' })) }) },
  ] }, judge(1)];
  const scenario: unknown[] = options.blocked ? report({ ...plan, verdict: 'blocked', reason: '未確定の契約を推測せず停止する' }, 2) : [
    ...report(plan), ...report(approved),
    ...(options.buildFailure ? writes('export const answer = ;\n') : []),
    ...(options.sensorFailure ? writes('export const answer: string = 42;\n') : []),
    ...writes('export const answer = 42;\n'), ...report(approved),
    { content: 'CGを完了しました' }, { content: JSON.stringify({ verdict: 'complete', summary: 'ビルド、5テスト、型検査、CG成果物の検証が成功', notReproduced: ['human-approval', 'aidlc-lifecycle'] }) },
  ];
  writeJson(join(f.project, control, 'scenario.json'), scenario);
  return { ...f, control, context, config, unit, directive: { kind: 'run-stage', stage: 'code-generation', unit, gate: true }, event: { ...f.event, tool_input: { command: 'aidlc engine orchestrate next' }, tool_response: { stdout: JSON.stringify({ kind: 'run-stage', stage: 'code-generation', unit, gate: true }) } } };
}
