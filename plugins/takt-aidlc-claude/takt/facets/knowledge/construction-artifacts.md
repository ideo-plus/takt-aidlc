# Construction工程の入力と成果物

input/construction-context.jsonには現在の工程、Unit、必須成果物、要求ID、上流成果物、CIの出力対象がある。
input/construction-outputには技術レビュー対象の実ファイル、input/phase-checks.jsonには全体検証の実測が置かれる。
Functional Designの対応先はrules.mdに実在するBRx.yである。NFR RequirementsのNFRx.y詳細IDは、NFR Design以降でも対応する本文へ引き継がれる。
repair_requiredは全体検証の失敗を所有UnitのCGへ一度戻すための結果であり、検証成功ではない。
