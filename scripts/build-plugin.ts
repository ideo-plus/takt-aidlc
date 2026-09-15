import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { digest, writeJson } from '../src/handoff/io';

const root = resolve(import.meta.dir, '..');
export const output = join(root, 'dist/claude');

export async function buildPlugin() {
  // このビルド専用の生成先だけを置き換える。
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  for (const directory of ['.claude-plugin', 'hooks']) cpSync(join(root, 'plugins/claude', directory), join(output, directory), { recursive: true });
  const built = await Bun.build({ entrypoints: [join(root, 'src/handoff/cli.ts')], target: 'bun', format: 'esm', outdir: join(output, 'scripts'), naming: 'handoff.js' });
  if (!built.success) throw new Error(built.logs.map(String).join('\n'));
  if (!existsSync(join(output, 'scripts/handoff.js'))) throw new Error('連携CLIが生成されませんでした');
  cpSync(join(root, 'src/construction/construction-gate.ts'), join(output, 'scripts/construction-gate.ts'));
  cpSync(join(root, 'workflows'), join(output, 'workflows'), { recursive: true });
  const sourceFiles = ['src/handoff/cli.ts', 'src/handoff/bridge.ts', 'src/handoff/io.ts', 'src/construction/runtime.ts', 'src/construction/construction-gate.ts', 'workflows/aidlc-construction.yaml', 'plugins/claude/.claude-plugin/plugin.json', 'plugins/claude/hooks/hooks.json'];
  writeJson(join(output, 'build-info.json'), {
    version: JSON.parse(readFileSync(join(output, '.claude-plugin/plugin.json'), 'utf8')).version,
    aidlcVersion: '2.8.2', bunVersion: Bun.version,
    sources: Object.fromEntries(sourceFiles.map(path => [path, digest(readFileSync(join(root, path)))])),
    bundleSha256: digest(readFileSync(join(output, 'scripts/handoff.js'))),
  });
  return output;
}
if (import.meta.main) console.log(await buildPlugin());
