import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanEnvironment, fileInside } from '../handoff/io';

export type CgContext = {
  version: 1;
  record: string;
  unit: string | null;
  files: string[];
  roles: Record<string, string[]>;
  testingContract: { methodology: string; contract_sha256: string; [key: string]: unknown };
  testingContractText: string;
  requirementIds: string[];
  intentFile: string;
  stageFile: string;
  sensors: { id: string; file: string; command: string }[];
  templates: Record<string, string>;
  checks: Record<string, string>;
  mode: 'hotl';
};

export function intentRecord(project: string) {
  const space = readFileSync(join(project, 'aidlc/active-space'), 'utf8').trim();
  const intent = readFileSync(join(project, 'aidlc/spaces', space, 'intents/active-intent'), 'utf8').trim();
  if (![space, intent].every(s => /^[\w-]+$/.test(s))) throw new Error('不正なAI-DLCの選択子です');
  return { space, record: `aidlc/spaces/${space}/intents/${intent}` };
}

function markdownFiles(project: string, dir: string): string[] {
  if (!existsSync(join(project, dir))) return [];
  return readdirSync(join(project, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error(`Contextのsymlinkは対象外です: ${dir}/${entry.name}`);
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? markdownFiles(project, path) : entry.isFile() && path.endsWith('.md') ? [path] : [];
  });
}

export function collectCgContext(project: string, artifacts: string[], unit: string | null, checks: Record<string, string> = {}): CgContext {
  const { space, record } = intentRecord(project);
  if (unit !== null && !/^[\w-]+$/.test(unit)) throw new Error('不正なUnitです');
  if (artifacts.some(path => !path.startsWith(`${record}/inception/`) && !path.startsWith(`${record}/construction/`))) throw new Error('CGの成果物入力は現在のIntent内に限定してください');
  const intentFile = `${record}/project-description.json`;
  const stageFile = '.claude/aidlc-common/stages/construction/code-generation.md';
  const stageText = readFileSync(fileInside(project, stageFile), 'utf8');
  const front = stageText.match(/^---\n([\s\S]*?)\n---/);
  if (!front) throw new Error('CG定義のfrontmatterがありません');
  const stage = Bun.YAML.parse(front[1]) as { sensors?: string[] };
  const sensors = (stage.sensors ?? []).map(id => {
    if (!['required-sections', 'linter', 'type-check', 'traceability'].includes(id)) throw new Error(`未対応のCGセンサー: ${id}`);
    const file = `.claude/sensors/aidlc-${id}.md`;
    const definition = readFileSync(fileInside(project, file), 'utf8');
    const command = definition.match(/^command:\s*(.+)$/m)?.[1];
    if (!command) throw new Error(`センサーのcommandがありません: ${id}`);
    return { id, file, command };
  });
  if (!sensors.length) throw new Error('CGのセンサー定義がありません');
  const designRoot = unit ? `${record}/construction/${unit}` : `${record}/construction`;
  const unitDesigns = ['functional-design', 'nfr-requirements', 'nfr-design', 'infrastructure-design'].flatMap(name => markdownFiles(project, `${designRoot}/${name}`));
  const templates = Object.fromEntries(['code-generation-plan', 'unit-test-instructions', 'code-summary'].flatMap(name => {
    const path = `aidlc/spaces/${space}/memory/templates/${name}.md`;
    return existsSync(join(project, path)) ? [[`${name}.md`, path]] : [];
  }));
  const common = [...artifacts, ...unitDesigns, intentFile, stageFile, ...Object.values(templates), ...Object.values(checks),
    ...sensors.map(s => s.file),
    ...['org', 'team', 'project'].map(name => `aidlc/spaces/${space}/memory/${name}.md`),
    ...markdownFiles(project, '.claude/knowledge/aidlc-shared'),
    ...markdownFiles(project, `aidlc/spaces/${space}/knowledge/aidlc-shared`),
  ];
  const phaseRules = `aidlc/spaces/${space}/memory/phases/construction.md`;
  if (existsSync(join(project, phaseRules))) common.push(phaseRules);
  const forRole = (role: string) => [`${'.claude/agents'}/${role}.md`,
    ...markdownFiles(project, `.claude/knowledge/${role}`),
    ...markdownFiles(project, `aidlc/spaces/${space}/knowledge/${role}`)];
  const roles = {
    plan: [...common, ...forRole('aidlc-developer-agent')],
    implement: [...common, ...forRole('aidlc-developer-agent')],
    review: [...common, ...forRole('aidlc-architecture-reviewer-agent'), ...forRole('aidlc-quality-agent')],
    report: [...common, ...forRole('aidlc-developer-agent')],
  };
  const traceabilityTool = '.claude/tools/aidlc-sensor-traceability.ts';
  const files = [...new Set([...artifacts, ...Object.values(roles).flat(), traceabilityTool])];
  for (const path of files) fileInside(project, path);
  const result = spawnSync('aidlc', ['engine', 'testing-posture', 'render', '--project-dir', project], { cwd: project, env: cleanEnvironment(), encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Testing Contractを解決できません: ${result.stderr}`);
  const match = result.stdout.match(/```json\s*([\s\S]*?)```/);
  if (!match) throw new Error('Testing ContractのJSONがありません');
  const testingContract = JSON.parse(match[1]);
  if (testingContract.methodology !== 'test-after') throw new Error(`CG初版はtest-afterのみ対応しています。${testingContract.methodology}を別の順序へ変更して実行することはできません`);
  // 元のsensor実装から対象Unitの要求IDを取得する。プローブは正規成果物でも承認記録でもない。
  const tempRoot = join(project, 'aidlc/takt-handoff'); mkdirSync(tempRoot, { recursive: true });
  const probeDir = mkdtempSync(join(tempRoot, 'trace-probe-'));
  let requirementIds: string[];
  try {
    const outputDir = join(probeDir, 'construction', ...(unit ? [unit] : []), 'code-generation'); mkdirSync(outputDir, { recursive: true });
    const probe = join(outputDir, 'traceability.json');
    writeFileSync(probe, JSON.stringify({ stage: 'code-generation', upstream_ids: ['__TAKT_PROBE__'], coverage: [{ id: '__TAKT_PROBE__', status: 'N/A', target: 'read-only ID probe' }] }));
    const resolved = spawnSync(process.execPath, [fileInside(project, traceabilityTool), '--output-path', probe, '--stage-slug', 'code-generation'], { cwd: project, env: { ...cleanEnvironment(), AIDLC_PROJECT_DIR: project }, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
    if (resolved.status !== 0) throw new Error(`本家traceabilityの入力解決に失敗: ${resolved.stderr}`);
    const output = JSON.parse(resolved.stdout);
    if (output.reason) throw new Error(`CG入力の対応が未確定: ${output.reason}`);
    requirementIds = output.missing_from_upstream_ids;
    if (!Array.isArray(requirementIds) || !requirementIds.length || requirementIds.some(id => typeof id !== 'string')) throw new Error('対応を追跡できる要求IDがありません');
  } finally { rmSync(probeDir, { recursive: true, force: true }); }
  return { version: 1, record, unit, files, roles, testingContract, testingContractText: result.stdout, requirementIds, intentFile, stageFile, sensors, templates, checks, mode: 'hotl' };
}

export const adaptation = `# AI-DLC CGのHOTL実行契約
TAKTが担うのはCode Generationステージだけです。設計工程やBuild and Testステージ全体を実行しません。
以下の資料は固定したAI-DLCの原文です。Intent、既存設計、開発規約、CGの実装手順と成果物要件に従ってください。
ただし人間の対話承認・ウォーキングスケルトン後の承認・AI-DLCエンジンの状態更新は実行しません。ユーザーの方針により、CG内の計画確認とレビューはTAKTの自動判定へ置き換えます。
本家のTask委譲はTAKTの担当ステップへの委譲として扱います。ネイティブのPlan Approval receiptやdispatch markerは生成・要求せず、ここでは固定入力のhash、計画のTesting Contract hash、TAKTの計画レビュー結果を生成の前提にします。
センサー定義も開発契約です。定義された検査を実行し、その実測結果を残してください。ただしAI-DLCのネイティブ監査記録を捏造せず、人間のApprove Planを得たとも記録しないでください。元のaidlc/や.claude/を更新せず、CGの報告はTAKTのレポートとcg/に保存します。
原文の<record>などは元プロジェクトでの出典です。添付した固定コピーと作業領域のソースを参照し、元の記録領域へ書き込まないでください。
規約はstrict-additiveとして読み、空のテンプレート例を確定事項と見なさないでください。人が明示した既存の要求・例外を優先し、不明な判断は捏造せずblockedとして終了してください。
Testing Contractの方法・順序・品質目標を弱めてはいけません。ビルドとテストの両方が成功するまでCG完了を返してはいけません。
AI-DLC原文にあるBash等の権限は元の担当者の説明です。現在許可されたツールだけを使ってください。
`;
