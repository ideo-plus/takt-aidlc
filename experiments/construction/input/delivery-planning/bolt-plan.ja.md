# Bolt計画（Bolt Plan）

> **Bolt**とは、Constructionフェーズにおける1回分のビルド単位です（対象のUnit of Workに対して設計から実装・テストまでを1回のパスで通し、動くものを完成させます）。このインテントでは、Unit of Workが`U1（answer-value-update）`1件のみのため、Boltも1つだけです。

## Sources

- `aidlc/spaces/default/intents/260915-answer-value-update/inception/units-generation/unit-of-work.md`
- `aidlc/spaces/default/intents/260915-answer-value-update/inception/units-generation/unit-of-work-dependency.md`
- `aidlc/spaces/default/intents/260915-answer-value-update/inception/delivery-planning/delivery-planning-questions.md`（人間の回答: Q1〜Q4）
- `aidlc/spaces/default/intents/260915-answer-value-update/inception/practices-discovery/team-practices.md`

## Bolt一覧

### Bolt 1: answer-value-update

- **含まれるUnit of Work**: U1（answer-value-update, kind: library）
- **ウォーキングスケルトン**: 該当なし（Practices Discoveryの確定回答により、このインテントではウォーキングスケルトン＝本実装前の最小疎通確認は行わないと決定済み）。
- **完了条件（Definition of Done）**:
  1. `src/value.ts`がエクスポートする`answer`の値が42に変更されている。
  2. Practices Discoveryで確定した最小テスト3件（(1) `answer === 42`であることのハッピーパス、(2) `typeof answer === "number"`の型健全性、(3) `answer`が旧値41に戻っていないことの回帰防止）が、すべて`bun test`でパスする。
  3. `bun test --coverage`で`src/value.ts`の行カバレッジが80%以上であることを確認する（対象が1行のため自明に100%へ達する）。
  4. `answer`の識別子名・エクスポート形式（`export const answer`）・数値型を維持し、`package.json`・外部依存・CIワークフロー・Lint/フォーマッタ設定を新規導入しない。
- **確信仮説（Confidence Hypothesis）**: 実行順序は次のとおりである — (1) 本AI-DLCセッション内でDelivery Planningの人間による最終承認を得る、(2) 承認後、登録済みの連携フックがこのワークフローを正式にparkし、TAKTを自動起動する、(3) TAKTがこのBolt（`src/value.ts`の値変更＋最小テスト3件の実装）を実行する、(4) 実行結果を検証する。このBoltが完了すれば、AI-DLC Inceptionの人間承認からTAKTへのConstruction引き継ぎ・実装・検証までが一気通貫で実機として機能することを確認できる。本AI-DLCセッションはこのBoltの実装そのものは行わない（TAKTへの引き継ぎ後に実行される）。
- **想定デモ**: TAKTによる`src/value.ts`の差分（41→42）と、`bun test --coverage`の実行結果（3テストすべてPASS、行カバレッジ100%）を提示する。

## Assumptions & Open Questions

None.
