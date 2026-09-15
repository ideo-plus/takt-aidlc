# takt-aidlc

[English](README.md) · [導入手順](docs/getting-started.md) · [委譲モード](docs/delegation-modes.md)

AI-DLCの作業をホストプラグインからTAKTへ委譲する実験的な連携です。**Claude Code／Codexの両ホスト**に対応し、**CGステージ単体／Constructionフェーズ全体の2モード**を整備しています。AI-DLCをparkし、別の作業領域でTAKTを実行します。AI-DLC本体へのパッチは不要です。

対象は **AI-DLC 2.8.2 / TAKT 0.65.0**。ホスト・委譲範囲・TAKTワーカーは別の選択です。**実装済みの範囲と今後の対応は、次の表で区別しています。**

## 設計方針と実装状況

| 選択するもの | 選択肢 | 現在の状態 |
|---|---|---|
| AI-DLCのホスト | Claude Code | ホストプラグインを実装済み。`dist/claude/`を生成 |
| AI-DLCのホスト | Codex | CGホスト連携を実装済み。`dist/codex/`にプラグインとローカル配布定義を生成 |
| 委譲範囲 | CGステージ単体 | Workflow・原文注入・ビルド／テスト／センサーの検証を実装済み |
| 委譲範囲 | Constructionフェーズ全体 | 設計から検証までの試作あり。共通CG処理と品質条件への統一はこれから |
| TAKTワーカー | Claude／Codex | CG実行で両方に対応。CodexはLuna Max（`gpt-5.6-luna`・推論強度`max`）を指定可能 |

両モードともTAKT内はHOTLとし、対話承認を挟まず、ビルド・テスト・適用するセンサーの成功を必須にする方針です。Construction全体版でも同じCG処理を使います。[委譲モード](docs/delegation-modes.md)と[Codexホストの導入手順](docs/codex-host.md)を参照してください。

## 実装済みのCG機能

- 本家CG定義、Intent、Unit設計、規約、担当エージェントの知識、センサー定義の原文をTAKTのインストラクションへ渡します。
- CG内は**HOTL（人が監督し、実行中の対話承認を挟まない方式）**です。技術レビューと修正を自動で繰り返し、解決不能な矛盾は`blocked`で終了します。
- ビルド・テスト・適用するセンサーが成功し、同じコードのレビューが済むまで`verified`を返しません。
- 元のプロジェクトはparkを維持し、生成コードとCGレポートを別の作業領域で確認できます。

## クイックスタート

必要な環境: macOSまたはLinux、Bun **1.3.13**、Node.js **22.22.0以上**、Git、`aidlc` **2.8.2**、`takt` **0.65.0**、Codex CLI **0.154.0**。[ツールの導入手順](docs/getting-started.md)を参照してください。テストはmock応答を使い、モデルの認証情報は不要です。

```sh
git clone https://github.com/ideo-plus/takt-aidlc.git
cd takt-aidlc
bun install --frozen-lockfile
bun run test
bun run build:plugin
```

テスト時にAI-DLCランタイムを`.experiments/cache/`へ準備します。`dist/claude/`と`dist/codex/`に両ホストの配布物を生成します。テストではCodex CLIによる隔離したプラグインインストールも確認します。

## 使い方

### Claude Codeホスト＋CG

[導入手順](docs/getting-started.md)に従って、CGに入る前に対象プロジェクトの入力・ソース・ビルドとテストのスクリプト・センサーを設定します。そのプロジェクトから通常のAI-DLCセッションを起動します。

```sh
claude --plugin-dir /absolute/path/to/takt-aidlc/dist/claude
```

この構成では`hostHarness: "claude"`を指定します（省略時の既定値）。プラグインを読み込むだけでは委譲は有効になりません。

### Codexホスト＋CG

```sh
codex plugin marketplace add /absolute/path/to/takt-aidlc/dist/codex
codex plugin add takt-aidlc@takt-aidlc-local
```

対象プロジェクトを`aidlc config --harness codex --yes`で準備し、連携設定に`hostHarness: "codex"`を指定します。フックを有効化・信頼して新しいCodexセッションを開始し、`$aidlc`で進めます。[Codex導入手順](docs/codex-host.md)を参照してください。

`provider`は両ホストに共通するTAKTワーカーの選択です。

### Codexワーカーを試す

Codex CLIの認証後、独立した合成入力でLuna Maxを試せます。この実験には、起動中のClaudeホストは不要です。

```sh
bun run experiment:cg -- --live --provider codex --model gpt-5.6-luna --reasoning-effort max
```

ビルド失敗・型検査不合格からの修正だけをモデルなしで確認するには、`bun run experiment:cg -- --build-failure --sensor-failure`を使います。

## 対応範囲と検証結果

実装済みのCGは`test-after`、現在の1 Unit・1作業領域、単一の監査シャードを対象とします。人間の計画承認は自動の技術レビューへ置き換えます。AI-DLC本体の完了処理や承認の監査記録は再現しません。**`verified`になっても、本家CGの完了や元のプロジェクトへのコード取り込みは自動実行しません。**

mockと実モデルの結果は[CG検証記録](experiments/code-generation/RESULTS.md)を参照してください。以前の[Inception引き継ぎ](experiments/native-session/STATUS.md)と[Construction全体](experiments/construction/RESULTS.md)の試験は、別の構成の検証結果です。品質条件を統一したConstruction全体版の完成を示すものではありません。

[Codexホストの実機試験](experiments/codex-host/RESULTS.md)では、Luna Maxホストと本家フックからTAKT mockへ委譲し、ビルド・テスト成功まで確認しました。実モデルのCG全工程完走とは区別しています。

## ドキュメント

- [CG単体／Construction全体の委譲モード](docs/delegation-modes.md)
- [Codexホストの導入・動作・検証](docs/codex-host.md)
- [導入と設定](docs/getting-started.md)
- [CGの動作・センサー・制約](docs/code-generation.md)
- [Claude Codeホストプラグイン](docs/claude-plugin.md)

## 問い合わせ

[問い合わせと開発手順](docs/contributing.md)に窓口と報告方法をまとめています。

## 開発への参加

`bun run typecheck`、`bun run test`、`bun run build:plugin`で検証します。CIはモデルの認証情報を使わず、Ubuntu上でプラグインを検証します。管理者と開発方針は[開発手順](docs/contributing.md)を参照してください。

## ライセンス

ライセンスは未選定です。利用許諾を表明するものではありません。
