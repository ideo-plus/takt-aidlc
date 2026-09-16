# CGの入力と検証記録

input/context.jsonには現在のUnit、要求ID、Testing Contract、原文パス、固定スクリプトの索引がある。
固定スクリプトのコピーはinput/project配下にある。テスト手順の説明とスクリプトの実際の対象・方法を照合できる。
cg/source-manifest.jsonは実際の変更ファイル、cg/traceability.jsonは要求とソース・テストの対応を表す。
cg/build.json、cg/test.json、cg/sensors.jsonには品質ゲートの実測が記録される。センサー別の詳細はcg/linter.jsonとcg/type-check.jsonにある。
verifiedはTAKTの検証完了を意味し、本家CGの完了や元プロジェクトへの取り込みを意味しない。
