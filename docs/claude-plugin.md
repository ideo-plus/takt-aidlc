# Claude Codeホストプラグイン

## インストールと起動

```sh
claude plugin marketplace add https://github.com/ideo-plus/takt-aidlc.git
claude plugin install takt-aidlc@takt-aidlc
```

ビルド済みの配布物をCLIが取得するため、手動のclone・ビルドは不要。対象プロジェクトで[設定](getting-started.md)を済ませてから、新しい`claude`セッションを開始し、`/aidlc`で進める。通常利用で`--plugin-dir`は指定しない。

配布物にはフック定義、`scripts/handoff.js`、品質ゲート、TAKT Workflow、MITライセンスを含む。開発時のローカル読み込みは[開発手順](contributing.md)を参照。

## フックの役割

| フック | CGモードでの動作 |
|---|---|
| SessionStart | CGだけをTAKTへ委譲し、委譲後はホストのターンを停止する方針を通知する |
| PreToolUse | `next` / `continue`の直接呼び出しにシェル連結がある場合、実行前に拒否する |
| PostToolUse | CGの`run-stage`応答と現在の状態・開始記録を確認し、入力固定、公式park、TAKT起動を行う |

`aidlc/takt-handoff/config.json`の`enabled: true`で有効にし、`delegationScope: "code-generation"`または`"construction"`を選ぶ。CG単体モードはCG入口、Construction全体モードはInception最終承認後に起動する。同じ入口のイベントを重複受信しても、新しいTAKT実行を重ねない。

設定は[導入手順](getting-started.md)、実行内容は[CGの動作](code-generation.md)と[Constructionの動作](construction-phase.md)を参照。TAKTワーカーのproviderはClaude／Codexから独立して選べる。Codex上でAI-DLCを動かす場合は[Codexホスト用プラグイン](codex-host.md)を使う。

## 状態確認

```sh
cat aidlc/takt-handoff/cg-runs/<run-id>/status.json
```

CGのCLI再試行は未実装。`enabled: false`は新しい委譲を抑止するが、実行中のworkerは停止しない。


Bedrockを使わない場合、ホストの設定調整は[導入手順](getting-started.md)に従う。`disableBedrock: true`が対象とするのはTAKTの子プロセスである。

## 検証

移動した配布物のフックからmockのCGを起動する自動テスト、CG以外で起動しないテスト、重複イベントのテストがある。実モデルのCGは[検証記録](../experiments/code-generation/RESULTS.md)を参照。
