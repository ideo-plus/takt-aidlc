import { afterAll, beforeAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPlugin, output, codexOutput } from '../scripts/build-plugin';
import { cleanEnvironment } from '../src/handoff/io';
import { workflowFiles } from '../src/takt/workflow';

const root = mkdtempSync(join(tmpdir(), 'takt-setup-'));
const plugins = { claude: join(root, 'claude plugin'), codex: join(root, 'codex plugin') };
beforeAll(async () => {
  await buildPlugin();
  cpSync(output, plugins.claude, { recursive: true });
  cpSync(codexOutput, plugins.codex, { recursive: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
const project = () => mkdtempSync(join(root, 'project with spaces '));
function run(host: 'claude' | 'codex', target: string, args: string[] = []) {
  return spawnSync(process.execPath, [join(plugins[host], 'scripts/setup.js'), '--project', target, ...args], {
    cwd: root, env: cleanEnvironment(), encoding: 'utf8', timeout: 10000,
  });
}

test.each(['claude', 'codex'] as const)('%s配布物だけで初期設定でき、CGの既定は日本語・無効状態になる', host => {
  const target = project(), result = run(host, target);
  expect(result.status).toBe(0);
  const report = JSON.parse(result.stdout), config = JSON.parse(readFileSync(report.config.path, 'utf8'));
  expect(config).toMatchObject({ enabled: false, hostHarness: host, provider: host, language: 'ja', delegationScope: 'code-generation', artifacts: [], sources: [] });
  expect(config.constructionWorkflow).toBeUndefined();
  expect(workflowFiles(target, config.workflow).length).toBeGreaterThan(10);
  expect(workflowFiles(target, 'aidlc/takt-handoff/takt/en/workflows/aidlc-construction-phase.yaml').length).toBeGreaterThan(5);
  expect(existsSync(join(target, config.buildScript))).toBe(false);
  const hook = spawnSync(process.execPath, [join(plugins[host], 'scripts/handoff.js'), host === 'codex' ? 'codex-session' : 'session', target], {
    cwd: target, input: JSON.stringify({ cwd: target }), env: cleanEnvironment(), encoding: 'utf8', timeout: 10000,
  });
  expect(hook.status).toBe(0);
  expect(hook.stdout).toBe('');
});

test('英語Constructionと別ホストのワーカーを設定できる', () => {
  const target = project();
  const result = run('claude', target, ['--language', 'en', '--scope', 'construction', '--provider', 'codex']);
  expect(result.status).toBe(0);
  const config = JSON.parse(readFileSync(JSON.parse(result.stdout).config.path, 'utf8'));
  expect(config).toMatchObject({ enabled: false, hostHarness: 'claude', provider: 'codex', language: 'en', delegationScope: 'construction' });
  expect(config.workflow).toContain('/en/workflows/');
  expect(config.constructionWorkflow).toContain('/en/workflows/');
  expect(config.phaseBuildScript).toBe('aidlc/takt-handoff/phase-build.ts');
  expect(config.phaseVerifyScript).toBe('aidlc/takt-handoff/phase-test.ts');
});

test('再実行しても設定とカスタム定義を変更せず、削除済みファイルも補充しない', () => {
  const target = project();
  const initial = JSON.parse(run('codex', target).stdout);
  const custom = '{ "enabled": true, "custom": "keep verbatim" }\n';
  writeFileSync(initial.config.path, custom);
  const facet = join(initial.takt.path, 'ja/facets/instructions/code-generation-plan.md');
  writeFileSync(facet, 'custom facet');
  rmSync(join(initial.takt.path, 'en'), { recursive: true });
  const result = run('codex', target, ['--language', 'en', '--scope', 'construction']);
  expect(result.status).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report.config.action).toBe('preserved');
  expect(report.takt.action).toBe('preserved');
  expect(readFileSync(initial.config.path, 'utf8')).toBe(custom);
  expect(readFileSync(facet, 'utf8')).toBe('custom facet');
  expect(existsSync(join(initial.takt.path, 'en'))).toBe(false);
  expect(readdirSync(join(target, 'aidlc/takt-handoff')).sort()).toEqual(['config.json', 'takt']);
});

test('既存設定だけがある場合も設定を保持して定義を配置する', () => {
  const target = project(), base = join(target, 'aidlc/takt-handoff');
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'config.json'), '{"enabled":false}\n');
  const result = run('claude', target);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).takt.action).toBe('created');
  expect(readFileSync(join(base, 'config.json'), 'utf8')).toBe('{"enabled":false}\n');
});

test('不正なオプションや既存リンク・ファイル衝突を拒否して上書きしない', () => {
  for (const args of [['--language', 'fr'], ['--scope', 'other'], ['--provider', 'mock'], ['--unknown']]) {
    const target = project();
    expect(run('claude', target, args).status).not.toBe(0);
    expect(readdirSync(target)).toEqual([]);
  }
  const external = project();
  for (const path of ['aidlc', 'aidlc/takt-handoff', 'aidlc/takt-handoff/takt', 'aidlc/takt-handoff/config.json']) {
    const target = project(), full = join(target, path);
    mkdirSync(join(full, '..'), { recursive: true });
    symlinkSync(external, full);
    expect(run('codex', target).status).not.toBe(0);
    expect(readdirSync(external)).toEqual([]);
  }
  const target = project(), base = join(target, 'aidlc/takt-handoff');
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'takt'), 'keep');
  expect(run('claude', target).status).not.toBe(0);
  expect(readFileSync(join(base, 'takt'), 'utf8')).toBe('keep');
  expect(existsSync(join(base, 'config.json'))).toBe(false);
});
