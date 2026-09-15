import { spawn } from 'node:child_process';
import { closeSync, openSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { approvalCommandIssue, captureApproval, executeHandoff, handoffEnabled, prepareHandoff, storage, type HookEvent } from './bridge';
import { cleanEnvironment, quote, readJson } from './io';

const [mode, projectArgument, id] = process.argv.slice(2);
const project = realpathSync(projectArgument || process.cwd());
try {
  if (mode === 'session') {
    if (handoffEnabled(project)) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'このプロジェクトではtakt-aidlc連携が有効です。通常のAI-DLCの質問・承認を維持してください。Inceptionの最終承認時には、その後のConstructionをTAKTへ引き継ぐ方針もユーザーへ伝えてください。承認後のparkとTAKT起動はフックが担当します。' } }));
  } else if (mode === 'hooks') {
    const hook = { matcher: 'Bash', hooks: [{ type: 'command', command: `${quote(process.execPath)} ${quote(import.meta.path)} hook ${quote(project)}`, timeout: 30 }] };
    console.log(JSON.stringify({ hooks: { PreToolUse: [hook], PostToolUse: [hook] } }, null, 2));
  } else if (mode === 'hook' || mode === 'plugin-hook') {
    // 元の設定を変更できない移行時も、自分たちの旧フックだけを無効にする。
    if (mode === 'hook' && process.env.TAKT_AIDLC_PLUGIN_ONLY === '1') process.exit(0);
    const event = JSON.parse(await Bun.stdin.text()) as HookEvent;
    if (event.tool_name !== 'Bash') process.exit(0);
    if (event.hook_event_name === 'PreToolUse') {
      const issue = handoffEnabled(project) && approvalCommandIssue(event.tool_input.command ?? '', project);
      if (issue) {
        console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: issue } }));
        process.exit(0);
      }
      captureApproval(project, event);
    } else if (event.hook_event_name === 'PostToolUse') {
      const handoff = await prepareHandoff(project, event);
      if (handoff) {
        if (handoff.status.state === 'parked') {
          const log = openSync(join(handoff.run, 'worker.log'), 'a', 0o600);
          const worker = spawn(process.execPath, [import.meta.path, 'work', project, handoff.id], { cwd: project, env: cleanEnvironment(), detached: true, stdio: ['ignore', log, log] });
          worker.on('error', error => console.error('TAKT workerを起動できません:', error.message));
          worker.unref(); closeSync(log);
        }
        console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `AI-DLCはpark済みです。TAKTへの引き継ぎID: ${handoff.id}。承認コマンドが返した古い次工程の指示は実行せず、このターンを終了してください。結果は ${join(handoff.run, 'status.json')} で確認できます。` } }));
      }
    }
  } else if (mode === 'work' || mode === 'retry') {
    const result = await executeHandoff(project, id, mode === 'retry');
    console.log(JSON.stringify(result));
    if (result.state !== 'verified') process.exitCode = 1;
  } else if (mode === 'status') {
    if (!/^[a-f0-9]{24}$/.test(id ?? '')) throw new Error('run IDが必要です');
    console.log(JSON.stringify(readJson(join(storage(project), 'runs', id, 'status.json')), null, 2));
  } else {
    throw new Error('usage: bun handoff.js session|hooks|hook|plugin-hook|work|retry|status <project> [id]');
  }
} catch (error) {
  // PostToolUseの失敗もconductorに明示し、無言でConstructionを継続させない。
  console.error(`自動引き継ぎを停止しました: ${String(error)}`);
  if (mode === 'hook' || mode === 'plugin-hook') console.error('復旧が完了するまでConstructionを進めず、このターンを終了してください。');
  process.exitCode = 2;
}
