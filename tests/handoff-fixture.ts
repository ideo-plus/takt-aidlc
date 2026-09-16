import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeJson } from '../src/handoff/io';
import type { HookEvent } from '../src/hosts/events';
import { testRuntime } from '../scripts/test-runtime';

export const repo = resolve(import.meta.dir, '..');
export const testRoot = join(repo, '.experiments/automatic', new Date().toISOString().replaceAll(':', '-') + '-' + process.pid);
const runtime = testRuntime;
export function put(path: string, value: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); }
let index = 0;
export async function fixture(options: { approved?: boolean } = {}) {
  const project = join(testRoot, String(++index)); mkdirSync(project, { recursive: true });
  cpSync(join(runtime, '.claude/tools'), join(project, '.claude/tools'), { recursive: true });
  cpSync(join(runtime, 'aidlc'), join(project, 'aidlc'), { recursive: true });
  const record = 'aidlc/spaces/default/intents/fixture-8000000000000001';
  put(join(project, 'aidlc/active-space'), 'default\n');
  put(join(project, 'aidlc/.aidlc-clone-id'), 'handofffixture01\n');
  put(join(project, 'aidlc/spaces/default/intents/active-intent'), 'fixture-8000000000000001\n');
  writeJson(join(project, 'aidlc/spaces/default/intents/intents.json'), [{ uuid: '00000000-0000-7000-8000-000000000001', slug: 'fixture', dirName: 'fixture-8000000000000001', status: 'in-flight' }]);
  const lib = await import(pathToFileURL(join(project, '.claude/tools/aidlc-lib.ts')).href);
  const audit = await import(pathToFileURL(join(project, '.claude/tools/aidlc-audit.ts')).href);
  const graph = lib.loadStageGraph();
  const state = join(project, record, 'aidlc-state.md');
  put(state, `# 実験専用の合成状態\n\n## Project Information\n- **State Version**: 8\n- **Scope**: feature\n- **Project Root**: ${project}\n\n## Current Status\n- **Status**: Running\n- **Lifecycle Phase**: CONSTRUCTION\n- **Current Stage**: functional-design\n\n## Runtime State\n- **Construction Autonomy Mode**: gated\n\n## Stage Progress\n${graph.map((s: any) => `- [${['initialization', 'ideation', 'inception'].includes(s.phase) ? 'x' : s.slug === 'functional-design' ? '-' : ' '}] ${s.slug} — EXECUTE`).join('\n')}\n`);
  const artifact = record + '/inception/requirements-analysis/requirements.md';
  put(join(project, artifact), '# 要求\n\n## 受入条件\n`src/value.ts`のanswerを41から42にする。\n');
  put(join(project, 'src/value.ts'), 'export const answer = 41;\n');
  // テスト専用のイベント。製品のbridgeは承認イベントを書かない。
  if (options.approved !== false) {
    audit.appendAuditEntry('GATE_APPROVED', { Stage: 'delivery-planning', 'User Input': 'SYNTHETIC TEST FIXTURE — 実際の人の承認ではない' }, project);
    audit.appendAuditEntry('STAGE_COMPLETED', { Stage: 'delivery-planning', Details: 'SYNTHETIC TEST FIXTURE' }, project);
  }
  const event: HookEvent = { hook_event_name: 'PostToolUse', session_id: 'synthetic-session', tool_use_id: 'synthetic-tool-use', cwd: project, tool_name: 'Bash', tool_input: { command: 'aidlc engine orchestrate report --stage delivery-planning --result approved' }, tool_response: { stdout: JSON.stringify({ kind: 'done', reason: 'Committed approve for "delivery-planning" (scope: feature). State advanced; run next to continue.' }) } };
  return { project, state, artifact, event, lib, audit };
}
