import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cleanEnvironment, command, digest, fileInside, requireSuccess, snapshot, unchanged, writeJson, type Snapshot } from '../handoff/io';
import { prepareProvider } from '../handoff/provider';
import { materializeWorkflow } from '../takt/workflow';
import { sources, cgGateSource } from '../code-generation/code-generation-gate';
import type { PhaseConfig } from './context';
import contract from '../../takt/facets/policies/aidlc-supervision.md' with { type: 'text' };

export async function executeConstructionSupervision(args: {
  attempt: string; store: string; files: Snapshot; sourcePaths: string[]; inputPaths: string[];
  requirementIds: string[]; units: string[]; config: PhaseConfig; repaired: boolean; timeout: number; verify: () => void;
}) {
  const { attempt, store, files, sourcePaths, requirementIds, units, config, verify } = args;
  const workspace = join(attempt, 'work'), control = join(attempt, 'control');
  mkdirSync(workspace, { recursive: true }); mkdirSync(control, { recursive: true });
  const copy = (path: string, target: string) => {
    mkdirSync(dirname(target), { recursive: true }); copyFileSync(fileInside(store, path), target);
  };
  for (const path of sourcePaths) { copy(path, join(workspace, path)); chmodSync(join(workspace, path), 0o644); }
  const inputs: Snapshot = {};
  const paths = [...new Set(args.inputPaths)];
  for (const path of paths) {
    const target = `input/project/${path}`; copy(path, join(workspace, target));
    inputs[target] = files[path];
  }
  const context = { requirementIds, units, inputPaths: paths, sources: sources(workspace) };
  writeJson(join(workspace, 'input/supervision-context.json'), context);
  inputs['input/supervision-context.json'] = digest(readFileSync(join(workspace, 'input/supervision-context.json')));
  writeJson(join(control, 'supervision-context.json'), { ...context, workspace, inputs });
  copyFileSync(join(import.meta.dir, 'construction-supervision-gate.ts'), join(control, 'construction-supervision-gate.ts'));
  copyFileSync(cgGateSource, join(control, 'code-generation-gate.ts'));
  const { workflow, controlFiles } = materializeWorkflow(store, config.constructionWorkflow, control);
  const supervisor = workflow.steps.find((step: any) => step.name === 'supervise');
  if (!supervisor) throw new Error('Constructionのsuperviseステップが必要です');
  workflow.initial_step = 'supervise';
  workflow.steps = [supervisor];
  const bundle = `${contract}\n${paths.map(path => `\n## Original source: ${path}\nSHA256: ${files[path]}\n${readFileSync(fileInside(store, path), 'utf8')}\n`).join('')}\n${contract}`;
  writeFileSync(join(control, 'supervision-sources.md'), bundle);
  workflow.instructions['construction-supervision-sources'] = './supervision-sources.md';
  supervisor.instruction = ['construction-supervision-sources', ...[supervisor.instruction].flat()];
  writeFileSync(join(control, 'workflow.yaml'), Bun.YAML.stringify(workflow));
  writeJson(join(control, 'injection.json'), paths.map(path => ({ path, sha256: files[path] })));
  const protectedFiles = snapshot(control, ['supervision-context.json', 'construction-supervision-gate.ts', 'code-generation-gate.ts', 'supervision-sources.md', 'workflow.yaml', 'injection.json', ...controlFiles]);
  const key = args.repaired ? 'all/supervise-after-repair' : 'all/supervise';
  const scenario = config.stageScenarios?.[key];
  if (config.provider === 'mock' && !scenario) throw new Error(`mock応答がありません: ${key}`);
  const env = prepareProvider(attempt, { ...config, delegationScope: 'code-generation' }, scenario ? fileInside(store, scenario) : undefined);
  for (const gitArgs of [['init', '-q'], ['config', 'core.hooksPath', '/dev/null'], ['add', '.'], ['-c', 'user.name=TAKT', '-c', 'user.email=takt@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'chore: seed supervision workspace']]) {
    requireSuccess(await command(['git', ...gitArgs], workspace, env, 10000));
  }
  verify();
  const run = await command(['takt', '--pipeline', '--skip-git', '--provider', config.provider, '--workflow', join(control, 'workflow.yaml'), '--task', 'Construction全体のIntent・受入条件と最終コードを独立に照合し、要件充足とUnit間の整合性を判定してください。'], workspace, env, args.timeout, { outputPrefix: join(attempt, 'takt-output') });
  writeJson(join(attempt, 'takt.json'), run);
  if (run.timedOut || run.outputLimitExceeded) requireSuccess(run);
  verify(); unchanged(workspace, inputs); unchanged(control, protectedFiles);
  const checked = await command([process.execPath, join(control, 'construction-supervision-gate.ts')], workspace, cleanEnvironment(), 10000);
  writeJson(join(attempt, 'result.json'), checked);
  requireSuccess(checked);
  const result = JSON.parse(checked.stdout);
  if (result.verdict === 'approved') requireSuccess(run);
  return { ...result, workspace };
}
