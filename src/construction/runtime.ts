import { chmodSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { digest, writeJson, type Snapshot } from '../handoff/io';
import { sourceHash } from './construction-gate';

export function prepareConstruction(attempt: string, workspace: string, verifyScript: string, inputs: Snapshot) {
  const control = join(attempt, 'control'); mkdirSync(control, { recursive: true });
  const gate = join(control, 'construction-gate.ts');
  copyFileSync(join(import.meta.dir, 'construction-gate.ts'), gate); chmodSync(gate, 0o444);
  writeJson(join(control, 'context.json'), {
    workspace, verifyScript, verifyHash: digest(readFileSync(verifyScript)), inputs,
    initialSourceHash: sourceHash(workspace),
  });
  return gate;
}
