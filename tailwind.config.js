// css/tailwind.css の生成設定（cdn.tailwindcss.com v3.4.17 と同じ既定テーマ）。
// HTML/JS に Tailwind のクラスを追加・変更したら、リポジトリ直下で次を実行して css/tailwind.css を作り直す:
//   npx tailwindcss@3.4.17 -c tailwind.config.js -o css/tailwind.css --minify
module.exports = {
  content: ["./*.html", "./js/**/*.js"],
  theme: { extend: {} },
  plugins: [],
};
