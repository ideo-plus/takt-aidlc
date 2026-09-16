import assert from 'node:assert/strict';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hash, sources } from './code-generation-gate';

export function constructionSupervisionGate(control: string) {
  const ctx = JSON.parse(readFileSync(join(control, 'supervision-context.json'), 'utf8'));
  const root = ctx.workspace;
  assert.equal(realpathSync(process.cwd()), realpathSync(root));
  for (const [path, expected] of Object.entries(ctx.inputs)) assert.equal(hash(readFileSync(join(root, path))), expected, `固定入力が変化: ${path}`);
  const current = sources(root);
  assert.deepEqual(current, ctx.sources, 'supervise中にソースが変化');
  const runs = readdirSync(join(root, '.takt/runs'));
  assert.equal(runs.length, 1);
  const file = join(root, '.takt/runs', runs[0], 'reports/04-construction-supervision.json');
  const result = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(['approved', 'changes_requested', 'blocked'].includes(result.verdict));
  assert.ok(result.intentAssessment?.trim());
  if (result.verdict === 'blocked') {
    assert.ok(result.reason?.trim());
    return { ...result, sourceHash: hash(JSON.stringify(current)), reportHash: hash(readFileSync(file)) };
  }
  assert.deepEqual(result.requirements.map((row: any) => row.id).sort(), [...ctx.requirementIds].sort(), 'superviseに要求の抜け・重複がある');
  for (const row of result.requirements) {
    assert.ok(['met', 'unmet', 'undetermined'].includes(row.status));
    assert.ok(Array.isArray(row.evidence) && row.evidence.length > 0);
    for (const evidence of row.evidence) assert.ok(Object.hasOwn(current, evidence.path) && evidence.reason?.trim(), 'コード上の根拠がない');
  }
  assert.deepEqual(result.units.map((row: any) => row.unit).sort(), [...ctx.units].sort());
  assert.ok(result.units.every((row: any) => ['met', 'unmet', 'undetermined'].includes(row.status) && row.assessment?.trim()));
  assert.ok(Array.isArray(result.findings) && Array.isArray(result.repairUnits));
  for (const finding of result.findings) {
    assert.ok(finding.id?.trim() && finding.reason?.trim() && finding.fix?.trim());
    assert.ok(Array.isArray(finding.requirementIds) && finding.requirementIds.length && finding.requirementIds.every((id: string) => ctx.requirementIds.includes(id)));
  }
  if (result.verdict === 'approved') {
    assert.ok(result.requirements.every((row: any) => row.status === 'met'));
    assert.ok(result.units.every((row: any) => row.status === 'met'));
    assert.equal(result.findings.length, 0); assert.equal(result.repairUnits.length, 0);
  } else {
    assert.ok(result.findings.length > 0 && result.repairUnits.length > 0);
    assert.equal(new Set(result.repairUnits).size, result.repairUnits.length);
    assert.ok(result.repairUnits.every((unit: string) => ctx.units.includes(unit)), '修正対象Unitが不正');
  }
  return { ...result, sourceHash: hash(JSON.stringify(current)), reportHash: hash(readFileSync(file)) };
}
if (import.meta.main) {
  try { console.log(JSON.stringify(constructionSupervisionGate(dirname(realpathSync(import.meta.path))))); }
  catch (error) { console.error(String(error)); process.exitCode = 1; }
}
