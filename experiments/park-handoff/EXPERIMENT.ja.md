# park中のフックとTAKTの実行環境を比較する

[English](EXPERIMENT.md)

> 履歴記録です。試作の実行用スクリプトは削除済みです。以下のコマンドやパスは当時の実験を示し、現在の導入手順ではありません。

<a id="conclusion-editing-worked-with-read-only-inputs-and-separated-ai-dlc-controls"></a>

## 結論: 読取専用の入力と、AI-DLCの制御を継承しない実行環境で編集できた

判定: **VERIFIED**。

2026年9月15日、実際のTAKTからClaude Codeを呼ぶ比較実験で、AI-DLCのPlan Approval Guardを継承したケースは編集が拒否され、制御設定を分けたケースは編集できた。元の要求文書、状態ファイル、引き継ぎ用入力は変わらなかった。

ただし、「park中ならいつでも編集拒否」ではない。フック単体の比較では、Inception末尾のDelivery Planningでparkした状態はソース変更を許可した。拒否の条件は、Code Generationの工程・指示と承認状態にある。

測定結果は[結果JSON](results/2026-09-15.json)、生ログは同JSONの`rawEvidenceDirectory`に保存した。実験データと上流のキャッシュはGit管理対象から除外している。

<a id="the-live-comparison-used-the-same-editing-request-in-two-environments"></a>

## 実モデルの比較では、同じ編集依頼を2つの環境へ渡した

| 条件 | AI-DLCの制御を継承 | 制御設定を分離 |
|---|---|---|
| 入力 | answerを42にする要求文書のコピー | 同じ内容のコピー |
| 開始時のコード | `export const answer = 41;` | 同じコード |
| 実行 | TAKT → Claude Code | TAKT → Claude Code |
| AI-DLC承認ガード | プロジェクトのPreToolUseに登録 | 登録なし |
| Editの結果 | ガードが終了コード2で拒否 | 編集成功 |
| 終了時のコード | `answer = 41` | `answer = 42` |
| 入力コピー | 変更なし | 変更なし |
| 元の要求・状態ファイル | 変更なし | 変更なし |
| TAKTの終了コード | 0 | 0 |
| 経過時間 | 約11.8秒 | 約7.9秒 |

実モデル試験は各条件1回。時間は参考記録で、速度比較を目的とした測定ではない。

継承側ではReadが2回許可され、続くEditが拒否された。理由には `no matching v2 code-generation active directive` と記録されている。Claude Codeは拒否を報告して止まり、設定や承認を変更して回避しなかった。

ここで使ったWorkflowは「編集を一度試して終了する」ことを完了条件にしている。そのため、拒否側もTAKT上は成功となる。これはTAKTが実装成功を誤判定したという意味ではない。自動連携の完了条件には、要求に対応する成果物や検証コマンドの結果を組み込む必要がある。

<a id="model-free-comparisons-isolated-rejection-conditions"></a>

## AIを呼ばない比較で、拒否条件を切り分けた

上流の生成ランタイムに含まれる実際のフックをサブプロセスとして実行した。Writeはフックが終了コード0を返した場合だけ実験側で適用した。この編集処理はハーネスの模擬であり、上記の実Claude Code試験と区別する。

| 条件・操作 | 結果 |
|---|---|
| 未承認のCode GenerationでソースへWrite | 拒否: 終了コード2 |
| 同じ工程でparkし、`next`を実行してからWrite | 拒否: 終了コード2 |
| park後に要求文書をRead | 許可: 終了コード0 |
| park後にBashのリダイレクトでソース変更を要求 | 拒否: 終了コード2 |
| park後に上流の要求文書へWrite | 拒否: 終了コード2 |
| park後にCode Generationの計画文書へWrite | 拒否: 終了コード2 |
| Delivery PlanningでparkしてソースへWrite | この承認ガードは許可: 終了コード0 |
| 自律実行モードでpark | エンジンは`kind: error`を返す |
| CWDだけ変更し、元のフックとプロジェクト指定を継承 | 拒否: 終了コード2 |
| 入力・制御設定を分離してTAKTのmockで実行 | ソース生成成功、入力と元の要求・状態は変更なし |

`park`後の`next`が`kind: parked`を返すことも確認した。その状態では現在の指示がコード生成用でなくなるため、未承認計画を作るための通常の書き込み例外も利用できない場合がある。今回の拒否は単に「計画がない」だけでなく、「対応する有効なコード生成指示がない」という理由だった。

また、park拒否時にもエンジンのプロセス終了コードは0だった。連携処理は終了コードだけで成功と判断せず、返されたJSONの`kind`を確認しなければならない。

<a id="pinned-upstream-implementation-and-no-invented-approvals"></a>

## 上流の実装を固定し、承認は作らずに実験した

| 項目 | 使用した版 |
|---|---|
| AI-DLC | v2.8.2 / `355903d6dc8eb07d3c77180be5d40ed679d6a40f` |
| TAKT | 0.65.0 |
| Claude Code | 2.1.270 |
| Bun | 1.3.13 |

AI-DLCの状態は実験用に合成したもの。未承認のCode Generationなどを設定し、実際の`orchestrate park`でparkした。Inception全工程の実行や、人の承認記録の生成・偽装は行っていない。

AI-DLCの上流ソースは変更せず、公式の`package.ts claude`で生成したランタイムを使った。実モデル試験の継承側には、対象を切り分けるためPlan Approval Guardだけを登録した。AI-DLCの全フックを登録した構成や、Codex側の動作はこの実験の対象外である。

TAKTは実験専用の設定ディレクトリと`--pipeline --skip-git`を使用する。Claude Codeは実験プロジェクトの設定だけを読み、使えるツールをRead・Write・Editに限定した。元のユーザー設定や実プロジェクトのガードを解除していない。Gitのコミットは再現用の架空プロジェクト内で基準を作るためだけに行い、このリポジトリの変更はコミットしていない。

入力は読取専用のファイルモードにし、実行前後のハッシュを比較した。実モデル試験には入力へのWrite・Editを拒否する権限設定も加えた。ただし、任意の悪意あるプロセスに対する完全な隔離や、監査ファイル全体の不変性を証明するものではない。

<a id="historical-reproduction-commands"></a>

## 再実行する

リポジトリのルートで実行する。Bun、Git、TAKTが必要。初回はAI-DLC v2.8.2を取得し、指定コミットとの一致を確認してランタイムを生成する。

```sh
bun experiments/park-handoff/run.ts
```

末尾に出る`runDir`を指定して実モデル試験を実行する。Claude Codeの認証済み環境が必要で、モデル利用量が発生する。

```sh
bun experiments/park-handoff/live.ts <runDir>
```

実モデル試験は同じrunDirでは一度だけ実行できる。再試行する場合は`run.ts`から新しい実験データを作る。各条件のプロセス全体を90秒で停止し、Claude Codeの呼び出しにもターン数と費用の上限を設定している。

生ログには実験用プロンプトやローカルパスが含まれる。共有用の結果JSONには、判定、版、測定値、フックの終了コードだけを抜き出した。

<a id="next-step-identified-at-the-time-automatic-handoff-after-inception-approval"></a>

## 次はInception承認後の自動引き継ぎを試す

今回証明したのは、特定のガードによる拒否と、制御設定を分離したTAKT実行である。Inceptionの承認後に自動でpark・起動する接続自体はまだ実装していない。

1. **推奨: 自動引き継ぎを実装する。** 成果物の固定、parkのJSON確認、TAKT起動、受入検証までをつなぐ。
2. **対応範囲を先に広げる。** AI-DLCの全フックを登録した環境とCodexで、同じ比較を行う。

実装する場合も、元のAI-DLCをparkしたという事実だけでTAKTの書き込みが許可されるとは考えず、入力・制御設定・成果物の管理を明確に分ける。
