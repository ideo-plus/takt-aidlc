# Claude Codeホストプラグイン

## ビルドと起動

```sh
bun run build:plugin
claude plugin validate dist/claude
claude --plugin-dir /absolute/path/to/takt-aidlc/dist/claude
```

最後のコマンドは対象のAI-DLCプロジェクトから実行する。`plugins/claude/`はビルド素材であり、読み込むのは`dist/claude/`。生成物は別のパスへコピーしても動く。

配布物にはフック定義、`scripts/handoff.js`、CG品質ゲート、TAKT Workflowを含む。AI-DLC本体や独自Stageを差し替えない。

## フックの役割

| フック | CGモードでの動作 |
|---|---|
| SessionStart | CGだけをTAKTへ委譲し、委譲後はホストのターンを停止する方針を通知する |
| PreToolUse | `next` / `continue`の直接呼び出しにシェル連結がある場合、実行前に拒否する |
| PostToolUse | CGの`run-stage`応答と現在の状態・開始記録を確認し、入力固定、公式park、TAKT起動を行う |

`aidlc/takt-handoff/config.json`の`enabled: true`と`handoffStage: "code-generation"`で有効になる。CG以外のStage応答やInceptionの承認では起動しない。同じ入口のイベントを重複受信しても、新しいTAKT実行を重ねない。

設定は[導入手順](getting-started.md)、実行内容は[CGの動作](code-generation.md)を参照。CodexはTAKTのproviderとして選択する。ホストプラグイン自体をCodexへ移植したものではない。

## 状態確認

```sh
bun /absolute/path/to/plugin/scripts/handoff.js cg-status /absolute/path/to/project <id>
```

CGのCLI再試行は未実装。`enabled: false`は新しい委譲を抑止するが、実行中のworkerは停止しない。

元のAI-DLCのフック・担当エージェント・プロジェクト設定は必要。以前の実験で登録したtakt-aidlcの手動フックは、プラグインとの二重登録を避けるためその項目だけ外す。`TAKT_AIDLC_PLUGIN_ONLY=1`は旧takt-aidlc手動フックだけを無効化する互換オプションであり、AI-DLC本体のフックは残す。

Bedrockを使わない場合、ホストの設定調整は[導入手順](getting-started.md)に従う。`disableBedrock: true`が対象とするのはTAKTの子プロセスである。

## 検証と旧方式

移動した配布物のフックからmockのCGを起動する自動テスト、CG以外で起動しないテスト、重複イベントのテストがある。実モデルのCGは[検証記録](../experiments/code-generation/RESULTS.md)を参照。

以前のInception最終承認からの委譲は、`handoffStage: "inception-legacy"`を明示した旧実験向けに残している。[当時の実セッション記録](../experiments/native-session/STATUS.md)は現在のCG入口の実証とは区別する。
