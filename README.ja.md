# takt-aidlc

[English](README.md) · [導入手順](docs/getting-started.md) · [CGの動作](docs/code-generation.md)

AI-DLCの**Code Generation（CG）ステージをTAKTへ委譲**する実験的な連携です。Claude CodeのホストプラグインがCGへの遷移を検出してAI-DLCをparkし、別の作業領域で計画・レビュー・実装・検証を実行します。AI-DLC本体へのパッチは不要です。

対象は **AI-DLC 2.8.2 / TAKT 0.65.0**。TAKTの実行にはClaudeとCodexを選択でき、**Luna Max**も指定できます。

## 特徴

- 本家CG定義、Intent、Unit設計、規約、担当エージェントの知識、センサー定義の原文をTAKTのインストラクションへ渡します。
- CG内は**HOTL（人が監督し、実行中の対話承認を挟まない方式）**です。技術レビューと修正を自動で繰り返し、解決不能な矛盾は`blocked`で終了します。
- ビルド・テスト・適用するセンサーが成功し、同じコードのレビューが済むまで`verified`を返しません。
- 元のプロジェクトはparkを維持し、生成コードとCGレポートを別の作業領域で確認できます。

## クイックスタート

必要な環境: macOSまたはLinux、Bun **1.3.13**、Node.js **22.22.0以上**、Git、`aidlc` **2.8.2**、`takt` **0.65.0**。[ツールの導入手順](docs/getting-started.md)を参照してください。テストはmock応答を使い、モデルの認証情報は不要です。

```sh
git clone https://github.com/ideo-plus/takt-aidlc.git
cd takt-aidlc
bun install --frozen-lockfile
bun run test
bun run build:plugin
```

テスト時にAI-DLCランタイムを`.experiments/cache/`へ準備します。配布用プラグインは`dist/claude/`へ生成されます。

## 使い方

[導入手順](docs/getting-started.md)に従って、CGに入る前に対象プロジェクトの入力・ソース・ビルドとテストのスクリプト・センサーを設定します。そのプロジェクトから通常のAI-DLCセッションを起動します。

```sh
claude --plugin-dir /absolute/path/to/takt-aidlc/dist/claude
```

ホストはClaude Codeです。`provider: "codex"`はTAKT内の実行をCodexに切り替えます。プラグインを読み込むだけでは委譲は有効になりません。

Codex CLIの認証後、独立した合成入力でLuna Maxを試せます。

```sh
bun run experiment:cg -- --live --provider codex --model gpt-5.6-luna --reasoning-effort max
```

ビルド失敗・型検査不合格からの修正だけをモデルなしで確認するには、`bun run experiment:cg -- --build-failure --sensor-failure`を使います。

## 対応範囲と検証結果

現在の対象はCG単体、`test-after`、現在の1 Unit・1作業領域、単一の監査シャードです。人間の計画承認は自動の技術レビューへ置き換えます。AI-DLC本体の完了処理や承認の監査記録は再現しません。**`verified`になっても、本家CGの完了や元のプロジェクトへのコード取り込みは自動実行しません。**

mockと実モデルの結果は[CG検証記録](experiments/code-generation/RESULTS.md)を参照してください。以前の[Inception引き継ぎ](experiments/native-session/STATUS.md)と[Construction全体](experiments/construction/RESULTS.md)の試験は、別の構成の履歴です。

## ドキュメント

- [導入と設定](docs/getting-started.md)
- [CGの動作・センサー・制約](docs/code-generation.md)
- [Claude Codeホストプラグイン](docs/claude-plugin.md)

## 問い合わせ

[問い合わせと開発手順](docs/contributing.md)に窓口と報告方法をまとめています。

## 開発への参加

`bun run typecheck`、`bun run test`、`bun run build:plugin`で検証します。CIはモデルの認証情報を使わず、Ubuntu上でプラグインを検証します。管理者と開発方針は[開発手順](docs/contributing.md)を参照してください。

## ライセンス

ライセンスは未選定です。利用許諾を表明するものではありません。
