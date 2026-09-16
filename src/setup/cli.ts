import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pluginHost, setupProject, type SetupOptions } from './project';

try {
  const { values } = parseArgs({
    args: process.argv.slice(2), strict: true, allowPositionals: false,
    options: {
      project: { type: 'string', default: '.' },
      language: { type: 'string', default: 'ja' },
      scope: { type: 'string', default: 'code-generation' },
      provider: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log('Usage: bun <plugin>/scripts/setup.js [--project PATH] [--language ja|en] [--scope code-generation|construction] [--provider claude|codex]\n\nDefaults: current project, ja, code-generation; provider matches the installed host.\nCopies bundled TAKT definitions and creates a disabled config. Existing definitions and config are preserved.');
  } else {
    const pluginRoot = resolve(import.meta.dir, '..');
    const result = setupProject(values.project, pluginRoot, {
      language: values.language, scope: values.scope, provider: values.provider ?? pluginHost(pluginRoot),
    } as SetupOptions);
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(String(error));
  process.exitCode = 2;
}
