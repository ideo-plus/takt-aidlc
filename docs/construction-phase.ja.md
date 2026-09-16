# Construction全体をTAKTへ委譲する

[English](construction-phase.md)

<a id="execution-flow"></a>

## 動作

`delegationScope: "construction"`で、AI-DLCのInception最終承認後にConstruction全体をTAKTへ委譲する。Claude Code／Codexの両ホストに対応する。元のAI-DLCは公式CLIでparkし、以降の実行は別の作業領域で進める。

```text
Inceptionの最終承認
  → 入力・工程選択・Unit依存関係を固定してpark
  → Unitを依存順に処理
      → Functional Design
      → NFR Requirements / NFR Design
      → Infrastructure Design
      → 共通CG（計画・レビュー・実装・ビルド・テスト・センサー・修正）
  → 全UnitのBuild and Testと技術レビュー
      → 必要なら所有UnitのCGへ一度戻して修正・再検証
  → 必要なCI Pipelineの生成と技術レビュー
  → superviseでIntent全体・Unit間の連携・要求充足を判定
      → 必要なら所有UnitのCGと全体工程を一度やり直して再判定
  → 承認した同じソースで全Unitの検査と全体ビルド・テストを再実行
```

設計工程とCI工程は、元のStage Progressで実行対象になっているものを使う。`[S]`または`SKIP`の工程は実行しない。Unit種別による成果物の適用範囲も反映する。テスト手順の必須ファイルはMinimal／Standard／Comprehensiveに合わせる。

TAKT内の確認は自動の技術レビューであり、人間承認ではない。ウォーキングスケルトン後にも対話承認を置かない。入力から判断できないことは理由を記録して`blocked`で終了する。ネイティブの承認・CG開始・工程完了の監査行は作らない。

<a id="shared-implementation-with-cg-only-mode"></a>

## CG単体版との共通部分

CG単体の入口確認と、固定入力から動く`executeCgWorkspace`を分離した。Construction全体版は各Unitで同じCG実行処理・Workflow・品質ゲートを呼ぶ。

- 本家CG、Intent、規約、知識、センサー、Testing Contractの原文をインストラクションへ展開する。
- 前工程の設計は技術レビュー後に固定し、CGの読み取り入力へ追加する。
- ビルド・テスト・適用するセンサーを通した同じコードに対してレビューする。
- CGの結果を次のUnitへ渡し、依存先のコードがある状態で実装する。
- 最終ソースでも各Unitの固定したビルド・テスト・センサーを再実行する。

設計とフェーズ全体の工程には、各工程の本家Markdown、担当者・レビュアーの定義と知識、上流成果物、固定した検証スクリプトを渡す。出典とhashは各工程の`control/injection.json`に残す。

<a id="configuration"></a>

## 設定

[共通の導入手順](getting-started.ja.md)と[Codexホストの導入](codex-host.ja.md)を参照し、Inceptionの最終承認より前に設定する。

次は設定の雛形。ファイル名と検証スクリプトは対象プロジェクトに合わせて用意する。

```json
{
  "enabled": true,
  "hostHarness": "codex",
  "delegationScope": "construction",
  "provider": "codex",
  "model": "gpt-5.6-luna",
  "codexReasoningEffort": "max",
  "artifacts": [
    "aidlc/spaces/default/intents/<intent>/inception/requirements-analysis/requirements.md"
  ],
  "sources": ["src/value.ts"],
  "workflow": "aidlc/takt-handoff/takt/workflows/aidlc-code-generation-stage.yaml",
  "constructionWorkflow": "aidlc/takt-handoff/takt/workflows/aidlc-construction-phase.yaml",
  "buildScript": "aidlc/takt-handoff/unit-build.ts",
  "verifyScript": "aidlc/takt-handoff/unit-test.ts",
  "sensorScripts": {
    "type-check": "aidlc/takt-handoff/unit-typecheck.ts"
  },
  "sensorExceptions": {
    "linter": {
      "reason": "確定した開発方針でLint基盤を追加しない",
      "source": "aidlc/spaces/default/intents/<intent>/inception/practices-discovery/team-practices.md"
    }
  },
  "phaseBuildScript": "aidlc/takt-handoff/full-build.ts",
  "phaseVerifyScript": "aidlc/takt-handoff/full-test.ts",
  "pipelinePaths": [".github/workflows/ci.yml"],
  "timeoutMs": 3600000
}
```

[TAKT定義の取得手順](getting-started.ja.md#download-the-takt-bundle)に従い、`takt/`を`facets/`ごと`aidlc/takt-handoff/`へ配置する。リポジトリのclone・ビルドは不要。
CGには`takt/workflows/aidlc-code-generation-stage.yaml`、工程の作成・レビューには`takt/workflows/aidlc-construction-phase.yaml`を使う。ローカルの指示・ポリシー・知識・出力契約も固定入力になる。ペルソナはTAKT 0.65.0の組み込みを使う。

ホストは`hostHarness`、委譲範囲は`delegationScope`、ワーカーは`provider`で選ぶ。委譲範囲の指定は必須で、`code-generation`または`construction`を指定する。

<a id="per-unit-checks"></a>

### Unitごとの検査

`unitChecks`にUnit名をキーとして、`buildScript`、`verifyScript`、`sensorScripts`、`sensorExceptions`を指定できる。未指定のUnitはトップレベルの同名設定を使う。

複数Unitでは、未実装の後続Unitを先行Unitの検査対象に含めないよう、それぞれのビルド・テストを定義する。全Unitをまとめる検査は`phaseBuildScript`と`phaseVerifyScript`に置く。カバレッジなどの品質目標は固定スクリプトで検証する。

<a id="sensors-for-design-artifacts"></a>

### 設計成果物のセンサー

- `required-sections`: 2つ以上のH2と、存在する独自テンプレートの見出しを確認する。
- `upstream-coverage`: 固定した上流成果物の確認一覧に欠落がないことを確認する。
- `traceability`: 本家の`aidlc engine sensor-traceability`で検証する。Functional DesignはFR/ACからBRへの対応と孤立ルール、NFR工程は工程に応じたNFRのIDを確認する。CGの直前には、設計で追加されたBR・NFRの詳細IDも再解決する。
- `linter`／`type-check`: TS/JSのコード例があれば、`stageSensorScripts`の対応するスクリプトが必要。終了コード0とJSONの`pass: true`を要求する。

本家センサーには、元のpark状態とレビュー済みの上流成果物を専用ディレクトリへ投影して渡す。これは検査用のコピーであり、元のAI-DLCの状態を進めたり承認記録を作ったりしない。

設計用のスクリプトには`AIDLC_ARTIFACTS_DIR`でその工程の成果物ディレクトリを渡す。TS/JSのコード例がなく、スクリプトも未設定の場合は`not_applicable`と理由を記録する。CGのアプリケーションコードの検査とは別に扱う。

CI工程は`pipelinePaths`に明示したファイルだけを書き出せる。YAMLは構文を確認し、全体ビルド・テストと技術レビューを通す。CIサービス上でのジョブ実行やデプロイを完了したとは扱わない。

<a id="final-requirement-validation"></a>

## 最終の要件充足判定

`supervisor`と組み込み`supervise`を使い、全Unitの最終コードをIntent、Inceptionの要求、設計、各Unitの判定と照合する。個別工程のreviewと、フェーズ最後のsuperviseは別セッションで実行する。

- approved：全要求と全Unitについてコード上の根拠を記録し、最終の機械検証へ進む。
- changes_requested：repairUnitsの所有Unitを依存順にCGへ戻し、Build and Testと必要なCI工程をやり直す。その後superviseを再実行する。
- blocked：外部判断が必要な理由を保存し、対話待ちにせず停止する。

superviseからの修正は1回まで。再判定でも不合格ならfailedとする。Build and Testからの修正もフェーズ全体で1回まで。
判定後のソースの変更は受け入れない。superviseがapprovedでも、最終ビルド・テスト・適用センサーが失敗すればverifiedにはならない。

<a id="results"></a>

## 結果

```sh
cat aidlc/takt-handoff/construction-phase-runs/<run-id>/status.json
```

`aidlc/takt-handoff/construction-phase-runs/<run-id>/`に記録する。

| 保存先 | 内容 |
|---|---|
| `manifest.json` / `snapshot/` | 承認時に固定した入力と設定 |
| `status.json` | `parked` → `running` → `verified` / `blocked` / `failed` |
| `attempts/1/<工程>/` | TAKTの実行、出典、レポート、技術レビュー、検査結果 |
| `attempts/1/store/` | 次の工程へ渡すコードとレビュー済み成果物 |
| `attempts/1/result/` | 最終の生成ソース |
| `attempts/1/final-unit-checks.json` | 最終ソースに対する各Unitの再検査 |
| `attempts/1/final-build.json` / `final-test.json` | 全体の最終検査 |
| `attempts/1/result.json` | 工程・Unit・生成物とhashの一覧 |

`verified`でも、元のAI-DLCはparkを維持する。元プロジェクトへのコード取り込み、ネイティブConstructionの完了、Operationへの自動移行は未実装。

<a id="verification-and-limits"></a>

## 検証と制約

[検証記録](../experiments/construction-phase/RESULTS.ja.md)を参照。合成入力とmockワーカーで、複数Unit、設計差し戻し、CGのビルド／型検査修正、CI生成、両ホストのフック接続を確認する。実モデルでConstruction全体を完走した実績とは区別する。

- AI-DLC 2.8.2、State Version 8、単一監査シャード、Inception完了直後を対象とする。
- 有効なUnit依存DAG、CGとBuild and Testを含む工程選択、確定したTest Strategyと`test-after`が必要。ゼロUnitや、CGを省略する部分的なConstructionには対応しない。
- Unitは依存順に直列実行する。工程の時間上限と最大ステップ数を設ける。TAKTの詳細出力は各工程の`takt-output.stdout.log`／`takt-output.stderr.log`へ保存し、`takt.json`には末尾64,000文字を保持する。ログは1回のTAKT実行につき合計100MBを上限とし、超過と時間切れを区別する。
- 設計とCGの差し戻しは各Workflow内で修正する。Build and Testで実測の失敗がある場合は、`repair_required`と所有Unitを返し、共通CGで一度修正して再検証する。修正後も失敗する場合や入力から所有者を決められない場合は停止する。
- ソースは通常ファイルを列挙する。`node_modules`と`.venv`は一時的な依存として差分の対象から除く。途中再開、ロックの自動回収、OSレベルの完全な隔離は未実装。

<a id="live-model-trial"></a>

## 実モデルの試験

```sh
bun run experiment:construction-phase -- --live
```

Codexの認証が必要。Luna Max（gpt-5.6-luna、max）で1 Unit・全7工程を実行し、上限は1時間。専用の合成入力と合成承認境界を使い、TAKTワーカーにはmockを使わない。`--repairs`との併用はできない。

進捗は次で確認できる。

```sh
bun experiments/construction-phase/inspect.ts /absolute/path/to/construction-phase-runs/<run-id>
```
