import React, { useState, useEffect, useMemo, useRef } from "react";
import { loadData, saveData } from "./firebase.js";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import {
  Home, ClipboardList, Users, Trophy, Settings, Plus, Trash2,
  ChevronLeft, ChevronDown, Pencil, Target, Clock, Download, Upload,
  Link2, Award, CornerDownRight, X, Film, FileText, Printer, UsersRound,
} from "lucide-react";

/* ============ ストレージ(Claude上でもVercel上でも動く) ============ */
const localShim = {
  async get(key) {
    const v = window.localStorage.getItem(key);
    if (v === null) throw new Error("not found");
    return { key, value: v };
  },
  async set(key, value) { window.localStorage.setItem(key, value); return { key, value }; },
};
const store = () => (typeof window !== "undefined" && window.storage ? window.storage : localShim);

/* ============ デザイントークン(ダーク) ============ */
const C = {
  bg: "#0C1220", card: "#161F33", card2: "#1E2A45", border: "#2A3856",
  text: "#E9EEF8", sub: "#8FA0C0",
  orange: "#FF7A3D", led: "#FFB23E", win: "#3DBE7B", loss: "#E25C5C",
  board: "#070C16", nav: "#0A101E", oppBlue: "#5B74A8", oppText: "#7E94BC",
};
const MAX_OPPONENTS = 100;
const MAX_PLAYERS = 30;
const MAX_GAMES = 200;
const STORE_KEY = "fuchu6-minibasket-v1";
const STORAGE_LIMIT = 5 * 1024 * 1024;
const TEAM_KEY = "TEAM"; // チーム全体につけるイベント(24秒TOなど)

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

/* ============ ユーティリティ ============ */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
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
      cb(cv.toDataURL("image/jpeg", 0.7));
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

/* ============ ピリオド(Q/OT)ヘルパー ============ */
const periodsOf = (g) => 4 + (+g?.ot || 0);
const periodLabel = (i) => (i <= 4 ? `Q${i}` : `OT${i - 4}`);
const periodLen = (g, i) => (i <= 4 ? (+g?.qLen || 6) * 60 : (+g?.otLen || 3) * 60);
const padQ = (arr) => { const a = [...(arr || [])]; while (a.length < 6) a.push(""); return a; };
const normGame = (g) => {
  const { scoreSheet, ...rest } = g; // 容量対策: スコアシート写真は廃止
  return { ...rest, qLen: +g.qLen || 6, otLen: +g.otLen || 3, ot: +g.ot || 0,
    qScores: { own: padQ(g.qScores?.own), opp: padQ(g.qScores?.opp) },
    events: g.events || [], lineups: g.lineups || {}, videos: g.videos || {} };
};

/* ============ スタッツ計算 ============ */
const matchKey = (e, side, key) =>
  e.side === side && (side === "own" ? e.playerId === key : e.oppNum === key);

// コート上の時間帯: Qごとの出場メンバー登録 + 交代IN/OUTを合成
function courtIntervals(events, side, key, g) {
  const map = {}; let has = false;
  const lineups = g?.lineups || {};
  for (let q = 1; q <= periodsOf(g); q++) {
    const len = periodLen(g, q);
    let evs = (events || [])
      .filter((e) => matchKey(e, side, key) && e.q === q && (e.action === "IN" || e.action === "OUT"))
      .map((e) => ({ a: e.action, t: parseClock(e.time, len) ?? (e.action === "IN" ? len : 0) }));
    const inLineup = side === "own" && (lineups[q] || []).includes(key);
    if (inLineup && !evs.some((e) => e.a === "IN")) evs = [{ a: "IN", t: len }, ...evs];
    evs.sort((a, b) => b.t - a.t);
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

const gamePts = (g) => {
  const p = periodsOf(g);
  return { own: qSum(g.qScores?.own, p), opp: qSum(g.qScores?.opp, p) };
};

function careerStats(games, playerId) {
  const per = games.map((g) => ({ g, s: aggStats(g.events, "own", playerId, "all", g) })).filter((x) => hasStats(x.s));
  const n = per.length;
  const tot = {};
  [...STAT_DEFS.map((d) => d.k), "fgm", "fga", "ftm", "fta"].forEach((k) => (tot[k] = per.reduce((a, x) => a + (x.s[k] || 0), 0)));
  return { per, n, tot };
}

function mipOf(game, players) {
  const rows = players.map((p) => ({ p, s: aggStats(game.events, "own", p.id, "all", game) })).filter((r) => hasStats(r.s));
  if (rows.length === 0) return [];
  const max = Math.max(...rows.map((r) => r.s.eff));
  return rows.filter((r) => r.s.eff === max);
}

/* ============ 試合分析(画面とレポートで共用) ============ */
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

  const qData = Array.from({ length: periods }, (_, i) => ({
    name: periodLabel(i + 1),
    自チーム: +(game.qScores?.own?.[i]) || 0,
    相手: +(game.qScores?.opp?.[i]) || 0,
  }));

  const insights = [];
  const tips = [];
  const scopeLabel = scope === "all" ? "試合全体" : periodLabel(scope);
  if (ownT.n === 0) {
    insights.push(`${scopeLabel}のプレイログが未入力のため、スコアのみで表示しています。スタッツを入力すると分析が表示されます。`);
  } else {
    const fgp = ownT.fga > 0 ? ownT.fgm / ownT.fga : null;
    if (fgp !== null) insights.push(`シュート成功率 ${pct(ownT.fgm, ownT.fga)}(${ownT.fgm}/${ownT.fga})。${fgp >= 0.45 ? "効率よく得点できています。" : fgp >= 0.35 ? "平均的な水準です。" : "確率の高いシュート選択が課題です。"}`);
    if (oppT.fga > 0) insights.push(`相手のシュート成功率は ${pct(oppT.fgm, oppT.fga)}(${oppT.fgm}/${oppT.fga})。${oppT.fgm / oppT.fga > 0.45 ? "イージーシュートを許しています。" : "ディフェンスは機能しています。"}`);
    if (ownT.reb + oppT.reb > 0) insights.push(`リバウンドは ${ownT.reb} 対 ${oppT.reb}${ownT.reb > oppT.reb ? "で上回りました。" : ownT.reb < oppT.reb ? "で劣勢でした。" : "の互角。"}`);
    insights.push(`TOは自 ${ownT.to}・相手 ${oppT.to}。${ownT.to < oppT.to ? "ボール管理で優位に立ちました。" : ownT.to > oppT.to ? "ボールロストが失点機につながった可能性があります。" : ""}`);
    if (scope === "all") {
      const margins = qData.map((x) => x.自チーム - x.相手);
      const keyQ = win ? margins.indexOf(Math.max(...margins)) : margins.indexOf(Math.min(...margins));
      insights.push(`${win ? "勝因" : ownPts === oppPts ? "焦点" : "敗因"}の候補: ${qData[keyQ].name} の得失点差(${margins[keyQ] >= 0 ? "+" : ""}${margins[keyQ]})が最も大きく、流れを${win ? "つかんだ" : "失った"}時間帯です。`);
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

  const reviews = scope === "all" ? [...ownRows].filter((r) => hasStats(r.s)).sort((a, b) => b.s.eff - a.s.eff).map((r, i) => {
    const s = r.s;
    const parts = [];
    parts.push(`${s.pts}得点(FG ${s.fgm}/${s.fga}${s.fta > 0 ? `、FT ${s.ftm}/${s.fta}` : ""})`);
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
    ["リバウンド(OR/DR)", `${ownT.reb} (${ownT.or}/${ownT.dr})`, `${oppT.reb} (${oppT.or}/${oppT.dr})`],
    ["アシスト", ownT.ast, oppT.ast],
    ["スティール", ownT.stl, oppT.stl],
    ["ブロック", ownT.blk, oppT.blk],
    ["ターンオーバー", ownT.to, oppT.to],
    ["ファウル", ownT.pf, oppT.pf],
    ["タイムアウト", timeoutsOf(game.events, "own", scope), timeoutsOf(game.events, "opp", scope)],
  ];

  return { periods, ownT, oppT, ownPts, oppPts, ortg, drtg, net, win, ownRows, oppRows, qData, insights, tips, reviews, compRows, scopeLabel };
}

// 詳細レポート用: 時系列の流れ分析
function flowAnalysis(data, game) {
  const periods = periodsOf(game);
  const sorted = [...(game.events || [])].map((e, i) => ({ e, i })).sort((a, b) => a.e.q - b.e.q || a.i - b.i).map((x) => x.e);
  let ro = 0, rp = 0, leadChanges = 0, prevSign = 0;
  let runTeam = null, runPts = 0;
  const perPeriod = {};
  const note = (q, text) => { (perPeriod[q] = perPeriod[q] || []).push(text); };

  for (const e of sorted) {
    const pts = PTS_OF[e.action];
    if (!pts) continue;
    if (e.side === runTeam) runPts += pts;
    else {
      if (runTeam && runPts >= 6) note(e.q, `${runTeam === "own" ? data.team.name : "相手"}が${runPts}-0のラン`);
      runTeam = e.side; runPts = pts;
    }
    if (e.side === "own") ro += pts; else rp += pts;
    const sign = Math.sign(ro - rp);
    if (sign !== 0 && prevSign !== 0 && sign !== prevSign) leadChanges++;
    if (sign !== 0) prevSign = sign;
  }
  if (runTeam && runPts >= 6 && sorted.length) note(sorted[sorted.length - 1].q, `${runTeam === "own" ? data.team.name : "相手"}が${runPts}-0のラン`);

  const periodNotes = [];
  for (let q = 1; q <= periods; q++) {
    const o = +(game.qScores?.own?.[q - 1]) || 0;
    const p = +(game.qScores?.opp?.[q - 1]) || 0;
    const rows = data.players.map((pl) => ({ pl, s: aggStats(game.events, "own", pl.id, q, game) })).filter((r) => r.s.pts > 0).sort((a, b) => b.s.pts - a.s.pts);
    const parts = [`${periodLabel(q)}: ${o}-${p}${o > p ? "で上回る" : o < p ? "で劣勢" : "の互角"}`];
    if (rows[0]) parts.push(`#${rows[0].pl.number} ${rows[0].pl.codename || rows[0].pl.name}が${rows[0].s.pts}得点`);
    if (perPeriod[q]) parts.push(...perPeriod[q]);
    const tos = timeoutsOf(game.events, "own", q) + timeoutsOf(game.events, "opp", q);
    if (tos > 0) parts.push(`タイムアウト${tos}回`);
    periodNotes.push(parts.join("。") + "。");
  }
  return { periodNotes, leadChanges, sorted };
}

/* ============ 共通UI ============ */
const Card = ({ children, className = "", style }) => (
  <div className={`rounded-2xl p-4 ${className}`} style={{ background: C.card, border: `1px solid ${C.border}`, ...style }}>{children}</div>
);
const SectionTitle = ({ children }) => (
  <div className="text-xs font-bold tracking-widest mb-2" style={{ color: C.orange }}>{children}</div>
);
const Field = ({ label, children }) => (
  <label className="block mb-3">
    <div className="text-xs mb-1" style={{ color: C.sub }}>{label}</div>
    {children}
  </label>
);
const inputStyle = { background: "#0F1830", border: `1px solid ${C.border}`, color: C.text };
const inputCls = "w-full rounded-xl px-3 py-2.5 text-base";
const PrimaryBtn = ({ children, ...props }) => (
  <button {...props} className="w-full text-white font-bold py-3 rounded-xl active:opacity-80 disabled:opacity-40"
    style={{ background: C.orange }}>{children}</button>
);
const Seg = ({ items, value, onChange }) => (
  <div className="flex rounded-xl overflow-hidden text-sm font-bold" style={{ border: `1px solid ${C.border}` }}>
    {items.map(([k, l]) => (
      <button key={k} className="flex-1 py-2.5" onClick={() => onChange(k)}
        style={value === k ? { background: C.orange, color: "#fff" } : { background: C.card, color: C.sub }}>{l}</button>
    ))}
  </div>
);

function ScoreBoard({ own, opp, oppName, oppLogo, date, small }) {
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

  if (!data) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: C.bg, color: C.sub }}>読み込み中…</div>
  );

  const getOpp = (id) => data.opponents.find((o) => o.id === id);
  const oppName = (id) => getOpp(id)?.name || "対戦相手";
  const props = { data, save, nav, setNav, setTab, oppName, getOpp };

  return (
    <div className="min-h-screen pb-24" style={{ background: C.bg, color: C.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
        input::placeholder, textarea::placeholder { color: #5A6B8F; }
        select option { background: #0F1830; }
        @media print {
          body * { visibility: hidden; }
          .report-root, .report-root * { visibility: visible; }
          .report-root { position: absolute !important; inset: 0 !important; overflow: visible !important; }
          .no-print { display: none !important; }
        }
      `}</style>
      <header className="sticky top-0 z-20 px-4 py-3 flex items-center gap-2.5 shadow-lg"
        style={{ background: C.nav, borderBottom: `1px solid ${C.border}` }}>
        {data.team.logo
          ? <img src={data.team.logo} alt="" className="w-8 h-8 rounded-full object-cover" />
          : <span className="text-xl">🏀</span>}
        <div className="font-bold truncate">{data.team.name}</div>
        <span className="ml-auto text-xs" style={{ color: saveState.startsWith("error") ? C.loss : C.sub }}>
          {saveState === "saving" ? "保存中…" : saveState.startsWith("error") ? saveState.slice(6) : ""}
        </span>
      </header>

      <main className="max-w-md mx-auto px-3 pt-3">
        {tab === "home" && <Dashboard {...props} />}
        {tab === "games" && !nav.gameId && <GameList {...props} />}
        {tab === "games" && nav.gameId && <GameDetail {...props} />}
        {tab === "players" && !nav.playerId && <PlayerList {...props} />}
        {tab === "players" && nav.playerId && <PlayerKarte {...props} />}
        {tab === "ranking" && <Ranking {...props} />}
        {tab === "settings" && <SettingsScreen {...props} />}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-20 flex justify-around py-1.5"
        style={{ background: C.nav, borderTop: `1px solid ${C.border}` }}>
        {[
          { t: "home", icon: Home, label: "ホーム" },
          { t: "games", icon: ClipboardList, label: "試合" },
          { t: "players", icon: Users, label: "選手" },
          { t: "ranking", icon: Trophy, label: "ランキング" },
          { t: "settings", icon: Settings, label: "設定" },
        ].map(({ t, icon: I, label }) => (
          <button key={t} onClick={() => { setTab(t); setNav({}); }}
            className="flex flex-col items-center px-2 py-1" style={{ color: tab === t ? C.led : C.sub }}>
            <I size={20} />
            <span className="text-[10px] mt-0.5">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ============ ダッシュボード ============ */
function Dashboard({ data, setTab, setNav, oppName, getOpp }) {
  const games = [...data.games].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const results = games.map((g) => ({ g, ...gamePts(g) }));
  const w = results.filter((r) => r.own > r.opp).length;
  const l = results.filter((r) => r.own < r.opp).length;
  const n = results.length;
  const avgPF = n ? results.reduce((a, r) => a + r.own, 0) / n : 0;
  const avgPA = n ? results.reduce((a, r) => a + r.opp, 0) / n : 0;

  const star = useMemo(() => {
    let best = null;
    for (const p of data.players) {
      const c = careerStats(data.games, p.id);
      if (c.n === 0) continue;
      const avg = c.tot.pts / c.n;
      if (!best || avg > best.avg) best = { p, avg };
    }
    return best;
  }, [data]);

  return (
    <div className="space-y-3">
      <Card>
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

      {star && (
        <Card>
          <SectionTitle>注目選手</SectionTitle>
          <button className="flex items-center gap-3 w-full text-left"
            onClick={() => { setTab("players"); setNav({ playerId: star.p.id }); }}>
            <Avatar p={star.p} size={52} />
            <div className="flex-1">
              <div className="font-bold text-lg">{star.p.codename || star.p.name}</div>
              <div className="text-xs" style={{ color: C.sub }}>#{star.p.number}・{star.p.grade}年</div>
            </div>
            <div className="text-right">
              <div className="text-4xl font-bold" style={{ color: C.orange, fontFamily: "'Bebas Neue', sans-serif" }}>{fmt1(star.avg)}</div>
              <div className="text-xs" style={{ color: C.sub }}>平均得点</div>
            </div>
          </button>
        </Card>
      )}

      <div>
        <div className="flex items-center justify-between mb-2 px-1">
          <SectionTitle>直近の試合</SectionTitle>
          <button className="text-xs font-bold" style={{ color: C.orange }} onClick={() => setTab("games")}>すべて見る</button>
        </div>
        {results.length === 0 ? (
          <Card className="text-center text-sm py-8" style={{ color: C.sub }}>まだ試合がありません。「試合」タブから登録しましょう。</Card>
        ) : (
          <div className="space-y-2">
            {results.slice(0, 3).map(({ g, own, opp }) => (
              <button key={g.id} className="w-full" onClick={() => { setTab("games"); setNav({ gameId: g.id }); }}>
                <ScoreBoard small own={own} opp={opp} oppName={oppName(g.opponentId)} oppLogo={getOpp(g.opponentId)?.logo} date={g.date} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============ 選手 ============ */
function PlayerForm({ initial, onSave, onCancel }) {
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
      <Field label="名前(フルネーム)"><input className={inputCls} style={inputStyle} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="山田 太郎" /></Field>
      <Field label="コードネーム(試合入力時の表示名)"><input className={inputCls} style={inputStyle} value={f.codename} onChange={(e) => set("codename", e.target.value)} placeholder="タロー" /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="背番号"><input className={inputCls} style={inputStyle} inputMode="numeric" value={f.number} onChange={(e) => set("number", e.target.value)} placeholder="4" /></Field>
        <Field label="ビブスNo."><input className={inputCls} style={inputStyle} inputMode="numeric" value={f.bibs || ""} onChange={(e) => set("bibs", e.target.value)} placeholder="12" /></Field>
        <Field label="学年">
          <select className={inputCls} style={inputStyle} value={f.grade} onChange={(e) => set("grade", e.target.value)}>
            {[1,2,3,4,5,6].map((g) => <option key={g} value={g}>{g}年</option>)}
          </select>
        </Field>
      </div>
      <div className="text-xs mb-1" style={{ color: C.sub }}>目標(1試合平均・5つまで)</div>
      <div className="space-y-2 mb-2">
        {targets.map((t, i) => (
          <div key={i} className="flex gap-2 items-center">
            <select className="flex-1 rounded-xl px-2 py-2 text-sm" style={inputStyle} value={t.stat}
              onChange={(e) => setTarget(i, "stat", e.target.value)}>
              {STAT_DEFS.map((d) => <option key={d.k} value={d.k}>{d.label}{INVERSE_STATS.has(d.k) ? "(以下)" : ""}</option>)}
            </select>
            <input className="w-20 rounded-xl px-2 py-2 text-sm text-center" style={inputStyle} inputMode="decimal"
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
      <Field label="目標メモ(自由記入)"><textarea className={inputCls} style={inputStyle} rows={2} value={f.goal} onChange={(e) => set("goal", e.target.value)} placeholder="声を出してチームを引っ張る" /></Field>
      <div className="flex gap-2 mt-1">
        <button className="flex-1 py-3 rounded-xl font-bold" style={{ border: `1px solid ${C.border}`, color: C.sub }} onClick={onCancel}>キャンセル</button>
        <button className="flex-1 py-3 rounded-xl text-white font-bold disabled:opacity-40" style={{ background: C.orange }}
          disabled={!f.name || !f.number} onClick={() => onSave({ ...f, targets: targets.filter((t) => t.value !== "") })}>保存する</button>
      </div>
    </Card>
  );
}

function PlayerList({ data, save, setNav }) {
  const [adding, setAdding] = useState(false);
  const players = [...data.players].sort((a, b) => (+a.number || 0) - (+b.number || 0));
  if (adding) return (
    <PlayerForm onCancel={() => setAdding(false)}
      onSave={(f) => { save({ ...data, players: [...data.players, { ...f, id: uid() }] }); setAdding(false); }} />
  );
  return (
    <div className="space-y-2">
      <button onClick={() => setAdding(true)}
        className="w-full flex items-center justify-center gap-1 py-3 rounded-2xl font-bold text-white disabled:opacity-40" style={{ background: C.orange }}
        disabled={players.length >= MAX_PLAYERS}>
        <Plus size={18} /> 選手を追加 {players.length >= MAX_PLAYERS ? `(上限${MAX_PLAYERS}人)` : ""}
      </button>
      {players.length === 0 && (
        <Card className="text-center text-sm py-8" style={{ color: C.sub }}>選手を登録すると、ここに一覧が表示されます。</Card>
      )}
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
  );
}

function PlayerKarte({ data, save, nav, setNav }) {
  const p = data.players.find((x) => x.id === nav.playerId);
  const [editing, setEditing] = useState(false);
  if (!p) return null;
  const games = [...data.games].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const { per, n, tot } = careerStats(games, p.id);
  const chart = per.map((x, i) => ({ name: x.g.date?.slice(5) || `G${i + 1}`, 得点: x.s.pts, EFF: x.s.eff }));
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
          <button style={{ color: C.sub }} onClick={() => setEditing(true)}><Pencil size={18} /></button>
          <button style={{ color: C.sub }} onClick={() => {
            if (confirm(`「${p.name}」を削除しますか?`)) { save({ ...data, players: data.players.filter((x) => x.id !== p.id) }); setNav({}); }
          }}><Trash2 size={18} /></button>
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
                const actual = n > 0 ? tot[t.stat] / n : 0;
                const inv = INVERSE_STATS.has(t.stat);
                const achieved = inv ? actual <= goal : actual >= goal;
                const ratio = inv
                  ? (actual > 0 ? Math.min(1, goal / actual) : 1)
                  : (goal > 0 ? Math.min(1, actual / goal) : 0);
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
        <SectionTitle>通算成績({n}試合)</SectionTitle>
        {n === 0 ? <div className="text-sm" style={{ color: C.sub }}>スタッツのある試合がまだありません。</div> : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ["得点", tot.pts, fmt1(tot.pts / n)],
                ["リバウンド", tot.reb, fmt1(tot.reb / n)],
                ["アシスト", tot.ast, fmt1(tot.ast / n)],
                ["スティール", tot.stl, fmt1(tot.stl / n)],
                ["EFF", tot.eff, fmt1(tot.eff / n)],
                ["TO", tot.to, fmt1(tot.to / n)],
              ].map(([l, t, a]) => (
                <div key={l} className="rounded-xl py-2.5" style={{ background: C.card2 }}>
                  <div className="text-2xl font-bold" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>{t}</div>
                  <div className="text-[10px]" style={{ color: C.sub }}>{l}(平均 {a})</div>
                </div>
              ))}
            </div>
            <div className="flex justify-around mt-3 pt-3 text-center text-sm" style={{ borderTop: `1px solid ${C.border}` }}>
              <div><span className="font-bold text-lg">{pct(tot.fgm, tot.fga)}</span><div className="text-[10px]" style={{ color: C.sub }}>FG% ({tot.fgm}/{tot.fga})</div></div>
              <div><span className="font-bold text-lg">{pct(tot.ftm, tot.fta)}</span><div className="text-[10px]" style={{ color: C.sub }}>FT% ({tot.ftm}/{tot.fta})</div></div>
              <div><span className="font-bold text-lg">{fmt1(tot.min / n)}</span><div className="text-[10px]" style={{ color: C.sub }}>平均出場(分)</div></div>
            </div>
          </>
        )}
      </Card>

      {n > 0 && (
        <Card>
          <SectionTitle>試合ごとの推移</SectionTitle>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chart} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="name" fontSize={10} stroke={C.sub} />
              <YAxis fontSize={10} allowDecimals={false} stroke={C.sub} />
              <Tooltip contentStyle={{ background: C.card2, border: `1px solid ${C.border}`, color: C.text }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="得点" stroke={C.orange} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="EFF" stroke={C.win} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {n > 0 && (
        <Card>
          <SectionTitle>試合別スタッツ</SectionTitle>
          <div className="overflow-x-auto -mx-1">
            <table className="text-xs w-full min-w-[520px]">
              <thead><tr style={{ color: C.sub, borderBottom: `1px solid ${C.border}` }}>
                {["日付","得点","REB","AST","STL","BLK","TO","PF","分","+/-","EFF"].map((h) => <th key={h} className="py-1.5 px-1 text-left whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody>
                {[...per].reverse().map(({ g, s }) => (
                  <tr key={g.id} style={{ borderBottom: `1px solid ${C.border}44` }}>
                    <td className="py-1.5 px-1 whitespace-nowrap">{g.date?.slice(5)}</td>
                    <td className="px-1 font-bold" style={{ color: C.orange }}>{s.pts}</td><td className="px-1">{s.reb}</td>
                    <td className="px-1">{s.ast}</td><td className="px-1">{s.stl}</td><td className="px-1">{s.blk}</td>
                    <td className="px-1">{s.to}</td><td className="px-1">{s.pf}</td><td className="px-1">{s.min}</td>
                    <td className="px-1" style={{ color: s.pm === null ? C.sub : s.pm >= 0 ? C.win : C.loss }}>{s.pm === null ? "–" : (s.pm >= 0 ? "+" : "") + s.pm}</td>
                    <td className="px-1 font-bold">{s.eff}</td>
                  </tr>
                ))}
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
  const [f, setF] = useState(initial ? { ...normGame(initial), newOpp: "" } : {
    date: new Date().toISOString().slice(0, 10), tournament: "",
    opponentId: data.opponents[0]?.id || "", newOpp: "",
    qLen: 6, otLen: 3, ot: 0,
    qScores: { own: padQ([]), opp: padQ([]) },
  });
  const periods = 4 + (+f.ot || 0);
  const setQ = (side, i, v) => {
    setF({ ...f, qScores: { ...f.qScores, [side]: f.qScores[side].map((x, j) => (j === i ? v : x)) } });
  };
  const oppFull = !f.opponentId && data.opponents.length >= MAX_OPPONENTS;
  return (
    <Card>
      <SectionTitle>{initial ? "試合情報を編集" : "試合を登録"}</SectionTitle>
      <Field label="日付"><input type="date" className={inputCls} style={inputStyle} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="大会名"><input className={inputCls} style={inputStyle} value={f.tournament} onChange={(e) => setF({ ...f, tournament: e.target.value })} placeholder="市民大会 予選リーグ" /></Field>
      <Field label="対戦相手">
        <select className={inputCls} style={inputStyle} value={f.opponentId} onChange={(e) => setF({ ...f, opponentId: e.target.value })}>
          <option value="">(新しいチームを入力)</option>
          {data.opponents.map((o) => <option key={o.id} value={o.id}>{o.name}{o.area ? `(${o.area})` : ""}</option>)}
        </select>
      </Field>
      {!f.opponentId && (
        oppFull
          ? <div className="text-xs mb-3" style={{ color: C.loss }}>対戦相手の登録上限({MAX_OPPONENTS}チーム)に達しています。設定タブで整理してください。</div>
          : <Field label="新しい相手チーム名"><input className={inputCls} style={inputStyle} value={f.newOpp} onChange={(e) => setF({ ...f, newOpp: e.target.value })} placeholder="◯◯ミニバス" /></Field>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Qの時間">
          <select className={inputCls} style={inputStyle} value={f.qLen} onChange={(e) => setF({ ...f, qLen: +e.target.value })}>
            <option value={5}>5分</option><option value={6}>6分</option>
          </select>
        </Field>
        <Field label="オーバータイム">
          <select className={inputCls} style={inputStyle} value={f.ot} onChange={(e) => setF({ ...f, ot: +e.target.value })}>
            <option value={0}>なし</option><option value={1}>OT1まで</option><option value={2}>OT2まで</option>
          </select>
        </Field>
        <Field label="OTの時間">
          <select className={inputCls} style={inputStyle} value={f.otLen} disabled={!f.ot} onChange={(e) => setF({ ...f, otLen: +e.target.value })}>
            <option value={2}>2分</option><option value={3}>3分</option>
          </select>
        </Field>
      </div>
      <div className="text-xs mb-1" style={{ color: C.sub }}>ピリオド別スコア(プレイログの得点も自動で加算されます)</div>
      <div className="overflow-x-auto">
        <div className="grid items-center text-center text-sm mb-3 gap-1.5" style={{ gridTemplateColumns: `64px repeat(${periods}, 1fr)`, minWidth: periods > 4 ? 360 : 0 }}>
          <div></div>{Array.from({ length: periods }, (_, i) => <div key={i} className="text-xs" style={{ color: C.sub }}>{periodLabel(i + 1)}</div>)}
          <div className="text-xs font-bold">自チーム</div>
          {Array.from({ length: periods }, (_, i) => <input key={i} inputMode="numeric" className="rounded-lg py-2 text-center w-full" style={inputStyle} value={f.qScores.own[i]} onChange={(e) => setQ("own", i, e.target.value)} />)}
          <div className="text-xs font-bold">相手</div>
          {Array.from({ length: periods }, (_, i) => <input key={i} inputMode="numeric" className="rounded-lg py-2 text-center w-full" style={inputStyle} value={f.qScores.opp[i]} onChange={(e) => setQ("opp", i, e.target.value)} />)}
        </div>
      </div>
      <div className="flex gap-2">
        <button className="flex-1 py-3 rounded-xl font-bold" style={{ border: `1px solid ${C.border}`, color: C.sub }} onClick={onCancel}>キャンセル</button>
        <button className="flex-1 py-3 rounded-xl text-white font-bold disabled:opacity-40" style={{ background: C.orange }}
          disabled={!f.date || (!f.opponentId && (!f.newOpp || oppFull))} onClick={() => onSave(f)}>保存する</button>
      </div>
    </Card>
  );
}

/* ============ 試合一覧 ============ */
function GameRow({ g, setNav }) {
  const { own, opp } = gamePts(g);
  return (
    <button className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
      style={{ background: C.card2 }} onClick={() => setNav({ gameId: g.id })}>
      <span className="text-xs w-20 text-left" style={{ color: C.sub }}>{g.date}</span>
      <span className="flex-1 text-left text-xs truncate" style={{ color: C.sub }}>{g.tournament || "練習試合"}</span>
      <span className="font-bold text-lg" style={{ fontFamily: "'Bebas Neue', sans-serif", color: own > opp ? C.win : own < opp ? C.loss : C.sub }}>
        {own}-{opp}
      </span>
    </button>
  );
}

function GameList({ data, save, setNav, oppName, getOpp }) {
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState("list");
  const [openKey, setOpenKey] = useState(null);
  const games = [...data.games].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  if (adding) return (
    <GameForm data={data} onCancel={() => setAdding(false)}
      onSave={(f) => {
        let oppId = f.opponentId, opponents = data.opponents;
        if (!oppId) { oppId = uid(); opponents = [...opponents, { id: oppId, name: f.newOpp, area: "", numbers: "", logo: "" }]; }
        const g = normGame({ id: uid(), date: f.date, tournament: f.tournament, opponentId: oppId, qLen: f.qLen, otLen: f.otLen, ot: f.ot, qScores: f.qScores, events: [] });
        save({ ...data, opponents, games: [...data.games, g] });
        setAdding(false); setNav({ gameId: g.id });
      }} />
  );

  const wld = (gs) => {
    const rs = gs.map((g) => gamePts(g));
    return { w: rs.filter((r) => r.own > r.opp).length, l: rs.filter((r) => r.own < r.opp).length, d: rs.filter((r) => r.own === r.opp).length };
  };

  const byOpp = data.opponents.map((o) => ({ o, gs: games.filter((g) => g.opponentId === o.id) }))
    .filter((x) => x.gs.length > 0).sort((a, b) => b.gs.length - a.gs.length);

  const tourNames = [...new Set(games.map((g) => g.tournament || "練習試合"))];
  const byTour = tourNames.map((t) => ({ t, gs: games.filter((g) => (g.tournament || "練習試合") === t) }))
    .sort((a, b) => (b.gs[0]?.date || "").localeCompare(a.gs[0]?.date || ""));

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
    <div className="space-y-2">
      <button onClick={() => setAdding(true)}
        className="w-full flex items-center justify-center gap-1 py-3 rounded-2xl font-bold text-white disabled:opacity-40" style={{ background: C.orange }}
        disabled={games.length >= MAX_GAMES}>
        <Plus size={18} /> 試合を登録 {games.length >= MAX_GAMES ? `(上限${MAX_GAMES}試合)` : ""}
      </button>
      <Seg items={[["list", "試合一覧"], ["byTour", "大会別"], ["byOpp", "相手別"]]} value={mode} onChange={(m) => { setMode(m); setOpenKey(null); }} />

      {mode === "list" && (
        <>
          {games.length === 0 && <Card className="text-center text-sm py-8" style={{ color: C.sub }}>試合を登録すると、ここに一覧が表示されます。</Card>}
          {games.map((g) => {
            const { own, opp } = gamePts(g);
            return (
              <button key={g.id} className="w-full text-left" onClick={() => setNav({ gameId: g.id })}>
                <div className="mb-1 px-1 text-xs" style={{ color: C.sub }}>{g.tournament || "練習試合"}{g.ot ? `・OT${g.ot}` : ""}</div>
                <ScoreBoard small own={own} opp={opp} oppName={oppName(g.opponentId)} oppLogo={getOpp(g.opponentId)?.logo} date={g.date} />
              </button>
            );
          })}
        </>
      )}

      {mode === "byTour" && (
        <>
          {byTour.length === 0 && <Card className="text-center text-sm py-8" style={{ color: C.sub }}>試合を登録すると、大会別に表示されます。</Card>}
          {byTour.map(({ t, gs }) => (
            <Card key={t}>
              <button className="w-full flex items-center gap-2.5 text-left" onClick={() => setOpenKey(openKey === t ? null : t)}>
                <Trophy size={20} style={{ color: C.led }} className="shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-bold truncate">{t}</div>
                  <div className="text-xs" style={{ color: C.sub }}>{gs.length}試合・{gs[gs.length - 1]?.date}〜{gs[0]?.date}</div>
                </div>
                <WL gs={gs} />
                <ChevronDown size={18} style={{ color: C.sub, transform: openKey === t ? "rotate(180deg)" : "none" }} />
              </button>
              {openKey === t && (
                <div className="mt-3 space-y-2">
                  {gs.map((g) => <GameRow key={g.id} g={g} setNav={setNav} />)}
                </div>
              )}
            </Card>
          ))}
        </>
      )}

      {mode === "byOpp" && (
        <>
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
              {openKey === o.id && (
                <div className="mt-3 space-y-2">
                  {gs.map((g) => <GameRow key={g.id} g={g} setNav={setNav} />)}
                </div>
              )}
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

/* ============ 試合詳細 ============ */
function GameDetail({ data, save, nav, setNav, oppName, getOpp }) {
  const g = data.games.find((x) => x.id === nav.gameId);
  const [sub, setSub] = useState("entry");
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
        save({ ...data, games: data.games.map((x) => x.id === g.id ? normGame({ ...x, date: f.date, tournament: f.tournament, opponentId: f.opponentId || x.opponentId, qLen: f.qLen, otLen: f.otLen, ot: f.ot, qScores: f.qScores }) : x) });
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
          <button style={{ color: C.sub }} onClick={copyLink} title="この試合のリンクをコピー"><Link2 size={18} /></button>
          <button style={{ color: C.sub }} onClick={() => setEditing(true)}><Pencil size={18} /></button>
          <button style={{ color: C.sub }} onClick={() => {
            if (confirm("この試合を削除しますか?スタッツも消えます。")) {
              save({ ...data, games: data.games.filter((x) => x.id !== g.id) });
              setNav({});
            }
          }}><Trash2 size={18} /></button>
        </div>
      </div>
      <div className="px-1 text-xs" style={{ color: C.sub }}>{g.tournament || "練習試合"}{g.ot ? `・OT${g.ot}(${g.otLen}分)` : ""}・Q{g.qLen}分</div>
      <ScoreBoard own={own} opp={opp} oppName={oppName(g.opponentId)} oppLogo={getOpp(g.opponentId)?.logo} date={g.date} />
      {mips.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl flex-wrap" style={{ background: C.card, border: `1px solid ${C.led}55` }}>
          <Award size={18} style={{ color: C.led }} />
          <span className="text-xs font-bold" style={{ color: C.led }}>MIP</span>
          {mips.map(({ p, s }) => (
            <span key={p.id} className="text-sm font-bold">#{p.number} {p.codename || p.name}<span className="text-xs font-normal" style={{ color: C.sub }}> (EFF {s.eff})</span></span>
          ))}
        </div>
      )}
      <div className="flex rounded-xl overflow-hidden text-sm font-bold" style={{ border: `1px solid ${C.border}` }}>
        {[["entry", "入力"], ["analysis", "分析"], ["media", "資料"]].map(([k, l]) => (
          <button key={k} className="flex-1 py-2.5" onClick={() => setSub(k)}
            style={sub === k ? { background: C.orange, color: "#fff" } : { background: C.card, color: C.sub }}>{l}</button>
        ))}
      </div>
      {sub === "entry" && <PlayByPlay data={data} save={save} game={g} oppName={oppName} />}
      {sub === "analysis" && <GameAnalysis data={data} game={g} oppName={oppName} onReport={setReport} />}
      {sub === "media" && <GameMedia data={data} save={save} game={g} oppName={oppName} />}
    </div>
  );
}

/* ============ Play by Play 入力 ============ */
function PlayByPlay({ data, save, game, oppName }) {
  const [q, setQ] = useState(1);
  const [time, setTime] = useState("");
  const [side, setSide] = useState("own");
  const [sel, setSel] = useState(null);
  const [insertAfter, setInsertAfter] = useState(null);
  const [showLineup, setShowLineup] = useState(false);
  const opponent = data.opponents.find((o) => o.id === game.opponentId);
  const oppNums = (opponent?.numbers || "").split(/[,、\s]+/).filter(Boolean);
  const periods = periodsOf(game);
  const lineup = game.lineups?.[q] || [];
  const players = [...data.players].sort((a, b) => {
    const ai = lineup.includes(a.id) ? 0 : 1, bi = lineup.includes(b.id) ? 0 : 1;
    return ai - bi || (+a.number || 0) - (+b.number || 0);
  });

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
      } else {
        events = [...x.events, ev];
      }
      return { ...x, events, qScores: pts ? applyScore(x.qScores, side, q - 1, pts) : x.qScores };
    });
    if (insertAfter) setInsertAfter(ev.id);
  };

  const delEvent = (id) => {
    const ev = (game.events || []).find((e) => e.id === id);
    const pts = ev ? PTS_OF[ev.action] || 0 : 0;
    if (insertAfter === id) setInsertAfter(null);
    updGame((x) => ({
      ...x,
      events: x.events.filter((e) => e.id !== id),
      qScores: pts ? applyScore(x.qScores, ev.side, ev.q - 1, -pts) : x.qScores,
    }));
  };

  const pName = (id) => {
    if (id === TEAM_KEY) return "チーム";
    const p = data.players.find((x) => x.id === id);
    return p ? `#${p.number} ${p.codename || p.name}` : "?";
  };
  const events = game.events || [];

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex gap-1.5 mb-3 overflow-x-auto">
          {Array.from({ length: periods }, (_, i) => i + 1).map((n) => (
            <button key={n} className="flex-1 min-w-14 py-2.5 rounded-lg font-bold"
              style={q === n ? { background: C.orange, color: "#fff" } : { background: C.card2, color: C.sub }}
              onClick={() => setQ(n)}>{periodLabel(n)}</button>
          ))}
        </div>

        <button className="w-full flex items-center gap-2 mb-3 text-sm font-bold rounded-xl px-3 py-2.5"
          style={{ background: C.card2, color: lineup.length ? C.win : C.sub }}
          onClick={() => setShowLineup(!showLineup)}>
          <UsersRound size={16} />
          {periodLabel(q)}の出場メンバー({lineup.length}人)
          <ChevronDown size={16} className="ml-auto" style={{ transform: showLineup ? "rotate(180deg)" : "none" }} />
        </button>
        {showLineup && (
          <div className="mb-3 p-3 rounded-xl" style={{ background: C.board }}>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {[...data.players].sort((a, b) => (+a.number || 0) - (+b.number || 0)).map((p) => (
                <button key={p.id} onClick={() => toggleLineup(p.id)}
                  className="px-3 py-1.5 rounded-full text-xs font-bold"
                  style={lineup.includes(p.id) ? { background: C.win, color: "#fff" } : { border: `1px solid ${C.border}`, color: C.sub }}>
                  #{p.number}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px]" style={{ color: C.sub }}>登録した選手は{periodLabel(q)}フル出場として時間・+/-を計算(途中交代はIN/OUTで上書き)</span>
              {q > 1 && <button className="text-xs font-bold shrink-0 ml-2" style={{ color: C.orange }} onClick={copyPrevLineup}>前と同じ</button>}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 mb-3">
          <Clock size={16} style={{ color: C.sub }} />
          <input className="rounded-lg px-2 py-1.5 w-24 text-center" style={inputStyle}
            placeholder={`残り ${Math.floor(periodLen(game, q) / 60)}:00`}
            value={time} onChange={(e) => setTime(e.target.value)} />
          <span className="text-xs" style={{ color: C.sub }}>任意({periodLabel(q)}は{Math.floor(periodLen(game, q) / 60)}分)</span>
        </div>
        <div className="mb-3">
          <Seg items={[["own", "自チーム"], ["opp", `相手(${oppName(game.opponentId)})`]]} value={side}
            onChange={(k) => { setSide(k); setSel(null); }} />
        </div>

        {side === "own" ? (
          data.players.length === 0 ? <div className="text-sm mb-3" style={{ color: C.sub }}>先に「選手」タブで選手を登録してください。</div> : (
            <div className="flex flex-wrap gap-1.5 mb-3">
              <button onClick={() => setSel(TEAM_KEY)}
                className="px-3 py-2 rounded-full text-sm font-bold"
                style={sel === TEAM_KEY ? { background: C.led, color: "#000" } : { border: `1px dashed ${C.led}`, color: C.led }}>
                チーム
              </button>
              {players.map((p) => (
                <button key={p.id} onClick={() => setSel(p.id)}
                  className="px-3 py-2 rounded-full text-sm font-bold"
                  style={sel === p.id ? { background: C.orange, color: "#fff" } : { border: `1px solid ${lineup.includes(p.id) ? C.win : C.border}`, color: C.text }}>
                  #{p.number} {p.codename || p.name}{lineup.includes(p.id) ? " ●" : ""}
                </button>
              ))}
            </div>
          )
        ) : (
          <div className="flex flex-wrap gap-1.5 mb-3 items-center">
            <button onClick={() => setSel(TEAM_KEY)}
              className="px-3 py-2 rounded-full text-sm font-bold"
              style={sel === TEAM_KEY ? { background: C.led, color: "#000" } : { border: `1px dashed ${C.led}`, color: C.led }}>
              チーム
            </button>
            {oppNums.map((n) => (
              <button key={n} onClick={() => setSel(n)}
                className="px-3 py-2 rounded-full text-sm font-bold"
                style={sel === n ? { background: C.oppBlue, color: "#fff" } : { border: `1px solid ${C.border}`, color: C.text }}>#{n}</button>
            ))}
            <input className="rounded-full px-3 py-2 w-20 text-sm" style={inputStyle} placeholder="#番号"
              onKeyDown={(e) => { if (e.key === "Enter" && e.target.value) { setSel(e.target.value.replace("#", "")); e.target.value = ""; } }}
              onBlur={(e) => { if (e.target.value) { setSel(e.target.value.replace("#", "")); e.target.value = ""; } }} />
            {sel && sel !== TEAM_KEY && !oppNums.includes(sel) && <span className="text-sm font-bold px-2.5 py-1 rounded-full text-white" style={{ background: C.oppBlue }}>#{sel}</span>}
          </div>
        )}

        <div className="grid grid-cols-3 gap-1.5">
          {ACTIONS.map((a) => {
            const disabled = !sel || (a.sub && sel === TEAM_KEY);
            return (
              <button key={a.k} disabled={disabled} onClick={() => addEvent(a.k)}
                className="py-2.5 rounded-xl text-xs font-bold disabled:opacity-30 active:scale-95 transition-transform"
                style={{
                  border: `1px solid ${a.good ? C.win : a.bad ? C.loss : C.border}`,
                  color: a.good ? C.win : a.bad ? C.loss : C.text,
                  background: C.card2,
                }}>{a.label}</button>
            );
          })}
          <button onClick={() => addEvent("TOT", true)}
            className="py-2.5 rounded-xl text-xs font-bold active:scale-95 transition-transform col-span-3"
            style={{ border: `1px solid ${C.led}`, color: C.led, background: C.card2 }}>
            タイムアウト({side === "own" ? "自チーム" : "相手"})
          </button>
        </div>
        <div className="text-xs mt-2 text-center" style={{ color: C.sub }}>
          {sel === TEAM_KEY ? "チーム全体のプレイとして記録します(24秒TOなど)" : sel ? "得点プレイはスコアボードに自動加算されます" : "選手(またはチーム)を選んでからアクションをタップ"}
        </div>
      </Card>

      {insertAfter && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold"
          style={{ background: "#3A2A14", border: `1px solid ${C.led}`, color: C.led }}>
          <CornerDownRight size={16} />
          <span className="flex-1">差し込みモード: 選択した行の直後に追加します</span>
          <button onClick={() => setInsertAfter(null)}><X size={16} /></button>
        </div>
      )}

      <Card>
        <SectionTitle>プレイログ({events.length}・時系列)</SectionTitle>
        {events.length === 0 ? <div className="text-sm" style={{ color: C.sub }}>記録されたプレイはまだありません。原則は時系列で入力し、漏れは行の「⤵」で差し込めます。</div> : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {events.map((e) => (
              <div key={e.id} className="flex items-center gap-1.5 text-sm py-1.5 rounded-lg px-1"
                style={{ borderBottom: `1px solid ${C.border}44`, background: insertAfter === e.id ? "#3A2A1466" : "transparent" }}>
                <span className="text-[10px] font-bold text-white rounded px-1.5 py-0.5" style={{ background: e.side === "own" ? C.orange : C.oppBlue }}>{periodLabel(e.q)}</span>
                <span className="text-xs w-9" style={{ color: C.sub }}>{e.time || "–"}</span>
                <span className="flex-1 truncate">
                  {e.side === "own" ? pName(e.playerId) : (e.oppNum === TEAM_KEY ? "相手チーム" : `相手 #${e.oppNum}`)}
                  <span style={{ color: C.sub }}> – {ACTION_LABEL[e.action]}</span>
                </span>
                {PTS_OF[e.action] ? <span className="text-xs font-bold" style={{ color: C.led }}>+{PTS_OF[e.action]}</span> : null}
                <button className="p-1" title="この直後に差し込む" style={{ color: insertAfter === e.id ? C.led : C.sub }}
                  onClick={() => setInsertAfter(insertAfter === e.id ? null : e.id)}><CornerDownRight size={14} /></button>
                <button className="p-1" style={{ color: C.sub }} onClick={() => delEvent(e.id)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ============ 資料(動画・書き出し) ============ */
function GameMedia({ data, save, game, oppName }) {
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
      return {
        period: periodLabel(e.q), time: e.time || "",
        team: e.side === "own" ? data.team.name : oppName(game.opponentId),
        num: isTeam ? "" : e.side === "own" ? (p?.number || "") : e.oppNum,
        name: isTeam ? "チーム" : e.side === "own" ? (p?.codename || p?.name || "") : "",
        action: ACTION_LABEL[e.action], pts: pts || "",
        score: `${ro}-${rp}`,
      };
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

  return (
    <div className="space-y-3">
      <Card>
        <SectionTitle><span className="inline-flex items-center gap-1"><Film size={13} /> 試合動画(YouTube)</span></SectionTitle>
        <div className="space-y-3">
          {vidKeys.map((k) => {
            const label = k === "all" ? "フル/その他" : periodLabel(+k);
            const id = ytId(videos[k]);
            return (
              <div key={k}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold w-16" style={{ color: C.sub }}>{label}</span>
                  <input className="flex-1 rounded-lg px-2 py-1.5 text-sm" style={inputStyle} placeholder="https://youtu.be/..."
                    value={videos[k] || ""}
                    onChange={(e) => upd({ videos: { ...videos, [k]: e.target.value } })} />
                </div>
                {id && (
                  <div className="rounded-xl overflow-hidden" style={{ aspectRatio: "16/9" }}>
                    <iframe width="100%" height="100%" src={`https://www.youtube.com/embed/${id}`}
                      title={`動画 ${label}`} frameBorder="0" allowFullScreen
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <SectionTitle>TeamHub用 書き出し(時系列 Play by Play)</SectionTitle>
        <div className="text-xs mb-3" style={{ color: C.sub }}>Q1から順に時系列で並べたスタッツです。CSVまたはテキストで書き出して、TeamHubへの転記に使えます。</div>
        <div className="flex gap-2">
          <button className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl font-bold text-sm" style={{ border: `1px solid ${C.border}` }} onClick={downloadCSV}>
            <Download size={16} /> CSV
          </button>
          <button className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl font-bold text-sm" style={{ border: `1px solid ${C.border}` }} onClick={copyText}>
            {copied ? "コピーしました!" : "テキストをコピー"}
          </button>
        </div>
        {(game.events || []).length > 0 && (
          <pre className="mt-3 p-3 rounded-xl text-[10px] leading-relaxed overflow-x-auto max-h-48 overflow-y-auto"
            style={{ background: C.board, color: C.sub }}>{toText()}</pre>
        )}
      </Card>
    </div>
  );
}

/* ============ レポート(印刷/PDF) ============ */
function ReportView({ data, game, mode, oppName, onClose }) {
  const a = analysisFor(data, game, "all");
  const flow = mode === "detail" ? flowAnalysis(data, game) : null;
  const mips = mipOf(game, data.players);
  const opp = oppName(game.opponentId);
  const title = mode === "simple" ? "試合レポート(簡易版)" : "試合レポート(詳細版)";
  const rootRef = useRef(null);

  const downloadHTML = () => {
    const inner = rootRef.current?.innerHTML || "";
    const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>${title} ${game.date || ""}</title>
<style>body{font-family:sans-serif;margin:24px;color:#111;max-width:760px}h1{font-size:20px}</style>
</head><body>${inner}</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url; el.download = `report-${game.date || "game"}-${mode}.html`; el.click();
    URL.revokeObjectURL(url);
  };

  const T = ({ children }) => <h2 style={{ fontSize: 15, borderLeft: "4px solid #E8632C", paddingLeft: 8, marginTop: 24, marginBottom: 8, fontWeight: 700 }}>{children}</h2>;
  const th = { border: "1px solid #ccc", padding: "4px 6px", fontSize: 12, textAlign: "left", background: "#f3f4f6" };
  const td = { border: "1px solid #ccc", padding: "4px 6px", fontSize: 12 };
  const ulS = { fontSize: 13, paddingLeft: 20, margin: "4px 0" };

  const BoxTable = ({ rows }) => (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead><tr>{["選手","得点","FG","FT","OR","DR","AST","STL","BLK","TO","PF","分","+/-","EFF"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>
        {[...rows].sort((x, y) => y.s.eff - x.s.eff).map(({ key, label, s }) => (
          <tr key={key}>
            <td style={td}>{label}</td><td style={{ ...td, fontWeight: 700 }}>{s.pts}</td>
            <td style={td}>{s.fgm}/{s.fga}</td><td style={td}>{s.ftm}/{s.fta}</td>
            <td style={td}>{s.or}</td><td style={td}>{s.dr}</td><td style={td}>{s.ast}</td>
            <td style={td}>{s.stl}</td><td style={td}>{s.blk}</td><td style={td}>{s.to}</td>
            <td style={td}>{s.pf}</td><td style={td}>{s.min}</td>
            <td style={td}>{s.pm === null ? "–" : (s.pm >= 0 ? "+" : "") + s.pm}</td>
            <td style={{ ...td, fontWeight: 700 }}>{s.eff}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="report-root fixed inset-0 z-50 overflow-y-auto" style={{ background: "#fff", color: "#111" }}>
      <div className="no-print sticky top-0 flex items-center gap-2 px-4 py-3 shadow" style={{ background: "#fff", borderBottom: "1px solid #ddd" }}>
        <button className="flex items-center gap-1 text-sm font-bold px-3 py-2 rounded-xl text-white" style={{ background: C.orange }}
          onClick={() => window.print()}>
          <Printer size={16} /> 印刷 / PDF保存
        </button>
        <button className="flex items-center gap-1 text-sm font-bold px-3 py-2 rounded-xl" style={{ border: "1px solid #ccc", color: "#333" }}
          onClick={downloadHTML}>
          <Download size={16} /> HTML
        </button>
        <button className="ml-auto p-2" style={{ color: "#555" }} onClick={onClose}><X size={20} /></button>
      </div>

      <div ref={rootRef} className="max-w-2xl mx-auto px-5 py-6">
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{title}</h1>
        <p style={{ fontSize: 13, color: "#555", margin: 0 }}>
          {game.date}・{game.tournament || "練習試合"}{game.ot ? `・OT${game.ot}` : ""}
        </p>
        <p style={{ fontSize: 24, fontWeight: 700, margin: "12px 0 4px" }}>
          {data.team.name} {a.ownPts} – {a.oppPts} {opp}
          <span style={{ fontSize: 14, marginLeft: 10, color: a.win ? "#1B8A52" : a.ownPts === a.oppPts ? "#666" : "#C03A3A" }}>
            {a.win ? "WIN" : a.ownPts === a.oppPts ? "引分" : "LOSE"}
          </span>
        </p>
        {mips.length > 0 && (
          <p style={{ fontSize: 13, margin: 0 }}>MIP: {mips.map(({ p, s }) => `#${p.number} ${p.codename || p.name}(EFF ${s.eff})`).join("、")}</p>
        )}

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
          <tbody>
            {a.compRows.map(([l, x, y]) => <tr key={l}><td style={td}>{l}</td><td style={td}>{x}</td><td style={td}>{y}</td></tr>)}
            <tr><td style={td}>レーティング(O/D/Net)</td>
              <td style={td} colSpan={2}>
                {a.ortg === null ? "–" : `オフェンス ${fmt1(a.ortg)} / ディフェンス ${fmt1(a.drtg)} / ネット ${a.net >= 0 ? "+" : ""}${fmt1(a.net)}`}
              </td></tr>
          </tbody>
        </table>

        {a.ownRows.length > 0 && (<><T>{data.team.name} ボックススコア</T><BoxTable rows={a.ownRows} /></>)}
        {a.oppRows.length > 0 && (<><T>{opp} ボックススコア</T><BoxTable rows={a.oppRows} /></>)}

        <T>試合分析サマリー</T>
        <ul style={ulS}>{a.insights.map((s, i) => <li key={i}>{s}</li>)}</ul>
        <p style={{ fontWeight: 700, marginBottom: 4, fontSize: 13 }}>次戦に向けた提言</p>
        <ul style={ulS}>{a.tips.map((s, i) => <li key={i}>{s}</li>)}</ul>

        {mode === "detail" && flow && (
          <>
            <T>試合の流れ(時系列分析)</T>
            <ul style={ulS}>{flow.periodNotes.map((s, i) => <li key={i}>{s}</li>)}</ul>
            <p style={{ fontSize: 13 }}>リードチェンジ: {flow.leadChanges}回</p>

            {a.reviews.length > 0 && (
              <>
                <T>選手別パフォーマンスレビュー</T>
                <ul style={ulS}>{a.reviews.map((r) => <li key={r.key}><b>{r.label}</b>: {r.text}</li>)}</ul>
              </>
            )}

            {flow.sorted.length > 0 && (
              <>
                <T>プレイバイプレイ(全記録)</T>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead><tr>{["期間","残り","チーム","選手","アクション"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {flow.sorted.map((e) => {
                      const isTeam = e.playerId === TEAM_KEY || e.oppNum === TEAM_KEY;
                      const p = e.side === "own" && !isTeam ? data.players.find((x) => x.id === e.playerId) : null;
                      return (
                        <tr key={e.id}>
                          <td style={td}>{periodLabel(e.q)}</td><td style={td}>{e.time || ""}</td>
                          <td style={td}>{e.side === "own" ? data.team.name : opp}</td>
                          <td style={td}>{isTeam ? "チーム" : e.side === "own" ? `#${p?.number || ""} ${p?.codename || p?.name || ""}` : `#${e.oppNum}`}</td>
                          <td style={td}>{ACTION_LABEL[e.action]}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
        <p style={{ fontSize: 11, color: "#888", marginTop: 24 }}>作成: {data.team.name} 記録アプリ</p>
      </div>
    </div>
  );
}

/* ============ 試合分析(画面) ============ */
function GameAnalysis({ data, game, oppName, onReport }) {
  const [scope, setScope] = useState("all");
  const a = analysisFor(data, game, scope);
  const mips = scope === "all" ? mipOf(game, data.players) : [];

  const StatTable = ({ rows, accent }) => (
    <div className="overflow-x-auto -mx-1">
      <table className="text-xs w-full min-w-[600px]">
        <thead><tr style={{ color: C.sub, borderBottom: `1px solid ${C.border}` }}>
          {["選手","得点","FG","FT","OR","DR","AST","STL","BLK","TO","PF","分","+/-","EFF"].map((h) => <th key={h} className="py-1.5 px-1 text-left whitespace-nowrap">{h}</th>)}
        </tr></thead>
        <tbody>
          {[...rows].sort((x, y) => y.s.eff - x.s.eff).map(({ key, label, s }) => (
            <tr key={key} style={{ borderBottom: `1px solid ${C.border}44` }}>
              <td className="py-1.5 px-1 whitespace-nowrap font-bold">{label}</td>
              <td className="px-1 font-bold" style={{ color: accent }}>{s.pts}</td>
              <td className="px-1">{s.fgm}/{s.fga}</td><td className="px-1">{s.ftm}/{s.fta}</td>
              <td className="px-1">{s.or}</td><td className="px-1">{s.dr}</td>
              <td className="px-1">{s.ast}</td><td className="px-1">{s.stl}</td><td className="px-1">{s.blk}</td>
              <td className="px-1">{s.to}</td><td className="px-1">{s.pf}</td><td className="px-1">{s.min}</td>
              <td className="px-1" style={{ color: s.pm === null ? C.sub : s.pm >= 0 ? C.win : C.loss }}>{s.pm === null ? "–" : (s.pm >= 0 ? "+" : "") + s.pm}</td>
              <td className="px-1 font-bold">{s.eff}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10px] mt-1 px-1" style={{ color: C.sub }}>※+/-と出場時間は、Qの出場メンバー登録または交代IN/OUTがある選手のみ計算されます</div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-sm" style={{ border: `1px solid ${C.border}`, color: C.text }}
          onClick={() => onReport("simple")}>
          <FileText size={15} /> レポート(簡易)
        </button>
        <button className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-sm" style={{ border: `1px solid ${C.orange}`, color: C.orange }}
          onClick={() => onReport("detail")}>
          <FileText size={15} /> レポート(詳細)
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto">
        {[["all", "全体"], ...Array.from({ length: a.periods }, (_, i) => [i + 1, periodLabel(i + 1)])].map(([k, l]) => (
          <button key={k} className="flex-1 min-w-12 py-2 rounded-lg font-bold text-sm"
            style={scope === k ? { background: C.orange, color: "#fff" } : { background: C.card, color: C.sub, border: `1px solid ${C.border}` }}
            onClick={() => setScope(k)}>{l}</button>
        ))}
      </div>

      {scope !== "all" && (
        <Card>
          <div className="flex items-center justify-center gap-6" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
            <div className="text-center"><div className="text-6xl" style={{ color: C.led }}>{a.ownPts}</div><div className="text-xs" style={{ fontFamily: "sans-serif", color: C.sub }}>自チーム</div></div>
            <div className="text-xl" style={{ color: C.sub }}>{periodLabel(scope)}</div>
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
                <div className="flex-1">
                  <div className="font-bold">#{p.number} {p.codename || p.name}</div>
                  <div className="text-xs" style={{ color: C.sub }}>{s.pts}得点・{s.reb}リバウンド・{s.ast}アシスト</div>
                </div>
                <div className="text-right">
                  <div className="text-4xl font-bold" style={{ color: C.led, fontFamily: "'Bebas Neue', sans-serif" }}>{s.eff}</div>
                  <div className="text-[10px]" style={{ color: C.sub }}>EFF</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {a.ownT.n + a.oppT.n > 0 && (
        <Card>
          <SectionTitle>レーティング({a.scopeLabel}・100ポゼッションあたり)</SectionTitle>
          <div className="grid grid-cols-3 text-center">
            {[["オフェンス", a.ortg, C.orange], ["ディフェンス", a.drtg, C.oppText], ["ネット", a.net, a.net !== null && a.net >= 0 ? C.win : C.loss]].map(([l, v, col]) => (
              <div key={l}>
                <div className="text-3xl font-bold" style={{ color: col, fontFamily: "'Bebas Neue', sans-serif" }}>{v === null ? "–" : (l === "ネット" && v >= 0 ? "+" : "") + fmt1(v)}</div>
                <div className="text-[10px]" style={{ color: C.sub }}>{l}</div>
              </div>
            ))}
          </div>
          <div className="text-[10px] mt-2" style={{ color: C.sub }}>※ディフェンスは低いほど良い。推定ポゼッション: 自 {fmt1(a.ownT.poss)} / 相手 {fmt1(a.oppT.poss)}</div>
        </Card>
      )}

      <Card>
        <SectionTitle>チームスタッツ比較({a.scopeLabel})</SectionTitle>
        <table className="w-full text-sm">
          <thead><tr style={{ color: C.sub }}>
            <th className="text-left py-1 font-normal text-xs">項目</th>
            <th className="text-right py-1 font-bold" style={{ color: C.orange }}>自チーム</th>
            <th className="text-right py-1 font-bold" style={{ color: C.oppText }}>{oppName(game.opponentId)}</th>
          </tr></thead>
          <tbody>
            {a.compRows.map(([l, x, y]) => (
              <tr key={l} style={{ borderTop: `1px solid ${C.border}44` }}>
                <td className="py-1.5 text-xs" style={{ color: C.sub }}>{l}</td>
                <td className="py-1.5 text-right font-bold">{x}</td>
                <td className="py-1.5 text-right">{y}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {scope === "all" && (
        <Card>
          <SectionTitle>ピリオド別スコア</SectionTitle>
          <ResponsiveContainer width="100%" height={180}>
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

      {a.ownRows.length > 0 && (
        <Card>
          <SectionTitle>自チーム 選手別スタッツ({a.scopeLabel})</SectionTitle>
          <StatTable rows={a.ownRows} accent={C.orange} />
        </Card>
      )}
      {a.oppRows.length > 0 && (
        <Card>
          <SectionTitle>相手 選手別スタッツ({a.scopeLabel})</SectionTitle>
          <StatTable rows={a.oppRows} accent={C.oppText} />
        </Card>
      )}

      {a.reviews.length > 0 && (
        <Card>
          <SectionTitle>選手別パフォーマンスレビュー</SectionTitle>
          <div className="space-y-3">
            {a.reviews.map((r) => (
              <div key={r.key} className="flex gap-2.5">
                <Avatar p={r.p} size={36} />
                <div className="flex-1">
                  <div className="font-bold text-sm">{r.label}</div>
                  <div className="text-xs leading-relaxed" style={{ color: C.sub }}>{r.text}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <SectionTitle>{scope === "all" ? (a.win ? "勝因分析" : a.ownPts === a.oppPts ? "試合分析" : "敗因分析") : `${periodLabel(scope)} の分析`}</SectionTitle>
        <ul className="text-sm space-y-1.5">
          {a.insights.map((s, i) => <li key={i} className="flex gap-2"><span style={{ color: C.orange }}>●</span><span>{s}</span></li>)}
        </ul>
      </Card>

      {a.tips.length > 0 && (
        <Card>
          <SectionTitle>次戦に向けた提言</SectionTitle>
          <ul className="text-sm space-y-1.5">
            {a.tips.map((s, i) => <li key={i} className="flex gap-2"><Target size={14} className="mt-0.5 shrink-0" style={{ color: C.win }} /><span>{s}</span></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}

/* ============ ランキング ============ */
function Ranking({ data, setTab, setNav }) {
  const [stat, setStat] = useState("pts");
  const [mode, setMode] = useState("total");
  const rows = data.players.map((p) => {
    const c = careerStats(data.games, p.id);
    if (c.n === 0) return null;
    return { p, n: c.n, total: c.tot[stat], avg: c.tot[stat] / c.n };
  }).filter(Boolean).sort((a, b) => (mode === "total" ? b.total - a.total : b.avg - a.avg));

  return (
    <Card>
      <div className="flex gap-2 mb-3">
        <select className={inputCls} style={inputStyle} value={stat} onChange={(e) => setStat(e.target.value)}>
          {STAT_DEFS.map((d) => <option key={d.k} value={d.k}>{d.label}</option>)}
        </select>
        <div className="flex rounded-xl overflow-hidden shrink-0 text-sm font-bold" style={{ border: `1px solid ${C.border}` }}>
          {[["total", "合計"], ["avg", "平均"]].map(([k, l]) => (
            <button key={k} className="px-4" onClick={() => setMode(k)}
              style={mode === k ? { background: C.orange, color: "#fff" } : { background: C.card, color: C.sub }}>{l}</button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? <div className="text-sm py-4 text-center" style={{ color: C.sub }}>スタッツのある試合がまだありません。</div> : (
        <div>
          {rows.map((r, i) => (
            <button key={r.p.id} className="w-full flex items-center gap-3 py-2.5 text-left" style={{ borderBottom: `1px solid ${C.border}44` }}
              onClick={() => { setTab("players"); setNav({ playerId: r.p.id }); }}>
              <div className="w-8 text-center text-2xl" style={{ fontFamily: "'Bebas Neue', sans-serif", color: i < 3 ? C.led : C.sub }}>{i + 1}</div>
              <Avatar p={r.p} size={36} />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm truncate">{r.p.codename || r.p.name}</div>
                <div className="text-[10px]" style={{ color: C.sub }}>#{r.p.number}・{r.n}試合</div>
              </div>
              <div className="text-2xl font-bold" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>{mode === "total" ? r.total : fmt1(r.avg)}</div>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ============ 設定 ============ */
function SettingsScreen({ data, save }) {
  const [team, setTeam] = useState(data.team);
  const [oppForm, setOppForm] = useState({ name: "", area: "", numbers: "" });
  const [editOpp, setEditOpp] = useState(null);
  const [oppDraft, setOppDraft] = useState(null);
  const oppCount = data.opponents.length;
  const usage = useMemo(() => JSON.stringify(data).length, [data]);
  const usagePct = Math.min(100, Math.round((usage / STORAGE_LIMIT) * 100));

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `minibasket-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
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
      } catch (err) {
        alert("読み込めませんでした。このアプリで書き出したJSONファイルを選んでください。");
      }
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
          {team.logo
            ? <img src={team.logo} alt="" className="w-14 h-14 rounded-full object-cover" />
            : <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl" style={{ background: C.card2, border: `1px solid ${C.border}` }}>🏀</div>}
          <label className="text-sm font-bold px-3 py-2 rounded-xl" style={{ border: `1px solid ${C.border}` }}>
            ロゴ画像を選ぶ
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) shrinkSquare(f, 96, (d) => setTeam({ ...team, logo: d })); }} />
          </label>
          {team.logo && <button className="text-xs" style={{ color: C.loss }} onClick={() => setTeam({ ...team, logo: "" })}>削除</button>}
        </div>
        <Field label="チーム名"><input className={inputCls} style={inputStyle} value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} /></Field>
        <Field label="ホームコート"><input className={inputCls} style={inputStyle} value={team.homeCourt} onChange={(e) => setTeam({ ...team, homeCourt: e.target.value })} /></Field>
        <PrimaryBtn onClick={() => save({ ...data, team })}>チーム情報を保存</PrimaryBtn>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-1">
          <SectionTitle>対戦相手チーム</SectionTitle>
          <span className="text-xs" style={{ color: oppCount >= MAX_OPPONENTS ? C.loss : C.sub }}>{oppCount}/{MAX_OPPONENTS}</span>
        </div>
        {data.opponents.map((o) => (
          <div key={o.id} className="py-2" style={{ borderBottom: `1px solid ${C.border}44` }}>
            {editOpp === o.id ? (
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <OppLogo o={oppDraft} size={44} />
                  <label className="text-xs font-bold px-3 py-2 rounded-xl" style={{ border: `1px solid ${C.border}` }}>
                    ロゴ画像
                    <input type="file" accept="image/*" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) shrinkSquare(f, 64, (d) => setOppDraft({ ...oppDraft, logo: d })); }} />
                  </label>
                  {oppDraft?.logo && <button className="text-xs" style={{ color: C.loss }} onClick={() => setOppDraft({ ...oppDraft, logo: "" })}>削除</button>}
                </div>
                <input className={inputCls + " mb-2"} style={inputStyle} placeholder="チーム名" value={oppDraft.name}
                  onChange={(e) => setOppDraft({ ...oppDraft, name: e.target.value })} />
                <input className={inputCls + " mb-2"} style={inputStyle} placeholder="地区(都内は区市町村名、他県は県名)" value={oppDraft.area || ""}
                  onChange={(e) => setOppDraft({ ...oppDraft, area: e.target.value })} />
                <input className={inputCls + " mb-2"} style={inputStyle} placeholder="背番号(カンマ区切り) 4,5,6,7" value={oppDraft.numbers || ""}
                  onChange={(e) => setOppDraft({ ...oppDraft, numbers: e.target.value })} />
                <div className="flex gap-3">
                  <button className="text-sm font-bold" style={{ color: C.orange }} onClick={commitEdit}>保存</button>
                  <button className="text-sm" style={{ color: C.sub }} onClick={() => { setEditOpp(null); setOppDraft(null); }}>キャンセル</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <OppLogo o={o} size={36} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm truncate">{o.name}{o.area ? <span className="font-normal text-xs" style={{ color: C.sub }}>({o.area})</span> : null}</div>
                  <div className="text-xs truncate" style={{ color: C.sub }}>背番号: {o.numbers || "未登録"}</div>
                </div>
                <button className="p-1.5" style={{ color: C.sub }} onClick={() => startEdit(o)}><Pencil size={16} /></button>
                <button className="p-1.5" style={{ color: C.sub }} onClick={() => {
                  if (confirm(`「${o.name}」を削除しますか?`)) save({ ...data, opponents: data.opponents.filter((x) => x.id !== o.id) });
                }}><Trash2 size={16} /></button>
              </div>
            )}
          </div>
        ))}
        <div className="mt-3">
          {oppCount >= MAX_OPPONENTS ? (
            <div className="text-xs" style={{ color: C.loss }}>登録上限({MAX_OPPONENTS}チーム)に達しました。使わないチームを削除すると追加できます。</div>
          ) : (
            <>
              <input className={inputCls + " mb-2"} style={inputStyle} placeholder="チーム名" value={oppForm.name} onChange={(e) => setOppForm({ ...oppForm, name: e.target.value })} />
              <input className={inputCls + " mb-2"} style={inputStyle} placeholder="地区(都内は区市町村名、他県は県名)" value={oppForm.area} onChange={(e) => setOppForm({ ...oppForm, area: e.target.value })} />
              <input className={inputCls + " mb-2"} style={inputStyle} placeholder="背番号(カンマ区切り) 4,5,6,7" value={oppForm.numbers} onChange={(e) => setOppForm({ ...oppForm, numbers: e.target.value })} />
              <PrimaryBtn disabled={!oppForm.name} onClick={() => {
                save({ ...data, opponents: [...data.opponents, { id: uid(), logo: "", ...oppForm }] });
                setOppForm({ name: "", area: "", numbers: "" });
              }}>対戦相手を追加</PrimaryBtn>
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
          <div className="text-[10px] mt-1" style={{ color: C.sub }}>目安: 選手{MAX_PLAYERS}人・相手{MAX_OPPONENTS}チーム・{MAX_GAMES}試合まで保存できる設計です。</div>
        </div>
        <div className="flex gap-2 mb-2">
          <button className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl font-bold text-sm" style={{ border: `1px solid ${C.border}` }} onClick={exportData}>
            <Download size={16} /> 書き出し(JSON)
          </button>
          <label className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl font-bold text-sm" style={{ border: `1px solid ${C.border}` }}>
            <Upload size={16} /> 読み込み
            <input type="file" accept=".json,application/json" className="hidden" onChange={importData} />
          </label>
        </div>
        <button className="w-full py-3 rounded-xl font-bold text-sm" style={{ border: `1px solid ${C.loss}`, color: C.loss }}
          onClick={() => {
            if (confirm("すべてのデータ(選手・試合・スタッツ)を削除します。よろしいですか?")) {
              save({ team: { name: "府中六小ミニバス", logo: "", homeCourt: "" }, players: [], opponents: [], games: [] });
            }
          }}>すべてのデータを初期化</button>
      </Card>
    </div>
  );
}
