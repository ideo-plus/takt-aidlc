# 要求（Construction実モデル試験の合成入力）

## 機能要件

- FR1: src/value.tsのanswerを41から42へ変更する。
- FR1.1: 名前付きexportのanswerだけを公開し、数値定数という形を維持する。
- FR2: src/value.test.tsに5件のUnitテストを作る。
- FR2.1: 値42、数値型、旧値41ではないことを確認する。
- FR2.2: 公開exportがanswerだけであることと、有限な整数であることを確認する。

## 非機能要件

- NFR1: Bunによるビルドとテストを成功させ、src/value.tsの行カバレッジを80%以上にする。固定された型検査も成功させる。
- NFR2: アプリに実行時依存やpackage.jsonを新設しない。GitHub ActionsのCI設定は.github/workflows/ci.ymlに作成する。Lint基盤は導入しない。

## 対象外

新しい業務機能、DB、ネットワークAPI、クラウド資源、デプロイ、パフォーマンス測定、実環境のセキュリティ検査は対象外。通常のライブラリ検証を超える未定義の数値目標を作らない。公開先や認証情報は必要ない。
