JSONのみ、文章は日本語。
{"verdict":"approved または changes_requested または blocked","reason":"停止理由","intentAssessment":"Intent全体を現在のコードへ照合した判断","requirements":[{"id":"input/context.jsonの要求ID","status":"met または unmet または undetermined","evidence":[{"path":"実在するソースまたはテストの相対パス","reason":"受入条件に対する根拠"}]}],"findings":[{"id":"一貫した指摘ID","requirementIds":["要求ID"],"reason":"未充足の根拠","fix":"修正対象と満たすべき受入条件"}]}
全要求IDを重複なく列挙する。approvedは全行met、findingsは空。changes_requestedは指摘を1件以上含める。blockedには外部判断が必要な理由を記載する。
