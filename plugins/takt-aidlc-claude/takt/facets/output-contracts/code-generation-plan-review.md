JSONのみ、文章は日本語。
{"verdict":"approved または changes_requested または blocked","reason":"停止理由","findings":[{"target":"対象","reason":"根拠","fix":"修正内容"}],"alignment":{"intent":"Intentへの適合","stageDefinition":"本家CG定義への適合","conventions":"規約への適合","testingContract":"テスト方法・順序・目標への適合"}}
approvedならfindingsは空にしてください。

組み込みレビューのAPPROVEはverdictのapproved、REJECTはchanges_requestedとして出力します。入力の矛盾などで判断できない場合はblockedです。
findingsの各項目にはfinding_id、status（newまたはpersists）、target、reason、fixを含めます。同じ問題は同じIDを維持し、解消済みの指摘はresolvedFindingsへ分けます。approvedのfindingsは空です。
