本家CGのStep 4（生成）とStep 5（成果物記録）に従い、次の計画を順番に実装してください。
{report:01-code-generation-plan.json}
新たな設計判断は行わず、InputのIntent・Unit設計・CG定義・開発規約・Testing Contractを維持します。
cg/source-manifest.jsonへ{"stage":"code-generation","version":1,"unit":"現在のUnit","writes":[{"path":"作成・変更・削除したソース/テストの相対パス"}]}を保存してください。全変更を列挙します。
cg/traceability.jsonへ{"stage":"code-generation","unit":"現在のUnit","upstream_ids":["全要求ID"],"coverage":[{"id":"要求ID","status":"OK","target":"実在するソースまたはテスト"}]}を保存してください。IDはinput/context.jsonを使います。
応答後に固定スクリプトがビルド・テスト・設定済みセンサーを実行します。失敗時はcg/build.json、cg/test.json、cg/linter.json、cg/type-check.jsonを読み、修正してください。
解決不能ならcg/blocked.jsonに{"reason":"理由と不足情報"}を保存しblockedとして終了します。
