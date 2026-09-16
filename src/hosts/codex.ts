import type { HookEvent } from './events';

// AI-DLC 2.8.2のbind-bash-sessionが付ける前置きだけを認める。
export function codexCommand(command: string, sessionId: string): string {
  if (!command.startsWith('export AIDLC_SESSION_OVERRIDE=')) return command;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) throw new Error('Codexのsession_idが不正です');
  const prefix = `export AIDLC_SESSION_OVERRIDE='${sessionId}' AIDLC_SESSION_OVERRIDE_SOURCE='payload'; `;
  if (!command.startsWith(prefix)) throw new Error('AI-DLCのコマンド前置きとCodexセッションが一致しません');
  return command.slice(prefix.length);
}

export function codexEvent(raw: HookEvent): HookEvent {
  if (raw.tool_name !== 'Bash') return raw;
  return { ...raw, tool_input: { ...raw.tool_input, command: codexCommand(raw.tool_input?.command ?? '', raw.session_id) } };
}

export function codexStdout(response: unknown): string {
  // Codex CLI 0.154.0の実イベントでは、Bashの結果は生のstdout文字列。
  if (typeof response === 'string') return response;
  // メタデータ付きの形式は、明示的な完了・成功が確認できる場合だけ扱う。
  if (response && typeof response === 'object') {
    const r = response as Record<string, unknown>;
    if (r.interrupted || r.session_id || r.exit_code !== 0 || typeof r.stdout !== 'string') throw new Error('CodexのBashが正常完了していません');
    return r.stdout;
  }
  throw new Error('CodexのBash出力形式が未対応です');
}

export function codexDirective(response: unknown): unknown {
  const output = codexStdout(response).trim();
  try { return JSON.parse(output); } catch { /* CodexはBashのstderrも同じ文字列にまとめる。 */ }
  const lines = output.split('\n').filter(line => line.trim());
  const payload = lines.filter(line => !line.startsWith('aidlc-orchestrate: '));
  if (payload.length !== 1) throw new Error('CodexのAI-DLC応答を一意に読み取れません');
  // 本家CLIの既知の診断行だけを除く。任意の混在出力からJSONを探さない。
  return JSON.parse(payload[0]);
}
