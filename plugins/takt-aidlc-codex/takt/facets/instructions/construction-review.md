次の成果物を、Intent、入力、注入された現在の工程定義・規約・センサーと照合してください。
{report:01-construction-draft.json}
input/construction-outputの実ファイルも確認します。Build and Test／CIではinput/phase-checks.jsonの実測値を確認し、未検証の品質目標やUnit間の要求漏れを指摘してください。
設計の不備はchanges_requested、入力の矛盾等で自律的に決められなければblocked、全て満たしていればapprovedを返します。
