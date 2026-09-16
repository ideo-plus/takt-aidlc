# ユニット定義（Unit of Work）

## Sources

- `aidlc/spaces/default/intents/260915-answer-value-update/inception/requirements-analysis/requirements.md`
- `aidlc/spaces/default/intents/260915-answer-value-update/inception/units-generation/units-generation-questions.md`（人間の回答: 単一ユニット・kind=library）
- Domain Designはスキップ（`aidlc/spaces/default/intents/260915-answer-value-update/inception/domain-design/`に成果物なし。既存コンポーネント`src/value.ts`の値変更のみで新規コンポーネントなしのため）

## ユニット一覧

| Unit ID | Directory | 名前 |
|---|---|---|
| U1 | u1-answer-value | AnswerValueUpdate |

## U1: AnswerValueUpdate

- **説明**: `src/value.ts`がエクスポートする定数`answer`の値を41から42へ変更し、Practices Discoveryで確定した最小テスト（`src/value.test.ts`）で検証する。
- **責務（Responsibilities）**:
  - FR1: `src/value.ts`の`answer`を41から42へ変更する（FR1.1: 識別子・エクスポート形式は変更しない、FR1.2: 他ファイルへの付随更新は行わない）。
  - FR2: `src/value.test.ts`を新設し、最小テスト3件（FR2.1: ハッピーパス、FR2.2: 型健全性、FR2.3: 回帰防止）を実装する。
- **デプロイモデル**: embedded（既存の単一ファイル構成に組み込み。`package.json`を作らず、独立したデプロイ物・実行体は生成しない — Practices Discoveryの確定決定）。
- **相対的な複雑度**: S（定数1行の値変更 + 最小テスト3件）。
- **kind**: library（独立したランタイムを持たない再利用可能なコード。人間の確定回答）。
- **実装上の注意・制約**:
  - `package.json`・lockfile・CIワークフロー・Lint/フォーマッタは新規導入しない（Practices Discoveryの確定決定）。
  - テストは`bun test`で`package.json`なしに直接実行する。
  - テストファイルの配置は`src/value.test.ts`（テスト対象ファイルの隣）。
  - エラーハンドリングは適用対象外（統合境界が存在しないため）。

## Assumptions & Open Questions

None.
