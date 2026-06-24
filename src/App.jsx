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
  // 平均用: スコアが0-0(まだ未入力)の試合は試合数にカウントしない
  const played = per.filter((x) => { const p = gamePts(x.g); return (p.own + p.opp) > 0; });
  const n = played.length;
  const tot = {};
  const totAdj = {}; // 平均用: 3Q試合は4/3倍して4Q換算
  const cntKeys = [...STAT_DEFS.map((d) => d.k), "fgm", "fga", "ftm", "fta"];
  cntKeys.forEach((k) => {
    // 合計は全試合(per)を集計。浮動小数点誤差を防ぐため小数第1位に丸める
    tot[k] = Math.round(per.reduce((a, x) => a + (x.s[k] || 0), 0) * 10) / 10;
    // 平均用の補正合計: 0-0を除いたplayedのみ、3Q試合は4Q換算
    totAdj[k] = played.reduce((a, x) => {
      const factor = regQOf(x.g) === 3 ? 4 / 3 : 1;
      return a + (x.s[k] || 0) * factor;
    }, 0);
  });
  return { per, n, tot, totAdj, gamesPlayed: per.length };
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

function ScoreBoard({ own, opp, oppName, oppLogo, date, small }) {
  const C = useC();
  const win = own > opp, draw = own === opp;
  return (
    <div className="rounded-xl px-4 py-3 flex items-center justify-between"
      style={{ background: C.board, border: `1px solid ${C.border}`, fontFamily: "'Bebas Neue', sans-serif" }}>
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
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden" style={{ background: CT.bg, color: CT.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
        @keyframes splashIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        @keyframes splashLine { from { width: 0; opacity: 0; } to { width: 64px; opacity: 1; } }
        @keyframes splashGlow { 0%,100% { opacity: .35; } 50% { opacity: .6; } }
        @keyframes splashPulse { 0%,100% { opacity: .13; transform: translate(-50%,-50%) scale(1); } 50% { opacity: .18; transform: translate(-50%,-50%) scale(1.04); } }
      `}</style>

      {/* 背景透かし: ロゴのみを表示(blend-modeで白フチを消す) */}
      {data?.team?.logo && (
        <img src={data.team.logo} alt="" aria-hidden="true"
          className="absolute pointer-events-none select-none"
          style={{ top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            width: "min(100vw, 100vh)", height: "min(100vw, 100vh)",
            objectFit: "contain",
            opacity: theme === "dark" ? 0.45 : 0.35,
            mixBlendMode: theme === "dark" ? "screen" : "multiply",
            animation: "splashPulse 4s ease-in-out infinite" }} />
      )}
      {/* ロゴがない場合のコートライン装飾 */}
      {!data?.team?.logo && (
        <div className="absolute inset-0 opacity-[0.04]"
          style={{ backgroundImage: `repeating-linear-gradient(90deg, ${CT.text} 0 1px, transparent 1px 80px)` }} />
      )}
      {/* 中央グロー */}
      <div className="absolute" style={{ top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        width: 340, height: 340, borderRadius: "50%",
        background: `radial-gradient(circle, ${CT.orange}18, transparent 70%)`,
        animation: "splashGlow 3s ease-in-out infinite" }} />

      <div className="relative flex flex-col items-center" style={{ animation: "splashIn .7s ease-out" }}>
        {/* チーム名 */}
        <div className="text-3xl font-bold text-center px-6 mb-3" style={{ letterSpacing: "0.02em" }}>{data?.team?.name || "府中六小ミニバス"}</div>

        {/* 装飾ライン */}
        <div className="h-[2px] rounded-full mb-3" style={{ background: `linear-gradient(90deg, transparent, ${CT.orange}, transparent)`, animation: "splashLine .9s ease-out .3s both" }} />

        {/* タイトル */}
        <div className="text-lg font-bold" style={{ color: CT.orange, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.34em", paddingLeft: "0.34em" }}>GAME MANAGEMENT</div>
        <div className="text-xs mt-1" style={{ color: CT.sub, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.5em", paddingLeft: "0.5em" }}>APP</div>
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
  const w = results.filter((r) => r.own > r.opp).length;
  const l = results.filter((r) => r.own < r.opp).length;
  const n = results.length;
  const avgPF = n ? results.reduce((a, r) => a + r.own, 0) / n : 0;
  const avgPA = n ? results.reduce((a, r) => a + r.opp, 0) / n : 0;
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
        <SectionTitle>シーズン成績</SectionTitle>
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
            {recentGames.map(({ g, own, opp }) => (
              <button key={g.id} className="w-full text-left" onClick={() => { setTab("games"); setNav({ gameId: g.id }); }}>
                <div className="mb-1 px-1 text-xs" style={{ color: C.sub }}>{g.tournament || "練習試合"}{g.ot ? `・OT${g.ot}` : ""}</div>
                <ScoreBoard small own={own} opp={opp} oppName={oppName(g.opponentId)} oppLogo={getOpp(g.opponentId)?.logo} date={g.date} />
              </button>
            ))}
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
                  <div className="text-2xl font-bold" style={{ color: C.orange, fontFamily: "'Bebas Neue', sans-serif" }}>{c.n ? fmt1(c.tot.pts / c.n) : "–"}</div>
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
  if (!p) return null;
  const games = [...data.games].sort(gameOrderAsc);
  const { per, n, tot, totAdj, gamesPlayed } = careerStats(games, p.id);
  const has3Q = per.some((x) => regQOf(x.g) === 3);
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
        <SectionTitle>通算成績({gamesPlayed}試合{n < gamesPlayed ? `・平均は${n}試合で算出` : ""})</SectionTitle>
        {has3Q && <div className="text-[10px] mb-2" style={{ color: C.sub }}>※3ピリオド制の試合は、平均値のみ4ピリオド換算(×4/3)で算出しています。合計はそのままです。</div>}
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

          {/* ===== 下段: シュート効率(案Z) FG%折れ線+平均線 ===== */}
          {(() => {
            const effChart = per.map((x, i) => ({
              name: x.g.date?.slice(5) || `G${i + 1}`,
              gid: x.g.id,
              fgp: x.s.fga > 0 ? Math.round((x.s.fgm / x.s.fga) * 1000) / 10 : null,
            }));
            const fgpVals = effChart.map((d) => d.fgp).filter((v) => v !== null);
            const fgpAvg = fgpVals.length ? Math.round(fgpVals.reduce((a, b) => a + b, 0) / fgpVals.length * 10) / 10 : null;
            return (
              <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.border}` }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="text-[11px] font-bold" style={{ color: C.sub }}>シュート効率(FG%)</div>
                  <span className="flex items-center gap-1 text-[10px]" style={{ color: C.sub }}>
                    <span className="inline-block w-5 h-0.5 rounded" style={{ background: C.orange }} />FG%
                  </span>
                  <span className="flex items-center gap-1 text-[10px]" style={{ color: C.sub }}>
                    <span className="inline-block" style={{ width: 20, borderTop: `1.5px dashed ${C.orange}` }} />平均
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={effChart} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}
                    onClick={(e) => { const pl = e?.activePayload?.[0]?.payload; if (pl) setSelGame(selGame === pl.gid ? null : pl.gid); }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="name" fontSize={10} stroke={C.sub} />
                    <YAxis domain={[0, 100]} fontSize={10} stroke={C.sub} tickFormatter={(v) => `${v}%`} />
                    <Tooltip contentStyle={{ background: C.card2, border: `1px solid ${C.border}`, color: C.text }}
                      formatter={(val) => val !== null ? [`${val}%`, "FG%"] : ["–", "FG%"]} />
                    {fgpAvg !== null && (
                      <ReferenceLine y={fgpAvg} stroke={C.orange} strokeDasharray="5 4" strokeWidth={1.5}
                        label={{ value: `平均 ${fmt1(fgpAvg)}%`, position: "insideTopRight", fill: C.orange, fontSize: 10 }} />
                    )}
                    <Line type="monotone" dataKey="fgp" name="FG%" stroke={C.orange} strokeWidth={2.5} connectNulls
                      dot={(props) => {
                        if (props.payload.fgp === null) return null;
                        const active = props.payload.gid === selGame;
                        return <circle key={`fg-${props.payload.gid}`} cx={props.cx} cy={props.cy}
                          r={active ? 6 : 3} fill={active ? C.led : C.orange}
                          stroke={active ? "#fff" : "none"} strokeWidth={active ? 2 : 0} />;
                      }} />
                  </LineChart>
                </ResponsiveContainer>
                <div className="text-[10px] mt-1" style={{ color: C.sub }}>
                  ※試投なし(0本)の試合は表示されません。FT%は下の表で確認できます。
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
    qLen: 6, otLen: 3, ot: 0, regQ: 4,
    qScores: { own: padQ([]), opp: padQ([]) },
  });
  const periods = (+f.regQ || 4) + (+f.ot || 0);
  const setQ = (side, i, v) => setF({ ...f, qScores: { ...f.qScores, [side]: f.qScores[side].map((x, j) => (j === i ? v : x)) } });
  const oppFull = !f.opponentId && data.opponents.length >= MAX_OPPONENTS;
  // 同じ日の試合数(自分以外)
  const sameDayGames = data.games.filter((x) => x.date === f.date && x.id !== initial?.id);

  const handleSave = () => {
    // 4Q→3Qに変更し、Q4にデータがある場合は確認してクリア
    const wasRegQ = initial ? regQOf(initial) : 4;
    if (wasRegQ === 4 && (+f.regQ === 3)) {
      const q4Score = (+f.qScores?.own?.[3] || 0) + (+f.qScores?.opp?.[3] || 0);
      const q4Events = (initial?.events || []).filter((e) => e.q === 4).length;
      if (q4Score > 0 || q4Events > 0) {
        const msg = `3ピリオド制に変更すると、第4ピリオドの${q4Score > 0 ? "スコア" : ""}${q4Score > 0 && q4Events > 0 ? "と" : ""}${q4Events > 0 ? `プレイログ(${q4Events}件)` : ""}が削除されます。よろしいですか?`;
        if (!confirm(msg)) return;
        // Q4のスコアとプレイログをクリア
        const own = [...f.qScores.own]; const opp = [...f.qScores.opp];
        own[3] = ""; opp[3] = "";
        const cleared = { ...f, qScores: { own, opp }, _clearQ4: true };
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
  return (
    <button className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
      style={{ background: C.card2 }} onClick={() => setNav({ gameId: g.id })}>
      <span className="text-xs w-20 text-left shrink-0" style={{ color: C.sub }}>{g.date}</span>
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
  const games = [...data.games].sort(gameOrderDesc);
  const results = games.map((g) => ({ g, ...gamePts(g) }));
  if (adding) return (
    <GameForm data={data} onCancel={() => setAdding(false)}
      onSave={(f) => {
        let oppId = f.opponentId, opponents = data.opponents;
        if (!oppId) { oppId = uid(); opponents = [...opponents, { id: oppId, name: f.newOpp, area: "", numbers: "", logo: "" }]; }
        const g = normGame({ id: uid(), date: f.date, tournament: f.tournament, opponentId: oppId, qLen: f.qLen, otLen: f.otLen, ot: f.ot, regQ: f.regQ, order: +f.order || 0, qScores: f.qScores, events: [] });
        save({ ...data, opponents, games: [...data.games, g] });
        setAdding(false); setNav({ gameId: g.id });
      }} />
  );
  const wld = (gs) => { const rs = gs.map((g) => gamePts(g)); return { w: rs.filter((r) => r.own > r.opp).length, l: rs.filter((r) => r.own < r.opp).length, d: rs.filter((r) => r.own === r.opp).length }; };
  const byOpp = data.opponents.map((o) => ({ o, gs: games.filter((g) => g.opponentId === o.id) })).filter((x) => x.gs.length > 0).sort((a, b) => nameCompare(a.o.name, b.o.name));
  const tourNames = [...new Set(games.map((g) => g.tournament || "練習試合"))];
  const byTour = tourNames.map((t) => ({ t, gs: games.filter((g) => (g.tournament || "練習試合") === t) })).sort((a, b) => (b.gs[0]?.date || "").localeCompare(a.gs[0]?.date || ""));
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

      {/* 相手レベル別・府中市内の成績 */}
      {games.length > 0 && (() => {
        const wldOf2 = (rs) => ({ w: rs.filter((r) => r.own > r.opp).length, l: rs.filter((r) => r.own < r.opp).length, d: rs.filter((r) => r.own === r.opp).length });
        const fuchuRs = results.filter((r) => (getOpp(r.g.opponentId)?.area || "").includes("府中"));
        const fuchu2 = wldOf2(fuchuRs);
        const tierStats2 = TIERS.map((t) => {
          const rs = results.filter((r) => getOpp(r.g.opponentId)?.tier === t.k);
          return { t, ...wldOf2(rs), n: rs.length, rs };
        });
        return (
          <Card>
            <SectionTitle>相手レベル別の成績</SectionTitle>
            {/* 府中市内 */}
            <button className="w-full flex items-center gap-3 pb-3 text-left" style={{ borderBottom: `1px solid ${C.border}` }}
              onClick={() => setOpenKey(openKey === "fuchu" ? null : "fuchu")}>
              <div className="text-2xl">🏙️</div>
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
          {games.length === 0 && <Card className="text-center text-sm py-8 col-span-2" style={{ color: C.sub }}>試合を登録すると、ここに一覧が表示されます。</Card>}
          {games.map((g) => {
            const { own, opp } = gamePts(g);
            return (
              <button key={g.id} className="w-full text-left" onClick={() => setNav({ gameId: g.id })}>
                <div className="mb-1 px-1 text-xs" style={{ color: C.sub }}>{g.tournament || "練習試合"}{g.ot ? `・OT${g.ot}` : ""}</div>
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
        save({ ...data, games: data.games.map((x) => x.id === g.id ? normGame({ ...x, date: f.date, tournament: f.tournament, opponentId: f.opponentId || x.opponentId, qLen: f.qLen, otLen: f.otLen, ot: f.ot, regQ: f.regQ, order: +f.order || 0, qScores: f.qScores, events: f._clearQ4 ? (x.events || []).filter((e) => e.q !== 4) : x.events, lineups: f._clearQ4 ? Object.fromEntries(Object.entries(x.lineups || {}).filter(([k]) => +k !== 4)) : x.lineups }) : x) });
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
      <ScoreBoard own={own} opp={opp} oppName={oppName(g.opponentId)} oppLogo={getOpp(g.opponentId)?.logo} date={g.date} />
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
      {sub === "analysis" && <GameAnalysis data={data} game={g} oppName={oppName} onReport={setReport} isAdmin={isAdmin} />}
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
  const [qLocked, setQLocked] = useState(false); // Q固定モード
  const [flash, setFlash] = useState(null); // 直近に記録したアクションのフラッシュ表示
  const flashTimer = useRef(null);

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
                  <button className="p-1" style={{ color: insertAfter === e.id ? C.led : C.sub }}
                    onClick={() => setInsertAfter(insertAfter === e.id ? null : e.id)}><CornerDownRight size={14} /></button>
                  <button className="p-1" style={{ color: C.sub }} onClick={() => delEvent(e.id)}><Trash2 size={14} /></button>
                </>}
              </div>
            ))}
          </div>
        )}
      </Card>
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
function GameAnalysis({ data, game, oppName, onReport, isAdmin }) {
  const C = useC();
  const [scope, setScope] = useState("all");
  const a = analysisFor(data, game, scope);
  const mips = scope === "all" ? mipOf(game, data.players) : [];
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
  const [mode, setMode] = useState("total");
  const isPctStat = stat === "fgp" || stat === "ftp"; // 率系スタッツ
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
            <div className="text-2xl font-bold" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>{isPctStat ? `${fmt1(r.total)}%` : mode === "total" ? fmtSmart(r.total) : fmt1(r.avg)}</div>
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
