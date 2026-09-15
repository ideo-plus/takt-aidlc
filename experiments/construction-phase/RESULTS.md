# Construction全体版の検証

## 結果

合成入力とmockワーカーを使い、次の2つの成功経路を確認した。[機械可読の結果](results/2026-09-15.json)に工程順と最終検証を記録している。

1. **2 Unitを依存順に実行。** 各UnitでFunctional Design、NFR Requirements、NFR Design、Infrastructure Design、共通CGを実行し、最後にBuild and TestとCI Pipelineを通した。設計の差し戻しとCGのビルド・型検査失敗も、修正してから先へ進んだ。
2. **全体検証からCGへ戻って修正。** consumerの単体テストは成功していても、先行Unitから再exportすべき契約に違反していれば全体検証が失敗する。Build and Testが所有Unitの修正を要求し、そのUnitの共通CGを再実行した後、全体検証とCIを通過した。

どちらも、最終ソースで全Unitのビルド・テスト・型検査と、全体ビルド・テストが終了コード0だった。元の入力ファイルは保持された。

## 確認した停止条件

- Inceptionの最終承認記録がなければparkしない。
- 委譲範囲の設定競合や、Unitの不正な依存を拒否する。
- park後に元の入力が変わった場合は実行を成功にしない。
- 未確定の設計は`blocked`で終了し、人間の回答待ちを作らない。
- 最終の全体テストが失敗した場合は`failed`になる。
- 実行・スキップの選択、Unit種別、Test Strategyに応じて対象を絞る。

## ホストと配布物

Claude Code形式とCodex形式の両方で、配布物のフックへInception承認イベントを渡し、Construction workerが起動することを確認した。Codexの配布物は実際のCodex CLIで隔離した設定領域へインストールする。重複通知でも実行回数は1回だった。

Construction全体版の試験は、ホストの実モデルにInceptionの承認コマンドを実行させる試験ではない。フックへ渡す承認イベントと監査記録は、明示した合成データである。製品コードは人間の承認やネイティブCG開始の監査行を生成しない。

## 何を実行したか

実際のTAKTエンジン、AI-DLCの状態・承認照合と公式park、Bunのビルドとテスト、TypeScriptの型検査、品質ゲート、成果物とソースのhash照合を実行した。

モデルの応答は固定したmockであり、設計内容の意味的な品質や実モデルの全工程完走を証明するものではない。AI-DLC本体のステージ定義をインストラクションへ渡し、独立した技術レビューへ回す構造を確認する試験である。

実装中には、読み取り専用の固定入力から次工程用ストアへコードを反映する際の権限エラーを修正した。固定入力は保持し、コントローラーが検証済みのコードを反映する時だけストアの該当ファイルを更新する。

## 再現

```sh
bun run experiment:construction-phase -- --codex --repairs
```

このコマンドはCodex用の本家ランタイムを入力に使い、合成承認とTAKT mockで実行する。実モデルの認証は不要。ログは`.experiments/`へ保存する。

設定と制約は[Construction導入手順](../../docs/construction-phase.md)を参照。元のAI-DLCへの結果取り込みとOperationの自動開始は未実装である。
