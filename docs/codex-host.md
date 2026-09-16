# CodexホストでAI-DLCのCGをTAKTへ委譲する

## 対応範囲

Codex CLI 0.154.0、AI-DLC 2.8.2、TAKT 0.65.0を対象に、CG単体とConstruction全体のホスト連携を実装した。AI-DLCをCodex上で進め、CG入口でparkし、TAKTへ委譲する。TAKT内の対話承認はなく、ビルド・テスト・適用するセンサーの成功条件はClaude Codeホストと共通。

ホストとワーカーは別の選択である。`hostHarness: "codex"`はAI-DLC側、`provider: "codex"`はTAKT側を指定する。Construction全体版の設定は[専用の導入手順](construction-phase.md)を参照。以下はCG単体の例。

## インストール

ビルド済みプラグインをHTTPSで取得する。手動のclone・ビルドは不要。

```sh
codex plugin marketplace add https://github.com/ideo-plus/takt-aidlc.git
codex plugin add takt-aidlc@takt-aidlc
```

ユーザー設定の`config.toml`で`[features]`の`hooks = true`を有効にする。設定済みのテーブルがあればその中に追記する。インストール後は新しいCodexセッションを開始し、AI-DLC本体とプラグインのフックを確認して信頼する。インストールだけでは未信頼のフックは動かない。[Codexのフック仕様](https://learn.chatgpt.com/docs/hooks)

## AI-DLCプロジェクトの設定

対象のGitリポジトリで、ワークフロー開始前にCodex用ランタイムを設定する。

```sh
aidlc config --harness codex --yes
```

`.codex/`にCG定義、担当者のMarkdownとTOML、知識、センサー、ツールが配置される。`.agents/skills/aidlc/`にはAI-DLCのスキルが入る。

AI-DLCの配布設定はBedrockを既定にするため、通常のOpenAI認証を使う場合はプロジェクトの`.codex/config.toml`と必要な担当者設定を確認する。ホストのproviderをOpenAI認証に合わせ、`codex login`で認証する。TAKT設定の`disableBedrock`は子プロセス向けであり、ホストの認証設定は変更しない。

[共通のCG設定手順](getting-started.md#configure-cg-delegation-before-cg-entry)に従って`aidlc/takt-handoff/config.json`を用意する。追加するホスト設定は次のとおり。他の入力、ソース、検証スクリプトの指定も必要。

```json
{
  "enabled": true,
  "delegationScope": "code-generation",
  "hostHarness": "codex",
  "provider": "codex",
  "model": "gpt-5.6-luna",
  "codexReasoningEffort": "max"
}
```

`hostHarness`を省略すると従来どおり`claude`になる。ワーカーの`provider`からホストを推測しない。プラグインのホストと設定が一致しない場合、そのプラグインは委譲を実行しない。

プロジェクトから`codex`を起動し、`$aidlc`で通常のAI-DLCを進める。CGより前の必要な設計・承認はAI-DLCが担当する。

## フックと出力の扱い

- SessionStartでCG委譲の方針をホストへ通知する。
- PreToolUseで、AI-DLCが付けるセッション識別用の前置きを正規化し、残った`next`／`continue`を検査する。任意のシェル連結は許可しない。
- PostToolUseで、本家のCG応答・現在の状態・開始記録を照合して入力を固定する。公式CLIでparkしてTAKTを起動し、元のCG指示を委譲通知へ置き換える。
- Codex CLI 0.154.0のBash出力は文字列で、stderrも混在する。本家の`aidlc-orchestrate:`診断行だけを除き、一意なJSON応答を読む。未知の混在出力や複数JSONは拒否する。
- メタデータ付き出力で失敗・中断・未完了が明示されている場合は委譲しない。生の文字列には終了コードがないため、コマンドの識別とネイティブの状態・監査照合も必要になる。

`continue: false`は元のツール結果を置き換えるが、Codexのターン終了を保証するものではない。委譲通知とpark状態を併用する。実機試験では通知後にターンが終了し、ホストによる実装の重複は起きなかった。

## 状態確認

```sh
cat aidlc/takt-handoff/cg-runs/<run-id>/status.json
```

結果は`aidlc/takt-handoff/cg-runs/<run-id>/`に保存する。`verified`はTAKTのCG検証完了を表す。元のAI-DLCへのコード取り込み、ネイティブCG完了、後続工程の自動再開は未実装。

## 検証

[実機の記録](../experiments/codex-host/RESULTS.md)では、合成Intentを使い、実際のCodexホスト・AI-DLC本体のフック・TAKT mockワーカーでCG委譲を確認した。CGの実装を実モデルで完走したという意味ではない。

認証済み環境から再現する場合は、リポジトリで次を実行する。

```sh
bun run experiment:codex-host
```

このスクリプトは隔離したプロジェクトとCodex設定を作る。既存の認証ファイルを参照し、自分たちの試験で確認したフックを実行するため、その起動に限ってフック信頼の確認を省略する。通常利用では上記の信頼手順を使う。利用者の既存プロジェクトやグローバル設定は変更しない。
