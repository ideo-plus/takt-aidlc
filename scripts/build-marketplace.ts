import { cpSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { buildPlugin, codexOutput, output } from './build-plugin';

const root = resolve(import.meta.dir, '..');
const bundles = [
  [output, join(root, 'plugins/takt-aidlc-claude')],
  [codexOutput, join(root, 'plugins/takt-aidlc')],
];

function files(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(directory, join(entry.parentPath, entry.name)))
    .sort();
}

await buildPlugin();
for (const [built, published] of bundles) {
  if (process.argv.includes('--check')) {
    const expected = files(built);
    if (JSON.stringify(expected) !== JSON.stringify(files(published)) ||
        expected.some(path => !readFileSync(join(built, path)).equals(readFileSync(join(published, path))))) {
      throw new Error(`${relative(root, published)} is stale; run bun run build:marketplace and commit the generated files`);
    }
  } else {
    // Only replace the two generated bundles, never the source templates.
    rmSync(published, { recursive: true, force: true });
    cpSync(built, published, { recursive: true });
  }
}
console.log(process.argv.includes('--check') ? 'Marketplace bundles match the source.' : 'Marketplace bundles updated.');
