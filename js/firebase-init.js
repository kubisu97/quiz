// Firebase SDK は vendor/ に同梱した 1 ファイル版を使う（外部 CDN に依存しないため）。
// 各ページは Firebase の関数をここ経由で import すること。
// vendor/firebase.js を別の URL（クエリ違い含む）で読み込むと SDK が二重に生成され、
// 「Type does not match the expected instance」で全操作が失敗する。
import {
  initializeApp,
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  getFirestore,
  doc,
  collection,
  getDocs,
  query,
  where,
  runTransaction,
  increment,
} from "../vendor/firebase.js?v=20261023a";

export {
  doc,
  collection,
  onSnapshot,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  query,
  orderBy,
  where,
  writeBatch,
  runTransaction,
  increment,
  serverTimestamp,
} from "../vendor/firebase.js?v=20261023a";

// 画面の隅に出すバージョン。デプロイが反映されたかの確認に使う。
export const APP_VERSION = "2026.10.23a";

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

// ?app=xxx を付けると本番とは別のデータ領域で動く（リハーサル用）。
// 本番データ（env.js の APP_ID）には一切触れない。
export const DEFAULT_APP_ID = env?.APP_ID ?? null;
const requestedApp = (() => {
  try {
    return new URLSearchParams(location.search).get("app");
  } catch {
    return null;
  }
})();
const overrideApp =
  requestedApp && /^[a-z0-9][a-z0-9-]{0,39}$/.test(requestedApp)
    ? requestedApp
    : null;
export const APP_ID = overrideApp || DEFAULT_APP_ID;
export const IS_REHEARSAL = !!overrideApp && overrideApp !== DEFAULT_APP_ID;

// リハーサル中は画面間のリンク・QR にも ?app= を引き継ぐ
export function withAppParam(href) {
  const url = new URL(href, location.href);
  if (IS_REHEARSAL) url.searchParams.set("app", APP_ID);
  return url.toString();
}

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
  // メイン画面の稼働状況（動画の準備・音声・最終応答）。管理画面で表示する。
  screens: () => collection(db, `${root}/screens`),
  screen: (id) => doc(db, `${root}/screens/${id}`),
};

// 進行ステータス
//   waiting       … 待機（QR・スコア表示）
//   voting        … 回答受付中
//   closed        … 回答締切（採点前。当日決める問題はここで正解を選ぶ）
//   result        … 正解発表
//   final_ranking … 最終結果
export const STATUS_LABELS = {
  waiting: "待機中",
  voting: "回答受付中",
  closed: "回答締切（正解発表前）",
  result: "正解発表",
  final_ranking: "最終結果",
};

// 「当日決める」問題。事前の correctIndex は持たず、本番で司会者が選んだ正解を
// liveCorrectIndex に保存する（リセットで消える）。
export function isLiveQuiz(quiz) {
  return quiz?.answerMode === "live";
}

// 表示・判定に使う正解。採点済みの問題は採点時に確定した正解を優先する。
export function correctIndexOf(quiz, state) {
  if (!quiz) return null;
  if (
    state &&
    state.scoredForQuizId === quiz.id &&
    Number.isInteger(state.revealedCorrectIndex)
  ) {
    return state.revealedCorrectIndex;
  }
  if (isLiveQuiz(quiz)) {
    return Number.isInteger(quiz.liveCorrectIndex)
      ? quiz.liveCorrectIndex
      : null;
  }
  return Number.isInteger(quiz.correctIndex) ? quiz.correctIndex : null;
}

// ---- 進行操作（管理画面とメイン画面の両方から使う） ----

// 回答締切。状態を読み直してから書くので、他の端末の操作を上書きしない。
export async function closeVoting(quizId) {
  const stateRef = refs.state();
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(stateRef);
    const s = snap.data();
    if (!s || s.status !== "voting" || s.currentQuizId !== quizId) return;
    tx.update(stateRef, { status: "closed", closedAt: Date.now() });
  });
}

// 採点して正解発表。1 つの問題につき 1 回しか点が入らないことをトランザクションで保証する
// （連打・管理画面の複数台操作・自動処理と手動の同時実行でも二重加算しない）。
export async function revealAndScore(quiz, correct) {
  if (!quiz) throw new Error("問題が見つかりません");
  const quizId = quiz.id;
  if (!Number.isInteger(correct) || correct < 0 || correct >= quiz.choices.length) {
    throw new Error("正解が設定されていません（問題一覧の「正解」を確認してください）");
  }
  const stateRef = refs.state();
  // 1. 先に締め切る（ここから先の回答変更を止める）
  await closeVoting(quizId);
  // 2. 締切後の回答を集計
  const ansSnap = await getDocs(query(refs.answers(), where("quizId", "==", quizId)));
  const winners = [
    ...new Set(
      ansSnap.docs
        .map((d) => d.data())
        .filter((a) => a.choice === correct)
        .map((a) => a.teamId)
    ),
  ];
  const points = Number(quiz.points) || SCORE_PER_CORRECT;
  // 3. 採点（状態を確認してから 1 回だけ）
  await runTransaction(db, async (tx) => {
    const sSnap = await tx.get(stateRef);
    const s = sSnap.data();
    if (!s || s.currentQuizId !== quizId) {
      throw new Error("進行中の問題が切り替わっています。画面を確認してください");
    }
    if (s.scoredForQuizId === quizId) {
      if (s.status !== "result") tx.update(stateRef, { status: "result" });
      return;
    }
    if (s.status !== "voting" && s.status !== "closed") {
      throw new Error("この問題は出題中ではありません");
    }
    const teamSnaps = [];
    for (const id of winners) teamSnaps.push(await tx.get(refs.team(id)));
    const scored = [];
    teamSnaps.forEach((ts) => {
      if (!ts.exists()) return; // 削除済みのチームは飛ばす
      tx.update(ts.ref, { score: increment(points) });
      scored.push(ts.id);
    });
    if (isLiveQuiz(quiz)) {
      tx.update(refs.quiz(quizId), { liveCorrectIndex: correct });
    }
    tx.update(stateRef, {
      status: "result",
      scoredForQuizId: quizId,
      revealedCorrectIndex: correct,
      scoredTeamIds: scored,
      scoredPoints: points,
    });
  });
}

// 時間切れの処理: 事前に正解がある問題は自動採点、当日決める問題は自動で締切。
// graceMs だけ締切時刻を過ぎてから動く（メイン画面は管理画面より少し遅らせて保険にする）。
export function startAutoTimer({ getState, getQuizzes, graceMs = 0, onError, onOk }) {
  let inFlight = false;
  let retryAt = 0;
  return setInterval(async () => {
    const state = getState();
    if (!state || state.status !== "voting" || !state.durationMs) return;
    if (inFlight || Date.now() < retryAt) return;
    const elapsed = Date.now() - (state.votingStartedAt || Date.now());
    if (elapsed < state.durationMs + graceMs) return;
    const quiz = getQuizzes().find((q) => q.id === state.currentQuizId);
    if (!quiz) return;
    inFlight = true;
    try {
      if (isLiveQuiz(quiz)) await closeVoting(quiz.id);
      else await revealAndScore(quiz, quiz.correctIndex);
      onOk?.();
    } catch (err) {
      retryAt = Date.now() + 3000;
      onError?.(err);
    } finally {
      inFlight = false;
    }
  }, 500);
}

export function choiceLetter(i) {
  return Number.isInteger(i) ? String.fromCharCode(65 + i) : "?";
}

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

// localStorage はプライベートブラウズ等で例外を投げることがあるので必ずここを通す
export const safeStorage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

// Firestore のエラーを司会者・参加者向けの日本語にする
export function describeError(err) {
  const code = err?.code || "";
  if (code === "permission-denied")
    return "データベースへのアクセスが拒否されました（Firestore のルールを確認してください）";
  if (code === "unavailable")
    return "サーバーに接続できません。電波・Wi-Fi を確認してください（自動で再接続します）";
  if (code === "resource-exhausted")
    return "Firebase の無料枠の上限に達した可能性があります";
  if (code === "failed-precondition" || code === "aborted")
    return "同時に操作されたため処理を中断しました。もう一度押してください";
  return err?.message || String(err);
}

// 画面上部の接続バナー。オフライン・サーバー未接続・権限エラーを目に見える形で出す。
// 戻り値の report(snapshot) を onSnapshot から呼ぶと、キャッシュ表示中かどうかを拾う。
export function mountConnectionBanner({ compact = false } = {}) {
  const bar = document.createElement("div");
  bar.id = "qz-conn";
  bar.setAttribute("role", "status");
  bar.style.cssText = [
    "position:fixed",
    "left:0",
    "right:0",
    "top:0",
    "z-index:90",
    "display:none",
    "padding:" + (compact ? "6px 10px" : "10px 16px"),
    "font:700 " + (compact ? "12px" : "15px") + "/1.4 var(--font-body)",
    "text-align:center",
    "color:#fff",
  ].join(";");
  document.body.appendChild(bar);

  let online = navigator.onLine !== false;
  let fromCacheSince = null;
  let lastError = null;
  let hadProblem = false;
  let okTimer = null;

  function paint() {
    const cacheStale = fromCacheSince && Date.now() - fromCacheSince > 4000;
    let msg = null;
    if (lastError) msg = "⚠ " + lastError;
    else if (!online) msg = "⚠ インターネットに接続されていません（つながると自動で復帰します）";
    else if (cacheStale)
      msg = "⚠ サーバーとの接続を待っています…（自動で再接続します）";

    if (msg) {
      hadProblem = true;
      clearTimeout(okTimer);
      bar.textContent = msg;
      bar.style.background = "#c0392b";
      bar.style.display = "block";
    } else if (hadProblem) {
      hadProblem = false;
      bar.textContent = "✓ 再接続しました";
      bar.style.background = "#2e7d4f";
      bar.style.display = "block";
      clearTimeout(okTimer);
      okTimer = setTimeout(() => (bar.style.display = "none"), 2500);
    }
  }

  window.addEventListener("online", () => {
    online = true;
    paint();
  });
  window.addEventListener("offline", () => {
    online = false;
    paint();
  });
  setInterval(paint, 1000);

  return {
    report(snap) {
      const fromCache = !!snap?.metadata?.fromCache;
      if (fromCache && !fromCacheSince) fromCacheSince = Date.now();
      if (!fromCache) {
        fromCacheSince = null;
        lastError = null;
      }
      paint();
    },
    error(err) {
      console.error(err);
      lastError = describeError(err);
      paint();
    },
    clearError() {
      lastError = null;
      paint();
    },
  };
}

// リハーサル環境で動いていることを画面の隅に常時表示する（本番と取り違えないため）
export function mountRehearsalBadge() {
  if (!IS_REHEARSAL) return;
  const badge = document.createElement("div");
  badge.textContent = `リハーサル環境: ${APP_ID}（本番データではありません）`;
  badge.style.cssText =
    "position:fixed;left:8px;bottom:8px;z-index:80;padding:4px 10px;background:#d9a84e;color:#103527;font:700 12px/1.4 var(--font-body);pointer-events:none";
  document.body.appendChild(badge);
}

export function renderSetupError(container, message) {
  container.innerHTML = `
    <div class="qz-card" style="max-width:36rem;margin:4rem auto;padding:1.75rem">
      <h2 class="qz-display" style="font-size:2.25rem;color:var(--coral)">Error</h2>
      <p class="qz-jp-head" style="font-size:1rem;margin-top:.5rem">接続エラー</p>
      <p style="font-size:.875rem;margin:.75rem 0 1rem;line-height:1.7">${escapeHtml(
        message
      )}</p>
      <p style="font-size:.8rem;margin:0 0 1rem;line-height:1.7">
        電波・Wi-Fi を確認してから、ページを再読み込みしてください。
      </p>
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
