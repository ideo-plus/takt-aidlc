# TAKTのワークフローとファセット

AI-DLCの作業をTAKTへ委譲する定義を、このディレクトリにまとめる。
[TAKT本家のbuiltins](https://github.com/nrslib/takt/tree/main/builtins)と同じ責務で、処理の流れとプロンプトの部品を分けている。

```text
takt/
├── workflows/
│   ├── aidlc-code-generation.yaml       CG単体。Construction全体でも共用
│   ├── aidlc-construction-stage.yaml    Construction各工程の作成・レビュー
│   └── aidlc-construction.yaml          旧Construction試作
└── facets/
    ├── instructions/               各ステップで実行する手順
    ├── policies/                   HOTL・変更範囲・品質判定の共通ルール
    ├── personas/                   組み込みペルソナの選択理由
    ├── knowledge/                  固定入力・成果物・検証記録の読み方
    └── output-contracts/           レポートの形式と必須項目
```

## YAMLとMarkdownの役割

YAMLにはステップ、遷移、編集権限、品質ゲート、利用するファセットの参照を置く。
指示本文とレポート形式はMarkdownへ置き、役割にはTAKTの組み込みペルソナを使い、共有ルールと知識は複数のステップから参照する。
TAKTのYAMLでは`policies`、`knowledge`、`instructions`、`report_formats`にローカルファイルを宣言し、ステップから別名で参照する。
ペルソナは`planner`、`coder`、`architecture-reviewer`、`coding-reviewer`、`exec-assistant`を名前指定する。[選択理由と本家の参照先](facets/personas/README.md)を参照。
`report_formats`が指すファイルの配置先は`facets/output-contracts/`。

配布用YAMLは`takt/workflows/`に置き、`../facets/`を参照する。連携CLIは実行前にYAMLとローカルファセットを専用の制御領域へ配置し、相対参照を更新する。組み込みペルソナはTAKTが解決する。元のディレクトリ構成は変更しない。

## AI-DLCの原文との関係

ここにある知識は連携方式の説明であり、本家の工程定義・Intent・Unit設計の代わりではない。
対象プロジェクトのAI-DLC原文とTesting Contractは、従来どおり実行時に固定して担当ステップへ注入する。
HOTLへの置換規則は`policies/cg-hotl.md`と`policies/stage-hotl.md`にあり、連携CLIにも同じファイルから組み込む。原文の前後に付けることで、人間承認や本家の状態更新を誤って実行しないようにする。

## プロジェクトへの配置

`takt/`を、`facets/`も含めて対象プロジェクトの`aidlc/takt-handoff/takt/`へ配置する。
取得手順は[導入ガイド](https://github.com/ideo-plus/takt-aidlc/blob/main/docs/getting-started.md#download-the-takt-bundle)を参照。
YAMLだけをコピーすると参照先が足りないため、委譲前の検証で停止する。

連携CLIは宣言されたMarkdownも入力一覧とhashに含める。実行用YAMLを移動するときは固定コピーからファセットを配置し、参照を更新する。
実行後もこれらのファイルのhashを検査する。カスタマイズする場合も、ファイル参照はYAMLのトップレベル宣言に集約する。Markdownの`include`／`extends`は使わず、単一ファイルへ展開する。

## 編集と検証

このディレクトリを編集し、プラグイン配布物のコピーは直接編集しない。

```sh
bun run check:takt
bun run test
bun run build:marketplace
bun run check:marketplace
```

`check:takt`はローカルファセットの依存を確認し、元のYAMLをTAKT 0.65.0の`workflow doctor`で検証する。モデルは呼ばず、利用者のTAKT設定も変更しない。組み込みペルソナを使うため、ペルソナのパス制約を避けるための配置変更は不要。

テストではファセットの参照解決、移動後の読み込み、入力変更の検出、両委譲モードの実行を確認する。
