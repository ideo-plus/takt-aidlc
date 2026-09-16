import { constants, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostHarness } from '../hosts/harness';

export type SetupOptions = {
  language: 'ja' | 'en';
  scope: 'code-generation' | 'construction';
  provider: 'claude' | 'codex';
};

function existing(path: string, kind: 'file' | 'directory') {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return false;
  if (stat.isSymbolicLink() || (kind === 'file' ? !stat.isFile() : !stat.isDirectory())) {
    throw new Error(`通常の${kind === 'file' ? 'ファイル' : 'ディレクトリ'}が必要です: ${path}`);
  }
  return true;
}

function checkBundle(root: string) {
  if (!existing(root, 'directory')) throw new Error(`同梱TAKT定義がありません: ${root}`);
  for (const name of readdirSync(root)) {
    const path = join(root, name), stat = lstatSync(path);
    if (stat.isDirectory()) checkBundle(path);
    else existing(path, 'file');
  }
}

export function pluginHost(pluginRoot: string): HostHarness {
  const codex = existsSync(join(pluginRoot, '.codex-plugin/plugin.json'));
  const claude = existsSync(join(pluginRoot, '.claude-plugin/plugin.json'));
  if (codex === claude) throw new Error('ホストを特定できません。インストール済みプラグインのsetup.jsを使ってください');
  return codex ? 'codex' : 'claude';
}

export function setupProject(projectPath: string, pluginRoot: string, options: SetupOptions) {
  const project = realpathSync(projectPath);
  if (!existing(project, 'directory')) throw new Error('対象プロジェクトがありません');
  const hostHarness = pluginHost(pluginRoot);
  if (!['ja', 'en'].includes(options.language) || !['code-generation', 'construction'].includes(options.scope) || !['claude', 'codex'].includes(options.provider)) {
    throw new Error('language・scope・providerの指定が不正です');
  }
  const source = join(pluginRoot, 'takt');
  checkBundle(source);
  for (const language of ['ja', 'en']) for (const name of ['aidlc-code-generation-stage', 'aidlc-construction-phase']) {
    if (!existing(join(source, language, 'workflows', `${name}.yaml`), 'file')) throw new Error('同梱Workflowが不足しています');
  }
  const aidlc = join(project, 'aidlc'), base = join(aidlc, 'takt-handoff');
  // 既存のリンクを経由してプロジェクト外へ書き込まない。
  existing(aidlc, 'directory'); existing(base, 'directory');
  const target = join(base, 'takt'), configPath = join(base, 'config.json');
  existing(target, 'directory'); existing(configPath, 'file');
  mkdirSync(base, { recursive: true });
  const lock = join(base, '.setup.lock');
  mkdirSync(lock);
  let temporary: string | undefined;
  try {
    const keepTakt = existing(target, 'directory'), keepConfig = existing(configPath, 'file');
    const prefix = 'aidlc/takt-handoff';
    const config = {
      enabled: false,
      hostHarness,
      language: options.language,
      delegationScope: options.scope,
      provider: options.provider,
      artifacts: [],
      sources: [],
      workflow: `${prefix}/takt/${options.language}/workflows/aidlc-code-generation-stage.yaml`,
      buildScript: `${prefix}/build.ts`,
      verifyScript: `${prefix}/test.ts`,
      sensorScripts: { 'type-check': `${prefix}/typecheck.ts`, linter: `${prefix}/lint.ts` },
      timeoutMs: 1800000,
      ...(options.scope === 'construction' ? {
        constructionWorkflow: `${prefix}/takt/${options.language}/workflows/aidlc-construction-phase.yaml`,
        phaseBuildScript: `${prefix}/phase-build.ts`,
        phaseVerifyScript: `${prefix}/phase-test.ts`,
      } : {}),
    };
    temporary = mkdtempSync(join(base, '.setup-'));
    if (!keepTakt) {
      cpSync(source, join(temporary, 'takt'), { recursive: true, errorOnExist: true, force: false });
      renameSync(join(temporary, 'takt'), target);
    }
    if (!keepConfig) {
      writeFileSync(join(temporary, 'config.json'), JSON.stringify(config, null, 2) + '\n');
      copyFileSync(join(temporary, 'config.json'), configPath, constants.COPYFILE_EXCL);
    }
    return {
      project,
      takt: { path: target, action: keepTakt ? 'preserved' : 'created' },
      config: { path: configPath, action: keepConfig ? 'preserved' : 'created' },
      next: options.language === 'ja'
        ? '既存ファイルは保持しました。config.jsonの入力・ソース・ビルド／テスト・センサーを整え、Workflowパスと言語を確認してからenabledをtrueにしてください。初期設定は既存TAKT定義の更新や既存設定の切替を行いません。'
        : 'Existing files are preserved. Configure inputs, sources, build/test scripts, and sensors; check workflow paths and language before setting enabled to true. Setup does not upgrade existing TAKT definitions or switch existing settings.',
    };
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
    rmSync(lock, { recursive: true });
  }
}
