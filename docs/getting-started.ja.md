# インストールとプロジェクトの設定

[English](getting-started.md)

<a id="install-the-plugin"></a>

## プラグインをインストールする

GitHubのマーケットプレイスからビルド済みプラグインを取得します。このリポジトリのclone、`bun install`、ビルドは不要です。

Claude Code：

```sh
claude plugin marketplace add https://github.com/ideo-plus/takt-aidlc.git
claude plugin install takt-aidlc@takt-aidlc
```

Codex：

```sh
codex plugin marketplace add https://github.com/ideo-plus/takt-aidlc.git
codex plugin add takt-aidlc@takt-aidlc
```

CLIがGitリポジトリを取得するため、GitとGitHubへのHTTPS接続が必要です。インストール後は新しいセッションを開始してください。Codexでは[ホストの設定手順](codex-host.ja.md#インストール)に従ってフックを有効化し、信頼します。その後、以下のプロジェクト設定を行います。インストールだけでは委譲は始まりません。

取得元の形式は[Claude Codeのマーケットプレイス仕様](https://code.claude.com/docs/en/discover-plugins)と[OpenAIのプラグイン仕様](https://developers.openai.com/plugins/build/plugins)で確認できます。

<a id="supported-environment"></a>

## 必要な環境を用意する

対象環境はmacOSまたはLinux、AI-DLC 2.8.2、TAKT 0.65.0、Bun 1.3.13、Node.js 22.22.0以上です。Claude Code／Codexの両ホストでCG単体とConstruction全体を実行できます。ワーカーもClaude／Codexから選べます。検証済みCLIはClaude Code 2.1.270とCodex 0.154.0です。

Bun、Node.js、Gitは普段使うツール管理方法で導入してください。TAKTと、ホスト・ワーカーに使うCLIをインストールします。

```sh
npm install --global takt@0.65.0
# Claudeのホストまたはワーカーを使う場合
npm install --global @anthropic-ai/claude-code@2.1.270
# Codexのホストまたはワーカーを使う場合
npm install --global @openai/codex@0.154.0
```

AI-DLCは[公式のv2.8.2リリース](https://github.com/awslabs/aidlc-workflows/releases/tag/v2.8.2)を使います。インストーラーは実行ファイルと対応するハーネス用ランタイムを用意します。

```sh
curl --fail --location https://github.com/awslabs/aidlc-workflows/releases/download/v2.8.2/install.sh --output /tmp/install-aidlc-2.8.2.sh
sh /tmp/install-aidlc-2.8.2.sh --version 2.8.2
```

`aidlc --version`と`takt --version`で確認してください。この連携では、導入済みの新しいAI-DLCを2.8.2の代わりには使えません。

選択したホストとワーカーのCLIで認証します。Codexは`codex login`で認証し、`codex login status`で確認します。プラグイン自体のビルド・テストは[開発者向けの手順](contributing.ja.md#開発)です。

<a id="configure-an-ai-dlc-project"></a>

## AI-DLCプロジェクトを準備する

ホストとTAKTワーカーは独立して選びます。Codexホストは[専用ガイド](codex-host.ja.md)を参照してください。以下はClaude Codeホストの手順で、CGの設定は両ホストに共通です。

Inceptionを始める前に、対象プロジェクトで実行します。

```sh
aidlc config --harness claude --yes
```

AI-DLCのClaude設定はBedrockを既定で要求します。通常のClaude認証を使う場合は、対象プロジェクトの`.claude/settings.json`から`CLAUDE_CODE_USE_BEDROCK`と、Bedrock用の`ANTHROPIC_DEFAULT_*_MODEL`を除いてください。AI-DLCのフックは残します。後から設定を変えると調査結果が無効になる場合があるため、ソースコードの調査より前に行います。

以下の委譲設定を準備してから、新しいClaude Codeセッションを起動します。

```sh
claude
```

`/aidlc`で通常どおり進め、選択した入口までAI-DLCの質問と承認に対応します。CGモードはCG入口、ConstructionモードはInceptionの最終承認後からTAKTが実行します。

<a id="choose-the-delegation-scope"></a>

## 委譲範囲を選ぶ

CG単体は`delegationScope: "code-generation"`、Inception承認後のConstruction全体は`delegationScope: "construction"`を指定します。両ホストで使えます。全体・Unit別の検証設定は[Constructionガイド](construction-phase.ja.md)を参照してください。以降の設定例はCG単体です。

<a id="download-the-takt-bundle"></a>

## TAKT定義を取得する

インストール済みプラグインの`takt/`を、ディレクトリごと対象プロジェクトへコピーします。インストールしたバージョンと揃えられ、Gitのcheckoutやビルドも不要です。

Claude Codeは`claude plugin list --json`の`takt-aidlc@takt-aidlc`にある`installPath`、Codexは`codex plugin add takt-aidlc@takt-aidlc --json`の`installedPath`で配置先を確認できます。Codexのコマンドはプラグインのインストールも行います。表示されたパスを使ってコピーしてください。

```sh
mkdir -p aidlc/takt-handoff
cp -R /path/from-the-cli/takt aidlc/takt-handoff/
```

認証済みGitHub CLI（`gh auth login`）から、HTTPSでアーカイブを取得する方法もあります。リポジトリが非公開でも使えますが、アクセス権のあるアカウントが必要です。認証なしの`curl`では取得できません。

```sh
(
  set -e
  mkdir -p aidlc/takt-handoff
  takt_download_dir=$(mktemp -d)
  trap 'rm -rf "$takt_download_dir"' EXIT
  gh api repos/ideo-plus/takt-aidlc/tarball/main > "$takt_download_dir/source.tar.gz"
  takt_archive_root=$(tar -tzf "$takt_download_dir/source.tar.gz" | sed -n '1s@/.*@@p')
  tar -xzf "$takt_download_dir/source.tar.gz" --strip-components=1 -C aidlc/takt-handoff "$takt_archive_root/takt"
)
```

`delegationScope`は必須で、`code-generation`または`construction`を指定します。

どちらの方法でも`aidlc/takt-handoff/takt/`が作られます。`takt/ja/workflows/`と`takt/en/workflows/`のYAMLは`../facets/`を参照するため、YAMLだけをコピーすると不足します。マーケットプレイスをタグやコミットに固定している場合は、インストール済みのコピーを使うか、APIコマンドの`main`を同じrefへ置き換えてください。

[TAKT定義のガイド](../takt/README.ja.md)に、指示・ポリシー・ペルソナ・知識・出力契約を説明しています。ペルソナはTAKT 0.65.0の組み込みを使い、AI-DLC固有の指示・規則・知識・出力形式はローカルのMarkdownで補います。参照するMarkdownもYAMLと一緒に固定・検査するため、委譲前に準備してください。

<a id="configure-cg-delegation-before-cg-entry"></a>

## CG入口までに委譲を設定する

CGへ入る前に、上のTAKT定義を取得します。

対象アプリケーションのビルド、Unitテスト、適用するセンサーを実行するBunスクリプトを用意します。スクリプトは固定コピーから実行し、生成コードの作業領域をカレントディレクトリにします。

`aidlc/takt-handoff/config.json`を作成してください。以下は雛形です。`<intent-dir>`を置き換え、必要なソース・設定ファイルをすべて列挙し、指定するスクリプトを実装します。

```json
{
  "enabled": true,
  "delegationScope": "code-generation",
  "hostHarness": "claude",
  "language": "ja",
  "provider": "codex",
  "model": "gpt-5.6-luna",
  "codexReasoningEffort": "max",
  "artifacts": [
    "aidlc/spaces/default/intents/<intent-dir>/inception/requirements-analysis/requirements.md",
    "aidlc/spaces/default/intents/<intent-dir>/inception/practices-discovery/team-practices.md",
    "aidlc/spaces/default/intents/<intent-dir>/inception/units-generation/unit-of-work.md",
    "aidlc/spaces/default/intents/<intent-dir>/inception/units-generation/unit-of-work-dependency.md",
    "aidlc/spaces/default/intents/<intent-dir>/inception/delivery-planning/bolt-plan.md"
  ],
  "sources": ["src/value.ts"],
  "workflow": "aidlc/takt-handoff/takt/ja/workflows/aidlc-code-generation-stage.yaml",
  "buildScript": "aidlc/takt-handoff/build.ts",
  "verifyScript": "aidlc/takt-handoff/test.ts",
  "sensorScripts": {
    "type-check": "aidlc/takt-handoff/typecheck.ts",
    "linter": "aidlc/takt-handoff/lint.ts"
  },
  "disableBedrock": true,
  "timeoutMs": 1800000
}
```

`language`は`ja`（省略時の既定）または`en`です。英語で実行する場合は`language: "en"`とし、`workflow`およびConstructionの`constructionWorkflow`も`takt/en/workflows/`を指定してください。組み込みファセットと実行時の追加ポリシーも同じ言語になります。AI-DLCの原文は翻訳せず固定入力として渡します。

明示した成果物に加えて、現在のIntent、Unit設計、本家CG定義、知識、センサー、memory、テンプレートが入力になります。ソースはglobではなく通常ファイルを個別に指定します。実際のアプリではpackage manifest、lockfile、必要な設定も含めてください。依存のインストールはビルドスクリプトが担当します。

ビルド・テストの失敗は終了コードを0以外にします。カバレッジ目標はテストスクリプトで検証してください。センサーは成功時にJSONオブジェクトを1つ出力し、`pass: true`かつ終了コード0を返す必要があります。終了コードが0でも`pass: false`なら不合格です。各スクリプトの上限は60秒です。ビルド出力は`cg/`配下に置き、計画外のアプリケーションファイルを生成しないでください。

適用しないセンサーはスクリプトを省略し、固定入力を出典として理由を明示します。

```json
{
  "sensorExceptions": {
    "linter": {
      "reason": "確定した開発方針で、この実験へのLintツール追加を除外している。",
      "source": "aidlc/spaces/default/intents/<intent-dir>/inception/practices-discovery/team-practices.md"
    }
  }
}
```

Claudeワーカーを使う場合は`provider`を`claude`にし、`codexReasoningEffort`を削除します。`model`には利用可能なClaudeモデルを指定するか、省略します。`disableBedrock: true`は子プロセスが引き継ぐBedrock設定だけを除去し、ホストの認証設定は変更しません。

有効なCG設定がなければ、プラグインを読み込んでも委譲しません。Workflowにはrunnerのコンテキストと品質ゲートが必要なため、単独では実行できません。

<a id="inspect-a-run"></a>

## 実行結果を確認する

通常のconductorが単独で実行する`aidlc engine orchestrate next`または`continue`からCG指示が返ると、フックが入力を固定し、AI-DLCをparkしてTAKTを起動します。リダイレクト、`echo`、シェル連結を付けないでください。認識した入口コマンドにそれらが含まれる場合は実行前に拒否します。

フックが返したrun IDを使って確認します。

```sh
cat aidlc/takt-handoff/code-generation-stage-runs/<run-id>/status.json
```

結果は`aidlc/takt-handoff/code-generation-stage-runs/<run-id>/`に保存します。`status.json`は`parked`、`running`、`verified`、`blocked`、`failed`を記録します。生成コードは`attempts/1/work/`、CG成果物はその`cg/`、検証記録は`attempts/1/control/`にあります。

`verified`はTAKTのCG検証完了を意味します。元のAI-DLCはCGでparkしたままです。コード取り込み、本家CGの完了、後続工程の再開は自動化していません。元のCGを並行実行しないでください。CGの再試行や古いロックの自動回収も未実装です。

<a id="updating-and-migrating"></a>

## 更新と切り替え

Claude Code：

```sh
claude plugin marketplace update takt-aidlc
claude plugin update takt-aidlc@takt-aidlc
```

Codex：

```sh
codex plugin marketplace upgrade takt-aidlc
codex plugin add takt-aidlc@takt-aidlc
```

更新後はホストを再起動します。新しい実行では、ファセットを含む`takt/`も同じバージョンに揃えてください。実行中の固定入力は変更しません。Workflowは`takt/ja/workflows/`と`takt/en/workflows/`に配置します。設定内の`workflow`と、Constructionの場合は`constructionWorkflow`を選んだ言語のパスへ更新し、`language`も揃えてください。旧パスへの読替えはありません。

以前のローカル開発版から切り替える場合：

- Claude Code：インストール版を使うときは`--plugin-dir .../dist/claude`を付けずに起動します。手動登録した古いtakt-aidlcのフックだけを外し、AI-DLC本体のフックは残します。
- Codex：リモート版の導入前に`codex plugin remove takt-aidlc@takt-aidlc-local`と`codex plugin marketplace remove takt-aidlc-local`を実行します。ローカル版とリモート版を同時に有効にするとフックが重複します。

ローカルビルドと実モデル試験は[開発手順](contributing.ja.md)にまとめています。

<a id="limits-and-troubleshooting"></a>

## 制約とトラブルシューティング

[CGの動作と制約](code-generation-stage.ja.md)と[検証記録](../experiments/code-generation/RESULTS.ja.md)を参照してください。現在は`test-after`だけに対応し、それ以外のTesting Contractはpark前に拒否します。モデルの利用上限、未解決の入力矛盾、検査失敗を成功扱いにすることはありません。

進行が止まった場合は、復旧前に状態、TAKTログ、品質ゲートのログを確認してください。固定ファイルを変更すると実行は無効になります。プロセス分離とhash検査は、同じOSユーザーで動く任意コードに対するOSのセキュリティ境界ではありません。
