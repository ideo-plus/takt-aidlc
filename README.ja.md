# takt-aidlc

[English](README.md) · [導入手順](docs/getting-started.ja.md) · [委譲モード](docs/delegation-modes.ja.md)

AI-DLCの**CG（コード生成）ステージ単体、またはConstructionフェーズ全体をTAKTで実行**します。AI-DLCのホストはClaude Code／Codexから選べます。TAKTは本家の工程定義・Intent・設計・センサーを読み、ビルドとテストを検証しながら実装・レビューを進めます。

対象は **AI-DLC 2.8.2 / TAKT 0.65.0**。AI-DLCをparkし、別の作業領域でTAKTを実行するため、本体へのパッチは不要です。実験的な連携であり、実モデルによるConstruction全工程の完走は未確認です。

<a id="install"></a>

## インストール

**このリポジトリを手動でclone・依存インストール・ビルドする必要はありません。** 両ホスト向けのビルド済みプラグインを配布しています。CLIがHTTPS経由でリポジトリを取得します。

実行に必要な環境：macOSまたはLinux、Git、Bun **1.3.13**、Node.js **22.22.0以上**、`aidlc` **2.8.2**、`takt` **0.65.0**、選択したホストとワーカーのCLI。ホストの検証バージョンはClaude Code **2.1.270**／Codex **0.154.0**です。[ツールの導入手順](docs/getting-started.ja.md#supported-environment)を参照してください。

### Claude Code

```sh
claude plugin marketplace add https://github.com/ideo-plus/takt-aidlc.git
claude plugin install takt-aidlc@takt-aidlc
```

### Codex

```sh
codex plugin marketplace add https://github.com/ideo-plus/takt-aidlc.git
codex plugin add takt-aidlc@takt-aidlc
```

インストール後は新しいセッションを開始します。Codexでは[フックの有効化と信頼](docs/codex-host.ja.md#インストール)も必要です。以前の開発用プラグインを使っていた場合は、先に[重複登録を解消](docs/getting-started.ja.md#updating-and-migrating)してください。

<a id="use-in-your-project"></a>

## 対象プロジェクトで使う

1. 対象プロジェクトで`aidlc config --harness claude --yes`または`aidlc config --harness codex --yes`を実行します。
2. 同梱の[初期設定コマンド](docs/getting-started.ja.md#initialize-the-project)を実行し、TAKT定義と`aidlc/takt-handoff/config.json`を配置します。言語と下表の委譲範囲を選び、[設定手順](docs/getting-started.ja.md#configure-an-ai-dlc-project)に従って入力・ソース・ビルド／テスト・センサーを設定した後、`enabled`を`true`にします。初期設定は既存ファイルを保持します。
3. `claude`を起動して`/aidlc`、または`codex`を起動して`$aidlc`で進めます。選択した入口までは通常のAI-DLCで質問と承認を進め、その入口からTAKTが自動で実行します。

| 委譲範囲 | TAKTの開始タイミング | 設定手順 |
|---|---|---|
| `code-generation` | 必要な設計が終わったCG入口 | [CGの設定](docs/getting-started.ja.md#configure-cg-delegation-before-cg-entry) |
| `construction` | Inception最終承認後。設計から全体検証までを実行 | [Constructionの設定](docs/construction-phase.ja.md#設定) |

**インストールだけでは委譲は有効になりません。** 選択した入口に入る前にプロジェクトを設定してください。`hostHarness`はAI-DLCのホスト、`provider`はTAKTのワーカー（Claude／Codex）をそれぞれ選びます。

両モードに、要件充足を独立に判定する`supervise`があります。Constructionでは全Unitをまとめた最終判定も行います。

両モードともHOTL（人が監督し、実行中の対話承認を挟まない方式）です。技術レビューと修正を自動で繰り返し、ビルド・テスト・適用するセンサーが成功すると`verified`になります。入力の矛盾を解決できなければ`blocked`で終了します。

結果は`aidlc/takt-handoff/code-generation-stage-runs/<run-id>/status.json`または`construction-phase-runs/<run-id>/status.json`で確認します。元のプロジェクトはparkを維持します。**生成コードの自動マージ、本家AI-DLCの完了処理・再開は行いません。**

<a id="compatibility-and-verification"></a>

## 対応範囲と検証結果

現在は`test-after`と単一の監査シャードに対応しています。ConstructionはUnitを依存順に処理し、CG単体と同じWorkflow・品質ゲートを使います。

- [CG検証記録](experiments/code-generation/RESULTS.ja.md)：mockと実モデルの結果。
- [Codexホスト検証](experiments/codex-host/RESULTS.ja.md)：実ホスト・本家フックからmockワーカーへの委譲を確認。
- [Construction検証](experiments/construction-phase/RESULTS.ja.md)：複数Unit・設計差し戻し・ビルド／テスト修正・CI生成をmockで確認。
- [Luna Maxの実モデル試験](experiments/construction-phase/LIVE-2026-09-16.ja.md)：1時間で設計2工程が完了し、CG以降は未到達。全工程完走は未確認。

<a id="documentation-and-help"></a>

## ドキュメント・問い合わせ

- [導入・設定・更新・トラブルシューティング](docs/getting-started.ja.md)
- [CG単体／Construction全体の委譲モード](docs/delegation-modes.ja.md)
- [Claude Codeホスト](docs/claude-plugin.ja.md) · [Codexホスト](docs/codex-host.ja.md)
- [TAKTのワークフローとファセット](takt/README.ja.md)
- [CGの動作とセンサー](docs/code-generation-stage.ja.md) · [Constructionの動作](docs/construction-phase.ja.md)
- [問い合わせ窓口と管理者](docs/contributing.ja.md#問い合わせ)

<a id="development"></a>

## 開発への参加

プラグインの変更や実験の再現は、[開発・配布手順](docs/contributing.ja.md)を参照してください。clone・ビルド・テスト・配布物の更新は、開発者向けの手順にまとめています。

<a id="license"></a>

## ライセンス

[MITライセンス](LICENSE)で公開しています。
