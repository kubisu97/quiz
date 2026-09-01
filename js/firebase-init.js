import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  collection,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const env = typeof window !== "undefined" ? window.__ENV__ : null;

function detectEnvError() {
  if (!env)
    return "env.js が読み込まれていません。env.example.js をコピーして env.js を作り、Firebase Console の値を設定してください。";
  if (!env.FIREBASE_CONFIG || !env.APP_ID)
    return "env.js の内容が不完全です。FIREBASE_CONFIG と APP_ID を設定してください。";
  const hasPlaceholder = Object.values(env.FIREBASE_CONFIG).some(
    (v) => typeof v === "string" && v.startsWith("YOUR_")
  );
  if (hasPlaceholder)
    return "env.js にプレースホルダ (YOUR_...) が残っています。Firebase Console の実際の値に置き換えてください。";
  return null;
}

export const envError = detectEnvError();
export const APP_ID = env?.APP_ID ?? null;

let app = null;
let auth = null;
let db = null;

if (!envError) {
  app = initializeApp(env.FIREBASE_CONFIG);
  auth = getAuth(app);
  db = getFirestore(app);
}

export { app, auth, db };

// 招待状サイトのパレットに合わせたチーム色。深緑の地に載る彩度に抑えている。
export const TEAM_COLORS = [
  "#ef7044",
  "#4a7c9e",
  "#d9a84e",
  "#7f9e6c",
  "#a86f9e",
];
export const DURATION_MS = 30000;
export const SCORE_PER_CORRECT = 10;

const root = APP_ID ? `artifacts/${APP_ID}/public/data` : null;
export const refs = {
  state: () => doc(db, `${root}/state/current`),
  quizzes: () => collection(db, `${root}/quizzes`),
  quiz: (id) => doc(db, `${root}/quizzes/${id}`),
  teams: () => collection(db, `${root}/teams`),
  team: (id) => doc(db, `${root}/teams/${id}`),
  answers: () => collection(db, `${root}/answers`),
  answer: (id) => doc(db, `${root}/answers/${id}`),
};

export function ensureSignedIn() {
  if (envError) return Promise.reject(new Error(envError));
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          unsub();
          resolve(user);
        }
      },
      reject
    );
    signInAnonymously(auth).catch(reject);
  });
}

export function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c])
  );
}

export function renderSetupError(container, message) {
  container.innerHTML = `
    <div class="qz-card" style="max-width:36rem;margin:4rem auto;padding:1.75rem">
      <h2 class="qz-display" style="font-size:2.25rem;color:var(--coral)">Error</h2>
      <p class="qz-jp-head" style="font-size:1rem;margin-top:.5rem">接続エラー</p>
      <p style="font-size:.875rem;margin:.75rem 0 1rem;line-height:1.7">${escapeHtml(
        message
      )}</p>
      <details style="font-size:.75rem;color:var(--muted)">
        <summary style="cursor:pointer;user-select:none">セットアップ手順</summary>
        <ol style="margin:.5rem 0 0 1.25rem;line-height:1.9">
          <li><code>env.example.js</code> を <code>env.js</code> にコピー</li>
          <li>Firebase Console でプロジェクトを作成し、Web アプリを追加</li>
          <li>firebaseConfig の値を <code>env.js</code> の <code>FIREBASE_CONFIG</code> に貼り付け</li>
          <li>Authentication で「匿名」プロバイダを有効化</li>
          <li>Firestore Database を作成（テストモードで可）</li>
          <li>ページをリロード</li>
        </ol>
      </details>
    </div>`;
}
