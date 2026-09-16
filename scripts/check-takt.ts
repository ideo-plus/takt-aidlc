import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cleanEnvironment, command, requireSuccess } from '../src/handoff/io';
import { workflowFiles } from '../src/takt/workflow';

const root = resolve(import.meta.dir, '..');
const temporary = mkdtempSync(join(tmpdir(), 'takt-check-'));
try {
  for (const language of ['ja', 'en']) {
    const config = join(temporary, language); mkdirSync(config);
    writeFileSync(join(config, 'config.yaml'), `language: ${language}\nprovider: mock\nworkflow_command_gates:\n  custom_scripts: true\n`);
    const targets = readdirSync(join(root, `takt/${language}/workflows`)).filter(name => name.endsWith('.yaml')).sort().map(name => {
      const path = `takt/${language}/workflows/${name}`;
      workflowFiles(root, path);
      return join(root, path);
    });
    if (!targets.length) throw new Error('検証するTAKT Workflowがありません');
    // 組み込みペルソナを使う元のYAMLを、TAKT自身で検証する。
    const result = await command(['takt', 'workflow', 'doctor', ...targets], temporary, { ...cleanEnvironment(), TAKT_CONFIG_DIR: config }, 30000);
    requireSuccess(result);
    process.stdout.write(result.stdout);
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
