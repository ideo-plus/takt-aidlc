import { createHash } from 'node:crypto';
import { openSync, closeSync, writeSync, mkdirSync, readFileSync, writeFileSync, renameSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

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
export type CommandResult = { code: number | null; timedOut: boolean; stdout: string; stderr: string; outputLimitExceeded?: boolean; outputTruncated?: boolean; stdoutFile?: string; stderrFile?: string };
export async function command(argv: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, options: { outputPrefix?: string } = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let outFd: number | undefined, errFd: number | undefined;
    const stdoutFile = options.outputPrefix ? options.outputPrefix + '.stdout.log' : undefined;
    const stderrFile = options.outputPrefix ? options.outputPrefix + '.stderr.log' : undefined;
    const closeFiles = () => { if (outFd !== undefined) { closeSync(outFd); outFd = undefined; } if (errFd !== undefined) { closeSync(errFd); errFd = undefined; } };
    try {
      if (stdoutFile && stderrFile) { mkdirSync(dirname(stdoutFile), { recursive: true }); outFd = openSync(stdoutFile, 'w', 0o600); errFd = openSync(stderrFile, 'w', 0o600); }
    } catch (e) { closeFiles(); reject(e); return; }
    const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, outputLimitExceeded = false, outputTruncated = false, bytes = 0;
    const outDecoder = new StringDecoder('utf8'), errDecoder = new StringDecoder('utf8');
    const captureLimit = options.outputPrefix ? 64000 : 2000000;
    const stop = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const capture = (which: 'stdout' | 'stderr', value: Buffer) => {
      try {
        bytes += value.length;
        if (options.outputPrefix && bytes > 100_000_000) { outputLimitExceeded = true; stop(); return; }
        const fd = which === 'stdout' ? outFd : errFd;
        if (fd !== undefined) { let n = 0; while (n < value.length) n += writeSync(fd, value, n); }
        const text = (which === 'stdout' ? outDecoder : errDecoder).write(value);
        let buffer = (which === 'stdout' ? stdout : stderr) + text;
        if (buffer.length > captureLimit) {
          if (options.outputPrefix) { outputTruncated = true; buffer = buffer.slice(-captureLimit); }
          else { outputLimitExceeded = true; buffer = buffer.slice(-captureLimit); stop(); }
        }
        if (which === 'stdout') stdout = buffer; else stderr = buffer;
      } catch (e) { clearTimeout(timer); stop(); reject(e); }
    };
    child.stdout.on('data', value => capture('stdout', value));
    child.stderr.on('data', value => capture('stderr', value));
    child.on('error', error => { clearTimeout(timer); closeFiles(); reject(error); });
    let closed = false, outEnded = false, errEnded = false, exitCode: number | null = null;
    const finish = () => {
      if (!closed || !outEnded || !errEnded) return;
      clearTimeout(timer); closeFiles(); stdout += outDecoder.end(); stderr += errDecoder.end();
      resolve({ code: exitCode, timedOut, stdout, stderr, ...(outputLimitExceeded ? { outputLimitExceeded } : {}), ...(stdoutFile ? { stdoutFile, stderrFile, outputTruncated } : {}) });
    };
    child.stdout.on('end', () => { outEnded = true; finish(); });
    child.stderr.on('end', () => { errEnded = true; finish(); });
    child.on('close', code => { closed = true; exitCode = code; finish(); });
  });
}
export function requireSuccess(result: CommandResult) {
  if (result.code !== 0 || result.timedOut || result.outputLimitExceeded) {
    const reason = result.timedOut ? '時間上限' : result.outputLimitExceeded ? '出力上限' : `終了コード ${result.code}`;
    throw new Error(`コマンド失敗 (${reason}): ${(result.stderr || result.stdout).slice(-8000)}${result.stdoutFile ? '\n完全なログ: ' + result.stdoutFile : ''}`);
  }
}
