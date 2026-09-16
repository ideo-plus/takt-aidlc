# TAKTへの委譲範囲を選ぶ

## 方針

TAKTへ委譲する範囲として、CGステージ単体とConstructionフェーズ全体の2モードを用意する。Claude Code／Codexというホストの選択、TAKTワーカーのprovider・モデルとは別の設定として扱う。

CG単体とConstruction全体の両モードを実装済み。Claude Code／Codexの両ホストに対応し、同じCG実行処理と品質ゲートを使う。実モデルでの全工程完走は未確認。

## 2つのモード

| 項目 | CGステージ単体 | Constructionフェーズ全体 |
|---|---|---|
| 委譲する時点 | AI-DLCが必要な設計を終え、CGへ入る時点 | AI-DLCのInception最終承認後、Constructionを始める前 |
| AI-DLCの担当 | Inceptionと必要なConstruction設計 | Inception |
| TAKTの担当 | 現在のUnitのCG計画、技術レビュー、実装、ビルド・テスト・センサー、コードレビューと修正 | 有効なConstruction工程の設計、Unitの依存順の実装、レビュー、ビルド・テストと修正 |
| 主な入力 | Intent、Inception成果物、現在のUnit設計、CG定義と関連規約・知識・センサー | Intent、Inception成果物、Constructionの工程・Unit計画、各工程の定義と関連規約・知識・センサー |
| 向く使い方 | 設計をAI-DLCで確認し、実装部分を自動化したい | 承認済みの要求から設計・実装・検証までまとめて自動化したい |

同じIntentで両モードを同時に起動しない。実行開始時に委譲範囲と入力を固定し、実行中に範囲を切り替えない。

## 共通の動作

- 元のAI-DLCは公式CLIでparkし、TAKTは別の作業領域で実行する。
- TAKT内はHOTLとし、技術レビューと修正を自動で進める。ウォーキングスケルトン後にも対話承認待ちを置かない。
- 要求の矛盾や不足を自律的に解決できなければ、理由を残して`blocked`で終了する。人間の判断や承認記録を作らない。
- 生成コードのビルド・テスト・適用するセンサーが成功するまで、委譲結果を成功にしない。
- 元のAI-DLCへのコード取り込み、ネイティブの完了記録、後続工程の再開は別の受け入れ処理として設計する。

## CG処理を共通にする

Construction全体版のCGと、単体委譲のCGが別々の品質条件にならない構造にする。

```text
CG単体
  AI-DLCのUnit設計 → 共通CG処理 → 検証済みCG結果

Construction全体
  Inception成果物
    → 必要な設計と技術レビュー
    → Unit依存順に共通CG処理
    → フェーズ全体のビルド・テスト
    → 検証済みConstruction結果
```

共通化するのは、原文の解決、Testing Contract、CG計画と要求対応、実装・レビューの契約、検証ゲート。ホストでの入口確認・parkと、固定入力から動くCG処理を分離した。Construction内のCG呼び出しのために、元のAI-DLCの状態をCGへ進める必要はない。

Construction内で作ったUnit設計は、技術レビュー後にCG用の入力として固定する。元のAI-DLCにCG開始や人間承認の監査記録を作って、この条件を満たしたことにしない。

## 設定

次は設定の主要部分。入力ファイルや検証スクリプトなどの設定も必要。[Construction設定手順](construction-phase.md)を参照。

```json
{
  "hostHarness": "codex",
  "delegationScope": "construction",
  "provider": "codex",
  "model": "gpt-5.6-luna",
  "codexReasoningEffort": "max"
}
```

- `hostHarness`: AI-DLCを進めるホスト。`claude`または`codex`。
- `delegationScope`: TAKTへ渡す範囲。`code-generation`または`construction`。
- `provider`とモデル設定: TAKT内で使う実行環境。


## 現状

[CG単体](code-generation-stage.md)と[Construction全体](construction-phase.md)を選択できる。設計の差し戻し、CGの修正、全体検証から所有Unitへの修正依頼は、TAKT側で自動処理する。入力の矛盾や上限到達は停止し、成功として受け入れない。
