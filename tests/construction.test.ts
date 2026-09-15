import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { constructionFixture } from '../experiments/construction/fixture';
import { captureApproval, executeHandoff, prepareHandoff } from '../src/handoff/bridge';
import { cleanEnvironment, command, readJson } from '../src/handoff/io';
import { put } from './handoff-fixture';

test('設計差し戻し・テスト失敗・コード指摘を修正し、再検証して完了する', async () => {
  const f = await constructionFixture({ repairs: true });
  captureApproval(f.project, f.event);
  const h = (await prepareHandoff(f.project, f.event))!;
  const result = await executeHandoff(f.project, h.id);
  expect(result.state).toBe('verified');
  const ledger = readJson<any[]>(join(h.run, 'attempts/1/control/ledger.json'));
  expect(ledger.filter(row => row.phase === 'design-review').map(row => row.verdict)).toEqual(['changes_requested', 'approved']);
  expect(ledger.filter(row => row.phase === 'test').map(row => row.verdict)).toEqual(['failed', 'passed', 'passed']);
  expect(ledger.filter(row => row.phase === 'code-review').map(row => row.verdict)).toEqual(['changes_requested', 'approved']);
  expect(ledger.find(row => row.phase === 'fix')).toBeDefined();
  expect(readFileSync(join(f.project, 'src/value.ts'), 'utf8')).toContain('41');
  // 実際にレビュー済みのコードを変えたら、同じ完了証跡は使えない。
  put(join(result.workspace!, 'src/value.ts'), 'export const answer = 43;\n');
  const stale = await command([process.execPath, join(h.run, 'attempts/1/control/construction-gate.ts'), 'result'], result.workspace!, cleanEnvironment(), 10000);
  expect(stale.code).not.toBe(0);
  expect(stale.stderr).toContain('レビュー後にコードが変化');
}, 60000);

test('人間の判断が必要な設計ではコードを書かずneeds_inputで停止する', async () => {
  const f = await constructionFixture({ needsInput: true });
  captureApproval(f.project, f.event);
  const h = (await prepareHandoff(f.project, f.event))!;
  const result = await executeHandoff(f.project, h.id);
  expect(result.state).toBe('needs_input');
  expect(result.construction?.questions).toHaveLength(1);
  expect(readFileSync(join(result.workspace!, 'src/value.ts'), 'utf8')).toContain('41');
  await expect(executeHandoff(f.project, h.id, true)).rejects.toThrow('実行できない');
}, 30000);

test('工程数の上限では未レビューの実装を成功扱いしない', async () => {
  const f = await constructionFixture({ maxSteps: 3 });
  captureApproval(f.project, f.event);
  const h = (await prepareHandoff(f.project, f.event))!;
  const result = await executeHandoff(f.project, h.id);
  expect(result.state).toBe('failed');
  expect(result.construction?.state).not.toBe('complete');
}, 30000);

test('実装中の追加判断も質問を保存してneeds_inputで停止する', async () => {
  const f = await constructionFixture({ implementationNeedsInput: true });
  captureApproval(f.project, f.event);
  const h = (await prepareHandoff(f.project, f.event))!;
  const result = await executeHandoff(f.project, h.id);
  expect(result.state).toBe('needs_input');
  expect(result.construction?.questions).toHaveLength(1);
  expect(readFileSync(join(result.workspace!, 'src/value.ts'), 'utf8')).toContain('41');
}, 30000);

test('設計担当がレポート外へファイルを作った場合も実装へ進まない', async () => {
  const f = await constructionFixture({ designWritesFile: true, maxSteps: 1 });
  captureApproval(f.project, f.event);
  const h = (await prepareHandoff(f.project, f.event))!;
  const result = await executeHandoff(f.project, h.id);
  expect(result.state).toBe('failed');
  expect(readFileSync(join(result.workspace!, 'src/value.ts'), 'utf8')).toContain('41');
}, 30000);
