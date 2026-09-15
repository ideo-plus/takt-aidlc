import { test, expect } from 'bun:test';
import { chmodSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { approvalCommand, captureApproval, prepareHandoff, executeHandoff, storage } from '../src/handoff/bridge';
import { readJson, writeJson } from '../src/handoff/io';
import { fixture, put } from './handoff-fixture';

test('native reportのdone応答でも承認・完了記録を照合してparkする', async () => {
  const response = { stdout: JSON.stringify({ kind: 'done', reason: 'Committed approve for "delivery-planning" (scope: classic). State advanced; run next to continue.' }) };
  const f = await fixture();
  captureApproval(f.project, f.event);
  const result = await prepareHandoff(f.project, { ...f.event, tool_response: response });
  expect(result?.status.state).toBe('parked');
  const unapproved = await fixture({ approved: false });
  captureApproval(unapproved.project, unapproved.event);
  await expect(prepareHandoff(unapproved.project, { ...unapproved.event, tool_response: response })).rejects.toThrow('承認・完了記録');
  expect(readFileSync(unapproved.state, 'utf8')).not.toContain('**Parked**');
});

test('承認→park→TAKT→独立検証。同じ通知は同じrunに収束する', async () => {
  const f = await fixture(); captureApproval(f.project, f.event);
  const before = readFileSync(join(f.project, f.artifact), 'utf8');
  const h = (await prepareHandoff(f.project, f.event))!;
  expect(h.status.state).toBe('parked');
  expect(readFileSync(f.state, 'utf8')).toContain('**Parked**');
  const duplicate = (await prepareHandoff(f.project, f.event))!;
  expect(duplicate.id).toBe(h.id);
  const result = await executeHandoff(f.project, h.id);
  expect(result.state).toBe('verified'); expect(result.attempts).toBe(1);
  expect(readFileSync(join(result.workspace!, 'src/value.ts'), 'utf8')).toContain('42');
  expect(readFileSync(join(f.project, 'src/value.ts'), 'utf8')).toContain('41');
  expect(readFileSync(join(f.project, f.artifact), 'utf8')).toBe(before);
  expect((await executeHandoff(f.project, h.id)).attempts).toBe(1);
}, 30000);

test('AI-DLC管理領域の専用名前空間でも引き継げる', async () => {
  const f = await fixture();
  renameSync(join(f.project, '.takt-aidlc'), join(f.project, 'aidlc/takt-handoff'));
  const path = join(f.project, 'aidlc/takt-handoff/config.json');
  const config = readJson<any>(path);
  for (const key of ['workflow', 'verifyScript', 'mockScenario']) config[key] = config[key].replace('.takt-aidlc/', 'aidlc/takt-handoff/');
  writeJson(path, config);
  expect(storage(f.project)).toBe(join(f.project, 'aidlc/takt-handoff'));
  captureApproval(f.project, f.event);
  const h = (await prepareHandoff(f.project, f.event))!;
  expect(h.run.startsWith(join(f.project, 'aidlc/takt-handoff/runs'))).toBe(true);
  expect((await executeHandoff(f.project, h.id)).state).toBe('verified');
}, 30000);

test('承認記録がない・承認前の入力記録がない場合は起動しない', async () => {
  const f = await fixture({ approved: false });
  await expect(prepareHandoff(f.project, f.event)).rejects.toThrow();
  captureApproval(f.project, f.event);
  await expect(prepareHandoff(f.project, f.event)).rejects.toThrow('承認・完了記録');
  expect(readFileSync(f.state, 'utf8')).not.toContain('**Parked**');
});

test('echo・連結コマンド・拒否結果を承認として扱わない', async () => {
  const f = await fixture(); const cmd = f.event.tool_input.command!;
  expect(approvalCommand(`echo ${cmd}`, f.project)).toBe(false);
  expect(approvalCommand(`${cmd}; echo ok`, f.project)).toBe(false);
  expect(approvalCommand("'aidlc'engine orchestrate report --stage delivery-planning --result approved", f.project)).toBe(false);
  expect(approvalCommand(`${cmd} --user-input "Approve Plan"`, f.project)).toBe(true);
  expect(approvalCommand('aidlc engine orchestrate report --result approved --stage delivery-planning', f.project)).toBe(true);
  expect(approvalCommand('bun .claude/tools/aidlc.ts engine orchestrate report --stage "delivery-planning" --result approved --user-input "Approve"', f.project)).toBe(true);
  expect(approvalCommand(`${cmd} --single`, f.project)).toBe(false);
  expect(approvalCommand(`${cmd} --user-input "$(echo forged)"`, f.project)).toBe(false);
  captureApproval(f.project, f.event);
  await expect(prepareHandoff(f.project, { ...f.event, tool_response: { stdout: '{"kind":"error"}' } })).rejects.toThrow('成功していません');
});

test('承認処理中の成果物変更はpark前に検出する', async () => {
  const f = await fixture(); captureApproval(f.project, f.event);
  put(join(f.project, f.artifact), '# 変更された要求\n');
  await expect(prepareHandoff(f.project, f.event)).rejects.toThrow('入力が変化');
  expect(readFileSync(f.state, 'utf8')).not.toContain('**Parked**');
});

test('park後の入力変更はTAKT起動前に検出する', async () => {
  const f = await fixture(); captureApproval(f.project, f.event);
  const h = (await prepareHandoff(f.project, f.event))!;
  put(join(f.project, 'src/value.ts'), 'changed');
  const result = await executeHandoff(f.project, h.id);
  expect(result.state).toBe('failed'); expect(result.attempts).toBe(0);
});

test('固定した検証スクリプトの改変も起動前に検出する', async () => {
  const f = await fixture(); captureApproval(f.project, f.event);
  const h = (await prepareHandoff(f.project, f.event))!;
  const script = join(h.run, 'snapshot/.takt-aidlc/verify.ts');
  chmodSync(script, 0o644); put(script, 'process.exit(0);');
  const result = await executeHandoff(f.project, h.id);
  expect(result.state).toBe('failed'); expect(result.attempts).toBe(0);
});

test('TAKTが終了コード0でも成果物が不正なら失敗とする', async () => {
  const f = await fixture({ write: false }); captureApproval(f.project, f.event);
  const h = (await prepareHandoff(f.project, f.event))!;
  const result = await executeHandoff(f.project, h.id);
  expect(readJson<any>(join(h.run, 'attempts/1/takt.json')).code).toBe(0);
  expect(result.state).toBe('failed');
}, 30000);

test('検証失敗後は同じ固定入力から新しい作業領域で再試行する', async () => {
  const f = await fixture({ failOnce: true }); captureApproval(f.project, f.event);
  const h = (await prepareHandoff(f.project, f.event))!;
  const first = await executeHandoff(f.project, h.id); expect(first.state).toBe('failed');
  await expect(executeHandoff(f.project, h.id)).rejects.toThrow('実行できない');
  const second = await executeHandoff(f.project, h.id, true);
  expect(second.state).toBe('verified'); expect(second.attempts).toBe(2);
  expect(second.workspace).not.toBe(first.workspace);
}, 30000);

test('並行したworkerでもTAKTは1回だけ起動する', async () => {
  const f = await fixture(); captureApproval(f.project, f.event);
  const h = (await prepareHandoff(f.project, f.event))!;
  const results = await Promise.allSettled([executeHandoff(f.project, h.id), executeHandoff(f.project, h.id)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(readJson<any>(join(h.run, 'status.json')).attempts).toBe(1);
  expect(readJson<any>(join(h.run, 'status.json')).state).toBe('verified');
  expect(existsSync(join(h.run, 'attempts/2'))).toBe(false);
}, 30000);

test('自律Construction・未完了Inception・承認後の差し戻しは引き継がない', async () => {
  const f = await fixture(); captureApproval(f.project, f.event);
  const original = readFileSync(f.state, 'utf8');
  put(f.state, original.replace('Mode**: gated', 'Mode**: autonomous'));
  await expect(prepareHandoff(f.project, f.event)).rejects.toThrow('自律');
  put(f.state, original.replace('[x] requirements-analysis', '[ ] requirements-analysis'));
  await expect(prepareHandoff(f.project, f.event)).rejects.toThrow('Inception');
  put(f.state, original);
  f.audit.appendAuditEntry('GATE_REJECTED', { Stage: 'delivery-planning' }, f.project);
  await expect(prepareHandoff(f.project, f.event)).rejects.toThrow('承認・完了記録');
});
