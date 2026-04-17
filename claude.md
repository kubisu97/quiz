プロジェクト名: 宴会リアルタイム対抗クイズ (Enkai Quiz Realtime)

1. 概要

5グループ対抗のクイズシステム。司会者が管理画面で操作すると、プロジェクター用のメイン画面と参加者のスマホ画面がリアルタイムで同期して進行する。

2. 技術スタック

Frontend: HTML5, Tailwind CSS, JavaScript (ES6+)

Backend/DB: Firebase (App, Auth, Firestore)

Realtime: Firestore onSnapshot を利用した状態管理

3. 画面構成 (Single File Application or Multiple HTMLs)

index.html: エントランス（解答者、メイン、管理への分岐）

player.html: 解答者用（チーム選択 -> 回答ボタン -> 結果待ち）

main.html: プロジェクター用（QRコード -> 問題・タイマー -> 正解発表 -> ランキング）

admin.html: 管理画面（問題作成、進行コントロール、リセット）

4. データ構造 (Firestore Path)

/artifacts/{appId}/public/data/state/current: 現在の問題番号、ステータス(waiting, voting, result, final_ranking)

/artifacts/{appId}/public/data/quizzes: クイズデータ（問題、選択肢、正解）

/artifacts/{appId}/public/data/teams: チーム名、スコア

/artifacts/{appId}/public/data/answers: 各チームの回答

5. 実装ステップ

Firebase初期設定: initializeApp と signInAnonymously の実装

管理画面: クイズのCRUD（作成・読込・更新・削除）と進行スイッチの実装

メイン画面: state を監視して画面遷移するロジックの実装

解答者画面: state が voting の時だけボタンを有効化し、回答を answers に保存

集計ロジック: 制限時間終了後、正解チームにスコアを加算