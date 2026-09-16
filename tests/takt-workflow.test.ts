import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { materializeWorkflow, workflowFiles } from '../src/takt/workflow';
import { cleanEnvironment, readJson } from '../src/handoff/io';
import { cgFixture } from '../experiments/code-generation/fixture';
import { prepareCg, executeCg } from '../src/code-generation/runner';
import { phaseFixture } from '../experiments/construction-phase/fixture';
import { capturePhase, preparePhase, executePhase } from '../src/construction-phase/runner';

const repo = resolve(import.meta.dir, '..');
test('TAKT本体が組み込みペルソナを選び、移動したローカルfacetも読み込める', () => {
  const temp = mkdtempSync(join(tmpdir(), 'takt-facets-'));
  try {
    cpSync(join(repo, 'takt'), join(temp, 'snapshot/takt'), { recursive: true });
    const config = join(temp, 'config'); mkdirSync(config);
    writeFileSync(join(config, 'config.yaml'), 'language: ja\nprovider: mock\nworkflow_command_gates:\n  custom_scripts: true\n');
    const targets: string[] = [];
    for (const name of ['aidlc-code-generation', 'aidlc-construction-stage', 'aidlc-construction']) {
      const path = `takt/workflows/${name}.yaml`;
      targets.push(join(repo, path));
      const control = join(temp, name);
      const { workflow } = materializeWorkflow(join(temp, 'snapshot'), path, control);
      const moved = join(control, 'workflow.yaml');
      writeFileSync(moved, Bun.YAML.stringify(workflow, null, 2));
      targets.push(moved);
    }
    rmSync(join(temp, 'snapshot'), { recursive: true });
    const result = spawnSync('takt', ['workflow', 'doctor', ...targets], {
      cwd: temp, env: { ...cleanEnvironment(), TAKT_CONFIG_DIR: config }, encoding: 'utf8', timeout: 15000,
    });
    if (result.status !== 0) throw new Error(result.stdout + result.stderr);
    expect(result.stdout.match(/Workflow OK:/g)).toHaveLength(6);
    for (const target of targets) {
      const inspected = spawnSync('takt', ['workflow', 'inspect', target], {
        cwd: temp, env: { ...cleanEnvironment(), TAKT_CONFIG_DIR: config }, encoding: 'utf8', timeout: 15000,
      });
      if (inspected.status !== 0) throw new Error(inspected.stdout + inspected.stderr);
      const text = inspected.stdout.replace(/\[INFO\]\s*/g, '');
      const resolved = [...text.matchAll(/persona: ([\w-]+)\s+source: (\w+)\s+path: ([^\n]+)/g)];
      const definition = Bun.YAML.parse(readFileSync(target, 'utf8')) as any;
      expect(resolved.map(match => match[1])).toEqual(definition.steps.map((step: any) => step.persona));
      for (const match of resolved) {
        expect(match[2]).toBe('builtin');
        expect(match[3]).toContain(`/builtins/ja/facets/personas/${match[1]}.md`);
      }
    }
    const files = workflowFiles(repo, 'takt/workflows/aidlc-code-generation.yaml');
    for (const kind of ['instructions', 'policies', 'knowledge', 'output-contracts']) {
      expect(files.some(path => path.startsWith(`takt/facets/${kind}/`))).toBe(true);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('facetの欠落はpark前に拒否し、park後の変更は実行を失敗させる', async () => {
  const f = await cgFixture();
  const path = `${f.control}/takt/facets/instructions/cg-plan.md`;
  const content = readFileSync(join(f.project, path), 'utf8');
  const state = readFileSync(f.state, 'utf8');
  unlinkSync(join(f.project, path));
  await expect(prepareCg(f.project, f.directive)).rejects.toThrow();
  expect(readFileSync(f.state, 'utf8')).toBe(state);
  writeFileSync(join(f.project, path), content);
  const run = (await prepareCg(f.project, f.directive))!;
  expect(readJson<any>(join(run.run, 'manifest.json')).files[path]).toBeTruthy();
  writeFileSync(join(f.project, path), content + '\n変更された指示\n');
  expect((await executeCg(f.project, run.id)).state).toBe('failed');
}, 30000);

test('facetは固定可能なプロジェクト内ファイルだけを使う', () => {
  const temp = mkdtempSync(join(tmpdir(), 'takt-facet-boundary-'));
  try {
    mkdirSync(join(temp, 'project'));
    writeFileSync(join(temp, 'external.md'), '外部ファイル');
    const workflow = (reference: string) => writeFileSync(join(temp, 'project/workflow.yaml'), Bun.YAML.stringify({ instructions: { plan: reference }, steps: [{ name: 'plan', instruction: 'plan' }] }));
    workflow('../external.md');
    expect(() => workflowFiles(join(temp, 'project'), 'workflow.yaml')).toThrow();
    symlinkSync(join(temp, 'external.md'), join(temp, 'project/link.md'));
    workflow('./link.md');
    expect(() => workflowFiles(join(temp, 'project'), 'workflow.yaml')).toThrow();
    writeFileSync(join(temp, 'project/nested.md'), '{include: other.md}');
    workflow('./nested.md');
    expect(() => workflowFiles(join(temp, 'project'), 'workflow.yaml')).toThrow('include/extends');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('Constructionでも工程用facetを固定し、park後の変更を拒否する', async () => {
  const f = await phaseFixture({ blocked: true });
  await capturePhase(f.project, f.event);
  f.approve();
  const run = (await preparePhase(f.project, f.event))!;
  const path = `${f.control}/takt/facets/instructions/stage-draft.md`;
  expect(readJson<any>(join(run.run, 'manifest.json')).files[path]).toBeTruthy();
  writeFileSync(join(f.project, path), '変更された工程指示');
  expect((await executePhase(f.project, run.id)).state).toBe('failed');
}, 30000);
