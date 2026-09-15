import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanEnvironment, command, requireSuccess } from '../src/handoff/io';

const repo = resolve(import.meta.dir, '..');
export const testRuntime = resolve(repo, process.env.TAKT_AIDLC_TEST_RUNTIME ?? '.experiments/cache/aidlc-v2.8.2/dist/claude');

export async function prepareTestRuntime() {
  if (!testRuntime.startsWith(join(repo, '.experiments/cache') + '/')) throw new Error('テスト用runtimeは.experiments/cache内に配置してください');
  const version = await command(['aidlc', '--version'], repo, cleanEnvironment(), 10000);
  requireSuccess(version);
  if (!/^aidlc 2\.8\.2\b/.test(version.stdout)) throw new Error('テストにはaidlc 2.8.2が必要です');
  const marker = join(testRuntime, '.claude/tools/aidlc-version.ts');
  if (!existsSync(marker)) {
    mkdirSync(testRuntime, { recursive: true });
    requireSuccess(await command(['aidlc', 'config', '--harness', 'claude', '--yes'], testRuntime, cleanEnvironment(), 60000));
  }
  if (!readFileSync(marker, 'utf8').includes('2.8.2')) throw new Error('テスト用runtimeのバージョンが一致しません');
  console.log('AI-DLC 2.8.2 test runtime ready');
}
if (import.meta.main) await prepareTestRuntime();
