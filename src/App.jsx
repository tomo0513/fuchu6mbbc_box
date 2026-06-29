import React, { useState, useEffect, useMemo, useRef } from "react";
import { loadData, saveData } from "./firebase.js";
import {
  LineChart, Line, BarChart, Bar, ComposedChart, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend, ReferenceLine,
} from "recharts";
import {
  Home, ClipboardList, Users, Trophy, Settings, Plus, Trash2,
  ChevronLeft, ChevronDown, Pencil, Target, Clock, Download, Upload,
  Link2, Award, CornerDownRight, X, Film, FileText, Printer, UsersRound,
} from "lucide-react";

/* ============ デザイントークン ============ */
const DARK = {
  bg: "#0C1220", card: "#161F33", card2: "#1E2A45", border: "#2A3856",
  text: "#E9EEF8", sub: "#8FA0C0",
  orange: "#FF7A3D", led: "#FFB23E", win: "#3DBE7B", loss: "#E25C5C",
  board: "#070C16", nav: "#0A101E", oppBlue: "#5B74A8", oppText: "#7E94BC",
  sidebar: "#0E1828", inputBg: "#0F1830",
};
const LIGHT = {
  bg: "#F0F4F8", card: "#FFFFFF", card2: "#EAF0F8", border: "#C8D8EC",
  text: "#1A2A44", sub: "#5A7A9F",
  orange: "#E8602A", led: "#C87A00", win: "#1E8A50", loss: "#C03030",
  board: "#EDF2FA", nav: "#FFFFFF", oppBlue: "#3A60A0", oppText: "#2A508A",
  sidebar: "#F8FAFE", inputBg: "#F0F4F8",
};
const ThemeCtx = React.createContext(DARK);
const useC = () => React.useContext(ThemeCtx);
// グローバル参照用(関数外で使う箇所の互換)
let C = DARK;
const MAX_OPPONENTS = 100;
const MAX_PLAYERS = 30;
const MAX_GAMES = 200;
const STORE_KEY = "fuchu6-minibasket-v1";
const STORAGE_LIMIT = 5 * 1024 * 1024;
const TEAM_KEY = "TEAM";
const ADMIN_PASS = "tomo0513"; // ← 管理者パスワード(変更可)

/* ============ 管理者権限フック ============ */
function useAdminMode() {
  const [isAdmin, setIsAdmin] = useState(() => {
    try { return sessionStorage.getItem("minibasket_admin") === "1"; } catch { return false; }
  });
  const login = (pass) => {
    if (pass === ADMIN_PASS) {
      try { sessionStorage.setItem("minibasket_admin", "1"); } catch {}
      setIsAdmin(true); return true;
    }
    return false;
  };
  const logout = () => {
    try { sessionStorage.removeItem("minibasket_admin"); } catch {}
    setIsAdmin(false);
  };
  return { isAdmin, login, logout };
}

/* ============ レスポンシブフック ============ */
function useIsPC() {
  const [isPC, setIsPC] = useState(() => window.innerWidth >= 768);
  useEffect(() => {
    const fn = () => setIsPC(window.innerWidth >= 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return isPC;
}

/* ============ アクション定義 ============ */
const ACTIONS = [
  { k: "P2_M", label: "2P成功", pts: 2, good: true },
  { k: "P2_X", label: "2P失敗" },
  { k: "P3_M", label: "3P成功", pts: 3, good: true },
  { k: "P3_X", label: "3P失敗" },
  { k: "FT_M", label: "FT成功", pts: 1, good: true },
  { k: "FT_X", label: "FT失敗" },
  { k: "OR", label: "ORﾘﾊﾞｳﾝﾄﾞ", good: true },
  { k: "DR", label: "DRﾘﾊﾞｳﾝﾄﾞ", good: true },
  { k: "AST", label: "アシスト", good: true },
  { k: "STL", label: "スティール", good: true },
  { k: "BLK", label: "ブロック", good: true },
  { k: "TO", label: "ターンオーバー", bad: true },
  { k: "PF", label: "ファウル", bad: true },
  { k: "IN", label: "交代IN", sub: true },
  { k: "OUT", label: "交代OUT", sub: true },
];
const PTS_OF = { P2_M: 2, P3_M: 3, FT_M: 1 };
const ACTION_LABEL = { ...Object.fromEntries(ACTIONS.map((a) => [a.k, a.label])), TOT: "タイムアウト" };

const STAT_DEFS = [
  { k: "pts", label: "得点" },
  { k: "reb", label: "リバウンド" },
  { k: "or", label: "OR" },
  { k: "dr", label: "DR" },
  { k: "ast", label: "アシスト" },
  { k: "stl", label: "スティール" },
  { k: "blk", label: "ブロック" },
  { k: "to", label: "ターンオーバー" },
  { k: "pf", label: "ファウル" },
  { k: "eff", label: "EFF(貢献度)" },
  { k: "min", label: "出場時間(分)" },
];
const INVERSE_STATS = new Set(["to", "pf"]);

/* ============ 相手チームのTier(強さ) ============ */
const TIERS = [
  { k: "A", label: "A", desc: "都大会上位レベル", color: "#E25C5C" },
  { k: "B", label: "B", desc: "府中大会上位レベル", color: "#FF7A3D" },
  { k: "C", label: "C", desc: "同格", color: "#FFB23E" },
  { k: "D", label: "D", desc: "格下", color: "#3DBE7B" },
];
const tierOf = (k) => TIERS.find((t) => t.k === k);

/* ============ 試合区分 ============ */
// countWL: 勝敗集計に含めるか / countQ: 平均計算に使うQ数(regQOf(g)をそのまま使う)
const GAME_CATS = [
  { k: "official",  label: "公式戦",   badge: "公式", color: "#E25C5C", countWL: true  },
  { k: "practice",  label: "練習試合", badge: "練習", color: "#5B74A8", countWL: true  },
  { k: "ref",       label: "参考試合", badge: "参考", color: "#8FA0C0", countWL: false },
];
const gameCatOf = (k) => GAME_CATS.find((c) => c.k === k) || GAME_CATS[1]; // デフォルト練習試合

// あいうえお順ソート(アルファベット→ひらがな・漢字)。日本語ロケール対応
const nameCompare = (a, b) => (a || "").localeCompare(b || "", "ja");
// 対戦相手の並び: Tier順(A→D→未設定) → 読み(kana)優先のあいうえお順
const TIER_RANK = { A: 0, B: 1, C: 2, D: 3 };
const oppCompare = (a, b) => {
  const ra = TIER_RANK[a.tier] ?? 9, rb = TIER_RANK[b.tier] ?? 9;
  if (ra !== rb) return ra - rb;
  return nameCompare(a.kana || a.name, b.kana || b.name);
};

/* ============ ユーティリティ ============ */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt1 = (n) => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toFixed(1) : "0.0");
// 整数ならそのまま、小数があれば小数第1位まで
const fmtSmart = (n) => {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};
const pct = (m, a) => (a > 0 ? Math.round((m / a) * 100) + "%" : "–");
const qSum = (arr, periods) => (arr || []).slice(0, periods).reduce((a, b) => a + (+b || 0), 0);

function parseClock(s, cap) {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Math.min(parseInt(m[1]) * 60 + parseInt(m[2]), cap || 360);
}

function shrinkSquare(file, size, cb) {
  const img = new Image(); const reader = new FileReader();
  reader.onload = () => {
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = size; cv.height = size;
      const ctx = cv.getContext("2d");
      const m = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, size, size);
      cb(cv.toDataURL("image/jpeg", 0.85));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function ytId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtu\.be\/|v=|shorts\/|embed\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

// 画像URLを直接表示可能な形に変換(Googleドライブの共有リンク対応)
function imgUrl(url) {
  if (!url) return null;
  const s = String(url).trim();
  // Googleドライブ: /file/d/XXX/view または ?id=XXX → 直接表示URL
  const m = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([\w-]+)/);
  if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1000`;
  return s; // それ以外(Imgur, iCloud, 直リンク等)はそのまま
}

/* ============ ピリオドヘルパー ============ */
const regQOf = (g) => +g?.regQ || 4; // レギュラーピリオド数(3 or 4)
const periodsOf = (g) => regQOf(g) + (+g?.ot || 0);
const periodLabel2 = (g, i) => (i <= regQOf(g) ? `Q${i}` : `OT${i - regQOf(g)}`);
const periodLabel = (i) => `Q${i}`; // 後方互換(OTなし簡易表示)
const periodLen = (g, i) => (i <= regQOf(g) ? (+g?.qLen || 6) * 60 : (+g?.otLen || 3) * 60);
const padQ = (arr) => { const a = [...(arr || [])]; while (a.length < 6) a.push(""); return a; };
const normGame = (g) => {
  const { scoreSheet, ...rest } = g;
  return { ...rest, qLen: +g.qLen || 6, otLen: +g.otLen || 3, ot: +g.ot || 0, regQ: +g.regQ || 4, order: +g.order || 0,
    category: g.category || "practice",
    memo: g.memo || "",
    qScores: { own: padQ(g.qScores?.own), opp: padQ(g.qScores?.opp) },
    events: g.events || [], lineups: g.lineups || {}, videos: g.videos || {}, scoreCards: g.scoreCards || [] };
};

/* ============ スタッツ計算 ============ */
const matchKey = (e, side, key) =>
  e.side === side && (side === "own" ? e.playerId === key : e.oppNum === key);

function courtIntervals(events, side, key, g) {
  const map = {}; let has = false;
  const lineups = g?.lineups || {};
  for (let q = 1; q <= periodsOf(g); q++) {
    const len = periodLen(g, q);
    let evs = (events || [])
      .filter((e) => matchKey(e, side, key) && e.q === q && (e.action === "IN" || e.action === "OUT"))
      .map((e) => ({ a: e.action, t: parseClock(e.time, len) ?? (e.action === "IN" ? len : 0) }));
    const inLineup = side === "own" && (lineups[q] || []).includes(key);
    // まず時系列順(残り時間の降順)に並べる。同時刻はOUT→INの順
    evs.sort((a, b) => (b.t - a.t) || (a.a === "OUT" ? -1 : 1));
    // 最初のイベントがOUT、またはイベントが無くlineup登録済みなら、Q頭からの出場を補完
    // (スターター/Q頭から出ていた選手の経過時間を正しく計上。lineup未登録でも救済)
    const firstIsOut = evs.length > 0 && evs[0].a === "OUT";
    const noEventButInLineup = evs.length === 0 && inLineup;
    if (firstIsOut || noEventButInLineup) evs = [{ a: "IN", t: len }, ...evs];
    if (evs.length) has = true;
    const iv = []; let start = null;
    for (const e of evs) {
      if (e.a === "IN" && start === null) start = e.t;
      if (e.a === "OUT" && start !== null) { iv.push([start, e.t]); start = null; }
    }
    if (start !== null) iv.push([start, 0]);
    map[q] = iv;
  }
  return { map, has };
}

function aggStats(events, side, key, scope, g) {
  const sc = scope || "all";
  const e = (events || []).filter((ev) => matchKey(ev, side, key) && (sc === "all" || ev.q === sc) && ev.action !== "TOT");
  const c = (k) => e.filter((ev) => ev.action === k).length;
  const ftm = c("FT_M"), fta = ftm + c("FT_X");
  const p2m = c("P2_M"), p2a = p2m + c("P2_X");
  const p3m = c("P3_M"), p3a = p3m + c("P3_X");
  const or = c("OR"), dr = c("DR");
  const fgm = p2m + p3m, fga = p2a + p3a;
  const pts = ftm + p2m * 2 + p3m * 3;
  const reb = or + dr, ast = c("AST"), stl = c("STL"), blk = c("BLK"), to = c("TO");
  const { map, has } = courtIntervals(events, side, key, g || {});
  let sec = 0, pm = 0;
  const qs = sc === "all" ? Object.keys(map).map(Number) : [sc];
  for (const q of qs) for (const [a, b] of map[q] || []) sec += a - b;
  if (has) {
    for (const ev of events || []) {
      const p = PTS_OF[ev.action]; if (!p) continue;
      if (sc !== "all" && ev.q !== sc) continue;
      const len = periodLen(g || {}, ev.q);
      const t = parseClock(ev.time, len) ?? len / 2;
      const on = (map[ev.q] || []).some(([x, y]) => x >= t && t >= y);
      if (on) pm += ev.side === side ? p : -p;
    }
  }
  return {
    pts, ftm, fta, p2m, p2a, p3m, p3a, fgm, fga, or, dr, reb, ast, stl, blk, to, pf: c("PF"),
    min: Math.round((sec / 60) * 10) / 10,
    pm: has ? pm : null,
    eff: pts + reb + ast + stl + blk - (fga - fgm) - (fta - ftm) - to,
  };
}
const hasStats = (s) => ["pts","fga","fta","reb","ast","stl","blk","to","pf"].some((k) => s[k] > 0) || s.min > 0;

function sideTotals(events, side, scope) {
  const sc = scope || "all";
  const e = (events || []).filter((ev) => ev.side === side && (sc === "all" || ev.q === sc) && ev.action !== "TOT");
  const c = (k) => e.filter((ev) => ev.action === k).length;
  const ftm = c("FT_M"), fta = ftm + c("FT_X");
  const p2m = c("P2_M"), p2a = p2m + c("P2_X");
  const p3m = c("P3_M"), p3a = p3m + c("P3_X");
  const or = c("OR"), dr = c("DR");
  return {
    pts: ftm + p2m * 2 + p3m * 3, ftm, fta, fgm: p2m + p3m, fga: p2a + p3a,
    or, dr, reb: or + dr, ast: c("AST"), stl: c("STL"), blk: c("BLK"), to: c("TO"), pf: c("PF"),
    poss: (p2a + p3a) - or + c("TO") + 0.44 * fta, n: e.length,
  };
}
const timeoutsOf = (events, side, scope) =>
  (events || []).filter((e) => e.side === side && e.action === "TOT" && (scope === "all" || e.q === scope)).length;
const gamePts = (g) => ({ own: qSum(g.qScores?.own, periodsOf(g)), opp: qSum(g.qScores?.opp, periodsOf(g)) });

// 試合の並び順: 日付 → 同日内order。descは新しい順
const gameOrderAsc = (a, b) => (a.date || "").localeCompare(b.date || "") || ((+a.order || 0) - (+b.order || 0));
const gameOrderDesc = (a, b) => (b.date || "").localeCompare(a.date || "") || ((+b.order || 0) - (+a.order || 0));

function careerStats(games, playerId) {
  const per = games.map((g) => ({ g, s: aggStats(g.events, "own", playerId, "all", g) })).filter((x) => hasStats(x.s));
  // 平均用: スコアが0-0(まだ未入力)の試合は除外
  const played = per.filter((x) => { const p = gamePts(x.g); return (p.own + p.opp) > 0; });
  // Q数基準の正規化: 実施Q数合計÷基準Q数(4Q×試合数)
  // 例: 4Q+3Q+2Q=9Q実施、基準12Q → 平均係数 = 12/9
  const totalQPlayed = played.reduce((a, x) => a + periodsOf(x.g), 0);
  const baseQ = played.length * 4; // 全試合4Q換算の基準
  // n は表示用の試合数(0-0除外)
  const n = played.length;
  const tot = {};
  const totAdj = {}; // Q数基準の平均用
  const cntKeys = [...STAT_DEFS.map((d) => d.k), "fgm", "fga", "ftm", "fta"];
  cntKeys.forEach((k) => {
    // 合計は全試合(per)を集計。浮動小数点誤差を防ぐため小数第1位に丸める
    tot[k] = Math.round(per.reduce((a, x) => a + (x.s[k] || 0), 0) * 10) / 10;
    // 平均用: played合計 ÷ 実施Q数 × 基準Q数(4Q換算)
    const playedTotal = played.reduce((a, x) => a + (x.s[k] || 0), 0);
    totAdj[k] = totalQPlayed > 0 ? playedTotal / totalQPlayed * baseQ : 0;
  });
  return { per, n, tot, totAdj, gamesPlayed: per.length, totalQPlayed, baseQ };
}

function mipOf(game, players) {
  const rows = players.map((p) => ({ p, s: aggStats(game.events, "own", p.id, "all", game) })).filter((r) => hasStats(r.s));
  if (rows.length === 0) return [];
  const max = Math.max(...rows.map((r) => r.s.eff));
  return rows.filter((r) => r.s.eff === max);
}

function analysisFor(data, game, scope) {
  const periods = periodsOf(game);
  const events = game.events || [];
  const ownT = sideTotals(events, "own", scope);
  const oppT = sideTotals(events, "opp", scope);
  const ownPts = scope === "all" ? qSum(game.qScores?.own, periods) : (+game.qScores?.own?.[scope - 1] || 0);
  const oppPts = scope === "all" ? qSum(game.qScores?.opp, periods) : (+game.qScores?.opp?.[scope - 1] || 0);
  const ortg = ownT.poss > 0 ? (100 * ownPts) / ownT.poss : null;
  const drtg = oppT.poss > 0 ? (100 * oppPts) / oppT.poss : null;
  const net = ortg !== null && drtg !== null ? ortg - drtg : null;
  const win = ownPts > oppPts;
  const ownRows = data.players.map((p) => ({ key: p.id, label: `#${p.number} ${p.codename || p.name}`, p, s: aggStats(events, "own", p.id, scope, game) })).filter((r) => hasStats(r.s) || r.s.min > 0);
  const oppKeys = [...new Set(events.filter((e) => e.side === "opp" && e.oppNum && e.oppNum !== TEAM_KEY && (scope === "all" || e.q === scope)).map((e) => e.oppNum))];
  const oppRows = oppKeys.map((n) => ({ key: n, label: `#${n}`, s: aggStats(events, "opp", n, scope, game) })).filter((r) => hasStats(r.s));
  const qData = Array.from({ length: periods }, (_, i) => ({ name: periodLabel2(game, i + 1), 自チーム: +(game.qScores?.own?.[i]) || 0, 相手: +(game.qScores?.opp?.[i]) || 0 }));
  const insights = [], tips = [];
  const scopeLabel = scope === "all" ? "試合全体" : periodLabel2(game, scope);
  if (ownT.n === 0) {
    insights.push(`${scopeLabel}のプレイログが未入力のため、スコアのみで表示しています。`);
  } else {
    const fgp = ownT.fga > 0 ? ownT.fgm / ownT.fga : null;
    if (fgp !== null) insights.push(`シュート成功率 ${pct(ownT.fgm, ownT.fga)}(${ownT.fgm}/${ownT.fga})。${fgp >= 0.45 ? "効率よく得点できています。" : fgp >= 0.35 ? "平均的な水準です。" : "確率の高いシュート選択が課題です。"}`);
    if (oppT.fga > 0) insights.push(`相手のシュート成功率は ${pct(oppT.fgm, oppT.fga)}。${oppT.fgm / oppT.fga > 0.45 ? "イージーシュートを許しています。" : "ディフェンスは機能しています。"}`);
    if (ownT.reb + oppT.reb > 0) insights.push(`リバウンドは ${ownT.reb} 対 ${oppT.reb}${ownT.reb > oppT.reb ? "で上回りました。" : ownT.reb < oppT.reb ? "で劣勢でした。" : "の互角。"}`);
    insights.push(`TOは自 ${ownT.to}・相手 ${oppT.to}。${ownT.to < oppT.to ? "ボール管理で優位に立ちました。" : ownT.to > oppT.to ? "ボールロストが失点機につながった可能性があります。" : ""}`);
    if (scope === "all") {
      const margins = qData.map((x) => x.自チーム - x.相手);
      const keyQ = win ? margins.indexOf(Math.max(...margins)) : margins.indexOf(Math.min(...margins));
      insights.push(`${win ? "勝因" : ownPts === oppPts ? "焦点" : "敗因"}の候補: ${qData[keyQ]?.name} の得失点差(${margins[keyQ] >= 0 ? "+" : ""}${margins[keyQ]})が最も大きい時間帯です。`);
    }
    const ftp = ownT.fta > 0 ? ownT.ftm / ownT.fta : null;
    if (ftp !== null && ftp < 0.5 && ownT.fta >= 4) tips.push("フリースロー成功率が50%未満。練習前後のルーティンでFT本数を増やしましょう。");
    if (fgp !== null && fgp < 0.35) tips.push("シュート成功率が低め。ゴール下とミドルの確率が高いエリアでの打ち切りを意識しましょう。");
    if (ownT.to >= (scope === "all" ? 12 : 4)) tips.push("ターンオーバーが多め。プレッシャー下のパス&キャッチ練習がおすすめです。");
    if (oppT.or >= (scope === "all" ? 8 : 3)) tips.push("相手にオフェンスリバウンドを許しています。ボックスアウトの徹底を。");
    if (ownT.ast < ownT.fgm * 0.4 && ownT.fgm > 0) tips.push("アシスト比率が低め。1人で打ち切る前にもう1本パスを回す意識づけを。");
    if (scope === "all" && qData[2] && qData[2].自チーム - qData[2].相手 < 0) tips.push("Q3の入りで失点が先行。ハーフタイム明けの最初の2分間の集中を声かけしましょう。");
    if (tips.length === 0) tips.push("大きな課題は見当たりません。この内容を継続しましょう。");
  }

  // プロのミニバス分析アナリスト視点: 良かった点・改善点(全体・各Q)
  const goodPoints = [];
  const improvePoints = [];
  if (ownT.n > 0) {
    const isAll = scope === "all";
    const sl = isAll ? "この試合" : `${scopeLabel}`;
    const fgp = ownT.fga > 0 ? ownT.fgm / ownT.fga : 0;
    const ftp = ownT.fta > 0 ? ownT.ftm / ownT.fta : 0;
    const oppFgp = oppT.fga > 0 ? oppT.fgm / oppT.fga : 0;
    const astRate = ownT.fgm > 0 ? ownT.ast / ownT.fgm : 0;
    const margins = qData.map((x) => x.自チーム - x.相手);
    const topEff = [...ownRows].filter((r) => hasStats(r.s)).sort((a, b) => b.s.eff - a.s.eff)[0];

    // --- 良かった点 ---
    if (fgp >= 0.45 && ownT.fga >= (isAll ? 10 : 3)) goodPoints.push(`${sl}のフィールドゴール成功率${pct(ownT.fgm, ownT.fga)}は小学生年代では非常に高い水準です。無理のないシュートセレクションができており、ボールを動かして良い形を作れていた証拠です。`);
    else if (fgp >= 0.38 && ownT.fga >= (isAll ? 10 : 3)) goodPoints.push(`${sl}のフィールドゴール成功率${pct(ownT.fgm, ownT.fga)}は年代の平均を上回ります。シュートチャンスの選び方は概ね良好でした。`);
    if (oppFgp > 0 && oppFgp < 0.35 && oppT.fga >= (isAll ? 8 : 3)) goodPoints.push(`相手のFG成功率を${pct(oppT.fgm, oppT.fga)}に抑えました。ディフェンスのプレッシャーとヘルプが機能し、イージーシュートを与えていません。`);
    if (ownT.reb > oppT.reb && ownT.reb + oppT.reb >= (isAll ? 10 : 3)) goodPoints.push(`リバウンドで${ownT.reb}対${oppT.reb}と上回りました(OR${ownT.or}/DR${ownT.dr})。ボックスアウトの意識が数字に表れています。${ownT.or >= (isAll ? 5 : 2) ? "オフェンスリバウンドからのセカンドチャンスも作れていました。" : ""}`);
    if (ownT.stl >= (isAll ? 6 : 2)) goodPoints.push(`スティール${ownT.stl}本はアクティブなディフェンスの成果です。パスラインを読んで積極的に仕掛けられていました。`);
    if (astRate >= 0.5 && ownT.fgm >= (isAll ? 4 : 2)) goodPoints.push(`得点のうちアシスト経由が${Math.round(astRate * 100)}%。個人技に頼らず、パスでズレを作って得点する良いバスケットができています。`);
    if (ftp >= 0.6 && ownT.fta >= (isAll ? 6 : 2)) goodPoints.push(`フリースロー${pct(ownT.ftm, ownT.fta)}と確実に決め切りました。競った展開で効いてくる重要な数字です。`);
    if (isAll && win && margins.filter((m) => m > 0).length >= 3) goodPoints.push(`複数のピリオドで相手を上回り、試合を通して主導権を握れていました。集中力が最後まで続いた点を評価できます。`);
    if (!isAll && ownPts > oppPts) goodPoints.push(`${scopeLabel}は${ownPts}対${oppPts}とリードを奪えました。この時間帯の戦い方は継続したいところです。`);
    if (topEff && topEff.s.eff >= (isAll ? 12 : 5)) goodPoints.push(`${topEff.label}がEFF${topEff.s.eff}と高い貢献度を記録。${topEff.s.pts}得点${topEff.s.reb}リバウンド${topEff.s.ast}アシストとチームを支えました。`);
    if (goodPoints.length === 0) goodPoints.push(`${sl}は数字上の強みは控えめでしたが、最後まで走り切る姿勢が見えました。次につながる内容です。`);

    // --- 改善点 ---
    if (fgp < 0.33 && ownT.fga >= (isAll ? 10 : 4)) improvePoints.push(`FG成功率${pct(ownT.fgm, ownT.fga)}は改善余地があります。遠い位置からの難しいシュートが多くなっていないか、ゴール下やフリーの味方を使えていたか映像で確認したいところです。練習ではレイアップとゴール下フィニッシュの本数を増やしましょう。`);
    if (ownT.to >= (isAll ? 12 : 4)) improvePoints.push(`ターンオーバー${ownT.to}個は多めです。相手のプレッシャーに対してパスを焦った場面が想定されます。ピボット、ボールミート、強いパスの3点をドリルで徹底すると減らせます。`);
    if (oppT.or >= (isAll ? 8 : 3)) improvePoints.push(`相手にオフェンスリバウンドを${oppT.or}本許しました。シュートが打たれた瞬間の「ボックスアウト」を全員が徹底することで、相手のセカンドチャンスを減らせます。`);
    if (ftp < 0.5 && ownT.fta >= (isAll ? 6 : 2)) improvePoints.push(`フリースロー${pct(ownT.ftm, ownT.fta)}は勝敗を左右します。練習の最後に、疲れた状態で連続FTを入れることをおすすめします。`);
    if (astRate < 0.35 && ownT.fgm >= (isAll ? 6 : 3)) improvePoints.push(`アシスト比率が低く、1対1で完結する場面が多かったようです。「もう1本パスを回す」意識と合わせの動き(カット、スクリーン)を増やすと得点が安定します。`);
    if (oppFgp >= 0.45 && oppT.fga >= (isAll ? 8 : 3)) improvePoints.push(`相手のFG成功率${pct(oppT.fgm, oppT.fga)}を許しました。ボールマンへの間合いとヘルプの戻りに改善余地があります。ゴール下を簡単に使われていないか確認しましょう。`);
    if (isAll && margins[2] !== undefined && margins[2] < -3) improvePoints.push(`第3ピリオドで失点が先行しました(${margins[2]})。ハーフタイム明けの入りは集中を切らしやすい時間帯です。最初の2分のプレーを声かけで引き締めたいところです。`);
    if (!isAll && ownPts < oppPts) improvePoints.push(`${scopeLabel}は${ownPts}対${oppPts}とリードを許しました。この時間帯に何が起きたか、失点の形を映像で振り返ると次に活きます。`);
    if (improvePoints.length === 0) improvePoints.push(`${sl}は大きな穴は見当たりませんでした。強いて言えば、リードした時間帯でも安易なプレーに逃げず、丁寧なバスケットを続けられると盤石になります。`);
  }

  // 旧insights/tipsは残すが画面では未使用(レポート互換のため保持)
  void insights; void tips;

  const reviews = scope === "all" ? [...ownRows].filter((r) => hasStats(r.s)).sort((a, b) => b.s.eff - a.s.eff).map((r, i) => {
    const s = r.s;
    const parts = [`${s.pts}得点(FG ${s.fgm}/${s.fga}${s.fta > 0 ? `、FT ${s.ftm}/${s.fta}` : ""})`];
    const strengths = [];
    if (s.reb >= 5) strengths.push(`リバウンド${s.reb}本`);
    if (s.ast >= 3) strengths.push(`アシスト${s.ast}`);
    if (s.stl >= 3) strengths.push(`スティール${s.stl}`);
    if (s.blk >= 2) strengths.push(`ブロック${s.blk}`);
    if (strengths.length) parts.push(`${strengths.join("、")}で貢献`);
    parts.push(`EFF ${s.eff}(チーム${i + 1}位)`);
    if (s.pm !== null) parts.push(`出場時間帯の得失点差は ${s.pm >= 0 ? "+" : ""}${s.pm}`);
    const concerns = [];
    if (s.to >= 4) concerns.push(`TO${s.to}はやや多め`);
    if (s.pf >= 4) concerns.push(`ファウル${s.pf}に注意`);
    if (s.fga >= 8 && s.fgm / s.fga < 0.3) concerns.push("シュート確率が低めだったため、打つエリアの整理を");
    return { ...r, text: parts.join("。") + "。" + (concerns.length ? " 課題: " + concerns.join("、") + "。" : "") };
  }) : [];
  const compRows = [
    ["得点", ownPts, oppPts],
    ["FG", `${ownT.fgm}/${ownT.fga} (${pct(ownT.fgm, ownT.fga)})`, `${oppT.fgm}/${oppT.fga} (${pct(oppT.fgm, oppT.fga)})`],
    ["FT", `${ownT.ftm}/${ownT.fta} (${pct(ownT.ftm, ownT.fta)})`, `${oppT.ftm}/${oppT.fta} (${pct(oppT.ftm, oppT.fta)})`],
    ["リバウンド合計", ownT.reb, oppT.reb],
    ["└ オフェンス(OR)", ownT.or, oppT.or],
    ["└ ディフェンス(DR)", ownT.dr, oppT.dr],
    ["アシスト", ownT.ast, oppT.ast],
    ["スティール", ownT.stl, oppT.stl],
    ["ブロック", ownT.blk, oppT.blk],
    ["ターンオーバー", ownT.to, oppT.to],
    ["ファウル", ownT.pf, oppT.pf],
    ["タイムアウト", timeoutsOf(game.events, "own", scope), timeoutsOf(game.events, "opp", scope)],
  ];
  return { periods, ownT, oppT, ownPts, oppPts, ortg, drtg, net, win, ownRows, oppRows, qData, insights, tips, reviews, compRows, scopeLabel, goodPoints, improvePoints };
}

function flowAnalysis(data, game) {
  const periods = periodsOf(game);
  const sorted = [...(game.events || [])].map((e, i) => ({ e, i })).sort((a, b) => a.e.q - b.e.q || a.i - b.i).map((x) => x.e);
  let ro = 0, rp = 0, leadChanges = 0, prevSign = 0, runTeam = null, runPts = 0;
  const perPeriod = {};
  const note = (q, text) => { (perPeriod[q] = perPeriod[q] || []).push(text); };
  for (const e of sorted) {
    const pts = PTS_OF[e.action];
    if (!pts) continue;
    if (e.side === runTeam) runPts += pts;
    else { if (runTeam && runPts >= 6) note(e.q, `${runTeam === "own" ? data.team.name : "相手"}が${runPts}-0のラン`); runTeam = e.side; runPts = pts; }
    if (e.side === "own") ro += pts; else rp += pts;
    const sign = Math.sign(ro - rp);
    if (sign !== 0 && prevSign !== 0 && sign !== prevSign) leadChanges++;
    if (sign !== 0) prevSign = sign;
  }
  if (runTeam && runPts >= 6 && sorted.length) note(sorted[sorted.length - 1].q, `${runTeam === "own" ? data.team.name : "相手"}が${runPts}-0のラン`);
  const periodNotes = [];
  for (let q = 1; q <= periods; q++) {
    const o = +(game.qScores?.own?.[q - 1]) || 0, p = +(game.qScores?.opp?.[q - 1]) || 0;
    const rows = data.players.map((pl) => ({ pl, s: aggStats(game.events, "own", pl.id, q, game) })).filter((r) => r.s.pts > 0).sort((a, b) => b.s.pts - a.s.pts);
    const parts = [`${periodLabel2(game, q)}: ${o}-${p}${o > p ? "で上回る" : o < p ? "で劣勢" : "の互角"}`];
    if (rows[0]) parts.push(`#${rows[0].pl.number} ${rows[0].pl.codename || rows[0].pl.name}が${rows[0].s.pts}得点`);
    if (perPeriod[q]) parts.push(...perPeriod[q]);
    const tos = timeoutsOf(game.events, "own", q) + timeoutsOf(game.events, "opp", q);
    if (tos > 0) parts.push(`タイムアウト${tos}回`);
    periodNotes.push(parts.join("。") + "。");
  }
  return { periodNotes, leadChanges, sorted };
}

/* ============ 共通UI ============ */
const Card = ({ children, className = "", style }) => {
  const C = useC();
  return <div className={`rounded-2xl p-4 ${className}`} style={{ background: C.card, border: `1px solid ${C.border}`, ...style }}>{children}</div>;
};
const SectionTitle = ({ children }) => {
  const C = useC();
  return <div className="text-xs font-bold tracking-widest mb-2" style={{ color: C.orange }}>{children}</div>;
};
const Field = ({ label, children }) => {
  const C = useC();
  return (
    <label className="block mb-3">
      <div className="text-xs mb-1" style={{ color: C.sub }}>{label}</div>
      {children}
    </label>
  );
};
const getInputStyle = (C) => ({ background: C.inputBg, border: `1px solid ${C.border}`, color: C.text });
const inputStyle = getInputStyle(DARK);
const inputCls = "w-full rounded-xl px-3 py-2.5 text-base";
const PrimaryBtn = ({ children, ...props }) => {
  const C = useC();
  return (
    <button {...props} className="w-full text-white font-bold py-3 rounded-xl active:opacity-80 disabled:opacity-40"
      style={{ background: C.orange }}>{children}</button>
  );
};
const Seg = ({ items, value, onChange }) => {
  const C = useC();
  return (
    <div className="flex rounded-xl overflow-hidden text-sm font-bold" style={{ border: `1px solid ${C.border}` }}>
      {items.map(([k, l]) => (
        <button key={k} className="flex-1 py-2.5" onClick={() => onChange(k)}
          style={value === k ? { background: C.orange, color: "#fff" } : { background: C.card, color: C.sub }}>{l}</button>
      ))}
    </div>
  );
};

function ScoreBoard({ own, opp, oppName, oppLogo, date, small, qScores, periods, game }) {
  const C = useC();
  const win = own > opp, draw = own === opp;
  return (
    <div className="rounded-xl px-4 py-3"
      style={{ background: C.board, border: `1px solid ${C.border}`, fontFamily: "'Bebas Neue', sans-serif" }}>
      {/* メインスコア行 */}
      <div className="flex items-center justify-between">
        <div className="text-center flex-1">
          <div className="text-xs tracking-widest" style={{ fontFamily: "sans-serif", color: C.sub }}>府中六小</div>
          <div className={small ? "text-5xl" : "text-7xl"} style={{ color: C.led, textShadow: `0 0 16px ${C.led}66`, lineHeight: 1.1 }}>{own}</div>
        </div>
        <div className="text-center px-2">
          <div className="text-xs" style={{ fontFamily: "sans-serif", color: C.sub }}>{date || ""}</div>
          <div className="text-sm font-bold px-2.5 py-0.5 rounded mt-1 text-white"
            style={{ background: draw ? "#444" : win ? C.win : C.loss, fontFamily: "sans-serif" }}>
            {draw ? "引分" : win ? "WIN" : "LOSE"}
          </div>
        </div>
        <div className="text-center flex-1">
          <div className="flex items-center justify-center gap-1 max-w-28 mx-auto">
            {oppLogo && <img src={oppLogo} alt="" className="w-4 h-4 rounded-full object-cover" />}
            <div className="text-xs tracking-widest truncate" style={{ fontFamily: "sans-serif", color: C.sub }}>{oppName}</div>
          </div>
          <div className={small ? "text-5xl" : "text-7xl"} style={{ color: C.oppText, lineHeight: 1.1 }}>{opp}</div>
        </div>
      </div>
      {/* Q別スコアテーブル(試合詳細のみ・合計列なし) */}
      {!small && qScores && periods > 0 && (
        <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.border}44` }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "sans-serif" }}>
            <thead>
              <tr>
                <th style={{ width: "28%", fontSize: 9, color: C.sub, fontWeight: 400, textAlign: "left", paddingBottom: 3 }}></th>
                {Array.from({ length: periods }, (_, i) => (
                  <th key={i} style={{ fontSize: 9, color: C.sub, fontWeight: 400, textAlign: "center", paddingBottom: 3 }}>
                    {periodLabel2(game, i + 1)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontSize: 9, color: C.sub, fontFamily: "sans-serif", paddingRight: 4 }}>府中六小</td>
                {Array.from({ length: periods }, (_, i) => (
                  <td key={i} style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 16, textAlign: "center", color: C.led, lineHeight: 1.3 }}>
                    {qScores.own[i] || 0}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={{ fontSize: 9, color: C.sub, fontFamily: "sans-serif", paddingRight: 4 }}>{oppName}</td>
                {Array.from({ length: periods }, (_, i) => (
                  <td key={i} style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 16, textAlign: "center", color: C.oppText, lineHeight: 1.3 }}>
                    {qScores.opp[i] || 0}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Avatar({ p, size = 40 }) {
  const C = useC();
  return p?.photo ? (
    <img src={p.photo} alt="" className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />
  ) : (
    <div className="rounded-full flex items-center justify-center font-bold text-white shrink-0"
      style={{ width: size, height: size, background: C.card2, border: `1px solid ${C.border}`, fontSize: size * 0.38 }}>
      {p?.number ?? "?"}
    </div>
  );
}
function OppLogo({ o, size = 36 }) {
  const C = useC();
  return o?.logo ? (
    <img src={o.logo} alt="" className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />
  ) : (
    <div className="rounded-full flex items-center justify-center shrink-0 text-sm"
      style={{ width: size, height: size, background: C.card2, border: `1px solid ${C.border}` }}>🏀</div>
  );
}

/* ============ メイン ============ */
export default function App() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("home");
  const [nav, setNav] = useState({});
  const [saveState, setSaveState] = useState("");
  const timer = useRef(null);
  const pending = useRef(null);
  const retried = useRef(false);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("minibasket_theme") || "dark"; } catch { return "dark"; }
  });
  const CT = theme === "dark" ? DARK : LIGHT;
  C = CT;
  const isPC = useIsPC();
  const { isAdmin, login, logout } = useAdminMode();
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("minibasket_theme", next); } catch {}
  };
  const [showLogin, setShowLogin] = useState(false);
  const [loginInput, setLoginInput] = useState("");
  const [loginErr, setLoginErr] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  useEffect(() => { const t = setTimeout(() => setShowSplash(false), 1600); return () => clearTimeout(t); }, []);

  useEffect(() => {
    (async () => {
      let d = null;
      try {
        const json = await loadData();
        if (json) d = JSON.parse(json);
      } catch (e) { /* 初回 */ }
      const init = d || {
        team: { name: "府中六小ミニバス", logo: "", homeCourt: "府中第六小学校 体育館" },
        players: [], opponents: [], games: [],
      };
      init.games = (init.games || []).map(normGame);
      setData(init);
      const m = (window.location.hash || "").match(/game=([\w]+)/);
      if (m && init.games.some((g) => g.id === m[1])) { setTab("games"); setNav({ gameId: m[1] }); }
    })();
  }, []);

  const persist = async () => {
    const d = pending.current;
    if (!d) return;
    const str = JSON.stringify(d);
    if (str.length > STORAGE_LIMIT * 0.96) {
      setSaveState("error:容量が上限に近づいています。設定タブで使用量を確認してください。");
      return;
    }
    try {
      await saveData(JSON.parse(str));
      pending.current = null; retried.current = false;
      setSaveState("");
    } catch (e) {
      if (!retried.current) { retried.current = true; setTimeout(persist, 1500); }
      else { retried.current = false; setSaveState("error:保存に失敗しました。自動で再保存します。"); setTimeout(persist, 5000); }
    }
  };
  const save = (next) => {
    setData(next);
    pending.current = next;
    setSaveState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(persist, 700);
  };

  if (!data || showSplash) return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden"
      style={{ background: theme === "dark" ? "linear-gradient(155deg,#0A0E14 0%,#111824 100%)" : "linear-gradient(155deg,#EDF2FA 0%,#F8FAFE 100%)", color: CT.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
        @keyframes splashIn   { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:none} }
        @keyframes splashLine { from{width:0;opacity:0} to{width:110px;opacity:1} }
        @keyframes accentLine { from{height:0;opacity:0} to{height:60%;opacity:1} }
        @keyframes splashGlow { 0%,100%{opacity:.6} 50%{opacity:1} }
      `}</style>

      {/* 背景: U12を右側に斜め大きく(案C) */}
      <div className="absolute pointer-events-none select-none"
        style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: "clamp(160px,45vw,220px)",
          lineHeight: .85, letterSpacing: "-.02em",
          color: "transparent",
          WebkitTextStroke: theme === "dark" ? "1.5px rgba(200,169,110,0.22)" : "1.5px rgba(26,39,64,0.1)",
          top: "38%", right: "-5%", transform: "translateY(-50%) rotate(-8deg)",
          userSelect: "none" }}>
        U12
      </div>

      {/* 左縦アクセントライン */}
      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full"
        style={{ background: `linear-gradient(180deg,transparent,${CT.orange},transparent)`,
          animation: "accentLine 1s ease-out .2s both", height: "60%" }} />

      {/* 下部グロー */}
      <div className="absolute pointer-events-none"
        style={{ bottom: -30, left: "50%", transform: "translateX(-50%)",
          width: 220, height: 110, borderRadius: "50%",
          background: `rgba(232,96,42,${theme === "dark" ? "0.16" : "0.08"})`,
          filter: "blur(28px)", animation: "splashGlow 3s ease-in-out infinite" }} />

      {/* メインコンテンツ */}
      <div className="relative flex flex-col items-center px-8 w-full"
        style={{ animation: "splashIn .7s ease-out" }}>

        {/* バッジ */}
        <div className="mb-4 px-4 py-1 rounded text-white font-bold"
          style={{ background: CT.orange, fontFamily: "'Bebas Neue',sans-serif",
            fontSize: 11, letterSpacing: "0.28em" }}>
          FUCHUROKU MINIBASKET
        </div>

        {/* チーム名: 「府中六小」で改行 */}
        <div className="font-black text-center" style={{
          fontSize: "clamp(20px,5.5vw,28px)", letterSpacing: "0.02em", lineHeight: 1.3,
          color: theme === "dark" ? "#fff" : "#1A2740",
          textShadow: theme === "dark" ? "0 0 40px rgba(232,96,42,0.45), 0 2px 14px rgba(0,0,0,0.9)" : "none" }}>
          府中六小<br />ミニバスケットボールクラブ
        </div>

        {/* サブテキスト */}
        <div className="mt-2" style={{ fontSize: 10, letterSpacing: "0.18em",
          color: theme === "dark" ? "#4A6080" : "#8FA0C0" }}>
          TOKYO &nbsp;·&nbsp; MINIBASKETBALL TEAM
        </div>

        {/* 装飾ライン */}
        <div className="rounded-full my-4"
          style={{ height: 1.5,
            background: `linear-gradient(90deg,transparent,${CT.orange},transparent)`,
            animation: "splashLine 1s ease-out .3s both" }} />

        {/* GAME MANAGEMENT APP */}
        <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 17,
          color: "#8FA0C0", letterSpacing: "0.3em", paddingLeft: "0.3em" }}>
          GAME MANAGEMENT
        </div>
        <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 12,
          color: CT.orange, letterSpacing: "0.38em", paddingLeft: "0.38em", marginTop: 3,
          textShadow: theme === "dark" ? "0 0 10px rgba(232,96,42,0.6)" : "none" }}>
          APP
        </div>
      </div>

      {!data && <div className="absolute bottom-12 text-xs" style={{ color: CT.sub }}>読み込み中…</div>}
    </div>
  );

  const getOpp = (id) => data.opponents.find((o) => o.id === id);
  const oppName = (id) => getOpp(id)?.name || "対戦相手";
  const props = { data, save, nav, setNav, setTab, oppName, getOpp, isPC, isAdmin, theme, toggleTheme };

  const NAV_ITEMS = [
    { t: "home", icon: Home, label: "ホーム" },
    { t: "games", icon: ClipboardList, label: "試合" },
    { t: "players", icon: Users, label: "選手" },
    { t: "ranking", icon: Trophy, label: "ランキング" },
    ...(isAdmin ? [{ t: "settings", icon: Settings, label: "設定" }] : []),
  ];

  // ログインモーダル
  const loginModal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "#0008" }}>
      <div className="rounded-2xl p-6 w-72" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div className="font-bold text-lg mb-1">管理者ログイン</div>
        <div className="text-xs mb-4" style={{ color: C.sub }}>パスワードを入力してください</div>
        <input className="w-full rounded-xl px-3 py-2.5 text-base mb-2" style={getInputStyle(C)}
          type="password" placeholder="パスワード" value={loginInput}
          onChange={(e) => { setLoginInput(e.target.value); setLoginErr(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") { if (!login(loginInput)) setLoginErr(true); else { setShowLogin(false); setLoginInput(""); } } }} />
        {loginErr && <div className="text-xs mb-2" style={{ color: C.loss }}>パスワードが違います</div>}
        <div className="flex gap-2">
          <button className="flex-1 py-2.5 rounded-xl font-bold" style={{ border: `1px solid ${C.border}`, color: C.sub }}
            onClick={() => { setShowLogin(false); setLoginInput(""); setLoginErr(false); }}>キャンセル</button>
          <button className="flex-1 py-2.5 rounded-xl font-bold text-white" style={{ background: C.orange }}
            onClick={() => { if (!login(loginInput)) setLoginErr(true); else { setShowLogin(false); setLoginInput(""); } }}>ログイン</button>
        </div>
      </div>
    </div>
  );

  const mainContent = (
    <main className={isPC ? "flex-1 overflow-y-auto p-6" : "max-w-md mx-auto px-3 pt-3 pb-24"}>
      <div className={isPC ? "max-w-4xl mx-auto" : ""}>
        {tab === "home" && <Dashboard {...props} />}
        {tab === "games" && !nav.gameId && <GameList {...props} />}
        {tab === "games" && nav.gameId && <GameDetail {...props} />}
        {tab === "players" && !nav.playerId && <PlayerList {...props} />}
        {tab === "players" && nav.playerId && <PlayerKarte {...props} />}
        {tab === "ranking" && <Ranking {...props} />}
        {tab === "settings" && <SettingsScreen {...props} />}
      </div>
    </main>
  );

  return (
    <ThemeCtx.Provider value={CT}>
    <div className="min-h-screen" style={{ background: CT.bg, color: CT.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
        input::placeholder, textarea::placeholder { color: ${CT.sub}88; }
        select option { background: ${CT.inputBg}; color: ${CT.text}; }
        select { color-scheme: ${theme === "dark" ? "dark" : "light"}; }
        .play-btn { transition: transform .08s, background .15s, color .15s; -webkit-tap-highlight-color: transparent; }
        .play-btn:not(:disabled):active { transform: scale(0.92); background: var(--btn-col) !important; color: #fff !important; }
        @keyframes flashPop { 0% { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.9); } 15% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; } }
        .flash-toast { animation: flashPop 1.3s ease-out forwards; }
        @media print {
          body * { visibility: hidden; }
          .report-root, .report-root * { visibility: visible; }
          .report-root { position: absolute !important; inset: 0 !important; overflow: visible !important; }
          .no-print { display: none !important; }
        }
      `}</style>
      {showLogin && loginModal}

      {isPC ? (
        /* ============ PCレイアウト ============ */
        <div className="flex h-screen overflow-hidden">
          {/* サイドバー */}
          <aside className="w-56 shrink-0 flex flex-col" style={{ background: C.sidebar, borderRight: `1px solid ${C.border}` }}>
            {/* ロゴ */}
            <div className="px-5 py-5 flex items-center gap-3" style={{ borderBottom: `1px solid ${C.border}` }}>
              {data.team.logo
                ? <img src={data.team.logo} alt="" className="w-9 h-9 rounded-full object-cover" />
                : <span className="text-2xl">🏀</span>}
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm leading-tight truncate">{data.team.name}</div>
                <button className="text-[10px]" style={{ color: isAdmin ? C.win : C.sub }}
                  onClick={() => isAdmin ? logout() : setShowLogin(true)}>
                  {isAdmin ? "● 管理者" : "○ 閲覧モード"}
                </button>
              </div>
            </div>
            {/* ナビ */}
            <nav className="flex-1 py-3 space-y-1 px-2">
              {NAV_ITEMS.map(({ t, icon: I, label }) => (
                <button key={t} onClick={() => { setTab(t); setNav({}); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-colors"
                  style={tab === t ? { background: C.orange, color: "#fff" } : { color: C.sub }}>
                  <I size={18} />
                  {label}
                </button>
              ))}
            </nav>
            {/* 保存状態 + テーマ切替 */}
            <div className="px-4 py-3 text-xs flex items-center justify-between" style={{ color: saveState.startsWith("error") ? CT.loss : CT.sub, borderTop: `1px solid ${CT.border}` }}>
              <span>{saveState === "saving" ? "保存中…" : saveState.startsWith("error") ? saveState.slice(6) : "データ同期済み"}</span>
              <button onClick={toggleTheme} className="ml-2 px-2 py-1 rounded-lg text-xs font-bold"
                style={{ background: CT.card2, color: CT.sub }}>{theme === "dark" ? "☀️ ライト" : "🌙 ダーク"}</button>
            </div>
          </aside>
          {mainContent}
        </div>
      ) : (
        /* ============ スマホレイアウト ============ */
        <>
          <header className="sticky top-0 z-20 px-4 py-3 flex items-center gap-2.5 shadow-lg"
            style={{ background: CT.nav, borderBottom: `1px solid ${CT.border}` }}>
            {data.team.logo
              ? <img src={data.team.logo} alt="" className="w-8 h-8 rounded-full object-cover" />
              : <span className="text-xl">🏀</span>}
            <div className="font-bold truncate">{data.team.name}</div>
            <button onClick={toggleTheme} className="ml-auto text-lg px-1">{theme === "dark" ? "☀️" : "🌙"}</button>
            <button className="text-xs" style={{ color: isAdmin ? CT.win : CT.sub }}
              onClick={() => isAdmin ? logout() : setShowLogin(true)}>
              {isAdmin ? "管理者" : "閲覧"}
            </button>
            <span className="text-xs" style={{ color: saveState.startsWith("error") ? CT.loss : CT.sub }}>
              {saveState === "saving" ? "保存中…" : saveState.startsWith("error") ? saveState.slice(6) : ""}
            </span>
          </header>
          {mainContent}
          <nav className="fixed bottom-0 left-0 right-0 z-20 flex justify-around py-1.5"
            style={{ background: C.nav, borderTop: `1px solid ${C.border}` }}>
            {NAV_ITEMS.map(({ t, icon: I, label }) => (
              <button key={t} onClick={() => { setTab(t); setNav({}); }}
                className="flex flex-col items-center px-2 py-1" style={{ color: tab === t ? C.led : C.sub }}>
                <I size={20} />
                <span className="text-[10px] mt-0.5">{label}</span>
              </button>
            ))}
          </nav>
        </>
      )}
    </div>
    </ThemeCtx.Provider>
  );
}

/* ============ ダッシュボード ============ */
function Dashboard({ data, setTab, setNav, oppName, getOpp, isPC }) {
  const C = useC();
  const games = [...data.games].sort(gameOrderDesc);
  const results = games.map((g) => ({ g, ...gamePts(g) }));
  // 勝敗集計: 参考試合(countWL=false)を除外
  const wlResults = results.filter((r) => gameCatOf(r.g.category).countWL);
  const refCount = results.length - wlResults.length; // 参考試合数
  const w = wlResults.filter((r) => r.own > r.opp).length;
  const l = wlResults.filter((r) => r.own < r.opp).length;
  const n = wlResults.length;
  const avgPF = n ? wlResults.reduce((a, r) => a + r.own, 0) / n : 0;
  const avgPA = n ? wlResults.reduce((a, r) => a + r.opp, 0) / n : 0;
  const stars = useMemo(() => {
    // 直近5試合の平均EFFが高い順に上位5人(0-0の未入力試合は除外)
    const recent5 = [...data.games].filter((g) => { const p = gamePts(g); return (p.own + p.opp) > 0; }).sort(gameOrderDesc).slice(0, 5);
    if (recent5.length === 0) return [];
    const rows = [];
    for (const p of data.players) {
      const per = recent5.map((g) => aggStats(g.events, "own", p.id, "all", g)).filter((s) => hasStats(s));
      if (per.length === 0) continue;
      const avg = (k) => per.reduce((a, s) => a + s[k], 0) / per.length;
      rows.push({ p, avgEff: avg("eff"), avgPts: avg("pts"), avgAst: avg("ast"), avgReb: avg("reb"), n: per.length });
    }
    return rows.sort((a, b) => b.avgEff - a.avgEff).slice(0, 5);
  }, [data]);

  const recentGames = results.slice(0, isPC ? 5 : 3);

  return (
    <div className={isPC ? "grid grid-cols-2 gap-5" : "space-y-3"}>
      {/* 成績カード */}
      <Card className={isPC ? "col-span-2" : ""}>
        <SectionTitle>シーズン成績{refCount > 0 ? `(参考試合${refCount}試合を除く)` : ""}</SectionTitle>
        <div className="flex items-end justify-center gap-8 py-1" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
          <div className="text-center"><div className="text-7xl" style={{ color: C.win, lineHeight: 1 }}>{w}</div><div className="text-xs mt-1" style={{ fontFamily: "sans-serif", color: C.sub }}>勝</div></div>
          <div className="text-3xl pb-4" style={{ color: C.border }}>–</div>
          <div className="text-center"><div className="text-7xl" style={{ color: C.loss, lineHeight: 1 }}>{l}</div><div className="text-xs mt-1" style={{ fontFamily: "sans-serif", color: C.sub }}>敗</div></div>
        </div>
        <div className="flex justify-around text-center mt-2 pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
          <div><div className="text-2xl font-bold">{fmt1(avgPF)}</div><div className="text-xs" style={{ color: C.sub }}>平均得点</div></div>
          <div><div className="text-2xl font-bold">{fmt1(avgPA)}</div><div className="text-xs" style={{ color: C.sub }}>平均失点</div></div>
          <div><div className="text-2xl font-bold" style={{ color: avgPF - avgPA >= 0 ? C.win : C.loss }}>{(avgPF - avgPA >= 0 ? "+" : "") + fmt1(avgPF - avgPA)}</div><div className="text-xs" style={{ color: C.sub }}>得失点差</div></div>
        </div>
      </Card>

      {/* 注目選手(上位5人) */}
      {stars.length > 0 && (
        <Card className="h-full">
          <SectionTitle>注目選手(直近5試合の平均EFF)</SectionTitle>
          <div className="space-y-1">
            {stars.map((st, i) => (
              <button key={st.p.id} className="flex items-center gap-3 w-full text-left py-1.5"
                style={{ borderBottom: i < stars.length - 1 ? `1px solid ${C.border}44` : "none" }}
                onClick={() => { setTab("players"); setNav({ playerId: st.p.id }); }}>
                <span className="w-6 text-center text-xl font-bold" style={{ fontFamily: "'Bebas Neue', sans-serif", color: i < 3 ? C.led : C.sub }}>{i + 1}</span>
                <Avatar p={st.p} size={40} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold truncate">{st.p.codename || st.p.name}</div>
                  <div className="text-[10px] flex gap-2 mt-0.5" style={{ color: C.sub }}>
                    <span>得点 <b style={{ color: C.text }}>{fmt1(st.avgPts)}</b></span>
                    <span>AST <b style={{ color: C.text }}>{fmt1(st.avgAst)}</b></span>
                    <span>REB <b style={{ color: C.text }}>{fmt1(st.avgReb)}</b></span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-bold" style={{ color: i === 0 ? C.orange : C.text, fontFamily: "'Bebas Neue', sans-serif" }}>{fmt1(st.avgEff)}</div>
                  <div className="text-[10px]" style={{ color: C.sub }}>平均EFF</div>
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* 直近の試合 */}
      <Card className="h-full">
        <div className="flex items-center justify-between mb-2">
          <SectionTitle>直近の試合</SectionTitle>
          <button className="text-xs font-bold" style={{ color: C.orange }} onClick={() => setTab("games")}>すべて見る</button>
        </div>
        {recentGames.length === 0 ? (
          <div className="text-center text-sm py-8" style={{ color: C.sub }}>まだ試合がありません。「試合」タブから登録しましょう。</div>
        ) : (
          <div className="space-y-2">
            {recentGames.map(({ g, own, opp }) => {
              const cat = gameCatOf(g.category);
              return (
                <button key={g.id} className="w-full text-left" onClick={() => { setTab("games"); setNav({ gameId: g.id }); }}>
                  <div className="mb-1 px-1 text-xs flex items-center gap-1.5" style={{ color: C.sub }}>
                    <span className="font-bold px-1.5 py-0.5 rounded text-white text-[9px] shrink-0"
                      style={{ background: cat.color }}>{cat.badge}</span>
                    <span>{g.tournament || "練習試合"}{g.ot ? `・OT${g.ot}` : ""}</span>
                  </div>
                  <ScoreBoard small own={own} opp={opp} oppName={oppName(g.opponentId)} oppLogo={getOpp(g.opponentId)?.logo} date={g.date} />
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ============ 選手フォーム ============ */
function PlayerForm({ initial, onSave, onCancel }) {
  const C = useC();
  const [f, setF] = useState(initial || { name: "", codename: "", number: "", bibs: "", grade: "6", photo: "", goal: "", targets: [] });
  const set = (k, v) => setF({ ...f, [k]: v });
  const targets = f.targets || [];
  const setTarget = (i, k, v) => set("targets", targets.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  return (
    <Card>
      <SectionTitle>{initial ? "選手を編集" : "選手を追加"}</SectionTitle>
      <div className="flex items-center gap-3 mb-3">
        <Avatar p={f} size={56} />
        <label className="text-sm font-bold px-3 py-2 rounded-xl" style={{ border: `1px solid ${C.border}` }}>
          写真を選ぶ
          <input type="file" accept="image/*" className="hidden"
            onChange={(e) => { const file = e.target.files?.[0]; if (file) shrinkSquare(file, 96, (d) => set("photo", d)); }} />
        </label>
      </div>
      <Field label="名前(フルネーム)"><input className={inputCls} style={getInputStyle(C)} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="山田 太郎" /></Field>
      <Field label="コードネーム(試合入力時の表示名)"><input className={inputCls} style={getInputStyle(C)} value={f.codename} onChange={(e) => set("codename", e.target.value)} placeholder="タロー" /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="背番号"><input className={inputCls} style={getInputStyle(C)} inputMode="numeric" value={f.number} onChange={(e) => set("number", e.target.value)} placeholder="4" /></Field>
        <Field label="ビブスNo."><input className={inputCls} style={getInputStyle(C)} inputMode="numeric" value={f.bibs || ""} onChange={(e) => set("bibs", e.target.value)} placeholder="12" /></Field>
        <Field label="学年">
          <select className={inputCls} style={getInputStyle(C)} value={f.grade} onChange={(e) => set("grade", e.target.value)}>
            {[1,2,3,4,5,6].map((g) => <option key={g} value={g}>{g}年</option>)}
          </select>
        </Field>
      </div>
      <div className="text-xs mb-1" style={{ color: C.sub }}>目標(1試合平均・5つまで)</div>
      <div className="space-y-2 mb-2">
        {targets.map((t, i) => (
          <div key={i} className="flex gap-2 items-center">
            <select className="flex-1 rounded-xl px-2 py-2 text-sm" style={getInputStyle(C)} value={t.stat}
              onChange={(e) => setTarget(i, "stat", e.target.value)}>
              {STAT_DEFS.map((d) => <option key={d.k} value={d.k}>{d.label}{INVERSE_STATS.has(d.k) ? "(以下)" : ""}</option>)}
            </select>
            <input className="w-20 rounded-xl px-2 py-2 text-sm text-center" style={getInputStyle(C)} inputMode="decimal"
              value={t.value} onChange={(e) => setTarget(i, "value", e.target.value)} placeholder="10" />
            <button className="p-1.5" style={{ color: C.sub }} onClick={() => set("targets", targets.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
      {targets.length < 5 && (
        <button className="text-sm font-bold mb-3 flex items-center gap-1" style={{ color: C.orange }}
          onClick={() => set("targets", [...targets, { stat: "pts", value: "" }])}>
          <Plus size={14} /> 目標を追加
        </button>
      )}
      <Field label="目標メモ(自由記入)"><textarea className={inputCls} style={getInputStyle(C)} rows={2} value={f.goal} onChange={(e) => set("goal", e.target.value)} placeholder="声を出してチームを引っ張る" /></Field>
      <div className="flex gap-2 mt-1">
        <button className="flex-1 py-3 rounded-xl font-bold" style={{ border: `1px solid ${C.border}`, color: C.sub }} onClick={onCancel}>キャンセル</button>
        <button className="flex-1 py-3 rounded-xl text-white font-bold disabled:opacity-40" style={{ background: C.orange }}
          disabled={!f.name || !f.number} onClick={() => onSave({ ...f, targets: targets.filter((t) => t.value !== "") })}>保存する</button>
      </div>
    </Card>
  );
}

function PlayerList({ data, save, setNav, isPC, isAdmin }) {
  const C = useC();
  const [adding, setAdding] = useState(false);
  const players = [...data.players].sort((a, b) => (+a.number || 0) - (+b.number || 0));
  if (adding) return (
    <PlayerForm onCancel={() => setAdding(false)}
      onSave={(f) => { save({ ...data, players: [...data.players, { ...f, id: uid() }] }); setAdding(false); }} />
  );
  return (
    <div className="space-y-3">
      {isAdmin && <button onClick={() => setAdding(true)}
        className="w-full flex items-center justify-center gap-1 py-3 rounded-2xl font-bold text-white disabled:opacity-40" style={{ background: C.orange }}
        disabled={players.length >= MAX_PLAYERS}>
        <Plus size={18} /> 選手を追加 {players.length >= MAX_PLAYERS ? `(上限${MAX_PLAYERS}人)` : ""}
      </button>}
      {players.length === 0 && (
        <Card className="text-center text-sm py-8" style={{ color: C.sub }}>選手を登録すると、ここに一覧が表示されます。</Card>
      )}
      <div className={isPC ? "grid grid-cols-2 gap-3" : "space-y-2"}>
        {players.map((p) => {
          const c = careerStats(data.games, p.id);
          return (
            <button key={p.id} className="w-full" onClick={() => setNav({ playerId: p.id })}>
              <Card className="flex items-center gap-3 text-left">
                <Avatar p={p} size={44} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold truncate">{p.name}</div>
                  <div className="text-xs truncate" style={{ color: C.sub }}>#{p.number}{p.codename ? `・${p.codename}` : ""}{p.bibs ? `・ビブス${p.bibs}` : ""}・{p.grade}年</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold" style={{ color: C.orange, fontFamily: "'Bebas Neue', sans-serif" }}>{c.n ? fmt1(c.totAdj.pts / c.n) : "–"}</div>
                  <div className="text-[10px]" style={{ color: C.sub }}>平均得点</div>
                </div>
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlayerKarte({ data, save, nav, setNav, isAdmin }) {
  const C = useC();
  const p = data.players.find((x) => x.id === nav.playerId);
  const [editing, setEditing] = useState(false);
  const [trendStat, setTrendStat] = useState("eff"); // 推移グラフの表示項目
  const [selGame, setSelGame] = useState(null); // 推移とスタッツの連動用(選択中の試合id)
  const [effStat, setEffStat] = useState("fgp"); // 効率グラフ: FG% or FT%
  if (!p) return null;
  // 前後の選手ナビゲーション(背番号順)
  const sortedPlayers = [...data.players].sort((a, b) => (+a.number || 0) - (+b.number || 0));
  const curIdx = sortedPlayers.findIndex((x) => x.id === p.id);
  const prevPlayer = curIdx > 0 ? sortedPlayers[curIdx - 1] : null;
  const nextPlayer = curIdx < sortedPlayers.length - 1 ? sortedPlayers[curIdx + 1] : null;
  const games = [...data.games].sort(gameOrderAsc);
  const { per, n, tot, totAdj, gamesPlayed, totalQPlayed, baseQ } = careerStats(games, p.id);
  const hasVaryQ = per.some((x) => regQOf(x.g) !== 4); // Q数が混在しているか
  const oppNm = (g) => data.opponents.find((o) => o.id === g.opponentId)?.name || "対戦相手";
  // 推移グラフ: EFF/得点/アシスト/リバウンドから選択
  const TREND_OPTS = [
    { k: "eff", label: "EFF", color: "#3DBE7B" },
    { k: "pts", label: "得点", color: "#FF7A3D" },
    { k: "ast", label: "アシスト", color: "#5B9BD5" },
    { k: "reb", label: "リバウンド", color: "#FFB23E" },
  ];
  const trendOpt = TREND_OPTS.find((o) => o.k === trendStat);
  const chart = per.map((x, i) => ({ name: x.g.date?.slice(5) || `G${i + 1}`, value: x.s[trendStat], gid: x.g.id }));
  const trendAvg = chart.length > 0 ? chart.reduce((a, c) => a + (c.value || 0), 0) / chart.length : 0;
  // キャリアハイ(1試合の最高記録)
  const careerHigh = {};
  ["pts", "reb", "ast", "stl", "blk", "eff"].forEach((k) => {
    let best = null;
    for (const x of per) { if (best === null || x.s[k] > best.v) best = { v: x.s[k], g: x.g }; }
    careerHigh[k] = best;
  });
  const targets = (p.targets || []).filter((t) => t.value !== "");
  if (editing) return (
    <PlayerForm initial={p} onCancel={() => setEditing(false)}
      onSave={(f) => { save({ ...data, players: data.players.map((x) => x.id === p.id ? { ...x, ...f } : x) }); setEditing(false); }} />
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button className="flex items-center gap-1 text-sm font-bold" style={{ color: C.sub }} onClick={() => setNav({})}>
          <ChevronLeft size={16} /> 選手一覧
        </button>
        <div className="flex gap-3">
          {isAdmin && <button style={{ color: C.sub }} onClick={() => setEditing(true)}><Pencil size={18} /></button>}
          {isAdmin && <button style={{ color: C.sub }} onClick={() => {
            if (confirm(`「${p.name}」を削除しますか?`)) { save({ ...data, players: data.players.filter((x) => x.id !== p.id) }); setNav({}); }
          }}><Trash2 size={18} /></button>}
        </div>
      </div>
      {/* 前後の選手ナビ */}
      <div className="flex gap-2">
        <button className="flex-1 flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold truncate"
          style={{ background: C.card2, color: prevPlayer ? C.text : C.border }}
          disabled={!prevPlayer}
          onClick={() => prevPlayer && setNav({ playerId: prevPlayer.id })}>
          <ChevronLeft size={14} className="shrink-0" />
          <span className="truncate">{prevPlayer ? `#${prevPlayer.number} ${prevPlayer.codename || prevPlayer.name}` : "–"}</span>
        </button>
        <button className="flex-1 flex items-center justify-end gap-1 px-3 py-2 rounded-xl text-xs font-bold truncate"
          style={{ background: C.card2, color: nextPlayer ? C.text : C.border }}
          disabled={!nextPlayer}
          onClick={() => nextPlayer && setNav({ playerId: nextPlayer.id })}>
          <span className="truncate">{nextPlayer ? `#${nextPlayer.number} ${nextPlayer.codename || nextPlayer.name}` : "–"}</span>
          <ChevronDown size={14} className="shrink-0" style={{ transform: "rotate(-90deg)" }} />
        </button>
      </div>
      <Card>
        <div className="flex items-center gap-3">
          <Avatar p={p} size={64} />
          <div className="flex-1">
            <div className="text-xl font-bold">{p.name}</div>
            <div className="text-xs" style={{ color: C.sub }}>{p.codename ? `${p.codename}・` : ""}#{p.number}{p.bibs ? `・ビブス${p.bibs}` : ""}・{p.grade}年</div>
          </div>
        </div>
        {p.goal && (
          <div className="mt-3 flex items-start gap-2 text-sm rounded-xl p-3" style={{ background: C.card2 }}>
            <Target size={16} style={{ color: C.orange }} className="mt-0.5 shrink-0" />
            <div>{p.goal}</div>
          </div>
        )}
      </Card>
      {targets.length > 0 && (
        <Card>
          <SectionTitle>目標と実績(1試合平均)</SectionTitle>
          {n === 0 ? <div className="text-sm" style={{ color: C.sub }}>試合データが入ると達成度が表示されます。</div> : (
            <div className="space-y-3">
              {targets.map((t, i) => {
                const def = STAT_DEFS.find((d) => d.k === t.stat);
                const goal = +t.value || 0;
                const actual = n > 0 ? totAdj[t.stat] / n : 0;
                const inv = INVERSE_STATS.has(t.stat);
                const achieved = inv ? actual <= goal : actual >= goal;
                const ratio = inv ? (actual > 0 ? Math.min(1, goal / actual) : 1) : (goal > 0 ? Math.min(1, actual / goal) : 0);
                return (
                  <div key={i}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-bold">{def?.label}{inv ? "(以下)" : ""}</span>
                      <span>
                        <span className="font-bold text-lg" style={{ color: achieved ? C.win : C.text, fontFamily: "'Bebas Neue', sans-serif" }}>{fmt1(actual)}</span>
                        <span className="text-xs" style={{ color: C.sub }}> / 目標 {goal}</span>
                        {achieved && <span className="text-xs ml-1" style={{ color: C.win }}>達成!</span>}
                      </span>
                    </div>
                    <div className="h-2.5 rounded-full overflow-hidden" style={{ background: C.card2 }}>
                      <div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, background: achieved ? C.win : C.orange, transition: "width .4s" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
      <Card>
        <SectionTitle>通算成績({gamesPlayed}試合 / {totalQPlayed}Q)</SectionTitle>
        {hasVaryQ && n > 0 && <div className="text-[10px] mb-2" style={{ color: C.sub }}>※平均はQ数基準で算出(実施{totalQPlayed}Q ÷ 基準{baseQ}Q)。全試合4Q換算の平均値です。</div>}
        {n === 0 ? <div className="text-sm" style={{ color: C.sub }}>スタッツのある試合がまだありません。</div> : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[["得点", tot.pts, fmt1(totAdj.pts / n)],["リバウンド", tot.reb, fmt1(totAdj.reb / n)],["アシスト", tot.ast, fmt1(totAdj.ast / n)],["スティール", tot.stl, fmt1(totAdj.stl / n)],["EFF", tot.eff, fmt1(totAdj.eff / n)],["TO", tot.to, fmt1(totAdj.to / n)]].map(([l, t, a]) => (
                <div key={l} className="rounded-xl py-2.5" style={{ background: C.card2 }}>
                  <div className="text-2xl font-bold" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>{t}</div>
                  <div className="text-[10px]" style={{ color: C.sub }}>{l}(平均 {a})</div>
                </div>
              ))}
            </div>
            <div className="flex justify-around mt-3 pt-3 text-center text-sm" style={{ borderTop: `1px solid ${C.border}` }}>
              <div><span className="font-bold text-lg">{pct(tot.fgm, tot.fga)}</span><div className="text-[10px]" style={{ color: C.sub }}>FG%</div></div>
              <div><span className="font-bold text-lg">{pct(tot.ftm, tot.fta)}</span><div className="text-[10px]" style={{ color: C.sub }}>FT%</div></div>
              <div><span className="font-bold text-lg">{fmt1(totAdj.min / n)}</span><div className="text-[10px]" style={{ color: C.sub }}>平均出場(分)</div></div>
            </div>
            <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
              <div className="text-[10px] font-bold mb-2" style={{ color: C.led }}>🏅 キャリアハイ(1試合最高)</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[["得点", "pts"], ["リバウンド", "reb"], ["アシスト", "ast"], ["スティール", "stl"], ["ブロック", "blk"], ["EFF", "eff"]].map(([l, k]) => {
                  const ch = careerHigh[k];
                  return (
                    <div key={k} className="rounded-xl py-2" style={{ background: C.card2 }}>
                      <div className="text-xl font-bold" style={{ fontFamily: "'Bebas Neue', sans-serif", color: C.led }}>{ch ? ch.v : "–"}</div>
                      <div className="text-[10px]" style={{ color: C.sub }}>{l}</div>
                      {ch && <div className="text-[9px] truncate px-1" style={{ color: C.sub }}>vs {oppNm(ch.g)}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </Card>
      {n > 0 && (
        <Card>
          <SectionTitle>試合ごとの推移とスタッツ</SectionTitle>

          {/* ===== 上段: パフォーマンス推移 ===== */}
          <div className="text-[11px] font-bold mb-2 mt-1" style={{ color: C.sub }}>パフォーマンス推移</div>
          <div className="flex gap-1.5 mb-3">
            {TREND_OPTS.map((o) => (
              <button key={o.k} onClick={() => setTrendStat(o.k)}
                className="flex-1 py-2 rounded-lg text-xs font-bold"
                style={trendStat === o.k ? { background: o.color, color: "#fff" } : { border: `1px solid ${C.border}`, color: C.sub }}>
                {o.label}
              </button>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chart} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}
              onClick={(e) => { const pl = e?.activePayload?.[0]?.payload; if (pl) setSelGame(selGame === pl.gid ? null : pl.gid); }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="name" fontSize={10} stroke={C.sub} />
              <YAxis fontSize={10} allowDecimals={false} stroke={C.sub} />
              <Tooltip contentStyle={{ background: C.card2, border: `1px solid ${C.border}`, color: C.text }} />
              <ReferenceLine y={0} stroke={C.sub} strokeWidth={1.5} />
              <ReferenceLine y={trendAvg} stroke={trendOpt?.color} strokeDasharray="5 4" strokeWidth={1.5}
                label={{ value: `平均 ${fmt1(trendAvg)}`, position: "insideTopRight", fill: trendOpt?.color, fontSize: 10 }} />
              <Line type="monotone" dataKey="value" name={trendOpt?.label} stroke={trendOpt?.color} strokeWidth={2.5}
                dot={(props) => {
                  const active = props.payload.gid === selGame;
                  return <circle key={props.payload.gid} cx={props.cx} cy={props.cy} r={active ? 6 : 3}
                    fill={active ? C.led : trendOpt?.color} stroke={active ? "#fff" : "none"} strokeWidth={active ? 2 : 0} />;
                }} />
            </LineChart>
          </ResponsiveContainer>

          {/* ===== 下段: シュート効率 FG%/FT% タブ切り替え ===== */}
          {(() => {
            const EFF_OPTS = [
              { k: "fgp", label: "FG%", color: C.orange,   made: "fgm", att: "fga" },
              { k: "ftp", label: "FT%", color: C.oppBlue,  made: "ftm", att: "fta" },
            ];
            const eo = EFF_OPTS.find((o) => o.k === effStat);
            const effChart = per.map((x, i) => ({
              name: x.g.date?.slice(5) || `G${i + 1}`,
              gid: x.g.id,
              val: x.s[eo.att] > 0 ? Math.round((x.s[eo.made] / x.s[eo.att]) * 1000) / 10 : null,
              att: x.s[eo.att],
            }));
            const vals = effChart.map((d) => d.val).filter((v) => v !== null);
            const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : null;
            const hasData = vals.length > 0;
            return (
              <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.border}` }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] font-bold" style={{ color: C.sub }}>シュート効率</div>
                  {/* FG% / FT% タブ */}
                  <div className="flex rounded-lg overflow-hidden text-xs font-bold" style={{ border: `1px solid ${C.border}` }}>
                    {EFF_OPTS.map((o) => (
                      <button key={o.k} onClick={() => setEffStat(o.k)} className="px-4 py-1.5"
                        style={effStat === o.k ? { background: o.color, color: "#fff" } : { background: C.card, color: C.sub }}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                {!hasData ? (
                  <div className="text-xs text-center py-6" style={{ color: C.sub }}>
                    {eo.label}の試投記録がまだありません。
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={effChart} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}
                      onClick={(e) => { const pl = e?.activePayload?.[0]?.payload; if (pl) setSelGame(selGame === pl.gid ? null : pl.gid); }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                      <XAxis dataKey="name" fontSize={10} stroke={C.sub} />
                      <YAxis domain={[0, 100]} fontSize={10} stroke={C.sub} tickFormatter={(v) => `${v}%`} />
                      <Tooltip contentStyle={{ background: C.card2, border: `1px solid ${C.border}`, color: C.text }}
                        formatter={(val, _, props) => val !== null
                          ? [`${val}% (${props.payload.att}本中)`, eo.label]
                          : ["試投なし", eo.label]} />
                      {avg !== null && (
                        <ReferenceLine y={avg} stroke={eo.color} strokeDasharray="5 4" strokeWidth={1.5}
                          label={{ value: `平均 ${fmt1(avg)}%`, position: "insideTopRight", fill: eo.color, fontSize: 10 }} />
                      )}
                      <Line type="monotone" dataKey="val" name={eo.label} stroke={eo.color} strokeWidth={2.5} connectNulls
                        dot={(props) => {
                          if (props.payload.val === null) return null;
                          const active = props.payload.gid === selGame;
                          return <circle key={`eff-${props.payload.gid}`} cx={props.cx} cy={props.cy}
                            r={active ? 6 : 3} fill={active ? C.led : eo.color}
                            stroke={active ? "#fff" : "none"} strokeWidth={active ? 2 : 0} />;
                        }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
                <div className="text-[10px] mt-1" style={{ color: C.sub }}>
                  ※試投なし(0本)の試合は折れ線に表示されません。ツールチップで試投本数も確認できます。
                </div>
              </div>
            );
          })()}

          <div className="text-[10px] text-center my-3" style={{ color: C.sub }}>グラフの点や下の表をタップすると、その試合が連動してハイライトされます</div>
          <div className="overflow-x-auto -mx-1">
            <table className="text-xs w-full min-w-[700px]">
              <thead><tr style={{ color: C.sub, borderBottom: `1px solid ${C.border}` }}>
                {["日付","対戦相手","得点","REB","AST","STL","BLK","TO","PF","分","+/-","EFF","FG%","FT%"].map((h) => <th key={h} className="py-1.5 px-1 text-left whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody>
                {[...per].reverse().map(({ g, s }) => {
                  const active = g.id === selGame;
                  return (
                    <tr key={g.id} onClick={() => setSelGame(active ? null : g.id)}
                      style={{ borderBottom: `1px solid ${C.border}44`, background: active ? `${C.led}22` : "transparent", cursor: "pointer" }}>
                      <td className="py-1.5 px-1 whitespace-nowrap" style={active ? { fontWeight: 700, color: C.led } : {}}>{g.date?.slice(5)}</td>
                      <td className="px-1 whitespace-nowrap truncate" style={{ color: C.sub, maxWidth: 90 }}>{oppNm(g)}</td>
                      <td className="px-1 font-bold" style={{ color: C.orange }}>{s.pts}</td><td className="px-1">{s.reb}</td>
                      <td className="px-1">{s.ast}</td><td className="px-1">{s.stl}</td><td className="px-1">{s.blk}</td>
                      <td className="px-1">{s.to}</td><td className="px-1">{s.pf}</td><td className="px-1">{s.min}</td>
                      <td className="px-1" style={{ color: s.pm === null ? C.sub : s.pm >= 0 ? C.win : C.loss }}>{s.pm === null ? "–" : (s.pm >= 0 ? "+" : "") + s.pm}</td>
                      <td className="px-1 font-bold">{s.eff}</td>
                      <td className="px-1" style={{ color: C.orange }}>{s.fga > 0 ? `${pct(s.fgm, s.fga)}` : "–"}</td>
                      <td className="px-1" style={{ color: C.oppBlue }}>{s.fta > 0 ? `${pct(s.ftm, s.fta)}` : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ============ 試合フォーム ============ */
function GameForm({ data, initial, onSave, onCancel }) {
  const C = useC();
  const [f, setF] = useState(initial ? { ...normGame(initial), newOpp: "" } : {
    date: new Date().toISOString().slice(0, 10), tournament: "",
    opponentId: data.opponents[0]?.id || "", newOpp: "",
    qLen: 6, otLen: 3, ot: 0, regQ: 4, category: "practice",
    qScores: { own: padQ([]), opp: padQ([]) },
  });
  const periods = (+f.regQ || 4) + (+f.ot || 0);
  const setQ = (side, i, v) => setF({ ...f, qScores: { ...f.qScores, [side]: f.qScores[side].map((x, j) => (j === i ? v : x)) } });
  const oppFull = !f.opponentId && data.opponents.length >= MAX_OPPONENTS;
  // 同じ日の試合数(自分以外)
  const sameDayGames = data.games.filter((x) => x.date === f.date && x.id !== initial?.id);

  const handleSave = () => {
    // Qが減る方向への変更で、削除されるQにデータがある場合は確認してクリア
    const wasRegQ = initial ? regQOf(initial) : 4;
    const newRegQ = +f.regQ || 4;
    if (wasRegQ > newRegQ) {
      // 削除されるQ(newRegQ+1 〜 wasRegQ)にデータがあるか確認
      const removedQs = Array.from({ length: wasRegQ - newRegQ }, (_, i) => newRegQ + 1 + i);
      const hasScore = removedQs.some((q) => (+f.qScores?.own?.[q - 1] || 0) + (+f.qScores?.opp?.[q - 1] || 0) > 0);
      const hasEvents = removedQs.some((q) => (initial?.events || []).some((e) => e.q === q));
      if (hasScore || hasEvents) {
        const qLabels = removedQs.map((q) => `Q${q}`).join("・");
        const msg = `${newRegQ}ピリオド制に変更すると、${qLabels}のデータが削除されます。よろしいですか?`;
        if (!confirm(msg)) return;
        // 削除されるQのスコア・イベント・ラインナップをクリア
        const own = [...f.qScores.own]; const opp = [...f.qScores.opp];
        removedQs.forEach((q) => { own[q - 1] = ""; opp[q - 1] = ""; });
        const cleared = { ...f, qScores: { own, opp }, _clearQs: removedQs };
        onSave(cleared);
        return;
      }
    }
    onSave(f);
  };
  return (
    <Card>
      <SectionTitle>{initial ? "試合情報を編集" : "試合を登録"}</SectionTitle>
      <Field label="日付"><input type="date" className={inputCls} style={getInputStyle(C)} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      {sameDayGames.length > 0 && (
        <Field label={`同じ日の試合順(この日は他に${sameDayGames.length}試合あります。小さい番号が先)`}>
          <input className={inputCls} style={getInputStyle(C)} inputMode="numeric" value={f.order ?? ""}
            onChange={(e) => setF({ ...f, order: e.target.value === "" ? "" : +e.target.value })} placeholder="例: 1, 2, 3..." />
        </Field>
      )}
      <Field label="大会名"><input className={inputCls} style={getInputStyle(C)} value={f.tournament} onChange={(e) => setF({ ...f, tournament: e.target.value })} placeholder="市民大会 予選リーグ" /></Field>
      <Field label="試合区分">
        <div className="flex gap-2">
          {GAME_CATS.map((c) => (
            <button key={c.k} type="button" className="flex-1 py-2.5 rounded-xl text-xs font-bold"
              onClick={() => setF({ ...f, category: c.k })}
              style={f.category === c.k ? { background: c.color, color: "#fff" } : { border: `1px solid ${C.border}`, color: C.sub }}>
              {c.label}
            </button>
          ))}
        </div>
        {f.category === "ref" && <div className="text-[10px] mt-1" style={{ color: C.sub }}>※参考試合はスタッツを記録しますが、勝敗集計には含まれません。</div>}
      </Field>
      <Field label="対戦相手">
        <select className={inputCls} style={getInputStyle(C)} value={f.opponentId} onChange={(e) => setF({ ...f, opponentId: e.target.value })}>
          <option value="">(新しいチームを入力)</option>
          {[...data.opponents].sort((a, b) => nameCompare(a.name, b.name)).map((o) => <option key={o.id} value={o.id}>{o.name}{o.area ? `(${o.area})` : ""}</option>)}
        </select>
      </Field>
      {!f.opponentId && (!oppFull
        ? <Field label="新しい相手チーム名"><input className={inputCls} style={getInputStyle(C)} value={f.newOpp} onChange={(e) => setF({ ...f, newOpp: e.target.value })} placeholder="◯◯ミニバス" /></Field>
        : <div className="text-xs mb-3" style={{ color: C.loss }}>対戦相手の登録上限({MAX_OPPONENTS}チーム)に達しています。</div>)}
      <Field label="試合形式">
        <select className={inputCls} style={getInputStyle(C)} value={f.regQ} onChange={(e) => setF({ ...f, regQ: +e.target.value })}>
          <option value={4}>4ピリオド制(通常)</option>
          <option value={3}>3ピリオド制</option>
          <option value={2}>2ピリオド制</option>
        </select>
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Qの時間">
          <select className={inputCls} style={getInputStyle(C)} value={f.qLen} onChange={(e) => setF({ ...f, qLen: +e.target.value })}>
            <option value={5}>5分</option><option value={6}>6分</option>
          </select>
        </Field>
        <Field label="オーバータイム">
          <select className={inputCls} style={getInputStyle(C)} value={f.ot} onChange={(e) => setF({ ...f, ot: +e.target.value })}>
            <option value={0}>なし</option><option value={1}>OT1まで</option><option value={2}>OT2まで</option>
          </select>
        </Field>
        <Field label="OTの時間">
          <select className={inputCls} style={getInputStyle(C)} value={f.otLen} disabled={!f.ot} onChange={(e) => setF({ ...f, otLen: +e.target.value })}>
            <option value={2}>2分</option><option value={3}>3分</option>
          </select>
        </Field>
      </div>
      <div className="text-xs mb-1" style={{ color: C.sub }}>ピリオド別スコア</div>
      <div className="overflow-x-auto">
        <div className="grid items-center text-center text-sm mb-3 gap-1.5" style={{ gridTemplateColumns: `64px repeat(${periods}, 1fr)`, minWidth: periods > 4 ? 360 : 0 }}>
          <div></div>{Array.from({ length: periods }, (_, i) => <div key={i} className="text-xs" style={{ color: C.sub }}>{periodLabel2(f, i + 1)}</div>)}
          <div className="text-xs font-bold">自チーム</div>
          {Array.from({ length: periods }, (_, i) => <input key={i} inputMode="numeric" className="rounded-lg py-2 text-center w-full" style={getInputStyle(C)} value={f.qScores.own[i]} onChange={(e) => setQ("own", i, e.target.value)} />)}
          <div className="text-xs font-bold">相手</div>
          {Array.from({ length: periods }, (_, i) => <input key={i} inputMode="numeric" className="rounded-lg py-2 text-center w-full" style={getInputStyle(C)} value={f.qScores.opp[i]} onChange={(e) => setQ("opp", i, e.target.value)} />)}
        </div>
      </div>
      <div className="flex gap-2">
        <button className="flex-1 py-3 rounded-xl font-bold" style={{ border: `1px solid ${C.border}`, color: C.sub }} onClick={onCancel}>キャンセル</button>
        <button className="flex-1 py-3 rounded-xl text-white font-bold disabled:opacity-40" style={{ background: C.orange }}
          disabled={!f.date || (!f.opponentId && (!f.newOpp || oppFull))} onClick={handleSave}>保存する</button>
      </div>
    </Card>
  );
}

/* ============ 試合一覧 ============ */
function GameRow({ g, setNav, showOpp, oppName }) {
  const C = useC();
  const { own, opp } = gamePts(g);
  const cat = gameCatOf(g.category);
  return (
    <button className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
      style={{ background: C.card2 }} onClick={() => setNav({ gameId: g.id })}>
      <span className="text-xs w-20 text-left shrink-0" style={{ color: C.sub }}>{g.date}</span>
      {/* 区分バッジ(参考試合のみ表示) */}
      {cat.k === "ref" && (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{ background: cat.color, color: "#fff" }}>{cat.badge}</span>
      )}
      <span className="flex-1 text-left text-xs truncate" style={{ color: C.sub }}>
        {showOpp && oppName ? oppName(g.opponentId) : (g.tournament || "練習試合")}
      </span>
      <span className="font-bold text-lg" style={{ fontFamily: "'Bebas Neue', sans-serif", color: own > opp ? C.win : own < opp ? C.loss : C.sub }}>{own}-{opp}</span>
    </button>
  );
}

function GameList({ data, save, setNav, oppName, getOpp, isPC, isAdmin }) {
  const C = useC();
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState("list");
  const [openKey, setOpenKey] = useState(null);
  const [catFilter, setCatFilter] = useState("all"); // カテゴリーフィルター
  const games = [...data.games].sort(gameOrderDesc);
  // カテゴリーフィルター適用後の試合一覧
  const filteredGames = catFilter === "all" ? games : games.filter((g) => (g.category || "practice") === catFilter);
  const results = filteredGames.map((g) => ({ g, ...gamePts(g) }));
  if (adding) return (
    <GameForm data={data} onCancel={() => setAdding(false)}
      onSave={(f) => {
        let oppId = f.opponentId, opponents = data.opponents;
        if (!oppId) { oppId = uid(); opponents = [...opponents, { id: oppId, name: f.newOpp, area: "", numbers: "", logo: "" }]; }
        const g = normGame({ id: uid(), date: f.date, tournament: f.tournament, opponentId: oppId, qLen: f.qLen, otLen: f.otLen, ot: f.ot, regQ: f.regQ, order: +f.order || 0, category: f.category || "practice", qScores: f.qScores, events: [] });
        save({ ...data, opponents, games: [...data.games, g] });
        setAdding(false); setNav({ gameId: g.id });
      }} />
  );
  const wld = (gs) => { const rs = gs.map((g) => gamePts(g)); return { w: rs.filter((r) => r.own > r.opp).length, l: rs.filter((r) => r.own < r.opp).length, d: rs.filter((r) => r.own === r.opp).length }; };
  const byOpp = data.opponents.map((o) => ({ o, gs: filteredGames.filter((g) => g.opponentId === o.id) })).filter((x) => x.gs.length > 0).sort((a, b) => nameCompare(a.o.name, b.o.name));
  const tourNames = [...new Set(filteredGames.map((g) => g.tournament || "練習試合"))];
  const byTour = tourNames.map((t) => ({ t, gs: filteredGames.filter((g) => (g.tournament || "練習試合") === t) })).sort((a, b) => (b.gs[0]?.date || "").localeCompare(a.gs[0]?.date || ""));
  const WL = ({ gs }) => {
    const { w, l, d } = wld(gs);
    return (
      <div className="text-right shrink-0" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
        <span className="text-3xl" style={{ color: C.win }}>{w}</span>
        <span className="text-lg mx-1" style={{ color: C.sub }}>勝</span>
        <span className="text-3xl" style={{ color: C.loss }}>{l}</span>
        <span className="text-lg ml-1" style={{ color: C.sub }}>敗</span>
        {d > 0 && <span className="text-sm ml-1" style={{ color: C.sub, fontFamily: "sans-serif" }}>({d}分)</span>}
      </div>
    );
  };
  return (
    <div className="space-y-3">
      {isAdmin && <button onClick={() => setAdding(true)}
        className="w-full flex items-center justify-center gap-1 py-3 rounded-2xl font-bold text-white disabled:opacity-40" style={{ background: C.orange }}
        disabled={games.length >= MAX_GAMES}>
        <Plus size={18} /> 試合を登録 {games.length >= MAX_GAMES ? `(上限${MAX_GAMES}試合)` : ""}
      </button>}

      {/* カテゴリーフィルタータブ */}
      <div className="flex gap-1.5">
        <button className="flex-1 py-2 rounded-xl text-xs font-bold"
          style={catFilter === "all" ? { background: C.text, color: C.bg } : { border: `1px solid ${C.border}`, color: C.sub }}
          onClick={() => { setCatFilter("all"); setOpenKey(null); }}>
          全て ({games.length})
        </button>
        {GAME_CATS.map((c) => {
          const cnt = games.filter((g) => (g.category || "practice") === c.k).length;
          return (
            <button key={c.k} className="flex-1 py-2 rounded-xl text-xs font-bold"
              style={catFilter === c.k ? { background: c.color, color: "#fff" } : { border: `1px solid ${C.border}`, color: C.sub }}
              onClick={() => { setCatFilter(c.k); setOpenKey(null); }}>
              {c.label} ({cnt})
            </button>
          );
        })}
      </div>

      {/* 相手レベル別・府中市内の成績: 全てタブのみ・公式戦のみ集計 */}
      {catFilter === "all" && games.length > 0 && (() => {
        // 公式戦のみ集計
        const officialResults = games.map((g) => ({ g, ...gamePts(g) })).filter((r) => (r.g.category || "practice") === "official");
        const wldOf2 = (rs) => ({ w: rs.filter((r) => r.own > r.opp).length, l: rs.filter((r) => r.own < r.opp).length, d: rs.filter((r) => r.own === r.opp).length });
        const fuchuRs = officialResults.filter((r) => (getOpp(r.g.opponentId)?.area || "").includes("府中"));
        const fuchu2 = wldOf2(fuchuRs);
        const tierStats2 = TIERS.map((t) => {
          const rs = officialResults.filter((r) => getOpp(r.g.opponentId)?.tier === t.k);
          return { t, ...wldOf2(rs), n: rs.length, rs };
        });
        return (
          <Card>
            <div className="flex items-center justify-between mb-2">
              <SectionTitle>相手レベル別の成績</SectionTitle>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: GAME_CATS[0].color, color: "#fff" }}>公式戦のみ</span>
            </div>
            {/* 府中市内 */}
            <button className="w-full flex items-center gap-3 pb-3 text-left" style={{ borderBottom: `1px solid ${C.border}` }}
              onClick={() => setOpenKey(openKey === "fuchu" ? null : "fuchu")}>
              <img src="data:image/jpeg;base64,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" alt="府中市" className="w-9 h-9 rounded-full object-cover shrink-0" />
              <div className="flex-1">
                <div className="font-bold text-sm">府中市内のチーム</div>
                <div className="text-[10px]" style={{ color: C.sub }}>{fuchuRs.length}試合</div>
              </div>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
                <span className="text-2xl" style={{ color: C.win }}>{fuchu2.w}</span>
                <span className="text-xs mx-0.5" style={{ color: C.sub }}>勝</span>
                <span className="text-2xl" style={{ color: C.loss }}>{fuchu2.l}</span>
                <span className="text-xs ml-0.5" style={{ color: C.sub }}>敗</span>
                {fuchu2.d > 0 && <span className="text-[10px] ml-1" style={{ color: C.sub, fontFamily: "sans-serif" }}>({fuchu2.d}分)</span>}
              </div>
              <ChevronDown size={16} style={{ color: C.sub, transform: openKey === "fuchu" ? "rotate(180deg)" : "none" }} />
            </button>
            {openKey === "fuchu" && (
              <div className="py-2 space-y-2">
                {fuchuRs.length === 0 ? <div className="text-xs" style={{ color: C.sub }}>対戦なし</div>
                  : fuchuRs.map((r) => <GameRow key={r.g.id} g={r.g} setNav={setNav} showOpp oppName={oppName} />)}
              </div>
            )}
            {/* Tier別 */}
            <div className="space-y-2 mt-3">
              {tierStats2.map(({ t, w, l, d, n, rs }) => (
                <div key={t.k}>
                  <button className="w-full flex items-center gap-3 text-left py-1"
                    onClick={() => n > 0 && setOpenKey(openKey === t.k ? null : t.k)}>
                    <span className="text-xs font-bold px-2 py-1 rounded text-white shrink-0 w-7 text-center" style={{ background: t.color }}>{t.k}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold">{t.desc}</div>
                      {n > 0 && (
                        <div className="h-1.5 rounded-full overflow-hidden mt-1 flex" style={{ background: C.card2 }}>
                          <div style={{ width: `${(w / n) * 100}%`, background: C.win }} />
                          <div style={{ width: `${(d / n) * 100}%`, background: C.sub }} />
                          <div style={{ width: `${(l / n) * 100}%`, background: C.loss }} />
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
                      {n === 0 ? <span className="text-xs" style={{ color: C.sub, fontFamily: "sans-serif" }}>対戦なし</span> : (
                        <>
                          <span className="text-lg" style={{ color: C.win }}>{w}</span>
                          <span className="text-[10px]" style={{ color: C.sub }}>勝</span>
                          <span className="text-lg ml-1" style={{ color: C.loss }}>{l}</span>
                          <span className="text-[10px]" style={{ color: C.sub }}>敗</span>
                          {d > 0 && <span className="text-[10px] ml-1" style={{ color: C.sub, fontFamily: "sans-serif" }}>({d}分)</span>}
                        </>
                      )}
                    </div>
                    {n > 0 && <ChevronDown size={16} style={{ color: C.sub, transform: openKey === t.k ? "rotate(180deg)" : "none" }} />}
                  </button>
                  {openKey === t.k && n > 0 && (
                    <div className="py-2 space-y-2 pl-9">
                      {rs.map((r) => <GameRow key={r.g.id} g={r.g} setNav={setNav} showOpp oppName={oppName} />)}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="text-[10px] mt-2" style={{ color: C.sub }}>Tierは設定タブの対戦相手登録で設定できます。各行をタップで対戦相手を表示。</div>
          </Card>
        );
      })()}
      <Seg items={[["list", "試合一覧"], ["byTour", "大会別"], ["byOpp", "相手別"]]} value={mode} onChange={(m) => { setMode(m); setOpenKey(null); }} />
      {mode === "list" && (
        <div className={isPC ? "grid grid-cols-2 gap-3" : "space-y-2"}>
          {filteredGames.length === 0 && <Card className="text-center text-sm py-8 col-span-2" style={{ color: C.sub }}>{catFilter === "all" ? "試合を登録すると、ここに一覧が表示されます。" : `${gameCatOf(catFilter).label}の試合はまだありません。`}</Card>}
          {filteredGames.map((g) => {
            const { own, opp } = gamePts(g);
            const cat = gameCatOf(g.category);
            return (
              <button key={g.id} className="w-full text-left" onClick={() => setNav({ gameId: g.id })}>
                <div className="mb-1 px-1 text-xs flex items-center gap-1.5" style={{ color: C.sub }}>
                  {catFilter === "all" && cat.k !== "practice" && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white" style={{ background: cat.color }}>{cat.badge}</span>
                  )}
                  <span>{g.tournament || "練習試合"}{g.ot ? `・OT${g.ot}` : ""}</span>
                </div>
                <ScoreBoard small own={own} opp={opp} oppName={oppName(g.opponentId)} oppLogo={getOpp(g.opponentId)?.logo} date={g.date} />
              </button>
            );
          })}
        </div>
      )}
      {mode === "byTour" && (
        <div className="space-y-2">
          {byTour.length === 0 && <Card className="text-center text-sm py-8" style={{ color: C.sub }}>試合を登録すると大会別に表示されます。</Card>}
          {byTour.map(({ t, gs }) => (
            <Card key={t}>
              <button className="w-full flex items-center gap-2.5 text-left" onClick={() => setOpenKey(openKey === t ? null : t)}>
                <Trophy size={20} style={{ color: C.led }} className="shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-bold truncate">{t}</div>
                  <div className="text-xs" style={{ color: C.sub }}>{gs.length}試合</div>
                </div>
                <WL gs={gs} />
                <ChevronDown size={18} style={{ color: C.sub, transform: openKey === t ? "rotate(180deg)" : "none" }} />
              </button>
              {openKey === t && <div className="mt-3 space-y-2">{gs.map((g) => <GameRow key={g.id} g={g} setNav={setNav} showOpp oppName={oppName} />)}</div>}
            </Card>
          ))}
        </div>
      )}
      {mode === "byOpp" && (
        <div className="space-y-2">
          {byOpp.length === 0 && <Card className="text-center text-sm py-8" style={{ color: C.sub }}>試合のある対戦相手がまだありません。</Card>}
          {byOpp.map(({ o, gs }) => (
            <Card key={o.id}>
              <button className="w-full flex items-center gap-2.5 text-left" onClick={() => setOpenKey(openKey === o.id ? null : o.id)}>
                <OppLogo o={o} size={40} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold truncate">{o.name}</div>
                  <div className="text-xs" style={{ color: C.sub }}>{o.area ? `${o.area}・` : ""}{gs.length}試合</div>
                </div>
                <WL gs={gs} />
                <ChevronDown size={18} style={{ color: C.sub, transform: openKey === o.id ? "rotate(180deg)" : "none" }} />
              </button>
              {openKey === o.id && <div className="mt-3 space-y-2">{gs.map((g) => <GameRow key={g.id} g={g} setNav={setNav} />)}</div>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ 試合詳細 ============ */
function GameDetail({ data, save, nav, setNav, oppName, getOpp, isAdmin }) {
  const C = useC();
  const g = data.games.find((x) => x.id === nav.gameId);
  const [sub, setSub] = useState(isAdmin ? "entry" : "analysis");
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [report, setReport] = useState(null);
  if (!g) return null;
  const { own, opp } = gamePts(g);
  const mips = mipOf(g, data.players);
  const copyLink = async () => {
    const url = window.location.href.split("#")[0] + "#game=" + g.id;
    try { await navigator.clipboard.writeText(url); } catch (e) { prompt("このリンクをコピーしてください", url); }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  if (report) return <ReportView data={data} game={g} mode={report} oppName={oppName} onClose={() => setReport(null)} />;
  if (editing) return (
    <GameForm data={data} initial={g} onCancel={() => setEditing(false)}
      onSave={(f) => {
        save({ ...data, games: data.games.map((x) => x.id === g.id ? normGame({ ...x, date: f.date, tournament: f.tournament, opponentId: f.opponentId || x.opponentId, qLen: f.qLen, otLen: f.otLen, ot: f.ot, regQ: f.regQ, order: +f.order || 0, category: f.category || "practice", qScores: f.qScores, events: f._clearQs ? (x.events || []).filter((e) => !f._clearQs.includes(e.q)) : x.events, lineups: f._clearQs ? Object.fromEntries(Object.entries(x.lineups || {}).filter(([k]) => !f._clearQs.includes(+k))) : x.lineups }) : x) });
        setEditing(false);
      }} />
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button className="flex items-center gap-1 text-sm font-bold" style={{ color: C.sub }} onClick={() => setNav({})}>
          <ChevronLeft size={16} /> 試合一覧
        </button>
        <div className="flex items-center gap-3">
          {copied && <span className="text-xs" style={{ color: C.win }}>コピーしました</span>}
          <button style={{ color: C.sub }} onClick={copyLink}><Link2 size={18} /></button>
          {isAdmin && <button style={{ color: C.sub }} onClick={() => setEditing(true)}><Pencil size={18} /></button>}
          {isAdmin && <button style={{ color: C.sub }} onClick={() => {
            if (confirm("この試合を削除しますか?")) { save({ ...data, games: data.games.filter((x) => x.id !== g.id) }); setNav({}); }
          }}><Trash2 size={18} /></button>}
        </div>
      </div>
      <div className="px-1 text-xs" style={{ color: C.sub }}>{g.tournament || "練習試合"}{g.ot ? `・OT${g.ot}(${g.otLen}分)` : ""}・Q{g.qLen}分</div>
      <ScoreBoard own={own} opp={opp} oppName={oppName(g.opponentId)} oppLogo={getOpp(g.opponentId)?.logo} date={g.date} qScores={g.qScores} periods={periodsOf(g)} game={g} />
      {mips.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl flex-wrap" style={{ background: C.card, border: `1px solid ${C.led}55` }}>
          <Award size={18} style={{ color: C.led }} />
          <span className="text-xs font-bold" style={{ color: C.led }}>MIP</span>
          {mips.map(({ p, s }) => <span key={p.id} className="text-sm font-bold">#{p.number} {p.codename || p.name}<span className="text-xs font-normal" style={{ color: C.sub }}> (EFF {s.eff})</span></span>)}
        </div>
      )}
      <div className="flex rounded-xl overflow-hidden text-sm font-bold" style={{ border: `1px solid ${C.border}` }}>
        {[...(isAdmin ? [["entry", "入力"]] : []), ["analysis", "概要"], ["media", "メディア"]].map(([k, l]) => (
          <button key={k} className="flex-1 py-2.5" onClick={() => setSub(k)}
            style={sub === k ? { background: C.orange, color: "#fff" } : { background: C.card, color: C.sub }}>{l}</button>
        ))}
      </div>
      {sub === "entry" && isAdmin && <PlayByPlay data={data} save={save} game={g} oppName={oppName} isAdmin={isAdmin} />}
      {sub === "analysis" && <GameAnalysis data={data} save={save} game={g} oppName={oppName} onReport={setReport} isAdmin={isAdmin} />}
      {sub === "media" && <GameMedia data={data} save={save} game={g} oppName={oppName} isAdmin={isAdmin} />}
    </div>
  );
}

/* ============ Play by Play 入力 ============ */
function PlayByPlay({ data, save, game, oppName, isAdmin }) {
  const C = useC();
  const periods = periodsOf(game);
  const [q, setQ] = useState(1);
  const [time, setTime] = useState("");
  const [side, setSide] = useState("own");
  // 相手側はデフォルトでチームを選択
  const [sel, setSel] = useState(null);
  const [insertAfter, setInsertAfter] = useState(null);
  const [showLineup, setShowLineup] = useState(false);
  const [qLocked, setQLocked] = useState(false);
  const [flash, setFlash] = useState(null);
  const flashTimer = useRef(null);
  const [editEvent, setEditEvent] = useState(null); // 編集中のイベント(null=非表示)

  // side変更時: 相手ならTEAM_KEYをデフォルト選択
  const changeSide = (k) => {
    setSide(k);
    setSel(k === "opp" ? TEAM_KEY : null);
  };

  const opponent = data.opponents.find((o) => o.id === game.opponentId);
  const oppNums = (opponent?.numbers || "").split(/[,、\s]+/).filter(Boolean);
  const lineup = game.lineups?.[q] || [];
  // 選手チップは常に背番号順で固定(入力のたびに並びが動かないように)
  const players = [...data.players].sort((a, b) => (+a.number || 0) - (+b.number || 0));
  const updGame = (fn) => save({ ...data, games: data.games.map((x) => (x.id === game.id ? fn(x) : x)) });
  const toggleLineup = (pid) => {
    updGame((x) => {
      const cur = x.lineups?.[q] || [];
      const next = cur.includes(pid) ? cur.filter((i) => i !== pid) : [...cur, pid];
      return { ...x, lineups: { ...x.lineups, [q]: next } };
    });
  };
  const copyPrevLineup = () => {
    if (q <= 1) return;
    updGame((x) => ({ ...x, lineups: { ...x.lineups, [q]: [...(x.lineups?.[q - 1] || [])] } }));
  };
  const applyScore = (qScores, sideKey, qi, delta) => {
    const arr = padQ(qScores[sideKey]);
    arr[qi] = String(Math.max(0, (+arr[qi] || 0) + delta));
    return { ...qScores, [sideKey]: arr };
  };
  const addEvent = (action, forceTeam) => {
    const key = forceTeam ? TEAM_KEY : sel;
    if (!key) return;
    if ((action === "IN" || action === "OUT") && key === TEAM_KEY) return;
    const ev = { id: uid(), q, time: time.trim(), side, action, ...(side === "own" ? { playerId: key } : { oppNum: key }) };
    const pts = PTS_OF[action] || 0;
    updGame((x) => {
      let events;
      if (insertAfter) {
        const idx = x.events.findIndex((e) => e.id === insertAfter);
        events = idx >= 0 ? [...x.events.slice(0, idx + 1), ev, ...x.events.slice(idx + 1)] : [...x.events, ev];
      } else { events = [...x.events, ev]; }
      return { ...x, events, qScores: pts ? applyScore(x.qScores, side, q - 1, pts) : x.qScores };
    });
    // sel・side・timeは保持(前の入力を引き継ぐ)
    if (insertAfter) setInsertAfter(ev.id);
    // 視覚フィードバック: 記録内容を一瞬表示
    const who = key === TEAM_KEY ? (side === "own" ? "自チーム" : "相手チーム") : (side === "own" ? pName(key) : `相手 #${key}`);
    setFlash({ id: ev.id, text: `${who} – ${ACTION_LABEL[action]}${pts ? ` (+${pts})` : ""}` });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1300);
  };
  const delEvent = (id) => {
    const ev = (game.events || []).find((e) => e.id === id);
    const pts = ev ? PTS_OF[ev.action] || 0 : 0;
    if (insertAfter === id) setInsertAfter(null);
    updGame((x) => ({ ...x, events: x.events.filter((e) => e.id !== id), qScores: pts ? applyScore(x.qScores, ev.side, ev.q - 1, -pts) : x.qScores }));
  };
  // イベントを編集保存: スコアの差分を調整
  const saveEditEvent = (updated) => {
    const orig = (game.events || []).find((e) => e.id === updated.id);
    if (!orig) return;
    const origPts = PTS_OF[orig.action] || 0;
    const newPts = PTS_OF[updated.action] || 0;
    updGame((x) => {
      let qs = x.qScores;
      // 元のスコアを取り消し
      if (origPts) qs = applyScore(qs, orig.side, orig.q - 1, -origPts);
      // 新スコアを加算
      if (newPts) qs = applyScore(qs, updated.side, updated.q - 1, newPts);
      return { ...x, events: x.events.map((e) => e.id === updated.id ? updated : e), qScores: qs };
    });
    setEditEvent(null);
  };
  // 残り時間を取得(入力欄が空ならpromptで聞く)。"M:SS"形式
  const askRemain = (label) => {
    let t = time.trim();
    if (!t) {
      const len = (q <= regQOf(game) ? (+game.qLen || 6) : (+game.otLen || 3));
      const ans = prompt(`${label}した時点の「残り時間」を入力してください(例: 4:30)\n※${periodLabel2(game, q)}の長さは${len}分です。空欄ならQ満了(${len}:00)として計算します。`, "");
      if (ans === null) return undefined; // キャンセル
      t = (ans || "").trim();
    }
    return t;
  };
  // 交代IN: ベンチ選手を投入(INイベント記録 + 出場メンバー追加 + 選択状態に)
  const subInPlayer = (pid) => {
    const p = data.players.find((x) => x.id === pid);
    const t = askRemain(`#${p?.number} ${p?.codename || p?.name} が交代IN`);
    if (t === undefined) return;
    const ev = { id: uid(), q, time: t, side: "own", action: "IN", playerId: pid };
    updGame((x) => {
      const cur = x.lineups?.[q] || [];
      return {
        ...x,
        events: [...x.events, ev],
        lineups: { ...x.lineups, [q]: cur.includes(pid) ? cur : [...cur, pid] },
      };
    });
    setSide("own");
    setSel(pid);
    setFlash({ id: ev.id, text: `#${p?.number} ${p?.codename || p?.name} – 交代IN${t ? ` (残り${t})` : ""}` });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1300);
  };
  // 交代OUT: 出場選手をベンチに戻す(OUTイベント記録 + 出場メンバーから除外)
  const subOutPlayer = (pid) => {
    const p = data.players.find((x) => x.id === pid);
    const t = askRemain(`#${p?.number} ${p?.codename || p?.name} が交代OUT`);
    if (t === undefined) return;
    const ev = { id: uid(), q, time: t, side: "own", action: "OUT", playerId: pid };
    updGame((x) => {
      const cur = x.lineups?.[q] || [];
      return {
        ...x,
        events: [...x.events, ev],
        lineups: { ...x.lineups, [q]: cur.filter((i) => i !== pid) },
      };
    });
    setSel(null);
    setFlash({ id: ev.id, text: `#${p?.number} ${p?.codename || p?.name} – 交代OUT${t ? ` (残り${t})` : ""}` });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1300);
  };
  const pName = (id) => {
    if (id === TEAM_KEY) return "チーム";
    const p = data.players.find((x) => x.id === id);
    return p ? `#${p.number} ${p.codename || p.name}` : "?";
  };
  const events = game.events || [];
  // ログは降順(新しい順)表示
  const logEvents = [...events].reverse();
  return (
    <div className="space-y-3">
      {isAdmin && <Card>
        {/* Q選択 + 固定トグル */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex gap-1.5 flex-1 overflow-x-auto">
            {Array.from({ length: periods }, (_, i) => i + 1).map((n) => (
              <button key={n} className="flex-1 min-w-14 py-2.5 rounded-lg font-bold"
                style={q === n
                  ? { background: C.orange, color: "#fff" }
                  : qLocked
                    ? { background: C.card2, color: C.border, cursor: "not-allowed" }
                    : { background: C.card2, color: C.sub }}
                onClick={() => { if (!qLocked) setQ(n); }}
                disabled={qLocked && q !== n}
              >{periodLabel2(game, n)}</button>
            ))}
          </div>
          <button className="shrink-0 px-3 py-2.5 rounded-lg text-xs font-bold"
            style={qLocked ? { background: C.win, color: "#fff" } : { border: `1px solid ${C.border}`, color: C.sub }}
            onClick={() => setQLocked(!qLocked)}
            title={qLocked ? "クリックで固定解除" : "クリックでQ固定"}>
            {qLocked ? "🔒固定中" : "固定"}
          </button>
        </div>
        {qLocked && <div className="text-xs mb-2 px-2 py-1 rounded-lg" style={{ background: C.card2, color: C.win }}>🔒 {periodLabel2(game, q)}に固定中。解除するには「固定中」ボタンをタップ</div>}
        <button className="w-full flex items-center gap-2 mb-3 text-sm font-bold rounded-xl px-3 py-2.5"
          style={{ background: C.card2, color: lineup.length ? C.win : C.sub }}
          onClick={() => setShowLineup(!showLineup)}>
          <UsersRound size={16} />
          {periodLabel2(game, q)}の出場メンバー({lineup.length}人)
          <ChevronDown size={16} className="ml-auto" style={{ transform: showLineup ? "rotate(180deg)" : "none" }} />
        </button>
        {showLineup && (
          <div className="mb-3 p-3 rounded-xl" style={{ background: C.card2 }}>
            <div className="text-[11px] mb-2 font-bold" style={{ color: lineup.length === 5 ? C.win : C.sub }}>
              出場中 {lineup.length}人{lineup.length > 5 ? "(5人を超えています)" : lineup.length === 5 ? " ✓" : ` / あと${5 - lineup.length}人選べます`}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {[...data.players].sort((a, b) => (+a.number || 0) - (+b.number || 0)).map((p) => (
                <button key={p.id} onClick={() => toggleLineup(p.id)}
                  className="px-3 py-2 rounded-full text-xs font-bold"
                  style={lineup.includes(p.id) ? { background: C.win, color: "#fff" } : { border: `1px solid ${C.border}`, color: C.sub }}>
                  #{p.number} {p.codename || p.name}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px]" style={{ color: C.sub }}>タップで追加/解除。複数選択できます({periodLabel2(game, q)}フル出場として計算)</span>
              {q > 1 && <button className="text-xs font-bold shrink-0 ml-2" style={{ color: C.orange }} onClick={copyPrevLineup}>前と同じ</button>}
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 mb-3">
          <Clock size={16} style={{ color: C.sub }} />
          <input className="rounded-lg px-2 py-1.5 w-24 text-center" style={getInputStyle(C)}
            placeholder={`残り ${Math.floor(periodLen(game, q) / 60)}:00`}
            value={time} onChange={(e) => setTime(e.target.value)} />
          <span className="text-xs" style={{ color: C.sub }}>任意</span>
        </div>
        <div className="mb-3">
          <Seg items={[["own", "自チーム"], ["opp", `相手(${oppName(game.opponentId)})`]]} value={side}
            onChange={changeSide} />
        </div>
        {side === "own" ? (
          data.players.length === 0 ? <div className="text-sm mb-3" style={{ color: C.sub }}>先に「選手」タブで選手を登録してください。</div> : (
            <>
              {lineup.length === 0 && (
                <div className="text-xs mb-2 px-2 py-1.5 rounded-lg" style={{ background: `${C.led}22`, color: C.led }}>
                  上の「{periodLabel2(game, q)}の出場メンバー」から出場中の選手を登録してください。登録した選手のみ記録できます。
                </div>
              )}
              <div className="flex flex-wrap gap-1.5 mb-2">
                <button onClick={() => setSel(TEAM_KEY)}
                  className="px-3 py-2 rounded-full text-sm font-bold"
                  style={sel === TEAM_KEY ? { background: C.led, color: "#000" } : { border: `1px dashed ${C.led}`, color: C.led }}>チーム</button>
                {/* 出場メンバーのみ表示 */}
                {players.filter((p) => lineup.includes(p.id)).map((p) => (
                  <button key={p.id} onClick={() => setSel(p.id)}
                    className="px-3 py-2 rounded-full text-sm font-bold"
                    style={sel === p.id ? { background: C.orange, color: "#fff" } : { border: `1px solid ${C.win}`, color: C.text }}>
                    #{p.number} {p.codename || p.name}
                  </button>
                ))}
              </div>
              {/* 交代OUT: 選択中の出場選手をベンチに戻す */}
              {sel && sel !== TEAM_KEY && lineup.includes(sel) && (
                <button onClick={() => subOutPlayer(sel)}
                  className="mb-2 px-3 py-2 rounded-xl text-xs font-bold w-full flex items-center justify-center gap-1.5"
                  style={{ border: `1px solid ${C.loss}`, color: C.loss }}>
                  🔄 {pName(sel)} を交代OUT(ベンチに戻す)
                </button>
              )}
              {/* 交代IN: ベンチ選手を投入 */}
              {players.filter((p) => !lineup.includes(p.id)).length > 0 && (
                <div className="mb-3 p-2 rounded-xl" style={{ background: C.card2 }}>
                  <div className="text-[10px] font-bold mb-1.5" style={{ color: C.sub }}>🔄 交代IN(ベンチから投入 → 出場メンバーに追加)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {players.filter((p) => !lineup.includes(p.id)).map((p) => (
                      <button key={p.id} onClick={() => subInPlayer(p.id)}
                        className="px-3 py-1.5 rounded-full text-xs font-bold"
                        style={{ border: `1px dashed ${C.sub}`, color: C.sub }}>
                        + #{p.number} {p.codename || p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )
        ) : (
          <div className="flex flex-wrap gap-1.5 mb-3 items-center">
            <button onClick={() => setSel(TEAM_KEY)}
              className="px-3 py-2 rounded-full text-sm font-bold"
              style={sel === TEAM_KEY ? { background: C.led, color: "#000" } : { border: `1px dashed ${C.led}`, color: C.led }}>チーム</button>
            {oppNums.map((n) => (
              <button key={n} onClick={() => setSel(n)}
                className="px-3 py-2 rounded-full text-sm font-bold"
                style={sel === n ? { background: C.oppBlue, color: "#fff" } : { border: `1px solid ${C.border}`, color: C.text }}>#{n}</button>
            ))}
            <input className="rounded-full px-3 py-2 w-20 text-sm" style={getInputStyle(C)} placeholder="#番号"
              onKeyDown={(e) => { if (e.key === "Enter" && e.target.value) { setSel(e.target.value.replace("#", "")); e.target.value = ""; } }}
              onBlur={(e) => { if (e.target.value) { setSel(e.target.value.replace("#", "")); e.target.value = ""; } }} />
          </div>
        )}
        <div className="grid grid-cols-3 gap-1.5">
          {ACTIONS.filter((a) => !a.sub).map((a) => {
            const disabled = !sel;
            const col = a.good ? C.win : a.bad ? C.loss : C.text;
            return (
              <button key={a.k} disabled={disabled} onClick={() => addEvent(a.k)}
                className="play-btn py-3 rounded-xl text-xs font-bold disabled:opacity-30"
                style={{ border: `1px solid ${a.good ? C.win : a.bad ? C.loss : C.border}`, color: col, background: C.card2, "--btn-col": col }}>{a.label}</button>
            );
          })}
          <button onClick={() => addEvent("TOT", true)}
            className="play-btn py-3 rounded-xl text-xs font-bold col-span-3"
            style={{ border: `1px solid ${C.led}`, color: C.led, background: C.card2, "--btn-col": C.led }}>
            タイムアウト({side === "own" ? "自チーム" : "相手"})
          </button>
        </div>
        <div className="text-xs mt-2 text-center" style={{ color: C.sub }}>
          {sel === TEAM_KEY ? "チーム全体のプレイとして記録します(24秒TOなど)" : sel ? "得点プレイはスコアボードに自動加算されます" : "選手(またはチーム)を選んでからアクションをタップ"}
        </div>
      </Card>}

      {/* 記録トースト: 押したことが視覚的にわかる */}
      {flash && (
        <div className="fixed left-1/2 z-40 px-4 py-2.5 rounded-full text-sm font-bold shadow-lg pointer-events-none flash-toast"
          style={{ bottom: 90, transform: "translateX(-50%)", background: C.win, color: "#fff" }}>
          ✓ 記録しました: {flash.text}
        </div>
      )}
      {isAdmin && insertAfter && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold"
          style={{ background: "#3A2A14", border: `1px solid ${C.led}`, color: C.led }}>
          <CornerDownRight size={16} />
          <span className="flex-1">差し込みモード: 選択した行の直後に追加します</span>
          <button onClick={() => setInsertAfter(null)}><X size={16} /></button>
        </div>
      )}
      <Card>
        <SectionTitle>{periodLabel2(game, q)}のプレイログ({events.filter((e) => e.q === q).length})</SectionTitle>
        {events.filter((e) => e.q === q).length === 0 ? (
          <div className="text-sm" style={{ color: C.sub }}>{periodLabel2(game, q)}に記録されたプレイはまだありません。</div>
        ) : (
          <div className="space-y-1 max-h-[500px] overflow-y-auto">
            {[...events].filter((e) => e.q === q).reverse().map((e) => (
              <div key={e.id} className="flex items-center gap-1.5 text-sm py-1.5 rounded-lg px-1"
                style={{ borderBottom: `1px solid ${C.border}44`, background: insertAfter === e.id ? "#3A2A1466" : "transparent" }}>
                <span className="text-xs w-9" style={{ color: C.sub }}>{e.time || "–"}</span>
                <span className="flex-1 truncate">
                  {e.side === "own" ? pName(e.playerId) : (e.oppNum === TEAM_KEY ? "相手チーム" : `相手 #${e.oppNum}`)}
                  <span style={{ color: e.side === "own" ? C.sub : C.oppText }}> – {ACTION_LABEL[e.action]}</span>
                </span>
                {PTS_OF[e.action] ? <span className="text-xs font-bold" style={{ color: C.led }}>+{PTS_OF[e.action]}</span> : null}
                {isAdmin && <>
                  <button className="p-1" style={{ color: C.orange }} onClick={() => setEditEvent({ ...e })}><Pencil size={13} /></button>
                  <button className="p-1" style={{ color: insertAfter === e.id ? C.led : C.sub }}
                    onClick={() => setInsertAfter(insertAfter === e.id ? null : e.id)}><CornerDownRight size={14} /></button>
                  <button className="p-1" style={{ color: C.sub }} onClick={() => delEvent(e.id)}><Trash2 size={14} /></button>
                </>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ===== プレイログ編集モーダル ===== */}
      {editEvent && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setEditEvent(null)}>
          <div className="w-full max-w-lg rounded-t-2xl p-5 space-y-3"
            style={{ background: C.card, border: `1px solid ${C.border}` }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <div className="font-bold">プレイを編集</div>
              <button onClick={() => setEditEvent(null)}><X size={18} style={{ color: C.sub }} /></button>
            </div>
            {/* 残り時間 */}
            <div>
              <div className="text-xs mb-1" style={{ color: C.sub }}>残り時間</div>
              <input className={inputCls} style={getInputStyle(C)} placeholder="例: 3:45"
                value={editEvent.time || ""} onChange={(e) => setEditEvent({ ...editEvent, time: e.target.value })} />
            </div>
            {/* 自チーム/相手切り替え */}
            <div className="flex gap-2">
              <button className="flex-1 py-2 rounded-xl text-sm font-bold"
                style={editEvent.side === "own" ? { background: C.orange, color: "#fff" } : { border: `1px solid ${C.border}`, color: C.sub }}
                onClick={() => setEditEvent({ ...editEvent, side: "own", oppNum: undefined })}>自チーム</button>
              <button className="flex-1 py-2 rounded-xl text-sm font-bold"
                style={editEvent.side === "opp" ? { background: C.oppBlue, color: "#fff" } : { border: `1px solid ${C.border}`, color: C.sub }}
                onClick={() => setEditEvent({ ...editEvent, side: "opp", playerId: undefined })}>相手</button>
            </div>
            {/* 選手選択(自チームのみ) */}
            {editEvent.side === "own" && (
              <div>
                <div className="text-xs mb-1" style={{ color: C.sub }}>選手</div>
                <div className="flex flex-wrap gap-1.5">
                  <button className="px-3 py-1.5 rounded-full text-xs font-bold"
                    style={editEvent.playerId === TEAM_KEY ? { background: C.led, color: "#000" } : { border: `1px dashed ${C.led}`, color: C.led }}
                    onClick={() => setEditEvent({ ...editEvent, playerId: TEAM_KEY })}>チーム</button>
                  {players.map((p) => (
                    <button key={p.id} className="px-3 py-1.5 rounded-full text-xs font-bold"
                      style={editEvent.playerId === p.id ? { background: C.orange, color: "#fff" } : { border: `1px solid ${C.border}`, color: C.text }}
                      onClick={() => setEditEvent({ ...editEvent, playerId: p.id })}>
                      #{p.number} {p.codename || p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* アクション選択 */}
            <div>
              <div className="text-xs mb-1" style={{ color: C.sub }}>アクション</div>
              <div className="grid grid-cols-4 gap-1.5">
                {ACTIONS.filter((a) => !a.sub).map((a) => (
                  <button key={a.k} className="py-2 rounded-xl text-xs font-bold"
                    style={editEvent.action === a.k ? { background: a.good ? C.win : a.bad ? C.loss : C.orange, color: "#fff" }
                      : { border: `1px solid ${C.border}`, color: C.sub }}
                    onClick={() => setEditEvent({ ...editEvent, action: a.k })}>{a.label}</button>
                ))}
              </div>
            </div>
            {/* 保存 */}
            <button className="w-full py-3 rounded-xl font-bold text-white mt-2"
              style={{ background: C.orange }} onClick={() => saveEditEvent(editEvent)}>
              保存する
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============ 資料 ============ */
function GameMedia({ data, save, game, oppName, isAdmin }) {
  const C = useC();
  const [copied, setCopied] = useState(false);
  const periods = periodsOf(game);
  const upd = (patch) => save({ ...data, games: data.games.map((x) => x.id === game.id ? { ...x, ...patch } : x) });
  const buildRows = () => {
    const sorted = [...(game.events || [])].map((e, i) => ({ e, i })).sort((a, b) => a.e.q - b.e.q || a.i - b.i);
    let ro = 0, rp = 0;
    return sorted.map(({ e }) => {
      const pts = PTS_OF[e.action] || 0;
      if (pts) { if (e.side === "own") ro += pts; else rp += pts; }
      const p = e.side === "own" && e.playerId !== TEAM_KEY ? data.players.find((x) => x.id === e.playerId) : null;
      const isTeam = e.playerId === TEAM_KEY || e.oppNum === TEAM_KEY;
      return { period: periodLabel2(game, e.q), time: e.time || "", team: e.side === "own" ? data.team.name : oppName(game.opponentId), num: isTeam ? "" : e.side === "own" ? (p?.number || "") : e.oppNum, name: isTeam ? "チーム" : e.side === "own" ? (p?.codename || p?.name || "") : "", action: ACTION_LABEL[e.action], pts: pts || "", score: `${ro}-${rp}` };
    });
  };
  const toCSV = () => {
    const head = "期間,残り時間,チーム,背番号,選手,アクション,得点,スコア";
    const lines = buildRows().map((r) => [r.period, r.time, r.team, r.num, r.name, r.action, r.pts, r.score].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    return [head, ...lines].join("\n");
  };
  const toText = () => buildRows().map((r) => `${r.period} ${r.time || "--:--"} [${r.team}]${r.num ? ` #${r.num}` : ""} ${r.name} ${r.action}${r.pts ? ` (+${r.pts})` : ""} ${r.score}`).join("\n");
  const downloadCSV = () => {
    const blob = new Blob(["\uFEFF" + toCSV()], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `playbyplay-${game.date || "game"}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  const copyText = async () => {
    try { await navigator.clipboard.writeText(toText()); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch (e) { prompt("コピーしてください", toText()); }
  };
  const videos = game.videos || {};
  const vidKeys = [...Array.from({ length: periods }, (_, i) => String(i + 1)), "all"];
  // 各Qのリンクを配列として正規化(旧データの文字列にも対応)
  const vidList = (k) => {
    const v = videos[k];
    if (Array.isArray(v)) return v;
    if (typeof v === "string" && v) return [v];
    return [];
  };
  const setVidList = (k, list) => upd({ videos: { ...videos, [k]: list } });
  return (
    <div className="space-y-3">
      <Card>
        <SectionTitle><span className="inline-flex items-center gap-1"><Film size={13} /> 試合動画(YouTube)</span></SectionTitle>
        <div className="space-y-4">
          {vidKeys.map((k) => {
            const label = k === "all" ? "フル/その他" : periodLabel2(game, +k);
            const list = vidList(k);
            const playable = list.filter((u) => ytId(u));
            // 閲覧モードで再生可能な動画がない場合はスキップ
            if (!isAdmin && playable.length === 0) return null;
            return (
              <div key={k}>
                <div className="text-xs font-bold mb-1.5" style={{ color: C.sub }}>{label}</div>
                {isAdmin ? (
                  <div className="space-y-2">
                    {(list.length ? list : [""]).map((url, i) => {
                      const id = ytId(url);
                      return (
                        <div key={i}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] w-6 shrink-0" style={{ color: C.sub }}>{i + 1}</span>
                            <input className="flex-1 rounded-lg px-2 py-1.5 text-sm" style={getInputStyle(C)} placeholder="https://youtu.be/..."
                              value={url} onChange={(e) => {
                                const base = list.length ? list : [""];
                                setVidList(k, base.map((u, j) => j === i ? e.target.value : u));
                              }} />
                            {list.length > 0 && <button className="p-1.5 shrink-0" style={{ color: C.loss }}
                              onClick={() => setVidList(k, list.filter((_, j) => j !== i))}><Trash2 size={15} /></button>}
                          </div>
                          {id && <div className="rounded-xl overflow-hidden ml-8" style={{ aspectRatio: "16/9" }}>
                            <iframe width="100%" height="100%" src={`https://www.youtube.com/embed/${id}`} title={`動画 ${label} ${i + 1}`} frameBorder="0" allowFullScreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" />
                          </div>}
                        </div>
                      );
                    })}
                    <button className="text-xs font-bold flex items-center gap-1 ml-8" style={{ color: C.orange }}
                      onClick={() => setVidList(k, [...list, ""])}>
                      <Plus size={13} /> {label}に動画を追加
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {playable.map((url, i) => (
                      <div key={i} className="rounded-xl overflow-hidden" style={{ aspectRatio: "16/9" }}>
                        <iframe width="100%" height="100%" src={`https://www.youtube.com/embed/${ytId(url)}`} title={`動画 ${label} ${i + 1}`} frameBorder="0" allowFullScreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {!isAdmin && !vidKeys.some((k) => vidList(k).some((u) => ytId(u))) && (
            <div className="text-sm text-center py-4" style={{ color: C.sub }}>まだ動画が登録されていません。</div>
          )}
          {isAdmin && (
            <div className="text-[10px] mt-1 leading-relaxed" style={{ color: C.sub }}>
              ※同じQでも「動画を追加」で複数のリンクを登録できます。{periods > 4 ? "OTのリンク欄も上に表示されています。" : ""}
            </div>
          )}
        </div>
      </Card>

      {/* スコアカード写真 */}
      <Card>
        <SectionTitle>スコアカード(写真)</SectionTitle>
        {(() => {
          const cards = game.scoreCards || [];
          return (
            <>
              <div className="space-y-3">
                {cards.map((url, i) => {
                  const src = imgUrl(url);
                  return (
                    <div key={i}>
                      {isAdmin && (
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold w-12 shrink-0" style={{ color: C.sub }}>{i + 1}枚目</span>
                          <input className="flex-1 rounded-lg px-2 py-1.5 text-sm" style={getInputStyle(C)} placeholder="画像のURL"
                            value={url} onChange={(e) => upd({ scoreCards: cards.map((c, j) => j === i ? e.target.value : c) })} />
                          <button className="p-1.5 shrink-0" style={{ color: C.loss }}
                            onClick={() => upd({ scoreCards: cards.filter((_, j) => j !== i) })}><Trash2 size={16} /></button>
                        </div>
                      )}
                      {src && <img src={src} alt={`スコアカード${i + 1}`} className="w-full rounded-xl"
                        style={{ border: `1px solid ${C.border}` }} loading="lazy"
                        referrerPolicy="no-referrer" />}
                    </div>
                  );
                })}
              </div>
              {isAdmin && (
                <>
                  <button className="mt-3 w-full flex items-center justify-center gap-1 py-2.5 rounded-xl font-bold text-sm"
                    style={{ border: `1px solid ${C.border}`, color: C.orange }}
                    onClick={() => upd({ scoreCards: [...cards, ""] })}>
                    <Plus size={16} /> スコアカードを追加
                  </button>
                  <div className="text-[10px] mt-2 leading-relaxed" style={{ color: C.sub }}>
                    ※写真はGoogleドライブ等にアップして、その共有リンク(「リンクを知っている全員」に設定)を貼ってください。アプリ本体には画像を保存しないので容量を消費しません。Googleドライブのリンクは自動で表示用に変換されます。
                  </div>
                </>
              )}
              {!isAdmin && cards.filter((c) => imgUrl(c)).length === 0 && (
                <div className="text-sm text-center py-4" style={{ color: C.sub }}>まだスコアカードが登録されていません。</div>
              )}
            </>
          );
        })()}
      </Card>

      <Card>
        <SectionTitle>TeamHub用 書き出し</SectionTitle>
        <div className="flex gap-2">
          <button className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl font-bold text-sm" style={{ border: `1px solid ${C.border}` }} onClick={downloadCSV}><Download size={16} /> CSV</button>
          <button className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl font-bold text-sm" style={{ border: `1px solid ${C.border}` }} onClick={copyText}>{copied ? "コピーしました!" : "テキストをコピー"}</button>
        </div>
        {(game.events || []).length > 0 && (
          <pre className="mt-3 p-3 rounded-xl text-[10px] leading-relaxed overflow-x-auto max-h-48 overflow-y-auto" style={{ background: C.card2, color: C.sub }}>{toText()}</pre>
        )}
      </Card>
    </div>
  );
}

/* ============ レポート ============ */
function ReportView({ data, game, mode, oppName, onClose }) {
  const a = analysisFor(data, game, "all");
  const flow = mode === "detail" ? flowAnalysis(data, game) : null;
  const mips = mipOf(game, data.players);
  const opp = oppName(game.opponentId);
  const title = mode === "simple" ? "試合レポート(簡易版)" : "試合レポート(詳細版)";
  const rootRef = useRef(null);
  const downloadHTML = () => {
    const inner = rootRef.current?.innerHTML || "";
    const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>${title} ${game.date || ""}</title><style>body{font-family:sans-serif;margin:24px;color:#111;max-width:760px}h1{font-size:20px}h2{font-size:15px;border-left:4px solid #E8632C;padding-left:8px;margin-top:24px;font-weight:700}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:4px 6px;font-size:12px;text-align:left}th{background:#f3f4f6}ul{font-size:13px;padding-left:20px}p{font-size:13px}</style></head><body>${inner}</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url; el.download = `report-${game.date || "game"}-${mode}.html`; el.click();
    URL.revokeObjectURL(url);
  };
  const th = { border: "1px solid #ccc", padding: "4px 6px", fontSize: 12, textAlign: "left", background: "#f3f4f6" };
  const td = { border: "1px solid #ccc", padding: "4px 6px", fontSize: 12 };
  const T = ({ children }) => <h2 style={{ fontSize: 15, borderLeft: "4px solid #E8632C", paddingLeft: 8, marginTop: 24, marginBottom: 8, fontWeight: 700 }}>{children}</h2>;
  const BoxTable = ({ rows }) => (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead><tr>{["選手","得点","FG","FT","OR","DR","AST","STL","BLK","TO","PF","分","+/-","EFF"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>
        {[...rows].sort((x, y) => y.s.eff - x.s.eff).map(({ key, label, s }) => (
          <tr key={key}><td style={td}>{label}</td><td style={{ ...td, fontWeight: 700 }}>{s.pts}</td><td style={td}>{s.fgm}/{s.fga}</td><td style={td}>{s.ftm}/{s.fta}</td><td style={td}>{s.or}</td><td style={td}>{s.dr}</td><td style={td}>{s.ast}</td><td style={td}>{s.stl}</td><td style={td}>{s.blk}</td><td style={td}>{s.to}</td><td style={td}>{s.pf}</td><td style={td}>{s.min}</td><td style={td}>{s.pm === null ? "–" : (s.pm >= 0 ? "+" : "") + s.pm}</td><td style={{ ...td, fontWeight: 700 }}>{s.eff}</td></tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="report-root fixed inset-0 z-50 overflow-y-auto" style={{ background: "#fff", color: "#111" }}>
      <div className="no-print sticky top-0 flex items-center gap-2 px-4 py-3 shadow" style={{ background: "#fff", borderBottom: "1px solid #ddd" }}>
        <button className="flex items-center gap-1 text-sm font-bold px-3 py-2 rounded-xl text-white" style={{ background: C.orange }} onClick={() => window.print()}><Printer size={16} /> 印刷 / PDF保存</button>
        <button className="flex items-center gap-1 text-sm font-bold px-3 py-2 rounded-xl" style={{ border: "1px solid #ccc", color: "#333" }} onClick={downloadHTML}><Download size={16} /> HTML</button>
        <button className="ml-auto p-2" style={{ color: "#555" }} onClick={onClose}><X size={20} /></button>
      </div>
      <div ref={rootRef} className="max-w-2xl mx-auto px-5 py-6">
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{title}</h1>
        <p style={{ fontSize: 13, color: "#555", margin: 0 }}>{game.date}・{game.tournament || "練習試合"}{game.ot ? `・OT${game.ot}` : ""}</p>
        <p style={{ fontSize: 24, fontWeight: 700, margin: "12px 0 4px" }}>{data.team.name} {a.ownPts} – {a.oppPts} {opp}<span style={{ fontSize: 14, marginLeft: 10, color: a.win ? "#1B8A52" : a.ownPts === a.oppPts ? "#666" : "#C03A3A" }}>{a.win ? "WIN" : a.ownPts === a.oppPts ? "引分" : "LOSE"}</span></p>
        {mips.length > 0 && <p style={{ fontSize: 13, margin: 0 }}>MIP: {mips.map(({ p, s }) => `#${p.number} ${p.codename || p.name}(EFF ${s.eff})`).join("、")}</p>}
        <T>ピリオド別スコア</T>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th style={th}></th>{a.qData.map((x) => <th key={x.name} style={th}>{x.name}</th>)}<th style={th}>計</th></tr></thead>
          <tbody>
            <tr><td style={{ ...td, fontWeight: 700 }}>{data.team.name}</td>{a.qData.map((x) => <td key={x.name} style={td}>{x.自チーム}</td>)}<td style={{ ...td, fontWeight: 700 }}>{a.ownPts}</td></tr>
            <tr><td style={{ ...td, fontWeight: 700 }}>{opp}</td>{a.qData.map((x) => <td key={x.name} style={td}>{x.相手}</td>)}<td style={{ ...td, fontWeight: 700 }}>{a.oppPts}</td></tr>
          </tbody>
        </table>
        <T>チームスタッツ</T>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th style={th}>項目</th><th style={th}>{data.team.name}</th><th style={th}>{opp}</th></tr></thead>
          <tbody>{a.compRows.map(([l, x, y]) => <tr key={l}><td style={td}>{l}</td><td style={td}>{x}</td><td style={td}>{y}</td></tr>)}</tbody>
        </table>
        {a.ownRows.length > 0 && (<><T>{data.team.name} ボックススコア</T><BoxTable rows={a.ownRows} /></>)}
        {a.oppRows.length > 0 && (<><T>{opp} ボックススコア</T><BoxTable rows={a.oppRows} /></>)}
        <T>試合分析サマリー</T>
        <ul style={{ fontSize: 13, paddingLeft: 20, margin: "4px 0" }}>{a.insights.map((s, i) => <li key={i}>{s}</li>)}</ul>
        {a.goodPoints.length > 0 && (
          <>
            <p style={{ fontWeight: 700, marginBottom: 4, fontSize: 13, color: "#1B8A52" }}>【良かった点】</p>
            <ul style={{ fontSize: 13, paddingLeft: 20, margin: "4px 0" }}>{a.goodPoints.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}</ul>
            <p style={{ fontWeight: 700, marginBottom: 4, fontSize: 13, color: "#E8632C" }}>【改善点】</p>
            <ul style={{ fontSize: 13, paddingLeft: 20, margin: "4px 0" }}>{a.improvePoints.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}</ul>
          </>
        )}
        <p style={{ fontWeight: 700, marginBottom: 4, fontSize: 13 }}>次戦に向けた提言</p>
        <ul style={{ fontSize: 13, paddingLeft: 20, margin: "4px 0" }}>{a.tips.map((s, i) => <li key={i}>{s}</li>)}</ul>
        {mode === "detail" && flow && (
          <>
            <T>試合の流れ(時系列分析)</T>
            <ul style={{ fontSize: 13, paddingLeft: 20, margin: "4px 0" }}>{flow.periodNotes.map((s, i) => <li key={i}>{s}</li>)}</ul>
            <p style={{ fontSize: 13 }}>リードチェンジ: {flow.leadChanges}回</p>
            {a.reviews.length > 0 && (<><T>選手別パフォーマンスレビュー</T><ul style={{ fontSize: 13, paddingLeft: 20, margin: "4px 0" }}>{a.reviews.map((r) => <li key={r.key}><b>{r.label}</b>: {r.text}</li>)}</ul></>)}
            {flow.sorted.length > 0 && (<><T>プレイバイプレイ(全記録)</T>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr>{["期間","残り","チーム","選手","アクション"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>{flow.sorted.map((e) => {
                  const isTeam = e.playerId === TEAM_KEY || e.oppNum === TEAM_KEY;
                  const p = e.side === "own" && !isTeam ? data.players.find((x) => x.id === e.playerId) : null;
                  return (<tr key={e.id}><td style={td}>{periodLabel2(game, e.q)}</td><td style={td}>{e.time || ""}</td><td style={td}>{e.side === "own" ? data.team.name : opp}</td><td style={td}>{isTeam ? "チーム" : e.side === "own" ? `#${p?.number || ""} ${p?.codename || p?.name || ""}` : `#${e.oppNum}`}</td><td style={td}>{ACTION_LABEL[e.action]}</td></tr>);
                })}</tbody>
              </table></>)}
          </>
        )}
        <p style={{ fontSize: 11, color: "#888", marginTop: 24 }}>作成: {data.team.name} 記録アプリ</p>
      </div>
    </div>
  );
}

/* ============ 試合分析(画面) ============ */
function GameAnalysis({ data, save, game, oppName, onReport, isAdmin }) {
  const C = useC();
  const [scope, setScope] = useState("all");
  const a = analysisFor(data, game, scope);
  const mips = scope === "all" ? mipOf(game, data.players) : [];
  const updGame = (patch) => save({ ...data, games: data.games.map((x) => x.id === game.id ? { ...x, ...patch } : x) });
  const StatTable = ({ rows, accent }) => (
    <div className="overflow-x-auto -mx-1">
      <table className="text-xs w-full min-w-[600px]">
        <thead><tr style={{ color: C.sub, borderBottom: `1px solid ${C.border}` }}>
          {["選手","得点","FG","FG%","FT","OR","DR","AST","STL","BLK","TO","PF","分","+/-","EFF"].map((h) => <th key={h} className="py-1.5 px-1 text-left whitespace-nowrap">{h}</th>)}
        </tr></thead>
        <tbody>
          {[...rows].sort((x, y) => y.s.eff - x.s.eff).map(({ key, label, s }) => (
            <tr key={key} style={{ borderBottom: `1px solid ${C.border}44` }}>
              <td className="py-1.5 px-1 whitespace-nowrap font-bold">{label}</td>
              <td className="px-1 font-bold" style={{ color: accent }}>{s.pts}</td>
              <td className="px-1">{s.fgm}/{s.fga}</td>
              <td className="px-1" style={{ color: C.sub }}>{pct(s.fgm, s.fga)}</td>
              <td className="px-1">{s.ftm}/{s.fta}</td>
              <td className="px-1">{s.or}</td><td className="px-1">{s.dr}</td><td className="px-1">{s.ast}</td>
              <td className="px-1">{s.stl}</td><td className="px-1">{s.blk}</td><td className="px-1">{s.to}</td>
              <td className="px-1">{s.pf}</td><td className="px-1">{s.min}</td>
              <td className="px-1" style={{ color: s.pm === null ? C.sub : s.pm >= 0 ? C.win : C.loss }}>{s.pm === null ? "–" : (s.pm >= 0 ? "+" : "") + s.pm}</td>
              <td className="px-1 font-bold">{s.eff}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="space-y-3">
      {/* 試合メモ */}
      <Card>
        <SectionTitle>試合メモ</SectionTitle>
        {isAdmin ? (
          <textarea className="w-full rounded-xl px-3 py-2.5 text-sm leading-relaxed resize-none"
            style={{ ...getInputStyle(C), minHeight: 88 }}
            placeholder="審判の判定のクセ、選手のメンタル、天候・会場の状態など自由に記録できます"
            value={game.memo || ""}
            onChange={(e) => updGame({ memo: e.target.value })} />
        ) : (
          game.memo
            ? <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.text }}>{game.memo}</p>
            : <p className="text-sm" style={{ color: C.sub }}>メモはまだ登録されていません。</p>
        )}
      </Card>
      {isAdmin && <div className="flex gap-2">
        <button className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-sm" style={{ border: `1px solid ${C.border}`, color: C.text }} onClick={() => onReport("simple")}><FileText size={15} /> レポート(簡易)</button>
        <button className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-sm" style={{ border: `1px solid ${C.orange}`, color: C.orange }} onClick={() => onReport("detail")}><FileText size={15} /> レポート(詳細)</button>
      </div>}
      <div className="flex gap-1.5 overflow-x-auto">
        {[["all", "全体"], ...Array.from({ length: a.periods }, (_, i) => [i + 1, periodLabel2(game, i + 1)])].map(([k, l]) => (
          <button key={k} className="flex-1 min-w-12 py-2 rounded-lg font-bold text-sm"
            style={scope === k ? { background: C.orange, color: "#fff" } : { background: C.card, color: C.sub, border: `1px solid ${C.border}` }}
            onClick={() => setScope(k)}>{l}</button>
        ))}
      </div>
      {scope !== "all" && (
        <Card>
          <div className="flex items-center justify-center gap-6" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
            <div className="text-center"><div className="text-6xl" style={{ color: C.led }}>{a.ownPts}</div><div className="text-xs" style={{ fontFamily: "sans-serif", color: C.sub }}>自チーム</div></div>
            <div className="text-xl" style={{ color: C.sub }}>{periodLabel2(game, scope)}</div>
            <div className="text-center"><div className="text-6xl" style={{ color: C.oppText }}>{a.oppPts}</div><div className="text-xs" style={{ fontFamily: "sans-serif", color: C.sub }}>相手</div></div>
          </div>
        </Card>
      )}
      {mips.length > 0 && (
        <Card style={{ border: `1px solid ${C.led}66` }}>
          <SectionTitle><span className="inline-flex items-center gap-1" style={{ color: C.led }}><Award size={13} /> MIP(EFF最高)</span></SectionTitle>
          <div className="space-y-2">
            {mips.map(({ p, s }) => (
              <div key={p.id} className="flex items-center gap-3">
                <Avatar p={p} size={44} />
                <div className="flex-1"><div className="font-bold">#{p.number} {p.codename || p.name}</div><div className="text-xs" style={{ color: C.sub }}>{s.pts}得点・{s.reb}リバウンド・{s.ast}アシスト</div></div>
                <div className="text-right"><div className="text-4xl font-bold" style={{ color: C.led, fontFamily: "'Bebas Neue', sans-serif" }}>{s.eff}</div><div className="text-[10px]" style={{ color: C.sub }}>EFF</div></div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {a.ownT.n + a.oppT.n > 0 && (
        <Card>
          <SectionTitle>レーティング({a.scopeLabel})</SectionTitle>
          <div className="grid grid-cols-3 text-center">
            {[["オフェンス", a.ortg, C.orange], ["ディフェンス", a.drtg, C.oppText], ["ネット", a.net, a.net !== null && a.net >= 0 ? C.win : C.loss]].map(([l, v, col]) => (
              <div key={l}><div className="text-3xl font-bold" style={{ color: col, fontFamily: "'Bebas Neue', sans-serif" }}>{v === null ? "–" : (l === "ネット" && v >= 0 ? "+" : "") + fmt1(v)}</div><div className="text-[10px]" style={{ color: C.sub }}>{l}</div></div>
            ))}
          </div>
        </Card>
      )}
      <Card>
        <SectionTitle>チームスタッツ比較({a.scopeLabel})</SectionTitle>
        <table className="w-full text-sm">
          <thead><tr style={{ color: C.sub }}><th className="text-left py-1 font-normal text-xs">項目</th><th className="text-right py-1 font-bold" style={{ color: C.orange }}>自チーム</th><th className="text-right py-1 font-bold" style={{ color: C.oppText }}>{oppName(game.opponentId)}</th></tr></thead>
          <tbody>{a.compRows.map(([l, x, y]) => (<tr key={l} style={{ borderTop: `1px solid ${C.border}44` }}><td className="py-1.5 text-xs" style={{ color: C.sub }}>{l}</td><td className="py-1.5 text-right font-bold">{x}</td><td className="py-1.5 text-right">{y}</td></tr>))}</tbody>
        </table>
      </Card>
      {scope === "all" && (
        <Card>
          <SectionTitle>ピリオド別スコア</SectionTitle>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={a.qData} margin={{ top: 5, right: 8, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="name" fontSize={11} stroke={C.sub} />
              <YAxis fontSize={10} allowDecimals={false} stroke={C.sub} />
              <Tooltip contentStyle={{ background: C.card2, border: `1px solid ${C.border}`, color: C.text }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="自チーム" fill={C.orange} radius={[4, 4, 0, 0]} />
              <Bar dataKey="相手" fill={C.oppBlue} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
      {a.ownRows.length > 0 && (<Card><SectionTitle>自チーム 選手別スタッツ({a.scopeLabel})</SectionTitle><StatTable rows={a.ownRows} accent={C.orange} /></Card>)}
      {a.oppRows.length > 0 && (
        <Card>
          <SectionTitle>相手 得点ランキング({a.scopeLabel}・上位5人)</SectionTitle>
          <div className="space-y-1.5">
            {[...a.oppRows].sort((x, y) => y.s.pts - x.s.pts).slice(0, 5).map(({ key, label, s }, i) => (
              <div key={key} className="flex items-center gap-3 py-1.5" style={{ borderBottom: `1px solid ${C.border}44` }}>
                <span className="w-6 text-center text-lg font-bold" style={{ fontFamily: "'Bebas Neue', sans-serif", color: i < 3 ? C.led : C.sub }}>{i + 1}</span>
                <span className="flex-1 font-bold text-sm">{label}</span>
                <span className="text-2xl font-bold" style={{ color: C.oppText, fontFamily: "'Bebas Neue', sans-serif" }}>{s.pts}</span>
                <span className="text-xs" style={{ color: C.sub }}>点</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      {a.reviews.length > 0 && (
        <Card>
          <SectionTitle>選手別パフォーマンスレビュー</SectionTitle>
          <div className="space-y-3">
            {a.reviews.map((r) => (
              <div key={r.key} className="flex gap-2.5">
                <Avatar p={r.p} size={36} />
                <div className="flex-1"><div className="font-bold text-sm">{r.label}</div><div className="text-xs leading-relaxed" style={{ color: C.sub }}>{r.text}</div></div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* AIアナリスト分析: 全体・各Q */}
      {a.goodPoints.length > 0 && (
        <Card style={{ border: `1px solid ${C.win}44` }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">🏀</span>
            <div>
              <div className="text-xs font-bold tracking-widest" style={{ color: C.win }}>AIアナリスト分析{scope === "all" ? "" : ` (${periodLabel2(game, scope)})`}</div>
              <div className="text-[10px]" style={{ color: C.sub }}>プロのミニバス分析アナリストの視点</div>
            </div>
          </div>
          <div className="mb-3">
            <div className="text-sm font-bold mb-2 flex items-center gap-1.5" style={{ color: C.win }}>
              <span className="px-2 py-0.5 rounded text-white text-xs" style={{ background: C.win }}>GOOD</span> 良かった点
            </div>
            <ul className="text-sm space-y-2">
              {a.goodPoints.map((s, i) => (
                <li key={i} className="flex gap-2 leading-relaxed"><span className="shrink-0" style={{ color: C.win }}>◎</span><span>{s}</span></li>
              ))}
            </ul>
          </div>
          <div className="pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
            <div className="text-sm font-bold mb-2 flex items-center gap-1.5" style={{ color: C.orange }}>
              <span className="px-2 py-0.5 rounded text-white text-xs" style={{ background: C.orange }}>NEXT</span> 改善点
            </div>
            <ul className="text-sm space-y-2">
              {a.improvePoints.map((s, i) => (
                <li key={i} className="flex gap-2 leading-relaxed"><span className="shrink-0" style={{ color: C.orange }}>▲</span><span>{s}</span></li>
              ))}
            </ul>
          </div>
          <div className="text-[10px] mt-3 pt-2" style={{ color: C.sub, borderTop: `1px solid ${C.border}` }}>
            ※入力されたスタッツとプレイログをもとに自動生成した分析です。実際の試合内容と照らし合わせてご活用ください。
          </div>
        </Card>
      )}

      {/* 次戦に向けた提言: 全体のみ */}
      {scope === "all" && a.tips.length > 0 && (
        <Card>
          <SectionTitle>次戦に向けた提言</SectionTitle>
          <ul className="text-sm space-y-1.5">{a.tips.map((s, i) => <li key={i} className="flex gap-2"><Target size={14} className="mt-0.5 shrink-0" style={{ color: C.win }} /><span>{s}</span></li>)}</ul>
        </Card>
      )}
    </div>
  );
}

/* ============ ランキング ============ */
function Ranking({ data, setTab, setNav }) {
  const C = useC();
  const [stat, setStat] = useState("pts");
  const [mode, setMode] = useState("avg"); // デフォルトを平均に
  const isPctStat = stat === "fgp" || stat === "ftp";
  const isPmStat = stat === "pm"; // +/-専用
  const rows = data.players.map((p) => {
    const c = careerStats(data.games, p.id);
    if (c.n === 0) return null;
    if (stat === "fgp") {
      if ((c.tot.fga || 0) === 0) return null;
      const v = (c.tot.fgm / c.tot.fga) * 100;
      return { p, n: c.n, total: v, avg: v, made: c.tot.fgm, att: c.tot.fga };
    }
    if (stat === "ftp") {
      if ((c.tot.fta || 0) === 0) return null;
      const v = (c.tot.ftm / c.tot.fta) * 100;
      return { p, n: c.n, total: v, avg: v, made: c.tot.ftm, att: c.tot.fta };
    }
    if (stat === "pm") {
      // +/-は試合ごとのpm合計と平均
      const pmTotal = c.per.reduce((a, x) => a + (x.s.pm || 0), 0);
      const pmAvg = c.per.length > 0 ? pmTotal / c.per.length : 0;
      return { p, n: c.n, total: pmTotal, avg: pmAvg };
    }
    return { p, n: c.n, total: c.tot[stat], avg: c.totAdj[stat] / c.n };
  }).filter(Boolean).sort((a, b) => (mode === "total" ? b.total - a.total : b.avg - a.avg));
  const statOptions = [];
  for (const d of STAT_DEFS) {
    statOptions.push([d.k, d.label]);
    if (d.k === "pts") {
      statOptions.push(["fgp", "フィールドゴール率(FG%)"]);
      statOptions.push(["ftp", "フリースロー率(FT%)"]);
    }
  }
  statOptions.push(["pm", "+/-(出場中の得失点差)"]);
  return (
    <Card>
      <div className="flex gap-2 mb-3">
        <select className={inputCls} style={getInputStyle(C)} value={stat} onChange={(e) => setStat(e.target.value)}>
          {statOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {!isPctStat && (
          <div className="flex rounded-xl overflow-hidden shrink-0 text-sm font-bold" style={{ border: `1px solid ${C.border}` }}>
            {[["total", "合計"], ["avg", "平均"]].map(([k, l]) => (
              <button key={k} className="px-4" onClick={() => setMode(k)}
                style={mode === k ? { background: C.orange, color: "#fff" } : { background: C.card, color: C.sub }}>{l}</button>
            ))}
          </div>
        )}
      </div>
      {isPctStat && <div className="text-[10px] mb-2" style={{ color: C.sub }}>※成功数／試投数からの通算成功率。試投のある選手のみ表示します。</div>}
      {rows.length === 0 ? <div className="text-sm py-4 text-center" style={{ color: C.sub }}>スタッツのある試合がまだありません。</div> : (
        <div>{rows.map((r, i) => (
          <button key={r.p.id} className="w-full flex items-center gap-3 py-2.5 text-left" style={{ borderBottom: `1px solid ${C.border}44` }}
            onClick={() => { setTab("players"); setNav({ playerId: r.p.id }); }}>
            <div className="w-8 text-center text-2xl" style={{ fontFamily: "'Bebas Neue', sans-serif", color: i < 3 ? C.led : C.sub }}>{i + 1}</div>
            <Avatar p={r.p} size={36} />
            <div className="flex-1 min-w-0"><div className="font-bold text-sm truncate">{r.p.codename || r.p.name}</div><div className="text-[10px]" style={{ color: C.sub }}>#{r.p.number}・{isPctStat ? `${r.made}/${r.att}本` : `${r.n}試合`}</div></div>
            <div className="text-2xl font-bold" style={{ fontFamily: "'Bebas Neue', sans-serif",
              color: isPmStat ? ((mode === "total" ? r.total : r.avg) >= 0 ? C.win : C.loss) : "inherit" }}>
              {isPctStat ? `${fmt1(r.total)}%`
                : isPmStat ? (() => { const v = mode === "total" ? r.total : r.avg; return (v >= 0 ? "+" : "") + fmtSmart(v); })()
                : mode === "total" ? fmtSmart(r.total) : fmt1(r.avg)}
            </div>
          </button>
        ))}</div>
      )}
    </Card>
  );
}

/* ============ 設定 ============ */
function SettingsScreen({ data, save }) {
  const C = useC();
  const [team, setTeam] = useState(data.team);
  const [oppForm, setOppForm] = useState({ name: "", kana: "", area: "", numbers: "", tier: "" });
  const [editOpp, setEditOpp] = useState(null);
  const [oppDraft, setOppDraft] = useState(null);
  const oppCount = data.opponents.length;
  const usage = useMemo(() => JSON.stringify(data).length, [data]);
  const usagePct = Math.min(100, Math.round((usage / STORAGE_LIMIT) * 100));
  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `minibasket-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
  };
  const importData = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!d.team || !Array.isArray(d.players) || !Array.isArray(d.games)) throw new Error("bad");
        if (confirm("現在のデータをバックアップの内容で置き換えます。よろしいですか?")) {
          d.games = d.games.map(normGame);
          save(d); setTeam(d.team);
        }
      } catch (err) { alert("読み込めませんでした。このアプリで書き出したJSONファイルを選んでください。"); }
    };
    reader.readAsText(file);
  };
  const startEdit = (o) => { setEditOpp(o.id); setOppDraft({ area: "", ...o }); };
  const commitEdit = () => {
    save({ ...data, opponents: data.opponents.map((x) => (x.id === editOpp ? oppDraft : x)) });
    setEditOpp(null); setOppDraft(null);
  };
  return (
    <div className="space-y-3">
      <Card>
        <SectionTitle>チーム情報</SectionTitle>
        <div className="flex items-center gap-3 mb-3">
          {team.logo ? <img src={team.logo} alt="" className="w-14 h-14 rounded-full object-cover" /> : <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl" style={{ background: C.card2, border: `1px solid ${C.border}` }}>🏀</div>}
          <label className="text-sm font-bold px-3 py-2 rounded-xl" style={{ border: `1px solid ${C.border}` }}>
            ロゴ画像を選ぶ
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) shrinkSquare(f, 256, (d) => setTeam({ ...team, logo: d })); }} />
          </label>
          {team.logo && <button className="text-xs" style={{ color: C.loss }} onClick={() => setTeam({ ...team, logo: "" })}>削除</button>}
        </div>
        <Field label="チーム名"><input className={inputCls} style={getInputStyle(C)} value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} /></Field>
        <Field label="ホームコート"><input className={inputCls} style={getInputStyle(C)} value={team.homeCourt} onChange={(e) => setTeam({ ...team, homeCourt: e.target.value })} /></Field>
        <PrimaryBtn onClick={() => save({ ...data, team })}>チーム情報を保存</PrimaryBtn>
      </Card>
      <Card>
        <div className="flex items-center justify-between mb-1">
          <SectionTitle>対戦相手チーム</SectionTitle>
          <span className="text-xs" style={{ color: oppCount >= MAX_OPPONENTS ? C.loss : C.sub }}>{oppCount}/{MAX_OPPONENTS}</span>
        </div>
        {[...data.opponents].sort(oppCompare).map((o) => (
          <div key={o.id} className="py-2" style={{ borderBottom: `1px solid ${C.border}44` }}>
            {editOpp === o.id ? (
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <OppLogo o={oppDraft} size={44} />
                  <label className="text-xs font-bold px-3 py-2 rounded-xl" style={{ border: `1px solid ${C.border}` }}>
                    ロゴ画像
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) shrinkSquare(f, 64, (d) => setOppDraft({ ...oppDraft, logo: d })); }} />
                  </label>
                  {oppDraft?.logo && <button className="text-xs" style={{ color: C.loss }} onClick={() => setOppDraft({ ...oppDraft, logo: "" })}>削除</button>}
                </div>
                <input className={inputCls + " mb-2"} style={getInputStyle(C)} placeholder="チーム名" value={oppDraft.name} onChange={(e) => setOppDraft({ ...oppDraft, name: e.target.value })} />
                <input className={inputCls + " mb-2"} style={getInputStyle(C)} placeholder="読み(カタカナ・並べ替え用)" value={oppDraft.kana || ""} onChange={(e) => setOppDraft({ ...oppDraft, kana: e.target.value })} />
                <input className={inputCls + " mb-2"} style={getInputStyle(C)} placeholder="地区(都内は区市町村名、他県は県名)" value={oppDraft.area || ""} onChange={(e) => setOppDraft({ ...oppDraft, area: e.target.value })} />
                <input className={inputCls + " mb-2"} style={getInputStyle(C)} placeholder="背番号(カンマ区切り) 4,5,6,7" value={oppDraft.numbers || ""} onChange={(e) => setOppDraft({ ...oppDraft, numbers: e.target.value })} />
                <div className="text-xs mb-1" style={{ color: C.sub }}>強さ(Tier)</div>
                <div className="flex gap-1.5 mb-2">
                  {TIERS.map((t) => (
                    <button key={t.k} onClick={() => setOppDraft({ ...oppDraft, tier: oppDraft.tier === t.k ? "" : t.k })}
                      className="flex-1 py-2 rounded-lg text-xs font-bold"
                      style={oppDraft.tier === t.k ? { background: t.color, color: "#fff" } : { border: `1px solid ${C.border}`, color: C.sub }}
                      title={t.desc}>{t.label}</button>
                  ))}
                </div>
                {oppDraft.tier && <div className="text-[10px] mb-2" style={{ color: C.sub }}>{tierOf(oppDraft.tier)?.desc}</div>}
                <div className="flex gap-3">
                  <button className="text-sm font-bold" style={{ color: C.orange }} onClick={commitEdit}>保存</button>
                  <button className="text-sm" style={{ color: C.sub }} onClick={() => { setEditOpp(null); setOppDraft(null); }}>キャンセル</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <OppLogo o={o} size={36} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm truncate flex items-center gap-1.5">
                    {o.tier && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white shrink-0" style={{ background: tierOf(o.tier)?.color }}>{o.tier}</span>}
                    <span className="truncate">{o.name}</span>
                    {o.area ? <span className="font-normal text-xs shrink-0" style={{ color: C.sub }}>({o.area})</span> : null}
                  </div>
                  <div className="text-xs truncate" style={{ color: C.sub }}>背番号: {o.numbers || "未登録"}</div>
                </div>
                <button className="p-1.5" style={{ color: C.sub }} onClick={() => startEdit(o)}><Pencil size={16} /></button>
                <button className="p-1.5" style={{ color: C.sub }} onClick={() => { if (confirm(`「${o.name}」を削除しますか?`)) save({ ...data, opponents: data.opponents.filter((x) => x.id !== o.id) }); }}><Trash2 size={16} /></button>
              </div>
            )}
          </div>
        ))}
        <div className="mt-3">
          {oppCount >= MAX_OPPONENTS ? (
            <div className="text-xs" style={{ color: C.loss }}>登録上限({MAX_OPPONENTS}チーム)に達しました。</div>
          ) : (
            <>
              <input className={inputCls + " mb-2"} style={getInputStyle(C)} placeholder="チーム名" value={oppForm.name} onChange={(e) => setOppForm({ ...oppForm, name: e.target.value })} />
              <input className={inputCls + " mb-2"} style={getInputStyle(C)} placeholder="読み(カタカナ・並べ替え用)例: フチュウロクショウ" value={oppForm.kana} onChange={(e) => setOppForm({ ...oppForm, kana: e.target.value })} />
              <input className={inputCls + " mb-2"} style={getInputStyle(C)} placeholder="地区(都内は区市町村名、他県は県名)" value={oppForm.area} onChange={(e) => setOppForm({ ...oppForm, area: e.target.value })} />
              <input className={inputCls + " mb-2"} style={getInputStyle(C)} placeholder="背番号(カンマ区切り)" value={oppForm.numbers} onChange={(e) => setOppForm({ ...oppForm, numbers: e.target.value })} />
              <div className="text-xs mb-1" style={{ color: C.sub }}>強さ(Tier)</div>
              <div className="flex gap-1.5 mb-1">
                {TIERS.map((t) => (
                  <button key={t.k} onClick={() => setOppForm({ ...oppForm, tier: oppForm.tier === t.k ? "" : t.k })}
                    className="flex-1 py-2 rounded-lg text-xs font-bold"
                    style={oppForm.tier === t.k ? { background: t.color, color: "#fff" } : { border: `1px solid ${C.border}`, color: C.sub }}
                    title={t.desc}>{t.label}</button>
                ))}
              </div>
              <div className="text-[10px] mb-2" style={{ color: C.sub }}>
                {oppForm.tier ? tierOf(oppForm.tier)?.desc : "A:都大会上位 / B:府中上位レベル / C:同格 / D:格下"}
              </div>
              <PrimaryBtn disabled={!oppForm.name} onClick={() => { save({ ...data, opponents: [...data.opponents, { id: uid(), logo: "", ...oppForm }] }); setOppForm({ name: "", kana: "", area: "", numbers: "", tier: "" }); }}>対戦相手を追加</PrimaryBtn>
            </>
          )}
        </div>
      </Card>
      <Card>
        <SectionTitle>データ管理</SectionTitle>
        <div className="mb-3">
          <div className="flex justify-between text-xs mb-1">
            <span style={{ color: C.sub }}>使用容量</span>
            <span style={{ color: usagePct > 85 ? C.loss : C.sub }}>{(usage / 1024 / 1024).toFixed(2)} MB / 5 MB ({usagePct}%)</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: C.card2 }}>
            <div className="h-full rounded-full" style={{ width: `${usagePct}%`, background: usagePct > 85 ? C.loss : usagePct > 60 ? C.led : C.win }} />
          </div>
          <div className="text-[10px] mt-1" style={{ color: C.sub }}>データはFirebaseにリアルタイム同期されます。</div>
        </div>
        <div className="flex gap-2 mb-2">
          <button className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl font-bold text-sm" style={{ border: `1px solid ${C.border}` }} onClick={exportData}><Download size={16} /> 書き出し(JSON)</button>
          <label className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl font-bold text-sm" style={{ border: `1px solid ${C.border}` }}>
            <Upload size={16} /> 読み込み
            <input type="file" accept=".json,application/json" className="hidden" onChange={importData} />
          </label>
        </div>
        <button className="w-full py-3 rounded-xl font-bold text-sm" style={{ border: `1px solid ${C.loss}`, color: C.loss }}
          onClick={() => { if (confirm("すべてのデータを削除します。よろしいですか?")) save({ team: { name: "府中六小ミニバス", logo: "", homeCourt: "" }, players: [], opponents: [], games: [] }); }}>
          すべてのデータを初期化
        </button>
      </Card>
    </div>
  );
}
