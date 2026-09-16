import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { digest, writeJson } from '../src/handoff/io';

const root = resolve(import.meta.dir, '..');
export const output = join(root, 'dist/claude');
export const codexOutput = join(root, 'dist/codex/plugins/takt-aidlc');

export async function buildPlugin() {
  const taktFiles = readdirSync(join(root, 'takt'), { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name).slice(root.length + 1)).sort();
  const sourceFiles = ['src/takt/workflow.ts', ...taktFiles, 'src/handoff/cli.ts', 'src/handoff/approval.ts', 'src/hosts/events.ts', 'src/handoff/io.ts', 'src/handoff/provider.ts', 'src/construction-phase/context.ts', 'src/construction-phase/runner.ts', 'src/construction-phase/stage.ts', 'src/construction-phase/construction-gate.ts', 'src/construction-phase/native-trace.ts', 'src/construction-phase/code-generation-gate.ts', 'src/hosts/harness.ts', 'src/hosts/codex.ts', 'src/code-generation/context.ts', 'src/code-generation/runner.ts', 'src/code-generation/code-generation-gate.ts'];
  for (const [target, source, manifestDir] of [
    [output, 'plugins/claude', '.claude-plugin'],
    [codexOutput, 'plugins/codex/takt-aidlc', '.codex-plugin'],
  ]) {
    // このビルド専用の生成先だけを置き換える。
    rmSync(target, { recursive: true, force: true }); mkdirSync(target, { recursive: true });
    for (const directory of [manifestDir, 'hooks']) cpSync(join(root, source, directory), join(target, directory), { recursive: true });
    cpSync(join(root, 'LICENSE'), join(target, 'LICENSE'));
    const built = await Bun.build({ entrypoints: [join(root, 'src/handoff/cli.ts')], target: 'bun', format: 'esm', outdir: join(target, 'scripts'), naming: 'handoff.js' });
    if (!built.success) throw new Error(built.logs.map(String).join('\n'));
    if (!existsSync(join(target, 'scripts/handoff.js'))) throw new Error('連携CLIが生成されませんでした');
    cpSync(join(root, 'src/construction-phase/native-trace.ts'), join(target, 'scripts/native-trace.ts'));
    cpSync(join(root, 'src/construction-phase/construction-gate.ts'), join(target, 'scripts/construction-gate.ts'));
    cpSync(join(root, 'src/code-generation/code-generation-gate.ts'), join(target, 'scripts/code-generation-gate.ts'));
    cpSync(join(root, 'takt'), join(target, 'takt'), { recursive: true });
    const inputs = [...sourceFiles, 'LICENSE', `${source}/${manifestDir}/plugin.json`, `${source}/hooks/hooks.json`];
    writeJson(join(target, 'build-info.json'), {
      version: JSON.parse(readFileSync(join(target, manifestDir, 'plugin.json'), 'utf8')).version,
      aidlcVersion: '2.8.2', bunVersion: Bun.version,
      sources: Object.fromEntries(inputs.map(path => [path, digest(readFileSync(join(root, path)))])),
      bundleSha256: digest(readFileSync(join(target, 'scripts/handoff.js'))),
    });
  }
  writeJson(join(root, 'dist/codex/.agents/plugins/marketplace.json'), {
    name: 'takt-aidlc-local', interface: { displayName: 'TAKT AI-DLC' },
    plugins: [{ name: 'takt-aidlc', source: { source: 'local', path: './plugins/takt-aidlc' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }],
  });
  return output;
}
if (import.meta.main) { await buildPlugin(); console.log(output); console.log(codexOutput); }
