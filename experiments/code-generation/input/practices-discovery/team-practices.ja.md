# 開発方針（合成CGテスト入力）

## Testing Posture

Methodologyはtest-after、Test Strategyはstandard。値変更後に5テストを作り、ビルド、Unitのテスト、型検査を実行する。行カバレッジの下限は80%。

## Code Style

既存のexport const answer形式と末尾セミコロンを維持する。アプリへの依存・設定追加は不要。Lint基盤は導入しないため、この試験ではlinterを根拠付きで適用外とする。型検査は固定された連携側スクリプトを用いる。
