import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, put, repo } from '../../tests/handoff-fixture';
import { readJson, writeJson } from '../../src/handoff/io';

export const testSource = `import { expect, test } from 'bun:test';
import { answer } from './value';
test('answer is 42', () => expect(answer).toBe(42));
test('answer is numeric', () => expect(typeof answer).toBe('number'));
test('answer is not 41', () => expect(answer).not.toBe(41));
`;
const design = { verdict: 'ready', units: [{ id: 'U1', dependsOn: [], files: ['src/value.ts', 'src/value.test.ts'] }], functional: 'answerを42へ変更', nonfunctional: '依存追加なし', interfaces: '名前付きexportを維持', infrastructure: '不要', testPlan: '値・型・回帰の3テストと行カバレッジ80%以上', questions: [] };
const approved = { verdict: 'approved', findings: [], questions: [] };
const changes = { verdict: 'changes_requested', findings: [{ target: 'src/value.test.ts', reason: '型の検証がない', requestedChange: 'numberであることを検証する' }], questions: [] };
const judge = (step: number) => ({ content: '', structured_output: { step, reason: '決定的テストシナリオ' } });
const report = (value: unknown, rule = 1) => [{ content: '成果物を確認しました' }, { content: JSON.stringify(value) }, judge(rule)];
const implement = (value: number, tests = testSource) => [
  { content: '実装完了', file_writes: [{ path: 'src/value.ts', content: `export const answer = ${value};\n` }, { path: 'src/value.test.ts', content: tests }] }, judge(1),
];

export async function constructionFixture(options: { live?: boolean; repairs?: boolean; needsInput?: boolean; implementationNeedsInput?: boolean; designWritesFile?: boolean; maxSteps?: number } = {}) {
  const f = await fixture({ provider: options.live ? 'claude' : 'mock' });
  let workflow = readFileSync(join(repo, 'workflows/aidlc-construction.yaml'), 'utf8');
  if (options.maxSteps) workflow = workflow.replace('max_steps: 18', `max_steps: ${options.maxSteps}`);
  put(join(f.project, '.takt-aidlc/workflow.yaml'), workflow);
  put(join(f.project, '.takt-aidlc/verify.ts'), readFileSync(join(repo, 'experiments/native-session/verify-app.ts'), 'utf8'));
  // 元の実機で承認されたInceptionを、今回の実行境界の入力として複製する。
  const original = join(repo, 'experiments/construction/input');
  const names = ['requirements-analysis/requirements.md', 'practices-discovery/team-practices.md', 'units-generation/unit-of-work.md', 'units-generation/unit-of-work-dependency.md', 'delivery-planning/bolt-plan.md'];
  const record = f.artifact.split('/inception/')[0];
  for (const name of names) put(join(f.project, record, 'inception', name), readFileSync(join(original, name), 'utf8'));
  const c = readJson<any>(join(f.project, '.takt-aidlc/config.json'));
  Object.assign(c, { construction: true, disableBedrock: true, timeoutMs: 600000, artifacts: names.map(name => `${record}/inception/${name}`) });
  writeJson(join(f.project, '.takt-aidlc/config.json'), c);
  let scenario: unknown[];
  if (options.needsInput) {
    scenario = report({ ...design, verdict: 'needs_input', questions: ['承認済み要件の範囲を超える変更が必要です。対象を確認してください。'] }, 2);
  } else if (options.implementationNeedsInput) {
    scenario = [...report(design), ...report(approved), { content: '承認範囲外のためblocked', file_writes: [{ path: 'construction/questions.json', content: JSON.stringify({ questions: ['外部インターフェースを変更してよいか確認が必要です。'] }) }] }, judge(2)];
  } else {
    scenario = [...report(design)];
    if (options.repairs) scenario.push(...report({ ...changes, findings: [{ target: 'testPlan', reason: '型の検証がない', requestedChange: '型のテストを設計に含める' }] }, 2), ...report(design));
    scenario.push(...report(approved));
    if (options.repairs) scenario.push(...implement(43));
    scenario.push(...implement(42, options.repairs ? testSource.replace("test('answer is numeric', () => expect(typeof answer).toBe('number'));\n", '') : testSource));
    if (options.repairs) scenario.push(...report(changes, 2), ...implement(42));
    scenario.push(...report(approved), { content: '完了報告を作成します' }, { content: JSON.stringify({ verdict: 'complete', summary: '値42、テスト成功、レビュー指摘解消', limitations: ['小さな接続試験'], questions: [] }) });
  }
  writeJson(join(f.project, '.takt-aidlc/scenario.json'), scenario);
  if (options.designWritesFile) {
    Object.assign(scenario[0] as object, { file_writes: [{ path: '.kiro/specs/design.md', content: '想定外の設計ファイル' }] });
    writeJson(join(f.project, '.takt-aidlc/scenario.json'), scenario);
  }
  return f;
}
