本家CGの要求・規約・Testing Contractを守って以下の指摘を修正してください。
{report:03-code-generation-code-review.json}
cg/source-manifest.jsonとcg/traceability.jsonも実際の変更に合わせます。
cg/の検証ログを読み、目標を下げずに原因を修正してください。修正後は固定ゲートでビルド・テスト・センサーを再実行し、別のコードレビュアーへ戻ります。
解決不能ならcg/blocked.jsonへ理由を保存し、blockedで終了してください。

cg/supervision.jsonが存在し、verdictがchanges_requestedの場合は、その要件充足判定の指摘も修正してください。修正後はコードレビューとsuperviseの両方へ戻ります。
