import { initializeApp } from "firebase/app";
import {
  getFirestore, doc, getDoc, setDoc,
  collection, getDocs, writeBatch,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBwQHXKd6F2eL9lEIuwAff_Z8WYVR8veB0",
  authDomain: "fuchu6mbbc-37e68.firebaseapp.com",
  projectId: "fuchu6mbbc-37e68",
  storageBucket: "fuchu6mbbc-37e68.firebasestorage.app",
  messagingSenderId: "934958575750",
  appId: "1:934958575750:web:162c860dc5e37a430a6107"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const TEAM_DOC = "fuchu6mbbc";
const teamRef = () => doc(db, "teams", TEAM_DOC);
const gamesCol = () => collection(db, "teams", TEAM_DOC, "games");
const selectGamesCol = () => collection(db, "teams", TEAM_DOC, "selectGames");

/**
 * 全データを読み込む。
 * メインドキュメント(team/players/opponents/tournaments/選抜のplayers・opponents)と、
 * 試合データ(games/selectGamesサブコレクション、1試合=1ドキュメント)を読み合わせて、
 * 従来と同じ形の1つのオブジェクトとして返す。論理削除(_deleted)された試合は除外する。
 */
export async function loadData() {
  const mainSnap = await getDoc(teamRef());
  if (!mainSnap.exists()) {
    alert("【診断】メインドキュメントが存在しません(mainSnap.exists() === false)");
    return null;
  }

  const main = mainSnap.data();
  alert("【診断】main のキー一覧: " + Object.keys(main).join(", ") + "\npayloadの型: " + typeof main.payload + "\npayloadの長さ: " + (main.payload ? main.payload.length : "なし"));
  // 後方互換: 旧形式(payload文字列に全部入っている)ならそのままパースして返し、
  // 次回保存時に新形式へ自動移行される。
  if (main.payload) {
    try {
      const parsed = JSON.parse(main.payload);
      alert("【診断】payloadのパース成功。players数: " + (parsed.players?.length ?? "undefined") + " / games数: " + (parsed.games?.length ?? "undefined"));
      return parsed;
    } catch (e) {
      alert("【診断】payloadのパースに失敗しました: " + e.message);
    }
  }

  const [gamesSnap, selectGamesSnap] = await Promise.all([
    getDocs(gamesCol()),
    getDocs(selectGamesCol()),
  ]);
  const games = gamesSnap.docs.map((d) => d.data()).filter((g) => !g._deleted);
  const selectGames = selectGamesSnap.docs.map((d) => d.data()).filter((g) => !g._deleted);

  return {
    team: main.team || { name: "府中六小ミニバス", logo: "", homeCourt: "" },
    players: main.players || [],
    opponents: main.opponents || [],
    tournaments: main.tournaments || [],
    games,
    selectTeam: {
      players: main.selectTeam?.players || [],
      opponents: main.selectTeam?.opponents || [],
      games: selectGames,
    },
  };
}

/**
 * 全データを保存する。
 * data.games / data.selectTeam.games は試合ごとに個別ドキュメントとして保存する。
 * これにより、Play by Playで1試合だけ更新するような場面でも、
 * 従来のように全データ(1MB近く)を毎回送信する必要がなくなり、保存が高速・軽量になる。
 *
 * 試合の削除はこの関数内では検知しない(全件比較のための読み込みコストを避けるため)。
 * 削除操作は必ずアプリ側から deleteGame() を明示的に呼ぶ。
 */
export async function saveData(data) {
  const { games, selectTeam, ...rest } = data;
  const selGames = selectTeam?.games || [];
  const selRest = { players: selectTeam?.players || [], opponents: selectTeam?.opponents || [] };

  // メインドキュメント: 巨大なpayload文字列は使わず、フィールドごとに保存(1MB制限内に確実に収める)
  const mainWrite = setDoc(teamRef(), { ...rest, selectTeam: selRest, payload: null });

  const writes = [mainWrite];
  if (games) writes.push(writeGamesBatch(gamesCol(), games));
  if (selGames) writes.push(writeGamesBatch(selectGamesCol(), selGames));

  await Promise.all(writes);
}

async function writeGamesBatch(col, gameList) {
  if (gameList.length === 0) return;
  // Firestoreの1バッチ上限は500件。念のため450件ずつに区切る。
  const chunkSize = 450;
  for (let i = 0; i < gameList.length; i += chunkSize) {
    const chunk = gameList.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    for (const g of chunk) {
      if (!g.id) continue;
      batch.set(doc(col, g.id), g);
    }
    await batch.commit();
  }
}

/**
 * 試合を1件削除する(論理削除)。アプリ側で試合を削除するときは、
 * 通常のsaveDataに加えてこれも呼び、次回loadData時にその試合が除外されるようにする。
 * scope: "main"=府中六小の試合 / "select"=府中選抜の試合
 */
export async function deleteGame(scope, gameId) {
  const col = scope === "select" ? selectGamesCol() : gamesCol();
  await setDoc(doc(col, gameId), { id: gameId, _deleted: true });
}

/**
 * 六小・選抜両方の全試合を物理削除する。「すべてのデータを初期化」からのみ呼ばれる想定。
 */
export async function deleteAllGames() {
  const [gamesSnap, selectGamesSnap] = await Promise.all([getDocs(gamesCol()), getDocs(selectGamesCol())]);
  const allDocs = [...gamesSnap.docs, ...selectGamesSnap.docs];
  const chunkSize = 450;
  for (let i = 0; i < allDocs.length; i += chunkSize) {
    const chunk = allDocs.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    for (const d of chunk) batch.delete(d.ref);
    await batch.commit();
  }
}
