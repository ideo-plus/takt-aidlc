JSONのみ、文章は日本語。
{"verdict":"ready または blocked","reason":"blockedの場合の理由","testingContractHash":"固定Contractのcontract_sha256","steps":[{"id":1,"unit":"現在のUnit","action":"実装手順","requirementIds":["要求ID"],"files":["src/対象ファイル"]}],"unitTestInstructions":"## 実行方法\n...\n## 期待結果\n...","appliedRules":[{"source":"原文パス","rule":"適用した具体的な規則","application":"このCGでどう適用するか"}]}
必要に応じてplanMarkdownへ計画本文を追加できます。独自テンプレートがある場合はその構造を守り、各Stepと要求の対応も本文に含めてください。Testing Contractは検証側が原文を追記するため再作成しません。
