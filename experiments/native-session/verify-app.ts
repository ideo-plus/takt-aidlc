import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// この実験でユーザーが承認した、値・テスト・80%の行カバレッジを検証する。
const source = join(process.cwd(), 'src/value.ts');
const app = await import(pathToFileURL(source).href);
assert.equal(app.answer, 42, 'answerは42でなければなりません');
const coverage = mkdtempSync(join(process.cwd(), '.handoff-coverage-'));
const result = spawnSync(process.execPath, ['test', '--coverage', '--coverage-reporter=lcov', `--coverage-dir=${coverage}`], { cwd: process.cwd(), encoding: 'utf8', timeout: 20000 });
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
assert.equal(result.status, 0, 'bun test --coverageが失敗しました');
const lcov = readFileSync(join(coverage, 'lcov.info'), 'utf8');
const record = lcov.split('end_of_record').find(block => {
  const file = block.match(/^SF:(.+)$/m)?.[1];
  return file !== undefined && resolve(file) === source;
});
assert.ok(record, 'src/value.tsのカバレッジ記録がありません');
const found = Number(record.match(/^LF:(\d+)$/m)?.[1]);
const hit = Number(record.match(/^LH:(\d+)$/m)?.[1]);
assert.ok(found > 0 && hit / found >= 0.8, '行カバレッジが80%未満です');
console.log(`受入条件を確認: answer === 42、テスト成功、行カバレッジ ${hit}/${found}`);
