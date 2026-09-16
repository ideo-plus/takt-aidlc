// 配布物・実行ディレクトリへコピーするため、組み込みモジュールだけに依存する。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

export const cgGateSource = join(import.meta.dir, 'code-generation-gate.ts');
export const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const save = (path: string, data: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(data, null, 2) + '\n'); };
const planProjection = (text: string) => text.replace(/\r\n/g, '\n').replace(/^(\s*[-*+]\s+)\[[xX-]\]/gm, '$1[ ]');
export function sources(root: string): Record<string, string> {
  const found: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === 'node_modules' || e.name === '.venv') continue;
      const path = join(dir, e.name), rel = relative(root, path);
      if (/^(?:node_modules|\.venv|\.git|\.claude|\.takt|input|cg|coverage|\.handoff-coverage-[^/]+)(?:\/|$)/.test(rel)) continue;
      assert.ok(!e.isSymbolicLink(), `symlinkは対象外: ${rel}`);
      if (e.isDirectory()) walk(path);
      else if (e.isFile()) found[rel] = hash(readFileSync(path));
    }
  };
  walk(root); return found;
}
function sourcePath(root: string, path: unknown) {
  assert.ok(typeof path === 'string' && !path.startsWith('/') && !path.split('/').some(p => !p || p === '.' || p === '..'));
  assert.ok(!path.split('/').some(p => p === 'node_modules' || p === '.venv'));
  assert.ok(!/^(?:node_modules|\.venv|\.git|\.claude|\.codex|\.agents|\.takt|input|cg)(?:\/|$)/.test(path));
  const full = join(root, path);
  assert.ok(lstatSync(full).isFile() && realpathSync(full).startsWith(realpathSync(root) + '/'));
  return path;
}
export function cgGate(control: string, phase: string) {
  const ctx = read(join(control, 'context.json'));
  const root: string = ctx.workspace;
  assert.equal(realpathSync(process.cwd()), realpathSync(root));
  for (const [path, expected] of Object.entries(ctx.inputs)) assert.equal(hash(readFileSync(join(root, path))), expected, `固定入力が変化: ${path}`);
  const dirs = readdirSync(join(root, '.takt/runs'));
  assert.equal(dirs.length, 1);
  const reportsDir = join(root, '.takt/runs', dirs[0], 'reports');
  const report = (name: string) => read(join(reportsDir, name));
  const reportHash = (name: string) => hash(readFileSync(join(reportsDir, name)));
  const ledgerPath = join(control, 'ledger.json');
  const ledger: any[] = existsSync(ledgerPath) ? read(ledgerPath) : [];
  const latest = (stage: string) => ledger.findLast(x => x.phase === stage);
  const current = sources(root), sourceHash = hash(JSON.stringify(current));
  const checkPlan = () => {
    const r = latest('plan-review');
    assert.equal(r?.verdict, 'approved', 'CG計画の技術レビューが未完了');
    assert.equal(r.planHash, reportHash('01-code-generation-plan.json'), 'レビュー後に計画が変化');
    assert.equal(r.reportHash, reportHash('02-code-generation-plan-review.json'), '計画レビューが変化');
    assert.equal(r.planMarkdownHash, hash(planProjection(readFileSync(join(root, 'cg/code-generation-plan.md'), 'utf8'))), 'CG計画本文が変化');
    assert.equal(r.instructionsHash, hash(readFileSync(join(root, 'cg/unit-test-instructions.md'))), 'Unitテスト手順が変化');
  };
  const checkTests = () => {
    const build = latest('build'), test = latest('test');
    assert.equal(build?.verdict, 'passed', 'ビルド未成功');
    assert.equal(test?.verdict, 'passed', 'テスト未成功');
    assert.ok(ledger.indexOf(test) > ledger.indexOf(build), '最新ビルド後のテストが必要');
    assert.equal(build.sourceHash, sourceHash, 'ビルド後にソースが変化');
    assert.equal(test.sourceHash, sourceHash, 'テスト後にソースが変化');
    const sensors = latest('sensors');
    assert.equal(sensors?.sourceHash, sourceHash, '最新コードのセンサー検証が必要');
    assert.equal(sensors.verdict, 'passed');
  };
  const checkSections = (path: string) => {
    const text = readFileSync(join(root, path), 'utf8');
    const headings: string[] = text.match(/^##\s+.+$/gm) ?? [];
    const template = ctx.cg.templates[basename(path)];
    if (template) {
      const expected: string[] = readFileSync(join(root, 'input/project', template), 'utf8').match(/^##\s+.+$/gm) ?? [];
      assert.ok(expected.every(h => headings.includes(h)), `required-sections: ${path}がテンプレートに不適合`);
    } else assert.ok(headings.length >= 2, `required-sections: ${path}には2つ以上のH2が必要`);
  };
  const checkTraceability = () => {
    const manifest = read(join(root, 'cg/source-manifest.json'));
    assert.equal(manifest.stage, 'code-generation'); assert.equal(manifest.version, 1);
    assert.equal(manifest.unit, ctx.cg.unit, '変更一覧のUnitが不一致');
    assert.ok(Array.isArray(manifest.writes));
    const actual = [...new Set([...Object.keys(ctx.initialSources), ...Object.keys(current)])].filter(path => current[path] !== ctx.initialSources[path]).sort();
    assert.deepEqual(manifest.writes.map((x: any) => x.path).sort(), actual, '変更ファイル一覧が実際の差分と不一致');
    const plan = report('01-code-generation-plan.json');
    const planned = new Set(plan.steps.flatMap((s: any) => s.files));
    assert.ok(actual.every(path => planned.has(path)), '計画外のファイル変更');
    const trace = read(join(root, 'cg/traceability.json'));
    assert.equal(trace.stage, 'code-generation');
    assert.equal(trace.unit, ctx.cg.unit, '要求対応のUnitが不一致');
    assert.deepEqual([...trace.upstream_ids].sort(), [...ctx.cg.requirementIds].sort());
    assert.deepEqual(trace.coverage.map((x: any) => x.id).sort(), [...ctx.cg.requirementIds].sort());
    for (const row of trace.coverage) { assert.equal(row.status, 'OK'); sourcePath(root, row.target); }
  };
  const checkReviewed = () => {
    checkPlan(); checkTests(); checkTraceability();
    const r = latest('code-review');
    assert.equal(r?.verdict, 'approved', 'コードレビュー未完了');
    assert.equal(r.sourceHash, sourceHash, 'レビュー後にソースが変化');
    assert.equal(r.reportHash, reportHash('03-code-generation-code-review.json'));
    assert.equal(r.traceHash, hash(readFileSync(join(root, 'cg/traceability.json'))));
    assert.equal(r.manifestHash, hash(readFileSync(join(root, 'cg/source-manifest.json'))));
  };
  const checkSupervised = () => {
    checkReviewed();
    const r = latest('supervise');
    assert.equal(r?.verdict, 'approved', '要件充足の最終判定が未承認');
    assert.ok(ledger.indexOf(r) > ledger.indexOf(latest('code-review')), '最新レビュー後のsuperviseが必要');
    assert.equal(r.sourceHash, sourceHash, 'supervise後にソースが変化');
    assert.equal(r.reviewHash, reportHash('03-code-generation-code-review.json'));
    assert.equal(r.reportHash, reportHash('04-code-generation-supervision.json'));
    assert.equal(r.supervisionHash, hash(readFileSync(join(root, 'cg/supervision.json'))));
  };
  if (phase === 'result') {
    const blocked = join(root, 'cg/blocked.json');
    if (existsSync(blocked)) return { ...read(blocked), state: 'blocked', reportsDir };
    for (const name of ['01-code-generation-plan.json', '02-code-generation-plan-review.json', '03-code-generation-code-review.json', '04-code-generation-supervision.json']) {
      if (existsSync(join(reportsDir, name)) && report(name).verdict === 'blocked') return { state: 'blocked', reason: report(name).reason, reportsDir };
    }
    checkSupervised();
    assert.equal(latest('finish')?.sourceHash, sourceHash);
    assert.equal(latest('finish')?.reportHash, reportHash('05-code-generation-summary.json'));
    assert.equal(latest('finish')?.summaryHash, hash(readFileSync(join(root, 'cg/code-summary.md'))));
    return { state: 'complete', reportsDir, sourceHash, checks: ledger.length, scope: 'code-generation', mode: 'hotl' };
  }
  const blockerReport: Record<string, string> = { plan: '01-code-generation-plan.json', 'plan-review': '02-code-generation-plan-review.json', 'code-review': '03-code-generation-code-review.json', supervise: '04-code-generation-supervision.json' };
  if (phase === 'supervise') checkReviewed();
  const blocker = blockerReport[phase] ? report(blockerReport[phase]) : existsSync(join(root, 'cg/blocked.json')) ? { ...read(join(root, 'cg/blocked.json')), verdict: 'blocked' } : null;
  if (blocker?.verdict === 'blocked') {
    assert.ok(typeof blocker.reason === 'string' && blocker.reason.trim(), '停止理由がありません');
    if (phase === 'plan' || phase === 'plan-review') assert.deepEqual(current, ctx.initialSources);
    ledger.push({ phase, verdict: 'blocked', reason: blocker.reason, sourceHash }); save(ledgerPath, ledger);
    return { state: 'checked', phase, verdict: 'blocked' };
  }
  let verdict = 'passed', binding: Record<string, unknown> = {};
  if (phase === 'plan') {
    assert.deepEqual(current, ctx.initialSources, 'CG計画中にコードを変更した');
    const p = report('01-code-generation-plan.json');
    assert.equal(p.verdict, 'ready');
    assert.equal(p.testingContractHash, ctx.cg.testingContract.contract_sha256);
    assert.ok(Array.isArray(p.steps) && p.steps.length > 0);
    const covered = new Set<string>();
    p.steps.forEach((s: any, i: number) => {
      assert.equal(s.unit, ctx.cg.unit, 'CG計画のUnitが不一致');
      assert.equal(s.id, i + 1); assert.ok(s.action?.trim() && Array.isArray(s.files) && s.files.every((p: unknown) => typeof p === 'string'));
      assert.ok(Array.isArray(s.requirementIds)); s.requirementIds.forEach((id: string) => covered.add(id));
    });
    assert.ok(ctx.cg.requirementIds.every((id: string) => covered.has(id)), 'CG計画に要求の抜けがある');
    assert.ok(Array.isArray(p.appliedRules) && p.appliedRules.length > 0);
    for (const r of p.appliedRules) {
      const ref = typeof r.source === 'string' ? r.source.replace(`${root}/`, '').replace(/^input\/project\//, '') : '';
      assert.ok(ctx.cg.files.includes(ref) || Object.hasOwn(ctx.inputs, ref), `参照元が固定入力にありません: ${r.source}`);
      assert.ok(r.rule?.trim() && r.application?.trim(), '適用した規則と適用方法がありません');
    }
    assert.ok(p.unitTestInstructions?.trim());
    const planBody = p.planMarkdown ?? `# Code Generation Plan\n\n## Implementation Steps\n\n${p.steps.map((s: any) => `- [ ] Step ${s.id}: ${s.action}\n  - Unit: ${s.unit ?? '(project)'}\n  - Requirements: ${s.requirementIds.join(', ')}\n  - Files: ${s.files.join(', ') || '(inspection only)'}`).join('\n')}`;
    writeFileSync(join(root, 'cg/code-generation-plan.md'), `${planBody}\n\n${ctx.cg.testingContractText}`);
    writeFileSync(join(root, 'cg/unit-test-instructions.md'), p.unitTestInstructions + '\n');
    checkSections('cg/code-generation-plan.md'); checkSections('cg/unit-test-instructions.md');
    binding = { planHash: reportHash('01-code-generation-plan.json'), planMarkdownHash: hash(planProjection(readFileSync(join(root, 'cg/code-generation-plan.md'), 'utf8'))), instructionsHash: hash(readFileSync(join(root, 'cg/unit-test-instructions.md'))) }; verdict = 'ready';
  } else if (phase === 'plan-review' || phase === 'code-review') {
    if (phase === 'plan-review') { assert.deepEqual(current, ctx.initialSources); assert.equal(latest('plan')?.planHash, reportHash('01-code-generation-plan.json')); }
    else { checkPlan(); checkTests(); checkTraceability(); }
    const name = phase === 'plan-review' ? '02-code-generation-plan-review.json' : '03-code-generation-code-review.json';
    const r = report(name);
    assert.ok(['approved', 'changes_requested'].includes(r.verdict) && Array.isArray(r.findings));
    for (const key of ['intent', 'stageDefinition', 'conventions', 'testingContract']) assert.ok(r.alignment?.[key]?.trim(), `${key}との適合確認がない`);
    if (r.verdict === 'approved') assert.equal(r.findings.length, 0);
    verdict = r.verdict; binding = { planHash: reportHash('01-code-generation-plan.json'), reportHash: reportHash(name) };
    if (phase === 'plan-review') Object.assign(binding, { planMarkdownHash: latest('plan').planMarkdownHash, instructionsHash: latest('plan').instructionsHash });
    if (phase === 'code-review') Object.assign(binding, { traceHash: hash(readFileSync(join(root, 'cg/traceability.json'))), manifestHash: hash(readFileSync(join(root, 'cg/source-manifest.json'))) });
  } else if (phase === 'supervise') {
    const r = report('04-code-generation-supervision.json');
    assert.ok(['approved', 'changes_requested'].includes(r.verdict));
    assert.ok(r.intentAssessment?.trim() && Array.isArray(r.requirements) && Array.isArray(r.findings));
    assert.deepEqual(r.requirements.map((row: any) => row.id).sort(), [...ctx.cg.requirementIds].sort(), 'superviseに要求の抜け・重複がある');
    for (const row of r.requirements) {
      assert.ok(['met', 'unmet', 'undetermined'].includes(row.status));
      assert.ok(Array.isArray(row.evidence) && row.evidence.length > 0);
      for (const evidence of row.evidence) { sourcePath(root, evidence.path); assert.ok(evidence.reason?.trim()); }
    }
    for (const finding of r.findings) {
      assert.ok(finding.id?.trim() && finding.reason?.trim() && finding.fix?.trim());
      assert.ok(Array.isArray(finding.requirementIds) && finding.requirementIds.length && finding.requirementIds.every((id: string) => ctx.cg.requirementIds.includes(id)));
    }
    if (r.verdict === 'approved') { assert.ok(r.requirements.every((row: any) => row.status === 'met')); assert.equal(r.findings.length, 0); }
    else assert.ok(r.findings.length > 0, '差し戻しの指摘がない');
    save(join(root, 'cg/supervision.json'), r);
    verdict = r.verdict;
    binding = { reportHash: reportHash('04-code-generation-supervision.json'), supervisionHash: hash(readFileSync(join(root, 'cg/supervision.json'))), reviewHash: reportHash('03-code-generation-code-review.json') };
  } else if (phase === 'implement' || phase === 'fix') {
    checkPlan(); checkTraceability();
    for (const [check, script, expected] of [['build', ctx.buildScript, ctx.buildHash], ['test', ctx.verifyScript, ctx.verifyHash]]) {
      assert.equal(hash(readFileSync(script)), expected);
      const r = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 256 * 1024 });
      const row = { phase: check, code: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '', verdict: r.status === 0 ? 'passed' : 'failed', sourceHash: hash(JSON.stringify(sources(root))) };
      ledger.push(row); save(ledgerPath, ledger); save(join(root, `cg/${check}.json`), row);
      assert.equal(r.status, 0, `${check}失敗。cg/${check}.jsonを読み修正すること`);
    }
    const results: Record<string, unknown> = { 'required-sections': { status: 'passed' }, traceability: { status: 'passed' } };
    for (const id of ['linter', 'type-check']) {
      const sensor = ctx.sensorScripts[id];
      if (!sensor) {
        const exception = ctx.sensorExceptions[id];
        assert.ok(exception?.reason?.trim() && ctx.cg.files.includes(exception.source), `${id}の適用外根拠が不正`);
        results[id] = { status: 'not_applicable', ...exception }; continue;
      }
      assert.equal(hash(readFileSync(sensor.path)), sensor.hash);
      const result = spawnSync(process.execPath, [sensor.path], { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 256 * 1024 });
      save(join(root, `cg/${id}.json`), { code: result.status, stdout: result.stdout, stderr: result.stderr });
      assert.equal(result.status, 0, `${id}実行失敗`);
      const output = JSON.parse(result.stdout);
      ledger.push({ phase: 'sensor', sensor: id, verdict: output.pass === true ? 'passed' : 'failed', output, sourceHash: hash(JSON.stringify(sources(root))) }); save(ledgerPath, ledger);
      assert.equal(output.pass, true, `${id}検査不合格`);
      results[id] = { status: 'passed', output };
    }
    ledger.push({ phase: 'sensors', verdict: 'passed', results, sourceHash: hash(JSON.stringify(sources(root))) }); save(ledgerPath, ledger);
    save(join(root, 'cg/sensors.json'), results);
  } else if (phase === 'finish') {
    checkSupervised(); const r = report('05-code-generation-summary.json');
    assert.equal(r.verdict, 'complete'); assert.ok(r.summary?.trim());
    assert.deepEqual([...r.notReproduced].sort(), ['human-approval', 'aidlc-lifecycle'].sort());
    writeFileSync(join(root, 'cg/code-summary.md'), r.summaryMarkdown ?? `# Code Summary\n\n## Changes and Verification\n\n${r.summary}\n\n## Deviations\n${r.notReproduced.join('\n')}\n`);
    checkSections('cg/code-summary.md');
    writeFileSync(join(root, 'cg/code-generation-plan.md'), readFileSync(join(root, 'cg/code-generation-plan.md'), 'utf8').replace(/^(\s*[-*+]\s+)\[ \]/gm, '$1[x]'));
    binding = { reportHash: reportHash('05-code-generation-summary.json'), summaryHash: hash(readFileSync(join(root, 'cg/code-summary.md'))) };
  } else throw new Error(`Unknown CG phase: ${phase}`);
  ledger.push({ phase, verdict, sourceHash: hash(JSON.stringify(sources(root))), ...binding }); save(ledgerPath, ledger);
  save(join(root, 'cg/progress.json'), ledger);
  return { state: 'checked', phase, verdict };
}
if (import.meta.main) {
  try { console.log(JSON.stringify(cgGate(dirname(realpathSync(import.meta.path)), process.argv[2]))); }
  catch (error) { console.error(String(error)); process.exitCode = 1; }
}
