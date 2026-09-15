# Claude CodeプラグインとしてTAKT連携を読み込む

## AI-DLC本体にパッチを当てず、フックで接続する

`takt-aidlc` 0.1.0は、Claude Code側へ追加するプラグインである。AI-DLCの上流コードやSKILL.mdは変更しない。プラグインのフックがInceptionの最終承認コマンドの前後を確認し、同梱した連携CLIがpark・TAKT起動・成果物の検証を担当する。

プラグインの読み込みだけでは自動実行しない。プロジェクトの`aidlc/takt-handoff/config.json`に`enabled: true`を設定した場合に有効になる。設定がない場合や`enabled: false`の場合は、通常のAI-DLCの動作を妨げない。

## ビルドしてローカルで使う

このリポジトリのルートで実行する。

```sh
bun install --frozen-lockfile
bun run build:plugin
claude plugin validate dist/claude
```

生成先は`dist/claude/`。このフォルダにはプラグイン定義、フック定義、連携CLIが入っており、元のリポジトリとは別の場所へコピーしても使える。

```text
dist/claude/
  .claude-plugin/plugin.json
  hooks/hooks.json
  scripts/handoff.js
  scripts/construction-gate.ts
  workflows/aidlc-construction.yaml
  build-info.json
```

対象のAI-DLCプロジェクト内から、生成フォルダの絶対パスを指定してClaude Codeを起動する。

```sh
claude --plugin-dir /absolute/path/to/takt-aidlc/dist/claude
```

`--plugin-dir`はそのセッションにプラグインを読み込む機能で、グローバルインストールは行わない。今回はこの読み込み方法で検証した。[Claude Codeのプラグイン仕様](https://code.claude.com/docs/en/plugins)

`plugins/claude/`はビルド用の素材で、連携CLIを含まない。読み込むのはビルド後の`dist/claude/`である。

## 対象プロジェクトの引き継ぎ条件を設定する

設定例と必要な入力は[自動引き継ぎPoC](handoff-poc.md)に記載している。実行環境にはBun、Git、TAKT、`aidlc` 2.8.2、認証済みClaude Codeが必要。AI-DLC 2.8.2のClaude Code向けランタイムを対象とする。

プラグインを使う場合、PoC用CLIの`hooks`コマンドでフックを手動登録する必要はない。以前の実験で手動登録した場合は、そのtakt-aidlcの項目だけを外してからプラグインを読み込む。AI-DLC本体のフックは残す。

進行中の実験で設定ファイルの変更がソース識別値に影響する場合は、元のファイルを変更せず、起動時に`TAKT_AIDLC_PLUGIN_ONLY=1`を設定できる。この変数は現行のtakt-aidlcの手動フックだけを無効にし、プラグインの`plugin-hook`とAI-DLC本体のフックは維持する。

```sh
claude --plugin-dir /absolute/path/to/takt-aidlc/dist/claude \
  --settings '{"env":{"TAKT_AIDLC_PLUGIN_ONLY":"1"}}'
```

プロジェクト設定自体を読み込み対象から外してはいけない。実機では、それによりAI-DLCの専門エージェントも利用できなくなった。通常のプロジェクト設定を読み、上記の変数だけを追加する構成で14種類の担当エージェントの復帰を確認した。

有効なプロジェクトではSessionStartで連携方針をClaudeへ通知する。通常の質問・承認を維持し、最終承認時にTAKTへ引き継ぐ方針をユーザーへ伝えるよう案内する。

`enabled: false`への変更は新しい引き継ぎを抑止する。既に起動したworkerを停止する機能ではない。

最終承認は、`aidlc engine orchestrate report --stage delivery-planning --result approved --user-input "Approve"`を単独のBashコマンドとして実行する。リダイレクトや`echo`を付けると、承認応答のJSON以外の出力が混ざる。直接呼び出しの承認にこうした構文を検出した場合、PreToolUseが実行前に拒否し、同じ承認に基づいて単一コマンドへ直すよう案内する。この検出は一般的なシェル解析を行うものではなく、ラッパースクリプトや任意の別名を通した承認には対応しない。

### Bedrockを使わない場合

AI-DLC 2.8.2の既定のClaude Code設定にはBedrockの指定が含まれる。今回の実験では、プロジェクトの`.claude/settings.json`から`CLAUDE_CODE_USE_BEDROCK`とBedrock用の`ANTHROPIC_DEFAULT_*_MODEL`指定を外し、通常のClaude Code認証を利用している。AI-DLCの配布元は変更していない。

引き継ぎ先にもBedrock設定を残したくない場合は、`aidlc/takt-handoff/config.json`に`"disableBedrock": true`を指定する。TAKTの子プロセスからBedrock利用フラグとBedrock形式のモデル値を除く。通常のモデル指定やAWSプロファイルは変更しない。未指定時は呼び出し元の設定を継承する。

## 配布物に含めるのは接続処理まで

| 担当 | 内容 |
|---|---|
| Claude Codeプラグイン | SessionStart、PreToolUse、PostToolUseの登録 |
| 同梱CLI | 入力確認、park、TAKT起動、検証、状態確認、再試行 |
| プロジェクト側の設定 | 対象成果物、ソース、Workflow、検証スクリプト |
| TAKT Workflow | Construction内で実行する工程 |

AI-DLC側の`.aidlc-plugin/plugin.json`を使う方式ではない。独自Stageを追加することも、本体へローカルパッチを当てることも、今回の実装には必要ない。

同梱CLIから状態を確認できる。

```sh
bun /absolute/path/to/plugin/scripts/handoff.js status <project> <id>
bun /absolute/path/to/plugin/scripts/handoff.js retry <project> <id>
```

## 検証済みの範囲

2026年9月15日に次を確認した。

- 型検査と25件のテストが成功した。
- `claude plugin validate`が警告なしで成功した。
- 配布フォルダを空白を含む別のパスへ移しても、フックからworkerを起動し、mockプロバイダーで成果物を生成・検証できた。
- 未設定・無効化したプロジェクトでは、承認コマンドのイベントを受けても引き継ぎデータを作らなかった。
- 実際のClaude Codeで`takt-aidlc@inline` 0.1.0として認識され、3フックが登録され、SessionStartの通知が正常に実行された。

[実際の読み込み結果](../experiments/plugin-load/results/2026-09-15.json)を保存している。再確認には、ビルド後に`bun experiments/plugin-load/run.ts`を実行する。この試験は実モデルを呼び出す。

通常のAI-DLCセッションからTAKTによる実装・検証まで到達した。初回の`done`応答の扱いと、次の試行で見つかった複合コマンドの扱いを修正し、別環境でDelivery Planningを正式に再実行した。最新の試行では承認コマンドが1回で成功し、承認後の手動park・フック再送・worker起動なしに完了した。3テスト成功・行カバレッジ100%、元のコードと入力は保持された。

これは承認済みのInception資料を再利用した最終工程からの検証であり、Inception全体の新規生成ではない。承認前には要約ツールのネイティブ呼び出しの不具合を、同梱の読み取り専用Bunツールで回避した。[実セッションの記録](../experiments/native-session/STATUS.md)と[最新結果](../experiments/native-session/results/2026-09-15-recheck.json)を参照。

## 次に確認すること

1. **推奨: 複数Unitの実アプリで適用範囲を確認する。** 単一作業領域での依存順の実装と検証を評価する。
2. **配布用の導入・運用手順を整理する。**

リモートのマーケットプレイスへの公開はまだ行っていない。

## Constructionの工程を有効にする

`construction: true`で、同梱Workflowの詳細設計・設計レビュー・実装・テスト・コードレビュー・修正・完了報告を使用できる。[設定と動作](construction-workflow.md)を参照。品質ゲート本体も配布物に含まれ、元のリポジトリを移動しても動く。
