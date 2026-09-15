import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareCg, executeCg } from '../../src/code-generation/runner';
import { readJson, writeJson } from '../../src/handoff/io';
import { cgFixture } from './fixture';

const live = process.argv.includes('--live');
const providerIndex = process.argv.indexOf('--provider');
const provider = providerIndex < 0 ? 'claude' : process.argv[providerIndex + 1];
if (provider !== 'claude' && provider !== 'codex') throw new Error('--providerはclaudeまたはcodexです');
const option = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const f = await cgFixture({ live, provider, model: option('--model'), reasoningEffort: option('--reasoning-effort'), buildFailure: process.argv.includes('--build-failure'), sensorFailure: process.argv.includes('--sensor-failure') });
const h = (await prepareCg(f.project, f.directive))!;
console.log(JSON.stringify({ run: h.run, provider: f.config.provider }));
const status = await executeCg(f.project, h.id);
const result = { verdict: status.state === 'verified' ? 'VERIFIED' : 'NOT VERIFIED', scope: 'CG only HOTL; native CG/knowledge/sensor sources; synthetic Intent/design and CG entry', status,
  originalSource: readFileSync(join(f.project, 'src/value.ts'), 'utf8'),
  ledger: existsSync(join(h.run, 'attempts/1/control/ledger.json')) ? readJson(join(h.run, 'attempts/1/control/ledger.json')) : [],
};
writeJson(join(h.run, 'result.json'), result); console.log(JSON.stringify(result, null, 2));
assert.equal(status.state, 'verified', status.error ?? 'CG failed');
