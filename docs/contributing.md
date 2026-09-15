# 問い合わせと開発手順

## 問い合わせ

不具合や機能提案は[GitHub Issues](https://github.com/ideo-plus/takt-aidlc/issues)へお願いします。使用したAI-DLC・TAKT・Bunのバージョン、実行した工程、期待した結果と実際の結果を添えてください。認証情報や秘密を含むログは掲載しないでください。

このリポジトリは`ideo-plus`で管理しています。アクセスできるメンテナーが変更をレビューします。

## 開発

[必要なツール](getting-started.md)を用意してから、次を実行します。

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build:plugin
```

`bun run test`はAI-DLC 2.8.2のテスト用ランタイムを`.experiments/cache/`に準備します。以前の手元の実験データは不要です。入力文書のコピーは`experiments/construction/input/`に含めています。

テストはmockプロバイダーを使い、モデルの認証情報なしで動きます。実際のTAKT実行エンジン、AI-DLCの状態・承認の照合、品質ゲートを通します。

## CI

[CI定義](../.github/workflows/ci.yml)は、レビュー用の変更とmainへの更新で起動します。Ubuntu上でツールのバージョンを固定し、型検査、テスト、プラグインビルド、Claude Codeのプラグイン検証を行います。モデルは呼びません。

実モデルの実験は手動で明示的に実行します。

```sh
bun run experiment:construction -- --live
```

結果を報告するときは、通常のAI-DLC承認を通した試験か、合成した承認境界を使ったWorkflow試験かを区別してください。失敗や手動復旧も、成功した実行とは別に記録します。

## 変更の説明

コミットメッセージは英語のConventional Commits形式にします。レビュー用の説明は日本語で、変更した動作、検証方法、未確認の範囲をまとめてください。
