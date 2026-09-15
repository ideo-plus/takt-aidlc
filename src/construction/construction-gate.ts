// Bunで単独実行できる品質ゲート。配布物と各attemptのcontrol/へそのままコピーする。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const save = (path: string, value: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); };

// レポート、制御ファイル、既知のカバレッジ出力をソースの識別値から除く。
export function sourceHash(workspace: string): string {
  const files: Record<string, string> = {};
  function visit(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name), rel = relative(workspace, path);
      if (/^(?:\.git|\.claude|\.takt|construction|coverage|\.handoff-coverage-[^/]+)(?:\/|$)/.test(rel)) continue;
      assert.ok(!entry.isSymbolicLink(), `symlinkは検証対象にできません: ${rel}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files[rel] = hash(readFileSync(path));
    }
  }
  visit(workspace);
  return hash(JSON.stringify(files));
}

const reportNames = { design: '01-design.json', designReview: '02-design-review.json', codeReview: '03-code-review.json', handoff: '04-handoff.json' } as const;
type Phase = 'design' | 'design-review' | 'implement' | 'fix' | 'code-review' | 'finish';

export function runGate(control: string, phase: Phase | 'result') {
  const context = json(join(control, 'context.json'));
  const workspace: string = context.workspace;
  assert.equal(realpathSync(process.cwd()), realpathSync(workspace));
  for (const [path, expected] of Object.entries(context.inputs)) {
    const file = join(workspace, path);
    assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), `入力形式が変化しました: ${path}`);
    assert.equal(hash(readFileSync(file)), expected, `入力が変化しました: ${path}`);
  }
  const runDirs = readdirSync(join(workspace, '.takt/runs'));
  assert.equal(runDirs.length, 1, '単一のTAKT実行だけを扱います');
  const reportsDir = join(workspace, '.takt/runs', runDirs[0], 'reports');
  const report = (kind: keyof typeof reportNames) => {
    const path = join(reportsDir, reportNames[kind]);
    assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink());
    const value = json(path);
    assert.ok(value && typeof value === 'object' && !Array.isArray(value));
    return value;
  };
  const reportHash = (kind: keyof typeof reportNames) => hash(readFileSync(join(reportsDir, reportNames[kind])));
  const ledgerPath = join(control, 'ledger.json');
  const ledger: any[] = existsSync(ledgerPath) ? json(ledgerPath) : [];
  const latest = (name: string) => ledger.findLast(row => row.phase === name);
  const code = sourceHash(workspace);
  const designApproved = () => {
    const row = latest('design-review');
    assert.equal(row?.verdict, 'approved', '設計レビューが承認されていません');
    assert.equal(row.designHash, reportHash('design'), '設計レビュー後に設計が変化しました');
    assert.equal(row.reportHash, reportHash('designReview'), '設計レビューの記録が変化しました');
  };
  const reviewed = () => {
    designApproved();
    const row = latest('code-review');
    assert.equal(row?.verdict, 'approved', 'コードレビューが承認されていません');
    assert.equal(row.sourceHash, code, 'レビュー後にコードが変化しました');
    assert.equal(row.reportHash, reportHash('codeReview'), 'コードレビューの記録が変化しました');
  };
  if (phase === 'result') {
    const implementationQuestions = join(workspace, 'construction/questions.json');
    if (existsSync(implementationQuestions)) {
      const value = json(implementationQuestions);
      assert.ok(Array.isArray(value.questions) && value.questions.length > 0);
      return { state: 'needs_input', stage: 'implementation', questions: value.questions, reportsDir };
    }
    for (const kind of Object.keys(reportNames) as (keyof typeof reportNames)[]) {
      if (!existsSync(join(reportsDir, reportNames[kind]))) continue;
      const value = report(kind);
      if (value.verdict === 'needs_input') {
        assert.ok(Array.isArray(value.questions) && value.questions.length > 0);
        return { state: 'needs_input', stage: kind, questions: value.questions, reportsDir };
      }
    }
    reviewed();
    const row = latest('finish');
    assert.equal(row?.sourceHash, code, '完了時のコードと一致しません');
    assert.equal(row.reportHash, reportHash('handoff'));
    return { state: 'complete', reportsDir, sourceHash: code, checks: ledger.length };
  }
  let verdict = 'passed';
  let binding: Record<string, string> = {};
  if (phase === 'design') {
    assert.equal(code, context.initialSourceHash, '設計中にコードが変更されました');
    const d = report('design');
    assert.ok(['ready', 'needs_input'].includes(d.verdict));
    assert.ok(Array.isArray(d.units) && d.units.length > 0);
    const seen = new Set<string>();
    for (const unit of d.units) {
      assert.ok(typeof unit.id === 'string' && unit.id.trim() && !seen.has(unit.id), 'Unit IDは一意でなければなりません');
      assert.ok(Array.isArray(unit.dependsOn) && unit.dependsOn.every((id: unknown) => typeof id === 'string' && seen.has(id)), 'Unitは依存順に並べてください');
      assert.ok(Array.isArray(unit.files)); seen.add(unit.id);
    }
    for (const key of ['functional', 'nonfunctional', 'interfaces', 'infrastructure', 'testPlan']) assert.ok(typeof d[key] === 'string' && d[key].trim(), `設計の${key}がありません`);
    assert.ok(Array.isArray(d.questions));
    if (d.verdict === 'ready') assert.equal(d.questions.length, 0);
    verdict = d.verdict; binding = { designHash: reportHash('design') };
  } else if (phase === 'design-review') {
    assert.equal(code, context.initialSourceHash, '設計レビュー中にコードが変更されました');
    assert.equal(latest('design')?.designHash, reportHash('design'));
    const d = report('designReview');
    assert.ok(['approved', 'changes_requested', 'needs_input'].includes(d.verdict));
    assert.ok(Array.isArray(d.findings) && Array.isArray(d.questions));
    if (d.verdict === 'approved') { assert.equal(d.findings.length, 0, '未解決指摘を承認できません'); assert.equal(d.questions.length, 0); }
    verdict = d.verdict; binding = { designHash: reportHash('design'), reportHash: reportHash('designReview') };
  } else if (phase === 'implement' || phase === 'fix') {
    designApproved();
    assert.equal(hash(readFileSync(context.verifyScript)), context.verifyHash, '検証スクリプトが変化しました');
    const result = spawnSync(process.execPath, [context.verifyScript], { cwd: workspace, encoding: 'utf8', timeout: 30000, maxBuffer: 128 * 1024 });
    const receipt = { phase, code: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '', sourceHash: sourceHash(workspace) };
    save(join(control, 'checks', `${ledger.length + 1}.json`), receipt);
    save(join(workspace, 'construction/verification.json'), receipt);
    ledger.push({ ...receipt, phase: 'test', verdict: result.status === 0 ? 'passed' : 'failed' }); save(ledgerPath, ledger);
    assert.equal(result.status, 0, 'テスト失敗。construction/verification.jsonを読み、実装を修正してください');
  } else if (phase === 'code-review') {
    designApproved();
    const test = latest('test');
    assert.equal(test?.verdict, 'passed'); assert.equal(test.sourceHash, code, 'テスト後にコードが変化しました');
    const d = report('codeReview');
    assert.ok(['approved', 'changes_requested', 'needs_input'].includes(d.verdict));
    assert.ok(Array.isArray(d.findings) && Array.isArray(d.questions));
    if (d.verdict === 'approved') { assert.equal(d.findings.length, 0, '未解決指摘を承認できません'); assert.equal(d.questions.length, 0); }
    verdict = d.verdict; binding = { reportHash: reportHash('codeReview') };
  } else if (phase === 'finish') {
    reviewed();
    const d = report('handoff');
    assert.equal(d.verdict, 'complete');
    assert.ok(typeof d.summary === 'string' && d.summary.trim());
    binding = { reportHash: reportHash('handoff') };
  } else throw new Error(`未知の工程: ${phase}`);
  ledger.push({ phase, verdict, sourceHash: sourceHash(workspace), ...binding }); save(ledgerPath, ledger);
  // 参照用のコピー。判定の正本はcontrol/に置く。
  save(join(workspace, 'construction/progress.json'), ledger);
  return { state: 'checked', phase, verdict };
}

if (import.meta.main) {
  try { console.log(JSON.stringify(runGate(dirname(realpathSync(import.meta.path)), process.argv[2] as Phase | 'result'))); }
  catch (error) { console.error(String(error)); process.exitCode = 1; }
}
