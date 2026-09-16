import { expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { approvalCommand, approvalCommandIssue, approvedBoundary } from '../src/handoff/approval';
import { phaseFixture } from '../experiments/construction-phase/fixture';
import { capturePhase, preparePhase } from '../src/construction-phase/runner';
import { writeJson } from '../src/handoff/io';

test('承認は単独の公式CLIコマンドと対象プロジェクトを照合する', () => {
  const command = 'aidlc engine orchestrate report --stage delivery-planning --result approved';
  expect(approvalCommand(command, '/project')).toBe(true);
  expect(approvalCommand(command + ' --project-dir /project', '/project')).toBe(true);
  for (const suffix of ['; echo ok', ' 2>&1', ' --single', ' --project-dir /other', ' --result approved']) {
    expect(approvalCommand(command + suffix, '/project')).toBe(false);
  }
  expect(approvalCommandIssue(command + ' 2>&1', '/project')).toContain('まだ実行されていません');
});

test('承認後の拒否記録とAI-DLCの自律実行を受け付けない', async () => {
  const f = await phaseFixture();
  await expect(approvedBoundary(f.project)).rejects.toThrow('承認・完了記録');
  f.approve();
  expect((await approvedBoundary(f.project)).record).toBe(f.context.record);
  const state = readFileSync(f.state, 'utf8');
  writeFileSync(f.state, state.replace('**Construction Autonomy Mode**: gated', '**Construction Autonomy Mode**: autonomous'));
  await expect(approvedBoundary(f.project)).rejects.toThrow('自律Construction');
  writeFileSync(f.state, state);
  f.audit.appendAuditEntry('GATE_REJECTED', { Stage: 'delivery-planning', Details: 'SYNTHETIC TEST' }, f.project);
  await expect(approvedBoundary(f.project)).rejects.toThrow('承認・完了記録');
});

test('承認中の入力・設定変更と中断応答ではparkしない', async () => {
  const f = await phaseFixture();
  await capturePhase(f.project, f.event);
  f.approve();
  const state = readFileSync(f.state, 'utf8');
  await expect(preparePhase(f.project, { ...f.event, tool_response: { interrupted: true } })).rejects.toThrow('中断');
  const configPath = join(f.project, 'aidlc/takt-handoff/config.json');
  writeJson(configPath, { ...f.config, timeoutMs: f.config.timeoutMs + 1 });
  await expect(preparePhase(f.project, f.event)).rejects.toThrow('設定が変化');
  writeJson(configPath, f.config);
  writeFileSync(join(f.project, 'src/value.ts'), 'export const answer = 99;\n');
  await expect(preparePhase(f.project, f.event)).rejects.toThrow('入力が変化');
  expect(readFileSync(f.state, 'utf8')).toBe(state);
  expect(existsSync(join(f.project, 'aidlc/takt-handoff/construction-phase-runs'))).toBe(false);
});
