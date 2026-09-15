import assert from 'node:assert/strict';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { approvalCommand, type Status } from '../../src/handoff/bridge';
import { digest, readJson, unchanged, writeJson } from '../../src/handoff/io';

const repo = resolve(import.meta.dir, '../..');
const run = realpathSync(process.argv[2]);
assert.ok(run.startsWith(join(repo, '.experiments/native-recheck') + '/'));
const session = readJson<any>(join(run, 'session.json'));
const provenance = readJson<any>(join(run, 'provenance.json'));
const project = session.project;
const runs = join(project, 'aidlc/takt-handoff/runs');
const ids = readdirSync(runs);
assert.equal(ids.length, 1, '再検証の引き継ぎは1件だけであること');
const handoff = join(runs, ids[0]);
const manifest = readJson<any>(join(handoff, 'manifest.json'));
const status = readJson<Status>(join(handoff, 'status.json'));
assert.equal(status.state, 'verified');
assert.equal(status.attempts, 1);
const state = join(manifest.record, 'aidlc-state.md');
assert.equal(digest(readFileSync(join(project, state))), status.parkStateHash);
assert.equal(digest(readFileSync(join(session.sourceRun, 'project', state))), provenance.sourceStateHash);
const finalApproval = readJson<any>(join(run, 'final-approval-selection.json'));
assert.equal(digest(readFileSync(join(repo, 'dist/claude/scripts/handoff.js'))), finalApproval.pluginHash ?? provenance.pluginHash);
unchanged(project, manifest.files);
unchanged(join(handoff, 'snapshot'), manifest.files);
const inputs = readJson<any>(join(status.workspace!, 'input/manifest.json'));
unchanged(status.workspace!, inputs.artifacts);
assert.equal(readFileSync(join(project, 'src/value.ts'), 'utf8'), 'export const answer = 41;\n');
assert.equal(readFileSync(join(status.workspace!, 'src/value.ts'), 'utf8'), 'export const answer = 42;\n');
const verification = readJson<any>(join(handoff, 'attempts/1/verification.json'));
const takt = readJson<any>(join(handoff, 'attempts/1/takt.json'));
assert.equal(verification.code, 0); assert.equal(takt.code, 0);
assert.match(verification.stderr, /3 pass/);
assert.match(verification.stdout, /行カバレッジ 1\/1/);
const transcriptPaths = [...new Bun.Glob(`*/${session.sessionId}.jsonl`).scanSync({ cwd: join(homedir(), '.claude/projects'), absolute: true })];
assert.equal(transcriptPaths.length, 1);
const entries = readFileSync(transcriptPaths[0], 'utf8').trim().split('\n').map(line => JSON.parse(line));
const blocks = entries.flatMap(row => Array.isArray(row.message?.content) ? row.message.content : []);
const commands = blocks.filter(b => b.type === 'tool_use' && b.name === 'Bash');
// nextに転送した依頼文内のコマンド例を、実行されたreportとして数えない。
const attempts = commands.filter(b => /^\s*aidlc\s+engine\s+orchestrate\s+report\b/.test(b.input.command ?? '') && /--stage\s+["']?delivery-planning/.test(b.input.command) && /--result\s+["']?approved/.test(b.input.command));
const approvals = attempts.filter(b => blocks.some(r => r.type === 'tool_result' && r.tool_use_id === b.id && r.is_error === false));
assert.equal(approvals.length, 1, '新しい最終承認コマンドを1回だけ実行したこと');
const approval = approvals[0];
assert.ok(approvalCommand(approval.input.command, project), '成功した承認が単一コマンドであること');
const response = blocks.find(b => b.type === 'tool_result' && b.tool_use_id === approval.id);
assert.equal(response?.is_error, false);
assert.equal(JSON.parse(response.content).kind, 'done');
const after = commands.slice(commands.indexOf(approval) + 1).map(b => b.input.command as string);
assert.ok(after.every(cmd => !/orchestrate\s+(?:park|next|continue)|(?:handoff\.(?:js|ts)|cli\.ts)\s+(?:plugin-hook|hook|work|retry)|\btakt\s+--pipeline/.test(cmd)), '承認後の手動進行・引き継ぎ再送がないこと');
const pending = join(project, 'aidlc/takt-handoff/pending', digest(session.sessionId + ':' + approval.id) + '.json');
assert.equal(readJson<any>(pending).configHash, manifest.configHash);
const result = {
  verdict: 'VERIFIED', scope: 'Native Delivery Planning re-entry from copied, genuinely approved Inception artifacts; fresh live approval and automatic plugin handoff',
  freshInceptionFromScratch: false, operatorRecoveryAfterApproval: false, replayedHookEvent: false,
  preApprovalAssistance: ['Existing user decisions relayed through native UI', 'Bundled read-only review-brief tool invoked directly because native dispatch failed'],
  sessionId: session.sessionId, approvalToolUseId: approval.id, approvalCommand: approval.input.command,
  rejectedApprovalAttempts: attempts.filter(b => b !== approval).map(b => ({ command: b.input.command, response: blocks.find(r => r.type === 'tool_result' && r.tool_use_id === b.id)?.content })),
  approvalResponse: JSON.parse(response.content), postApprovalCommands: after,
  handoffId: ids[0], state: status.state, attempts: status.attempts, provider: manifest.config.provider,
  disableBedrock: manifest.config.disableBedrock, taktExitCode: takt.code,
  verification, originalSource: 'export const answer = 41;', outputSource: 'export const answer = 42;',
  originalInputsAndSnapshotUnchanged: true, copiedInputArtifactsUnchanged: true, parkStateUnchanged: true,
  sourceExperimentStateUnchanged: true, pluginHashUnchangedSinceFinalApproval: true,
  automaticMerge: false, evidenceDirectory: relative(repo, run), workspace: relative(repo, status.workspace!),
};
writeJson(join(run, 'result.json'), result);
writeJson(join(import.meta.dir, 'results/2026-09-15-recheck.json'), result);
console.log(JSON.stringify(result, null, 2));
