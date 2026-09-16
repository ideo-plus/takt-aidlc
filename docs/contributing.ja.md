# 問い合わせと開発手順

[English](contributing.md)

<a id="support"></a>

## 問い合わせ

不具合や機能提案は[GitHub Issues](https://github.com/ideo-plus/takt-aidlc/issues)へお願いします。使用したAI-DLC・TAKT・Bunのバージョン、実行した工程、期待した結果と実際の結果を添えてください。認証情報や秘密を含むログは掲載しないでください。

このリポジトリは`ideo-plus`で管理しています。アクセスできるメンテナーが変更をレビューします。

<a id="development"></a>

## 開発

[必要なツール](getting-started.ja.md)を用意してから、次を実行します。

```sh
git clone https://github.com/ideo-plus/takt-aidlc.git
cd takt-aidlc
bun install --frozen-lockfile
bun run typecheck
bun run check:takt
bun run test
bun run build:marketplace
```

`bun run test`はAI-DLC 2.8.2のテスト用ランタイムを`.experiments/cache/`に準備します。以前の手元の実験データは不要です。CGの合成入力は`experiments/code-generation/input/`に含めています。

テストはmockプロバイダーを使い、モデルの認証情報なしで動きます。実際のTAKT実行エンジン、AI-DLCの状態・承認の照合、品質ゲートを通します。Codex CLIによるプラグインの隔離インストールも検証するため、Codex CLI 0.154.0を用意してください。

<a id="updating-distributions-and-testing-locally"></a>

## 配布物の更新とローカル確認

利用者はGitHubのマーケットプレイスからビルド済みプラグインを取得する。生成物もソースと同じ変更に含める。

| パス | 用途 |
|---|---|
| `takt/workflows/` / `takt/facets/` | TAKTのYAML、ローカルファセット、組み込みペルソナの選択理由 |
| `plugins/claude/` / `plugins/codex/` | マニフェストとフックの編集元 |
| `dist/claude/` / `dist/codex/` | ローカル開発用の生成先（Git管理外） |
| `plugins/takt-aidlc-claude/` / `plugins/takt-aidlc-codex/` | 公開する生成物（Git管理対象、直接編集しない） |
| `.claude-plugin/marketplace.json` / `.agents/plugins/marketplace.json` | Claude Code／Codexの公開マーケットプレイス |

ソース・フック・TAKTの定義を変更したら、編集元のプラグインのバージョンも更新し、`bun run build:marketplace`で再生成する。Codexの開発用キャッシュ更新にはplugin-creatorのcachebusterヘルパーを使える。`bun run check:marketplace`で、配布物が現在のソースから再現できることを確認する。

ローカルで確認する場合だけ、次の方法を使う。公開版の同じプラグインと同時に読み込まない。

```sh
# Claude Code: 対象プロジェクトから起動
claude --plugin-dir /absolute/path/to/takt-aidlc/dist/claude

# Codex: ローカル開発用マーケットプレイス
codex plugin marketplace add /absolute/path/to/takt-aidlc/dist/codex
codex plugin add takt-aidlc@takt-aidlc-local
```

mainにマージされると、READMEのHTTPSインストール手順から取得できる。公開定義はビルド済みファイルだけを参照し、利用者の環境ではビルドしない。

## CI

[CI定義](../.github/workflows/ci.yml)は、レビュー用の変更とmainへの更新で起動します。Ubuntu上でツールのバージョンを固定し、型検査、テスト、プラグインビルド、Claude Codeのプラグイン検証を行います。モデルは呼びません。配布物とソースの一致、隔離した設定で両CLIからインストールできることも検証します。

実モデルの実験は手動で明示的に実行します。

```sh
bun run experiment:cg -- --live --provider codex --model gpt-5.6-luna --reasoning-effort max
```

結果を報告するときは、通常のAI-DLC承認を通した試験か、合成したCG入口とIntentを使ったWorkflow試験かを区別してください。失敗や手動復旧も、成功した実行とは別に記録します。

<a id="describing-changes"></a>

## 変更の説明

コミットメッセージは英語のConventional Commits形式にします。レビュー用の説明は日本語で、変更した動作、検証方法、未確認の範囲をまとめてください。

すべてのMarkdownを、英語版の`.md`と日本語版の`.ja.md`で揃えてください。ガイド、ファセット、実験入力、記録も対象です。両言語の本文とリンクを同時に更新します。配布Workflowは日本語ファセットを使い、実験用ヘルパーは日本語入力を本家AI-DLCのファイル名へコピーします。同梱Markdownを変更したら配布物も再生成してください。
