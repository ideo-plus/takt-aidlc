import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { digest, fileInside } from '../handoff/io';

const sections = ['personas', 'policies', 'knowledge', 'instructions', 'report_formats'] as const;
type Facet = { section: typeof sections[number]; alias: string; path: string };

// TAKTが読む5種のfacet宣言を、承認時と実行時に同じ規則で追跡する。
// ファイル参照はトップレベルの宣言へ集約し、暗黙の外部依存を持たせない。
function readWorkflow(root: string, path: string) {
  const workflow = Bun.YAML.parse(readFileSync(fileInside(root, path), 'utf8')) as any;
  if (!workflow || typeof workflow !== 'object' || !Array.isArray(workflow.steps)) throw new Error(`TAKT Workflowが不正です: ${path}`);
  const facets: Facet[] = [];
  for (const section of sections) {
    const declarations = workflow[section];
    if (declarations === undefined) continue;
    if (!declarations || typeof declarations !== 'object' || Array.isArray(declarations)) throw new Error(`TAKTの${section}宣言が不正です`);
    for (const [alias, reference] of Object.entries(declarations)) {
      if (typeof reference !== 'string') throw new Error(`TAKT facetは文字列で指定してください: ${section}.${alias}`);
      if (!reference.endsWith('.md') || reference.includes('\n')) continue;
      if (isAbsolute(reference)) throw new Error(`TAKT facetはプロジェクト内の相対パスで指定してください: ${reference}`);
      const facetPath = relative(resolve(root), resolve(root, dirname(path), reference));
      const body = readFileSync(fileInside(root, facetPath), 'utf8');
      if (/\{(?:include|extends):/.test(body)) throw new Error(`TAKT facetはinclude/extendsを展開した単一ファイルで指定してください: ${facetPath}`);
      facets.push({ section, alias, path: facetPath });
    }
  }
  return { workflow, facets };
}

export function workflowFiles(root: string, path: string): string[] {
  return [...new Set([path, ...readWorkflow(root, path).facets.map(facet => facet.path)])];
}

// controlへYAMLを移す際はfacetも固定コピーから配置する。
// 相対参照をcontrol内へ向け、元プロジェクトやグローバル設定に依存させない。
export function materializeWorkflow(root: string, path: string, control: string) {
  const { workflow, facets } = readWorkflow(root, path);
  const controlFiles: string[] = [];
  for (const facet of facets) {
    const target = `facets/${facet.section}/${digest(facet.path).slice(0, 12)}-${basename(facet.path)}`;
    mkdirSync(dirname(join(control, target)), { recursive: true });
    copyFileSync(fileInside(root, facet.path), join(control, target));
    workflow[facet.section][facet.alias] = `./${target}`;
    controlFiles.push(target);
  }
  return { workflow, controlFiles: [...new Set(controlFiles)] };
}
