# ペルソナの選択

[English](README.md)

独自ペルソナは定義せず、TAKT 0.65.0に同梱されたペルソナをYAMLの`persona`で名前指定する。
このディレクトリには選択理由だけを置き、本家の定義を複製しない。

| 担当 | 組み込みペルソナ | 選択理由 |
|---|---|---|
| CG計画・Construction成果物作成 | `planner` | 要求分析と設計・実装計画を担当し、コード実装は担当しない |
| 実装・指摘修正 | `coder` | 確定した設計に沿う実装、テスト作成、修正を担当する |
| 計画・設計・Construction工程のレビュー | `architecture-reviewer` | 設計、構造、仕様への適合を確認し、自分でコードを変更しない |
| コードレビュー | `coding-reviewer` | 実装のバグ、回帰、テスト不足を差分と実証に基づいて確認する |
| 要件充足の最終判定 | `supervisor` | 現在のコードと元要件・受入条件・前段の指摘を独立に照合する |
| 完了報告 | `exec-assistant` | 汎用の報告役として使い、必要な確認と報告形式をinstructionで指定する |

`supervisor`はsuperviseステップで使う。機械ゲートの実行状況・結果・ログの審査は担当せず、要件充足と指摘の解消を判定する。ログをまとめる完了報告は`exec-assistant`が担当する。
AI-DLC固有の制約、HOTLへの置換、担当範囲、品質判定、出力形式はそれぞれpolicies・instructions・output-contractsで指定する。

<a id="resolution-and-verification"></a>

## 解決方法と検証

TAKTは名前参照をプロジェクト、グローバル設定、組み込みの順に探索する。連携実行は専用のTAKT設定と新しい作業領域を使う。
テストでは、元のYAMLと実行用のコピーに対して`workflow inspect`を実行し、全ステップのペルソナが`source: builtin`かつ本家`builtins/ja/facets/personas/`へ解決されることを確認する。
組み込みの定義はTAKTの依存物であり、本プロジェクトの入力Markdownのスナップショットには含めない。対象バージョンは0.65.0に固定する。

<a id="upstream-sources-inspected"></a>

## 参照した本家実装

- [組み込みペルソナ（v0.65.0）](https://github.com/nrslib/takt/tree/v0.65.0/builtins/ja/facets/personas)
- [ペルソナとファセットのローダー](https://github.com/nrslib/takt/blob/v0.65.0/src/infra/config/loaders/resource-resolver.ts)
- [探索順序](https://github.com/nrslib/takt/blob/v0.65.0/src/infra/config/loaders/workflowPackageScope.ts)

`main`の一覧も照合したうえで、動作判定には導入対象の0.65.0に同梱された定義を使っている。
