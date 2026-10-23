プロジェクト名: 宴会リアルタイム対抗クイズ (Enkai Quiz Realtime)

1. 概要

5グループ対抗のクイズシステム。司会者が管理画面で操作すると、プロジェクター用のメイン画面と参加者のスマホ画面がリアルタイムで同期して進行する。

2. 技術スタック

Frontend: HTML5, Tailwind CSS（ビルド済み css/tailwind.css を同梱）, JavaScript (ES6+)

Backend/DB: Firebase (App, Auth, Firestore)。SDK は vendor/firebase.js に 1 ファイルで同梱（v10.12.2）

Realtime: Firestore onSnapshot を利用した状態管理

外部 CDN には依存しない（Google Fonts のみ。読み込めなくても表示は止まらない）。
当日必要なのは GitHub Pages と Firebase への接続だけ。

3. 画面構成

index.html: エントランス（解答者、メイン、管理への分岐）

player.html: 解答者用（チーム選択 -> 回答ボタン -> 結果待ち）。動画はスマホには出さない（メイン画面で見てもらう）

main.html: プロジェクター用（開始ボタン -> QRコード -> 問題・タイマー -> 締切 -> 正解発表 -> ランキング）

admin.html: 管理画面（問題作成、進行コントロール、当日の正解選択、メイン画面の状態確認、リセット）

js/firebase-init.js: 共通処理。Firebase の関数は必ずここ経由で import する（vendor/firebase.js を別 URL で読むと SDK が二重になり動かない）

4. データ構造 (Firestore Path)

/artifacts/{appId}/public/data/state/current: 現在の問題番号、ステータス、採点済みの問題・正解・正解チーム、動画の指示

/artifacts/{appId}/public/data/quizzes: クイズデータ（問題、選択肢、answerMode、正解、当日の正解、配点、解答時間、画像・動画URL）

/artifacts/{appId}/public/data/teams: チーム名、スコア

/artifacts/{appId}/public/data/answers: 各チームの回答（ID は {quizId}_{teamId}）

/artifacts/{appId}/public/data/screens: メイン画面の稼働状況（20 秒ごと。動画の準備・音声・バージョン）

5. 進行ステータス

waiting → voting（回答受付）→ closed（回答締切）→ result（正解発表）→ … → final_ranking

- 事前に正解を入れた問題（answerMode: "preset"）: 時間切れで自動採点。手動締切の問題は「回答締切」→「正解発表・採点」
- 当日決める問題（answerMode: "live"）: 時間切れ・「回答締切」で closed になり、司会者が管理画面で正解の選択肢を押すと採点。
  決めた正解は quizzes の liveCorrectIndex に保存し、リセットで消える
- 採点はトランザクションで 1 問 1 回だけ（scoredForQuizId で判定）。連打・複数台・自動処理が重なっても二重加算しない
- 時間切れの処理は管理画面とメイン画面の両方が行う（メイン画面は 2 秒遅れの保険。司会者のスマホが画面ロックしても進む）

6. 動画

- MP4（H.264）の直リンク推奨。リポジトリの media/ に置いて「media/xxx.mp4」と指定するのが一番確実
- メイン画面は開いた時点で全動画をダウンロードしてブラウザに保存し、試し再生まで行う。準備できれば回線が切れても再生できる
- YouTube / Google Drive / Vimeo は外部プレイヤーのため、事前読み込み・一時停止の制御ができない
- iPhone で撮った動画（HEVC/.mov）は PC のブラウザで再生できないことがある。メイン画面・管理画面に「再生できない形式」と出たら H.264 の MP4 に変換する

7. リハーサル

URL に ?app=rehearsal のように付けると、本番とは別のデータ領域で動く（画面の左下に「リハーサル環境」と表示）。
メイン画面の QR・トップのリンクにも引き継がれる。本番前の練習はこれで行い、本番データは触らない。

8. Tailwind を変更したとき

HTML/JS に Tailwind のクラスを追加・変更したら、リポジトリ直下で次を実行して css/tailwind.css を作り直す。

npx tailwindcss@3.4.17 -c tailwind.config.js -o css/tailwind.css --minify

9. バージョン

js/firebase-init.js の APP_VERSION と、各 HTML の ?v=... を更新するとキャッシュが切り替わる。
管理画面の「メイン画面の状態」に古いバージョンと出たら、メイン画面を再読み込みする。
