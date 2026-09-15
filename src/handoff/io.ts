import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, sep } from 'node:path';
import { spawn } from 'node:child_process';

export function digest(value: string | Buffer) { return createHash('sha256').update(value).digest('hex'); }
export function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, path);
}
export function readJson<T>(path: string): T { return JSON.parse(readFileSync(path, 'utf8')); }
export function fileInside(root: string, path: string) {
  if (isAbsolute(path) || path.split(/[\\/]/).some(p => p === '..' || p === '.' || !p)) throw new Error(`不正な相対パス: ${path}`);
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`シンボリックリンクは対象外: ${path}`);
  }
  const resolved = realpathSync(current);
  if (!resolved.startsWith(realpathSync(root) + sep) || !lstatSync(resolved).isFile()) throw new Error(`通常ファイルが必要: ${path}`);
  return resolved;
}
export type Snapshot = Record<string, string>;
export function snapshot(root: string, paths: string[]): Snapshot {
  return Object.fromEntries([...new Set(paths)].sort().map(path => [path, digest(readFileSync(fileInside(root, path)))]));
}
export function unchanged(root: string, expected: Snapshot) {
  const actual = snapshot(root, Object.keys(expected));
  if (Object.keys(expected).some(path => actual[path] !== expected[path])) throw new Error('入力が変化しました。再承認後に新しい引き継ぎが必要です');
}
export function cleanEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(AIDLC_|AWS_AIDLC_|TAKT_|CLAUDE_PROJECT_DIR$|CLAUDECODE$|GIT_DIR$|GIT_WORK_TREE$|GIT_INDEX_FILE$)/.test(key)));
}
export function withoutBedrock(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env };
  delete result.CLAUDE_CODE_USE_BEDROCK;
  for (const [key, value] of Object.entries(result)) {
    const modelSetting = key === 'ANTHROPIC_MODEL' || /^ANTHROPIC_DEFAULT_.+_MODEL$/.test(key);
    if (modelSetting && value && /^(?:[^.\s]+\.)?anthropic\.|^arn:[^:]+:bedrock:/.test(value)) delete result[key];
  }
  return result;
}
export function quote(value: string) { return "'" + value.replaceAll("'", "'\\''") + "'"; }
export type CommandResult = { code: number | null; timedOut: boolean; stdout: string; stderr: string };
export async function command(argv: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const stop = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    child.stdout.on('data', value => { stdout += value; if (stdout.length > 2_000_000) { timedOut = true; stop(); } });
    child.stderr.on('data', value => { stderr += value; if (stderr.length > 2_000_000) { timedOut = true; stop(); } });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, timedOut, stdout, stderr }); });
  });
}
export function requireSuccess(result: CommandResult) {
  if (result.code !== 0 || result.timedOut) throw new Error(`コマンド失敗: ${result.stderr || result.stdout}`);
}
