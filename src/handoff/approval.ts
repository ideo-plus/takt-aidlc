import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest, fileInside } from './io';
import { harnessDirectory, type HostHarness } from '../hosts/harness';

// シェルの展開・連結・リダイレクトを認めず、単一の承認コマンドだけを扱う。
export function approvalCommand(commandText: string, project: string) {
  const tokens: string[] = [];
  let offset = 0;
  const token = /\s*(?:'([^']*)'|"([^"$`\\]*)"|([^\s'"\\;&|<>`$()]+))/y;
  while (offset < commandText.trimEnd().length) {
    if (offset > 0 && !/\s/.test(commandText[offset])) return false;
    token.lastIndex = offset;
    const match = token.exec(commandText);
    if (!match) return false;
    tokens.push(match[1] ?? match[2] ?? match[3]); offset = token.lastIndex;
  }
  let args: string[];
  if (tokens.slice(0, 4).join(' ') === 'aidlc engine orchestrate report') args = tokens.slice(4);
  else return false;
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--stage', '--result', '--user-input', '--project-dir'].includes(args[i]) || args[i + 1] === undefined || flags.has(args[i])) return false;
    flags.set(args[i], args[i + 1]);
  }
  if (flags.has('--project-dir') && flags.get('--project-dir') !== project) return false;
  return flags.get('--stage') === 'delivery-planning' && flags.get('--result') === 'approved';
}

// 実行許可の判定には使わない。承認らしい複合コマンドを黙って通過させないための検出。
export function approvalCommandIssue(commandText: string, project: string) {
  if (approvalCommand(commandText, project)) return null;
  // 認識済みの承認に構文が追加された場合だけを扱う。他プロジェクトや--singleは対象外。
  const hasApproval = commandText.split(/[;&|\n]/).some(part =>
    approvalCommand(part.replace(/\s+\d*[<>][\s\S]*$/, '').trim(), project));
  if (!hasApproval) return null;
  return 'TAKT連携の最終承認は、aidlc engine orchestrate report --stage delivery-planning --result approved --user-input "Approve" の単一コマンドで実行してください。リダイレクト・echo・連結コマンド・追加オプションは付けないでください。この要求はまだ実行されていません。同じ承認に基づいてコマンド形式を直し、再実行してください。';
}
async function engineLibrary(project: string, host: HostHarness = 'claude') {
  const version = await import(pathToFileURL(fileInside(project, `${harnessDirectory(host)}/tools/aidlc-version.ts`)).href);
  if (version.AIDLC_VERSION !== '2.8.2') throw new Error('AI-DLC v2.8.2専用です');
  return import(pathToFileURL(fileInside(project, `${harnessDirectory(host)}/tools/aidlc-lib.ts`)).href);
}
export async function approvedBoundary(project: string, host: HostHarness = 'claude') {
  const lib = await engineLibrary(project, host);
  const statePath = lib.stateFilePath(project);
  const state = readFileSync(statePath, 'utf8');
  if (lib.getField(state, 'State Version') !== '8') throw new Error('AI-DLC v2.8.2のState Version 8だけに対応しています');
  if (lib.getField(state, 'Status') !== 'Running') throw new Error('実行中のIntentだけを引き継げます');
  const checks = lib.parseCheckboxes(state);
  const graph = lib.loadStageGraph();
  const inception = graph.filter((s: any) => s.phase === 'inception');
  if (!inception.length || inception.some((s: any) => !checks.some((c: any) => c.slug === s.slug && ['completed', 'skipped'].includes(c.state)))) throw new Error('Inceptionに未完了または未記録の工程があります');
  if (!checks.some((c: any) => c.slug === 'delivery-planning' && c.state === 'completed')) throw new Error('Delivery Planningの完了が必要です');
  const construction = new Set(graph.filter((s: any) => s.phase === 'construction').map((s: any) => s.slug));
  if (checks.some((c: any) => construction.has(c.slug) && ['completed', 'awaiting-approval', 'revising'].includes(c.state))) throw new Error('Constructionの作業が既に進んでいます');
  const current = lib.getField(state, 'Current Stage');
  if (!graph.some((s: any) => s.slug === current && s.phase === 'construction')) throw new Error('Construction開始前の境界ではありません');
  if (lib.getField(state, 'Construction Autonomy Mode') === 'autonomous') throw new Error('AI-DLCの自律Constructionは引き継げません');
  const rows = lib.readAuditShardEvents(project);
  // 複数担当者の監査記録の因果順序はこのPoCでは推定しない。
  if (!rows.length) throw new Error('現在のDelivery Planningに対応する承認・完了記録がありません');
  if (new Set(rows.map((r: any) => r.shard)).size !== 1) throw new Error('単一監査シャードのIntentだけに対応しています');
  const relevant = rows.filter((r: any) => r.event === 'WORKFLOW_STARTED' || lib.auditBlockField(r.block, 'Stage') === 'delivery-planning');
  const completed = relevant.findLast((r: any) => r.event === 'STAGE_COMPLETED');
  const approval = relevant.findLast((r: any) => ['WORKFLOW_STARTED', 'GATE_APPROVED', 'GATE_REJECTED', 'STAGE_JUMPED', 'STAGE_STARTED'].includes(r.event));
  if (!approval || approval.event !== 'GATE_APPROVED' || !completed || completed.pos <= approval.pos) throw new Error('現在のDelivery Planningに対応する承認・完了記録がありません');
  return { statePath, record: relative(project, dirname(statePath)), approval: digest(approval.block), current };
}
