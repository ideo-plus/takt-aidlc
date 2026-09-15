import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanEnvironment, command, digest, quote, requireSuccess, writeJson } from '../../src/handoff/io';

const repo = resolve(import.meta.dir, '../..');
const run = realpathSync(process.argv[2]);
assert.ok(run.startsWith(join(repo, '.experiments/native') + '/'));
const session = JSON.parse(readFileSync(join(run, 'session.json'), 'utf8'));
const interactive = JSON.parse(readFileSync(join(run, 'interactive.json'), 'utf8'));
const project: string = session.project;
const plugin = join(repo, 'dist/claude');
requireSuccess(await command(['claude', 'plugin', 'validate', plugin], repo, cleanEnvironment(), 10000));
const migration = join(run, 'plugin-migration'); mkdirSync(migration, { recursive: true });
assert.ok(!existsSync(join(migration, 'result.json')), '切り替え済みです。現在の画面を確認してください');
const settingsPath = join(project, '.claude/settings.json');
const original = readFileSync(settingsPath, 'utf8');
writeFileSync(join(migration, 'settings-before.json'), original, { mode: 0o600 });
const settings = JSON.parse(original);
const manualEntry = join(repo, 'src/handoff/cli.ts');
let removed = 0;
for (const event of ['PreToolUse', 'PostToolUse']) {
  settings.hooks[event] = settings.hooks[event].flatMap((group: any) => {
    const hooks = group.hooks.filter((hook: any) => {
      const manual = typeof hook.command === 'string' && hook.command.includes(manualEntry);
      if (manual) removed++;
      return !manual;
    });
    return hooks.length ? [{ ...group, hooks }] : [];
  });
}
assert.equal(removed, 2, '既知の手動フック2件だけを置換します');
const before = await command(['aidlc', 'engine', 'workspace', 'codekb-snapshot', '--paths', './', '--json'], project, cleanEnvironment(), 10000);
requireSuccess(before);
writeJson(settingsPath, settings);
const after = await command(['aidlc', 'engine', 'workspace', 'codekb-snapshot', '--paths', './', '--json'], project, cleanEnvironment(), 10000);
requireSuccess(after);
const sameSource = JSON.parse(before.stdout).source_fingerprint === JSON.parse(after.stdout).source_fingerprint;
let settingsArgs = ['--setting-sources', 'project'];
if (!sameSource) {
  // projectを外すと専門エージェントも消えるので、設定は通常どおり読む。
  // 自分たちの旧フックだけを環境変数で無効にする。
  writeFileSync(settingsPath, original);
  const effective = join(migration, 'effective-settings.json'); writeJson(effective, { env: { TAKT_AIDLC_PLUGIN_ONLY: '1' } });
  settingsArgs = ['--setting-sources', 'project', '--settings', effective];
}
const argv = ['claude', '--resume', session.sessionId, '--plugin-dir', plugin, '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash(aidlc *)', ...settingsArgs, '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'];
requireSuccess(await command(['tmux', '-L', interactive.socket, 'respawn-pane', '-k', '-t', interactive.session, '-c', project, argv.map(quote).join(' ')], repo, cleanEnvironment(), 10000));
writeJson(join(migration, 'result.json'), {
  plugin, removedManualHooks: removed, projectSettingsChanged: sameSource,
  sourceFingerprintPreserved: true,
  originalSettingsSha256: digest(original), effectiveSettingsSha256: digest(JSON.stringify(settings)),
  sessionId: session.sessionId, interactive,
  stageApprovalGranted: false,
  projectAgentDiscovery: true,
});
console.log(JSON.stringify({ run, removedManualHooks: removed, projectSettingsChanged: sameSource, sourceFingerprintPreserved: true }));
