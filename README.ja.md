# takt-aidlc

[English](README.md) · [導入手順](docs/getting-started.md) · [Constructionワークフロー](docs/construction-workflow.md)

AI-DLCで承認したInceptionの成果物を、TAKTへ自動で引き継ぐための連携ツールです。Claude CodeプラグインがAI-DLCをparkし、別の作業領域でTAKTを実行して結果を検証します。AI-DLC本体へのパッチは不要です。

対象はAI-DLC **2.8.2**とTAKT **0.65.0**です。現在は実験段階の実装です。

## 特徴

- Inceptionの質問と承認は、通常どおりAI-DLCで行います。
- 最終承認をきっかけに引き継ぐため、承認後に別の起動コマンドを入力する必要がありません。
- Constructionでは詳細設計、設計レビュー、実装、テスト、コードレビュー、回数に上限のある修正を行います。
- テストは固定した検証スクリプトで実行し、コードのハッシュで古いレビュー結果の流用を防ぎます。
- 新しい要件や未解決の判断は`needs_input`で止め、人間の承認を作りません。
- 元のコードとAI-DLC記録は別に保持します。自動マージやデプロイは行いません。

## クイックスタート

macOSまたはLinuxで、**Bun 1.3.13**、**Node.js 22.22.0以降**、Git、`aidlc` **2.8.2**、`takt` **0.65.0**が必要です。[ツールの導入手順](docs/getting-started.md)を参照してください。以下のテストはmockプロバイダーを使うため、モデルの認証情報は不要です。

```sh
git clone https://github.com/ideo-plus/takt-aidlc.git
cd takt-aidlc
bun install --frozen-lockfile
bun run test
bun run build:plugin
```

テスト実行時に、対応するAI-DLCランタイムを`.experiments/cache/`へ準備します。プラグインの生成先は`dist/claude/`です。このフォルダは別の場所へコピーして使えます。

## 使い方

Delivery Planningの最終承認前に対象プロジェクトの入力と検証方法を設定し、そのプロジェクトからClaude Codeを起動します。

```sh
claude --plugin-dir /absolute/path/to/takt-aidlc/dist/claude
```

プラグインを読み込むだけでは自動実行しません。対象プロジェクトの`aidlc/takt-handoff/config.json`に、`enabled: true`、入力ファイル、Workflow、検証スクリプトを指定する必要があります。[導入ガイド](docs/getting-started.md)に設定例があります。

同梱の6工程のConstructionワークフローを使う場合は`construction: true`を指定します。TAKT側でBedrockの設定を継承せず、通常のClaude認証を使う場合は`disableBedrock: true`を指定します。

モデルを呼ばずに差し戻し・修正の動作を試す場合は、次を実行します。

```sh
bun run experiment:construction -- --repairs
```

## 検証済みの範囲と制約

実際の最終承認からTAKTへの引き継ぎは、手動復旧なしで完了することを確認しました。拡張したWorkflowも実際のClaudeプロバイダーで完了し、アプリの3テスト成功・行カバレッジ100%を確認しました。設計差し戻し、テスト失敗、コード修正、確認待ち、実行上限は決定的なテストで確認しています。[実験記録](experiments/native-session/STATUS.md)では、成功した実行と、それ以前の失敗・復旧を区別しています。

現在は単一の作業領域を使い、Unitを直列に扱います。AI-DLCのConstructionの各承認をそのまま再現する機能、Unitごとの並列作業領域、Operationへの復帰は含みません。また、小さな定数変更アプリによる検証のため、一般的なコード品質の向上まで実証したものではありません。

## ドキュメント

- [インストールとプロジェクト設定](docs/getting-started.md) — 英語
- [Claude Codeプラグイン](docs/claude-plugin.md)
- [Constructionワークフローと結果の扱い](docs/construction-workflow.md)
- [引き継ぎ設定と制約](docs/handoff-poc.md)
- [連携方式の設計](docs/automatic-handoff.md)
- [Construction拡充の実験結果](experiments/construction/RESULTS.md)

## 問い合わせ・開発への参加

[問い合わせ先と開発手順](docs/contributing.md)を参照してください。変更時には`bun run typecheck`と`bun run test`を実行します。CIでも、モデルの認証情報を使わずにこれらの確認とプラグインのビルドを行います。実モデルの実験は明示的に指定して実行します。

## ライセンス

このプロジェクトのライセンスは、まだ指定されていません。
