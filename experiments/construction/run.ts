import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { captureApproval, prepareHandoff, executeHandoff } from '../../src/handoff/bridge';
import { readJson, writeJson } from '../../src/handoff/io';
import { constructionFixture } from './fixture';

const live = process.argv.includes('--live');
const f = await constructionFixture({ live, repairs: process.argv.includes('--repairs') });
captureApproval(f.project, f.event);
const h = (await prepareHandoff(f.project, f.event))!;
console.log(JSON.stringify({ run: h.run, provider: live ? 'claude' : 'mock' }));
const status = await executeHandoff(f.project, h.id);
const result = {
  verdict: status.state === 'verified' ? 'VERIFIED' : 'NOT VERIFIED',
  scope: 'Construction workflow execution; copied real approved artifacts; synthetic approval boundary',
  provider: live ? 'claude' : 'mock', status,
  originalSource: readFileSync(join(f.project, 'src/value.ts'), 'utf8'),
  gates: existsSync(join(h.run, 'attempts/1/control/ledger.json')) ? readJson(join(h.run, 'attempts/1/control/ledger.json')) : [],
};
writeJson(join(h.run, 'result.json'), result);
console.log(JSON.stringify(result, null, 2));
assert.equal(status.state, 'verified', status.error ?? 'Constructionが完了していません');
