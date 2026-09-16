import { cpSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { command, cleanEnvironment, requireSuccess, writeJson } from '../../src/handoff/io';

const repo = resolve(import.meta.dir, '../..');
const run = realpathSync(process.argv[2]);
const withTests = process.argv.includes('--tests');
const construction = process.argv.includes('--construction');
if (!run.startsWith(join(repo, '.experiments/native') + '/')) throw new Error('native実験のパスを指定してください');
const { project } = JSON.parse(readFileSync(join(run, 'session.json'), 'utf8'));
const scope = readFileSync(join(project, 'aidlc/active-space'), 'utf8').trim();
const intent = readFileSync(join(project, 'aidlc/spaces', scope, 'intents/active-intent'), 'utf8').trim();
if (![scope, intent].every(name => /^[a-zA-Z0-9_-]+$/.test(name))) throw new Error('不正なworkspace selectorです');
const record = `aidlc/spaces/${scope}/intents/${intent}`;
const before = await command(['aidlc', 'engine', 'workspace', 'codekb-snapshot', '--paths', './', '--json'], project, cleanEnvironment(), 10000);
requireSuccess(before);
const directory = join(project, 'aidlc/takt-handoff'); mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, 'workflow.yaml'), `name: native-handoff-value-update\ninitial_step: implement\nmax_steps: 1\nsteps:\n  - name: implement\n    edit: true\n    required_permission_mode: edit\n    instruction: |\n      input/manifest.jsonと承認済みのInception成果物を読んでください。\n      指示されたsrc/value.tsのanswerの変更を実装してください。\n      入力と制御設定は変更しないでください。\n    rules:\n      - condition: 試行終了\n        next: COMPLETE\n`);
writeFileSync(join(directory, 'verify.ts'), `import { pathToFileURL } from 'node:url';\nimport { join } from 'node:path';\nconst module = await import(pathToFileURL(join(process.cwd(), 'src/value.ts')).href);\nif (module.answer !== 42) throw new Error('answerは42でなければなりません');\nconsole.log('受入条件: answer === 42 を確認');\n`);
if (withTests) writeFileSync(join(directory, 'verify.ts'), readFileSync(join(import.meta.dir, 'verify-app.ts'), 'utf8'));
if (construction) cpSync(join(repo, 'takt'), join(directory, 'takt'), { recursive: true });
writeJson(join(directory, 'config.json'), {
  enabled: true,
  handoffStage: 'inception-legacy',
  artifacts: [
    `${record}/inception/requirements-analysis/requirements.md`,
    `${record}/inception/units-generation/unit-of-work.md`,
    `${record}/inception/units-generation/unit-of-work-dependency.md`,
    `${record}/inception/delivery-planning/bolt-plan.md`,
    ...(withTests ? [`${record}/inception/practices-discovery/team-practices.md`] : []),
  ],
  sources: ['src/value.ts'], workflow: construction ? 'aidlc/takt-handoff/takt/workflows/aidlc-construction.yaml' : 'aidlc/takt-handoff/workflow.yaml', verifyScript: 'aidlc/takt-handoff/verify.ts', provider: 'claude', disableBedrock: true, construction, timeoutMs: construction ? 600000 : 90000,
});
const after = await command(['aidlc', 'engine', 'workspace', 'codekb-snapshot', '--paths', './', '--json'], project, cleanEnvironment(), 10000);
requireSuccess(after);
const sourceUnchanged = JSON.parse(before.stdout).source_fingerprint === JSON.parse(after.stdout).source_fingerprint;
writeJson(join(run, 'handoff-configuration.json'), { record, sourceUnchanged, withTests, construction, before: JSON.parse(before.stdout), after: JSON.parse(after.stdout) });
if (!sourceUnchanged) throw new Error('設定追加でソースの識別値が変わりました。調査結果との再確認が必要です');
console.log(JSON.stringify({ record, sourceUnchanged }));
