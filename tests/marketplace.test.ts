import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cleanEnvironment } from '../src/handoff/io';

test('公開するGitツリーだけで両CLIからインストールしフックを起動できる', () => {
  const root = resolve(import.meta.dir, '..');
  const temporary = mkdtempSync(join(tmpdir(), 'takt-marketplace-'));
  const checkout = join(temporary, 'marketplace');
  const env = {
    ...cleanEnvironment(),
    CODEX_HOME: join(temporary, 'codex-home'),
    CLAUDE_CONFIG_DIR: join(temporary, 'claude-home'),
  };
  const run = (args: string[], cwd = temporary) => {
    const result = spawnSync(args[0], args.slice(1), { cwd, env, encoding: 'utf8', timeout: 30000 });
    if (result.status !== 0) throw new Error(`${args.join(' ')}: ${result.stderr}\n${result.stdout}`);
    return result.stdout;
  };
  try {
    mkdirSync(checkout);
    mkdirSync(env.CODEX_HOME);
    mkdirSync(env.CLAUDE_CONFIG_DIR);
    // No src/, node_modules/, dist/, or build step is available to installers.
    for (const path of ['.agents/plugins', '.claude-plugin', 'plugins/takt-aidlc', 'plugins/takt-aidlc-claude']) {
      cpSync(join(root, path), join(checkout, path), { recursive: true });
    }
    run(['git', 'init', '-q'], checkout);
    run(['git', 'add', '.'], checkout);
    run(['git', '-c', 'user.name=Marketplace Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'test: marketplace fixture'], checkout);
    const fetched = join(temporary, 'fetched');
    run(['git', 'clone', '--quiet', `file://${checkout}`, fetched]);

    run(['claude', 'plugin', 'marketplace', 'add', fetched]);
    run(['claude', 'plugin', 'install', 'takt-aidlc@takt-aidlc']);
    const claude = JSON.parse(run(['claude', 'plugin', 'list', '--json']));
    const installedClaude = claude.find((entry: any) => entry.id === 'takt-aidlc@takt-aidlc');
    expect(installedClaude?.enabled).toBe(true);

    run(['codex', 'plugin', 'marketplace', 'add', fetched, '--json']);
    const codex = JSON.parse(run(['codex', 'plugin', 'add', 'takt-aidlc@takt-aidlc', '--json']));
    for (const [host, installed] of [['claude', installedClaude.installPath], ['codex', codex.installedPath]]) {
      expect(readFileSync(join(installed, 'LICENSE'), 'utf8')).toContain('MIT License');
      expect(readFileSync(join(installed, 'takt/aidlc-code-generation.yaml'), 'utf8')).toContain('./facets/instructions/cg-plan.md');
      expect(readFileSync(join(installed, 'takt/facets/instructions/cg-plan.md'), 'utf8')).toContain('現在のUnitのCG計画');
      const hooks = JSON.parse(readFileSync(join(installed, 'hooks/hooks.json'), 'utf8')).hooks;
      const hook = spawnSync('/bin/sh', ['-c', hooks.SessionStart[0].hooks[0].command], {
        cwd: temporary,
        env: { ...env, PLUGIN_ROOT: installed, CLAUDE_PLUGIN_ROOT: installed, CLAUDE_PROJECT_DIR: temporary },
        input: JSON.stringify({ cwd: temporary, hook_event_name: 'SessionStart' }),
        encoding: 'utf8', timeout: 10000,
      });
      if (hook.status !== 0) throw new Error(`${host} installed hook: ${hook.stderr}`);
      expect(hook.stdout).toBe('');
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}, 120000);
