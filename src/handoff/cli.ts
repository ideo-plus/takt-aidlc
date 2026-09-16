import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { approvalCommand, approvalCommandIssue } from './approval';
import type { HookEvent } from '../hosts/events';
import { readJson } from './io';
import { capturePhase, preparePhase, executePhase, spawnPhase } from '../construction-phase/runner';
import { phaseEnabled, phaseStorage } from '../construction-phase/context';
import { hostHarness } from '../hosts/harness';
import { codexEvent, codexDirective } from '../hosts/codex';
import { cgEnabled, cgEntryCommandIssue, cgStorage, executeCg, isCgEntryCommand, prepareCg, spawnCg } from '../code-generation/runner';

const [mode, projectArgument, id] = process.argv.slice(2);
const isCodex = mode === 'codex-hook' || mode === 'codex-session';
try {
  const raw = isCodex ? JSON.parse(await Bun.stdin.text()) : null;
  const project = realpathSync(projectArgument || (isCodex ? raw.cwd : process.cwd()));
  if (isCodex && (typeof raw.cwd !== 'string' || realpathSync(raw.cwd) !== realpathSync(process.cwd()) || realpathSync(raw.cwd) !== project)) throw new Error('Codexイベントの作業領域が一致しません');
  if (['session', 'plugin-hook', 'codex-session', 'codex-hook'].includes(mode) && (cgEnabled(project) || phaseEnabled(project))) {
    const configuredHost = hostHarness(readJson<any>(join(cgStorage(project), 'config.json')).hostHarness);
    if (configuredHost !== (isCodex ? 'codex' : 'claude')) process.exit(0);
  }
  if (mode === 'session' || mode === 'codex-session') {
    if (phaseEnabled(project)) console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'takt-aidlcはConstruction全体のHOTL委譲が有効です。Inceptionを通常どおり進め、人間によるDelivery Planning最終承認を得てから、単一のaidlc engine orchestrate report --stage delivery-planning --result approvedで記録してください。フックが原文とUnit依存関係を固定し、parkしてTAKTへ設計・CG・全体検証を委譲します。委譲後はターンを終了し、Constructionを重複実行しないでください。TAKT内に人間承認待ちはなく、ネイティブの承認・完了記録を作りません。'}}));
    else if (cgEnabled(project)) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'takt-aidlcはCG単体のHOTL委譲が有効です。AI-DLCのCG前工程を通常どおり進めてください。単一のaidlc engine orchestrate next/continueがcode-generationのrun-stageを返すと、フックがIntent・設計・本家CG/知識/センサー定義を固定しparkしてTAKTへ委譲します。TAKT内で対話承認を求めず、自動計画レビュー・実装・ビルド・テスト・センサー検証・コード修正を行います。フックの委譲通知後はCGを重複実行せず、このターンを終了してください。AI-DLCの承認・完了・センサー監査記録を偽造しないでください。' } }));
  } else if (mode === 'plugin-hook' || mode === 'codex-hook') {
    if (!cgEnabled(project) && !phaseEnabled(project)) process.exit(0);
    const event = isCodex ? codexEvent(raw) : JSON.parse(await Bun.stdin.text()) as HookEvent;
    if (event.tool_name !== 'Bash') process.exit(0);
    if (cgEnabled(project)) {
      const issue = event.hook_event_name === 'PreToolUse' && cgEntryCommandIssue(event.tool_input.command ?? '', project);
      if (issue) { console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: issue } })); process.exit(0); }
      if (event.hook_event_name === 'PostToolUse' && isCgEntryCommand(event.tool_input.command ?? '', project) && !event.tool_response?.interrupted) {
        if (typeof event.cwd !== 'string' || realpathSync(event.cwd) !== project) throw new Error('CGイベントの作業領域が一致しません');
        const directive = isCodex ? codexDirective(raw.tool_response) : JSON.parse(event.tool_response?.stdout ?? '{}');
        const handoff = await prepareCg(project, directive);
        if (handoff) {
          if (handoff.status.state === 'parked') spawnCg(project, handoff.id, handoff.run, import.meta.path);
          console.log(JSON.stringify({ ...(isCodex ? { continue: false, stopReason: 'CGはTAKTへ委譲済みです。元のCG指示を実行せず、このターンを終了してください。' } : {}), hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `CG単体をTAKTへ委譲しAI-DLCはpark済みです。CG run ID: ${handoff.id}。このターンを終了し、CGを重複実行しないでください。結果: ${join(handoff.run, 'status.json')}。TAKTの完了はAI-DLC側の完了記録ではありません。後続工程への受け入れはAI-DLC側で扱ってください。` } }));
        }
      }
      process.exit(0);
    }
    if (phaseEnabled(project)) {
      const issue = event.hook_event_name === 'PreToolUse' && approvalCommandIssue(event.tool_input.command ?? '', project);
      if (issue) { console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:issue}})); process.exit(0); }
      if (event.hook_event_name === 'PreToolUse') await capturePhase(project,event);
      else if (event.hook_event_name === 'PostToolUse') {
        // 関係のないコマンド出力をJSONとして読まない。
        if (!approvalCommand(event.tool_input.command ?? '', project)) process.exit(0);
        const normalized = isCodex ? {...event,tool_response:{stdout:JSON.stringify(codexDirective(raw.tool_response))}} : event;
        const handoff = await preparePhase(project,normalized);
        if (handoff) {
          if (handoff.status.state === 'parked') spawnPhase(project,handoff.id,handoff.run,import.meta.path);
          console.log(JSON.stringify({...(isCodex?{continue:false,stopReason:'ConstructionはTAKTへ委譲済みです。ターンを終了してください。'}:{}),hookSpecificOutput:{hookEventName:'PostToolUse',additionalContext:`Construction全体をTAKTへ委譲しAI-DLCはpark済みです。run ID: ${handoff.id}。このターンを終了してください。結果: ${join(handoff.run,'status.json')}。ネイティブの工程完了や承認記録は作成しません。`}}));
        }
      }
      process.exit(0);
    }
  } else if (mode === 'phase-work') {
    const result = await executePhase(project,id); console.log(JSON.stringify(result)); if(result.state !== 'verified') process.exitCode=1;
  } else if (mode === 'phase-status') {
    if(!/^[a-f0-9]{24}$/.test(id??'')) throw new Error('Construction run IDが必要です');
    console.log(JSON.stringify(readJson(join(phaseStorage(project),'construction-phase-runs',id,'status.json')),null,2));
  } else if (mode === 'cg-work') {
    const result = await executeCg(project, id); console.log(JSON.stringify(result));
    if (result.state !== 'verified') process.exitCode = 1;
  } else if (mode === 'cg-status') {
    if (!/^[a-f0-9]{24}$/.test(id ?? '')) throw new Error('CG run IDが必要です');
    console.log(JSON.stringify(readJson(join(cgStorage(project), 'code-generation-stage-runs', id, 'status.json')), null, 2));
  } else {
    throw new Error('usage: bun handoff.js session|plugin-hook|codex-session|codex-hook|cg-work|cg-status|phase-work|phase-status <project> [id]');
  }
} catch (error) {
  // PostToolUseの失敗もconductorに明示し、無言でConstructionを継続させない。
  console.error(`自動引き継ぎを停止しました: ${String(error)}`);
  if (mode === 'plugin-hook' || mode === 'codex-hook') console.error('復旧が完了するまでConstructionを進めず、このターンを終了してください。');
  process.exitCode = 2;
}
