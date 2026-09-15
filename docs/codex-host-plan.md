# Codexホストプラグインの検討

2026年9月15日時点。対象はCodex CLI 0.154.0、AI-DLC 2.8.2。

## 結論

`dist/codex`を追加し、Codex上で進めるAI-DLCからTAKTへCG単体を委譲する構成を推奨する。Codexにもプラグインと必要なライフサイクルフックがある。既存のCG実行・品質ゲートを共通化し、ホストとの接続部分を追加すれば実現できる見込み。

今回確認したのは仕様、配布元のコード、隔離したAI-DLCランタイムの生成まで。Codexホストでの自動委譲は未実装・未検証。

## 委譲範囲との関係

ユーザーの方針として、[CG単体とConstruction全体の2モード](delegation-modes.md)を用意する。`dist/claude`と`dist/codex`はホストの違いであり、委譲範囲ではない。両配布物で同じ範囲選択を使える設計を目指す。まずCG単体のホスト対応を検証し、Construction全体版も共通のCG処理と品質条件へ揃える。

## 配布構成案

```text
dist/
  claude/                       既存のClaude Codeホストプラグイン
  codex/
    takt-aidlc/                 Codexプラグイン本体
      .codex-plugin/plugin.json
      hooks/hooks.json
      scripts/handoff.js
      scripts/cg-gate.ts
      workflows/aidlc-code-generation.yaml
```

Codexの配布ディレクトリ内に、manifestのnameと一致する`takt-aidlc`フォルダを置く。`hooks/hooks.json`の標準探索を使えば、manifestにhooksフィールドを追加せずに配布できる。マーケットプレイスへの登録は配布手順として別に扱う。

CodexホストかClaudeホストかと、TAKTワーカーのproviderは別の設定にする。例えばCodexホストからLuna Maxで実行する場合も、CGの成功条件やHOTLの自動遷移は共通に保つ。

## 必要な変更

| 対象 | 方針 |
|---|---|
| ビルド | 共通CLI・CGゲート・WorkflowからClaude/Codexそれぞれの配布物を生成する |
| ホスト設定 | `hostHarness: claude / codex`を明示し、workerの`provider`と分離する案 |
| 原文の参照 | `.claude/`固定を解消し、Codexでは`.codex/aidlc-common`、`agents`、`knowledge`、`sensors`、`tools`を使う |
| Hook入力 | Codexの入力・出力を内部イベントへ正規化する。Bash完了、非ゼロ終了、途中の出力、重複通知を区別する |
| コマンド識別 | AI-DLCが付けるセッション前置きを検証して除き、残りを既存の厳密なCG入口判定へ渡す |
| 委譲後 | 元のCG実行指示を委譲通知へ置き換え、park中にCGを重複実行しないことを確認する |
| CI | 両方の配布物、Codexのイベント変換、Codex用ランタイムでのCG成功・失敗経路を検証する |

AI-DLCのCodexアダプターは、Bash実行前に次の形の前置きを追加する。

```sh
export AIDLC_SESSION_OVERRIDE='<session-id>' AIDLC_SESSION_OVERRIDE_SOURCE='payload'; aidlc engine orchestrate next
```

任意のシェル連結を許可する変更にはしない。フックのsession_idに一致する、既知の前置きだけを対象にする。元の入力と書き換え後の入力のどちらが届くか、他のPreToolUseフックとの順序も実機で確認する。

CodexのPostToolUseの`continue: false`は、元のツール結果を置き換えてモデルを継続させる機能であり、ターン終了の保証ではない。委譲通知、AI-DLCのpark状態、後続コマンドの扱いを合わせて検証する。

## 確認済みの根拠

- ローカルの`codex plugin --help`でプラグイン管理コマンドを確認した。`codex features list`ではhooksとpluginsが有効だった。
- 公式仕様では、プラグインにフックを同梱でき、SessionStart / PreToolUse / PostToolUseを使用できる。`exec_command`もBashとして照合され、後続の`write_stdin`で実行が完了した場合もPostToolUseの対象になる。[Hooks](https://learn.chatgpt.com/docs/hooks)
- プラグインのパッケージ形式とマーケットプレイス配布が公式に説明されている。[Package your plugin](https://developers.openai.com/plugins/build/plugins)
- 隔離ディレクトリで`aidlc config --harness codex --yes`を実行し、`.codex/aidlc-common/stages/construction/code-generation.md`、担当者のMarkdown/TOML、知識、センサー、共通ツール、`.agents/skills/aidlc/SKILL.md`を確認した。
- AI-DLCのCodex配布とBash前置きの処理を2.8.2のソースで確認した。[Codexガイド](https://github.com/awslabs/aidlc-workflows/blob/v2.8.2/docs/guide/harnesses/codex-cli.md)、[Codexアダプター](https://github.com/awslabs/aidlc-workflows/blob/v2.8.2/harness/codex/hooks/aidlc-codex-adapter.ts)

## 最初の検証範囲

1. 配布物の構造とホスト別の原文解決を、モデル不要のテストで確認する。
2. Codexの実際のHookイベントを小さな実験で取得し、コマンド書き換え・完了出力・重複通知を検証する。
3. CodexホストのCG入口→park→TAKTのmockワーカーまで通す。
4. 最後にLuna Maxの実ワーカーでCGを検証する。以前の30分タイムアウトは別の未完了事項として扱う。

プラグインのインストールだけではフックは信頼されず、Codex側の信頼設定が必要。隔離した実験で生成したAI-DLCも、フック15件の信頼未設定を報告した。ユーザーの既存設定や信頼設定は今回変更していない。

最初のCodexホスト試験はCG単体を対象とする。最終的にはConstruction全体も選択可能にする。TAKT内に人間承認待ちは追加せず、両モードでビルド・テスト・適用するセンサーの成功条件を維持する。元のAI-DLCへのコード取り込みと後続工程の自動再開は、引き続き別の未実装事項である。
