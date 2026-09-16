# CodexホストのCG委譲試験

[English](RESULTS.md)

<a id="result"></a>

## 結果

**VERIFIED：実際のCodexホストからAI-DLCのCG入口を通り、TAKT mockによるCG検証まで成功した。**

- Codex CLI 0.154.0、ホストモデル`gpt-5.6-luna`、推論強度`max`。
- AI-DLC 2.8.2、TAKT 0.65.0、Bun 1.3.13。
- `dist/codex`をローカルマーケットプレイスとして登録し、実際のCLIでプラグインをインストールした。
- 本家のCodexフックを残したプロジェクトで、ホストが`next`→`continue`の2コマンドを実行した。
- プラグインがCG入口を検出し、公式CLIでparkしてTAKTを起動した。
- TAKTの実行は1回で`verified`。ビルド・5テスト・型検査・要求対応の検証を通り、最終のビルドとテストも終了コード0だった。
- 元のコードは`answer = 41`、固定した入力も保持された。ホストは委譲通知後にターンを終了し、実装を重複して進めなかった。

[機械可読の結果](results/2026-09-15.json)に到達範囲と失敗履歴を記録した。

<a id="trial-boundary"></a>

## 試験の境界

Intent・前工程の入力とCG入口の状態は合成データ。人間の承認記録を作る試験ではない。TAKTワーカーの応答もmockであり、実モデルのCG全工程完走を示すものではない。一方、Codexホスト、プラグインの読み込み、本家AI-DLCフック、`next`／`continue`／`park`、TAKTエンジン、ビルドとテストは実際に実行した。

実験専用のCodex設定領域を用意し、既存の認証ファイルを参照した。確認したフックを自動試験で使うため、起動時だけフック信頼の確認を省略している。通常の導入ではフックを確認して信頼する必要がある。既存プロジェクト、ユーザーのグローバル設定、個人マーケットプレイスは変更していない。

<a id="differences-found-on-the-real-host"></a>

## 実機で見つけた違い

最初の試行はTAKT起動前に停止した。CodexのBash結果には本家CLIの診断行とJSONが一緒に入るため、全体をJSONとして読む処理が失敗した。

本家の`aidlc-orchestrate:`診断行だけを許可し、JSONが1つに定まる場合だけ処理するよう修正した。未知の出力や複数のJSONを勝手に読み飛ばす処理は入れていない。修正後に新しい隔離プロジェクトで再試行し、上記の成功を確認した。

別の短い実機試験では、SessionStart・PreToolUse・PostToolUseのイベント形を取得し、Bashの`tool_response`が文字列であることを確認した。AI-DLCのセッション前置きも、実際に書き換えられたコマンドで確認した。

<a id="automated-tests-and-reproduction"></a>

## 自動テストと再現

CIでは実モデルを呼ばず、Codex CLIによるプラグインのインストール、配布物の移動、Codex用原文の注入、重複起動防止、ビルド・型検査失敗からの修正、誤った前置き・複合コマンド・別プロジェクト・未完了出力の拒否を確認する。

実機試験の再現にはCodexの認証が必要。

```sh
bun run experiment:codex-host
```

[導入手順](../../docs/codex-host.ja.md)と、別途実施した[Luna MaxワーカーのCG試験](../code-generation/RESULTS.ja.md)も参照。後者の30分タイムアウトは、この接続試験の成功によって解消した扱いにはしない。
