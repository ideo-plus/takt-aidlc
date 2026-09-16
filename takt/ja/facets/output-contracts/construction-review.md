JSONのみ、文章は日本語。
{"verdict":"approved または changes_requested または blocked","reason":"停止理由","findings":[],"alignment":{"intent":"要求への対応","stageDefinition":"本家工程への対応","conventions":"規約への対応","testingContract":"品質目標と検証への対応"}}
approvedではfindingsを空にします。

組み込みレビューのAPPROVEはverdictのapproved、REJECTはchanges_requestedとして出力します。入力の矛盾などで判断できない場合はblockedです。
findingsの各項目にはfinding_id、status（newまたはpersists）、target、reason、fixを含めます。同じ問題は同じIDを維持し、解消済みの指摘はresolvedFindingsへ分けます。approvedのfindingsは空です。
