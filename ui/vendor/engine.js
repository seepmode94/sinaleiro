/* Vendored from clodfarm (https://github.com/matank001/clodfarm, commit 10305ea), clodfarm/ui/app.js lines 1-1604:
 * the sprites, the world, the critters and the scene. Changes are marked "sinaleiro:".
 *
 * MIT License
 * 
 * Copyright (c) 2026 Duke Security, Inc.
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
/* clodfarm UI. A living pixel farm: every Claude on the farm is a Claude critter that wanders, watches its sub-agents
 * at their plot, or naps when its budget says so; sub-agents are mini Claudes. Plain JS, no build step, no dependencies. */
"use strict";

// ================================================================== utilities
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "text") e.textContent = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// the providers a bot can use (clodfarm/bots.py has the same list; the farm checks what's sent)
const BOT_PROVIDERS = {
  openrouter: { label: "OpenRouter", url: "https://openrouter.ai/api", key: true, example: "qwen/qwen3-coder:free",
    hint: "Free models end in :free (openrouter.ai/models, filter by price). Make a key at openrouter.ai/keys. Free tiers allow a few requests a minute: the bot pauses when it hits that." },
  ollama: { label: "Ollama", url: "http://host.docker.internal:11434", key: false, example: "qwen3-coder",
    hint: "Ollama on the machine running the farm's container: pull a model that can use tools first (ollama pull qwen3-coder)." },
  custom: { label: "Anthropic-compatible", url: "", key: false, example: "",
    hint: "Any endpoint that speaks Anthropic's Messages API, like a LiteLLM gateway. The address is its base URL, without /v1." },
};
function hashStr(s) { let x = 2166136261; for (const c of String(s)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; }
/** replaceChildren that flattens arrays and drops null/false (plain replaceChildren would print "null"). */
function fill(el, ...kids) { el.replaceChildren(...kids.flat(3).filter(k => k != null && k !== false)); return el; }
const nowS = () => Date.now() / 1000;
function ago(ts) {
  if (!ts) return "-";
  const s = Math.max(0, nowS() - ts);
  return s < 90 ? `${Math.round(s)}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 172800 ? `${(s / 3600).toFixed(1)}h ago` : `${(s / 86400).toFixed(1)}d ago`;
}
function until(ts) {
  if (!ts) return "";
  const s = Math.max(0, ts - nowS());
  return s < 5400 ? `${Math.round(s / 60)}m` : s < 172800 ? `${(s / 3600).toFixed(1)}h` : `${(s / 86400).toFixed(1)}d`;
}
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ===================================================================== sprites
function canvas(w, hgt) { const c = document.createElement("canvas"); c.width = w; c.height = hgt; return c; }
/** Paint string rows ("." = transparent) with a palette into a new canvas. */
function paint(rows, pal, w = 16) {
  const c = canvas(w, rows.length), g = c.getContext("2d");
  rows.forEach((row, y) => [...row.padEnd(w, ".").slice(0, w)].forEach((ch, x) => {
    if (ch !== "." && pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x, y, 1, 1); }
  }));
  return c;
}

const CLAY = { o: "#5a2616", h: "#f2a07a", b: "#d97757", s: "#b45a3c", d: "#86381f", e: "#231815", w: "#ffffff", k: "#f6c9b3" };
const HAT_COLORS = ["#3b7dd8", "#7b4bb7", "#2f9e6b", "#d2a21d", "#c0392b", "#2c3e50", "#e06f9f", "#16a0a0"];
const HAT_H = 6; // rows above the body for hats
// the skin picker's swatches: hat and band colours, and body tints (clay first)
const SWATCHES = ["#3b7dd8", "#7b4bb7", "#2f9e6b", "#d2a21d", "#c0392b", "#2c3e50", "#e06f9f", "#16a0a0", "#e85b5b", "#f0cf7a", "#f7f3ea", "#1c2233"];
const BODY_TINTS = ["#d97757", "#c0603f", "#e89a74", "#d9b27a", "#8fb573", "#7fa8d9", "#a98bd1", "#e68aa8", "#8a8f9c", "#9a6a4a"];
const ACCESSORIES = ["", "scarf", "glasses", "bowtie", "backpack", "cape"];
// what the picker calls them
const SWATCH_NAMES = ["blue", "purple", "green", "mustard", "red", "navy", "pink", "teal", "coral", "butter", "cream", "ink"];
const BODY_NAMES = ["clay", "rust", "peach", "sand", "sage", "sky", "lilac", "rose", "stone", "cocoa"];
const HAT_NAMES = { straw: "STRAW", beanie: "BEANIE", cap: "CAP", flower: "FLOWER", headphones: "PHONES", bow: "BOW", crown: "CROWN", sprout: "SPROUT", leaf: "LEAF", wizard: "WIZARD", chef: "CHEF", none: "NONE" };
const ACC_NAMES = { "": "NONE", scarf: "SCARF", glasses: "GLASSES", bowtie: "BOWTIE", backpack: "BACKPACK", cape: "CAPE" };

/** Clawd, the Claude Code critter: a clay block with two eyes, stubby arms and four legs. 16 x 12. */
function clawdGrid({ look = 0, legs = 0, blink = false, sleep = false, arms = 0 }) {
  const W = 16, H = 12, g = Array.from({ length: H }, () => Array(W).fill("."));
  const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = c; };
  for (let y = 0; y <= 9; y++) for (let x = 2; x <= 13; x++) {
    const edge = x === 2 || x === 13 || y === 0 || y === 9;
    if ((x === 2 || x === 13) && (y === 0 || y === 9)) continue; // rounded corners
    set(x, y, edge ? "o" : (y === 1 || x === 3) ? "h" : (x === 12 || y === 8) ? "s" : "b");
  }
  // arms (arms=1 raises them: typing / cheering)
  const ay = 5 - arms;
  for (const [x0, dir] of [[0, 1], [15, -1]]) {
    for (let y = ay - 1; y <= ay + 2; y++) for (let k = 0; k < 3; k++) {
      const x = x0 + k * dir, rim = y === ay - 1 || y === ay + 2;
      if (k === 2) set(x, y, rim ? "o" : "b");
      else set(x, y, rim || k === 0 ? "o" : (dir === 1 ? "h" : "s"));
    }
  }
  // eyes: tall and dark with a shine; closed = a line
  for (const ex of [5, 9]) {
    const x = ex + look;
    if (blink || sleep) { set(x, 5, "e"); set(x + 1, 5, "e"); }
    else { for (let y = 3; y <= 5; y++) { set(x, y, "e"); set(x + 1, y, "e"); } set(x, 3, "w"); }
  }
  if (!sleep) { set(4 + look, 6, "k"); set(11 + look, 6, "k"); } // blush
  // legs: 4 pairs of 2px; the lifted pair is shorter
  const pairs = [[3, 4], [5, 6], [9, 10], [11, 12]];
  pairs.forEach(([a, b], i) => {
    const lifted = !sleep && legs !== 0 && ((i % 2 === 0) === (legs === 1));
    for (const x of [a, b]) {
      if (sleep) return;
      if (lifted) set(x, 10, "o");
      else { set(x, 10, "d"); set(x, 11, "o"); }
    }
  });
  return g.map(r => r.join(""));
}

/** A sub-agent: a small Claude, 10 x 8, with a band in its agent's colour. Cached per colour and pose. */
const miniCache = new Map();
function miniSprite(color, { legs = 0, arms = 0, blink = false }) {
  let byPose = miniCache.get(color);
  if (!byPose) miniCache.set(color, (byPose = []));
  const code = legs + 3 * arms + 6 * (blink ? 1 : 0);
  if (byPose[code]) return byPose[code];
  const rows = Array.from({ length: 8 }, () => Array(10).fill("."));
  const set = (x, y, ch) => { if (x >= 0 && x < 10 && y >= 0 && y < 8) rows[y][x] = ch; };
  for (let y = 0; y <= 5; y++) for (let x = 1; x <= 8; x++) {
    if ((x === 1 || x === 8) && (y === 0 || y === 5)) continue;
    set(x, y, x === 1 || x === 8 || y === 0 || y === 5 ? "o" : y === 1 ? "c" : x === 7 || y === 4 ? "s" : "b");
  }
  const ay = 2 - arms;
  set(0, ay, "o"); set(0, ay + 1, "o"); set(9, ay, "o"); set(9, ay + 1, "o");
  for (const x of [3, 6]) { set(x, blink ? 3 : 2, "e"); set(x, 3, "e"); }
  [2, 4, 5, 7].forEach((x, i) => { const up = legs !== 0 && ((i % 2 === 0) === (legs === 1)); set(x, 6, up ? "o" : "d"); if (!up) set(x, 7, "o"); });
  return (byPose[code] = paint(rows.map(r => r.join("")), { ...CLAY, c: color }, 10));
}

/** Hats: "@" is the hat's colour (@d darker, @l lighter), "#" its band / trim colour. `base` and `band` are the colours
 * when the Claude picked none; `tint` hats take the Claude's own colour then (the old look). */
const HATS = {
  straw: { base: "#f0cf7a", band: "#c0392b", pal: { o: "#6b4f1d", a: "@", b: "@d", r: "#" }, rows: [
    "................", "......oooo......", ".....oaaaao.....", "....oaaaaaao....", "...orrrrrrrro...", "ooaaaaaaaaaaaaoo", ".oobbbbbbbbbboo."] },
  beanie: { tint: true, band: "#f7f3ea", pal: { o: "#1c2233", w: "#", c: "@", d: "@d", l: "@l" }, rows: [
    ".......ww.......", "......owwo......", ".....occcco.....", "...occccccco....", "..occclcccccco..", "..oddddddddddo..", "..oddddddddddo.."] },
  cap: { tint: true, band: "#f7f3ea", pal: { o: "#1c2233", w: "#", c: "@", d: "@d" }, rows: [
    "................", "................", ".....occcco.....", "...occcwccccoo..", "..occcccccccccoo", "..ooooooooodddddo", "................"] },
  flower: { base: "#ffd0dc", band: "#f5c542", pal: { o: "#6b2f1f", p: "@", y: "#", g: "#3f8f35" }, rows: [
    "................", "..........opo...", ".........opypo..", "..........opo...", "...........g....", "................", "................"] },
  headphones: { tint: true, band: "#5b6272", pal: { o: "#15171f", c: "@", l: "@l", g: "#" }, rows: [
    "................", "................", "....oooooooo....", "...oggggggggo...", "..og........go..", "oo.o........o.oo", "oco..........oco"] },
  bow: { base: "#e0508a", band: "#f59cc0", pal: { o: "#5b1330", c: "@", l: "#" }, rows: [
    "................", "................", "................", "....oo....oo....", "...olco..oclo...", "...occcoocccoo..", "....oo.oo..oo..."] },
  crown: { base: "#f5c542", band: "#d63a3a", pal: { o: "#6b4a07", y: "@", l: "@l", r: "#", b: "#3b7dd8" }, rows: [
    "................", "................", "...o...o...o....", "..oyo.oyo.oyo...", "..oyyoyyyoyyo...", "..oylyryybyylo..", "..oooooooooooo.."] },
  sprout: { base: "#6fcf5b", band: "#3f8f35", pal: { o: "#1f4d1d", g: "@", l: "@l", s: "#" }, rows: [
    "................", "...oo.....oo....", "..ollo...oglo...", "..oglgo.ogllo...", "...oogosoggo....", "......os.o......", "......os........"] },
  leaf: { base: "#63a93f", band: "#8a5a2b", pal: { o: "#1f3d14", g: "@", l: "@l", d: "@d", s: "#" }, rows: [
    ".........oo.....", ".......oolgo....", ".....ooglggo....", "....oglgggdo....", "....ogggddo.....", ".....oddoo......", "......os........"] },
  wizard: { base: "#5b4bb7", band: "#f5c542", pal: { o: "#1c1440", c: "@", l: "@l", d: "@d", y: "#" }, rows: [
    ".........oo.....", "........oco.....", ".......occo.....", "......ocycco....", ".....occcclco...", "...occcccccccoo.", "oodddyddddyddddo"] },
  chef: { base: "#f7f3ea", band: "#d8d2c4", pal: { o: "#5b5b66", w: "@", g: "#" }, rows: [
    "....oo.oo.oo....", "...owwowwowwo...", "...owwwwwwwwo...", "....owwwwwwo....", "....owwwwwwo....", "....oggggggo....", "....oooooooo...."] },
  none: { base: "#000000", band: "#000000", pal: {}, rows: [] },
};

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16), f = (v) => clamp(Math.round(v + amt * 255), 0, 255);
  return "#" + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map(v => v.toString(16).padStart(2, "0")).join("");
}
const HEX = /^#[0-9a-fA-F]{6}$/;
const bodyPal = (body) => body === CLAY.b ? CLAY
  : { ...CLAY, o: shade(body, -0.5), h: shade(body, 0.12), b: body, s: shade(body, -0.13), d: shade(body, -0.33), k: shade(body, 0.3) };

/** A Claude's look, resolved: its hat, the hat / band / body colours and its accessory. `colors` is what the person
 * picked (may be null or partial); `fallback` is its farm colour, which tints the beanie, cap and headphones. */
const skinCache = new Map();
function skinOf(hat, colors, accessory, fallback) {
  hat = HATS[hat] ? hat : "straw";
  const def = HATS[hat], c = colors || {};
  const hc = HEX.test(c.hat || "") ? c.hat : def.tint ? (fallback || HAT_COLORS[0]) : def.base;
  const band = HEX.test(c.band || "") ? c.band : def.band, body = HEX.test(c.body || "") ? c.body : CLAY.b;
  const acc = ACCESSORIES.includes(accessory || "") ? accessory || "" : "";
  const key = `${hat}|${hc}|${band}|${body}|${acc}`;
  let s = skinCache.get(key);
  if (!s) skinCache.set(key, (s = { key, hat, hatC: hc, band, body, acc, frames: [] }));
  return s;
}
const agentSkin = (a) => skinOf(a.hat || "straw", a.colors, a.accessory, colorFor(a.id));

/** Accessories, drawn on the 16 x 18 critter in the same pixel grid ("#" = the band colour). `back` ones go behind it. */
const ACC = {
  cape: { back: ["", "", "", "", "", "", "", "..o##########o..", ".o############o.", ".o############o.", "o##############o", "o##############o", "o##############o", "o##############o", "oo############oo", ".oooooooooooooo."] },
  backpack: { pal: { b: "#8a5a2b", d: "#5e3a1a" },
    back: ["", "", "", "", "", "", "", "", "", "", "", "", ".............oo.", "............obbo", "............obbo", "............oddo", "............obbo", ".............oo."],
    front: ["", "", "", "", "", "", "", "", "", "", "", "", "", "...d.......d....", "...d.......d...."] },
  scarf: { front: ["", "", "", "", "", "", "", "", "", "", "", "", "", "..o##########o..", "..o#d#d#d#d#do..", "..........o#o...", "..........o#o...", "...........o...."] },
  glasses: { front: ["", "", "", "", "", "", "", "", "....oooooooo....", "....o..oo..o....", "....o..oo..o....", "....o..oo..o....", "....oooooooo...."] },
  bowtie: { front: ["", "", "", "", "", "", "", "", "", "", "", "", "", ".....##..##.....", ".....##dd##.....", ".....##..##....."] },
};
function drawAcc(g, skin, back, look) {
  const a = ACC[skin.acc], rows = a && (back ? a.back : a.front);
  if (!rows) return;
  const pal = { o: "#1c2233", "#": skin.band, d: shade(skin.band, -0.2), ...(a.pal || {}) };
  g.drawImage(paint(rows, pal), skin.acc === "glasses" ? look : 0, 0);
}

/** One pose of a skin, 16 x 18 (HAT_H rows of hat, then the 12-row body). Poses are cached per skin by a small number,
 * so the frame loop never builds a string key. */
const poseCode = (o) => (o.look || 0) + 1 + 3 * (o.legs || 0) + 9 * (o.blink ? 1 : 0) + 18 * (o.sleep ? 1 : 0) + 36 * (o.arms || 0);
function skinFrame(skin, o) {
  const code = poseCode(o);
  let c = skin.frames[code];
  if (c) return c;
  c = canvas(16, HAT_H + 12);
  const g = c.getContext("2d");
  drawAcc(g, skin, true, o.look || 0);
  g.drawImage(paint(clawdGrid(o), bodyPal(skin.body)), 0, HAT_H);
  drawAcc(g, skin, false, o.look || 0);
  const def = HATS[skin.hat];
  if (def.rows.length) {
    const pal = {}, hc = skin.hatC, bc = skin.band;
    for (const [k, v] of Object.entries(def.pal)) pal[k] = v === "@" ? hc : v === "@d" ? shade(hc, -0.18) : v === "@l" ? shade(hc, 0.2) : v === "#" ? bc : v;
    // hats end on the body's first row; shift down 1 when the eyes are closed so it sits snug
    g.drawImage(paint(def.rows, pal), 0, o.sleep ? 1 : 0);
  }
  return (skin.frames[code] = c);
}
/** A whole critter (kept for the landing page and the demos): critterSprite(hat, colour or skin, pose). */
function critterSprite(hat, color, opts = {}) {
  const skin = color && typeof color === "object" ? color : skinOf(hat, null, "", color);
  return skinFrame(skin, opts);
}

const EGG = paint([
  "....oooo....", "...occcco...", "..occsccco..", "..occcccco..", ".occccccsco.", ".ocsccccccco", ".occcccsccco",
  ".occcccccdco", ".odcccccdcco", "..oddcccddo.", "...odddddo..", "....oooo....",
], { o: "#6b5a3a", c: "#f6eed8", s: "#e2875f", d: "#d8c9a3" }, 12);

const LAPTOP = (on) => paint([
  ".ooooooo.", on ? ".ogsggso." : ".osssssso", on ? ".osgssso." : ".osssssso", on ? ".oggsgso." : ".osssssso", ".ooooooo.", "ommmmmmmo", "ooooooooo",
].map(r => r.slice(0, 9)), { o: "#1b1f2a", s: "#22303c", g: "#7cfc9a", m: "#9aa3b2" }, 9);
const LAPTOP_ON = LAPTOP(true), LAPTOP_OFF = LAPTOP(false);

// a 3 x 5 pixel font for the field's little signs ("+12")
const DIGITS = { "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001011001111", "4": "101101111001001",
  "5": "111100111001111", "6": "111100111101111", "7": "111001010010010", "8": "111101111101111", "9": "111101111001111", "+": "000010111010000" };
function pxText(g, text, x, y, color) {
  g.fillStyle = color;
  [...text].forEach((ch, i) => { const b = DIGITS[ch]; if (b) for (let k = 0; k < 15; k++) if (b[k] === "1") g.fillRect(x + i * 4 + (k % 3), y + Math.floor(k / 3), 1, 1); });
}
/** A wooden sign stuck in the ground with a count on it: "+N" minis the plot has but doesn't draw. */
function drawSign(g, x, y, text) {
  const w = text.length * 4 + 3;
  g.fillStyle = "#3a2616"; g.fillRect(x + Math.floor(w / 2) - 1, y + 6, 2, 4); g.fillRect(x, y, w, 8);
  g.fillStyle = "#c9964a"; g.fillRect(x + 1, y + 1, w - 2, 6);
  pxText(g, text, x + 2, y + 2, "#3a2616");
}

/** The planner: a scarecrow at the field's edge. Awake it sways and looks round; asleep it sags, grey. 16 x 22. */
const SCARECROW = [0, 1, 2].map(f => paint([
  ".....oooooo.....", "....oyyyyyyo....", "...oyyyyyyyyo...", "..oooooooooooo..", ".....obbbbo.....",
  f === 2 ? ".....obbbbo....." : ".....oebbeo.....", ".....obbbbo.....", f === 2 ? ".....obeebo....." : ".....obmmbo.....",
  "......obbo......", f === 1 ? "yy.ooorrrrooo.yy" : ".yyooorrrrooyy..", f === 1 ? ".oooorrrrrroooo." : "yooorrrrrrrrooyy",
  "......orrrro....", "......orrrro....", "......oyyyyo....", "......y.ww.y....", ".......oww......", ".......oww......",
  ".......oww......", ".......oww......", ".......oww......", "......owwww.....", ".....oooooooo...",
], f === 2 ? { o: "#3a3a40", y: "#9a9384", b: "#a8a294", e: "#3a3a40", m: "#6b6860", r: "#7a7a82", w: "#6b6158" }
  : { o: "#3a2616", y: "#e0b64e", b: "#d8c29a", e: "#231815", m: "#86381f", r: "#c0392b", w: "#8a6038" }));

// 10 x 10 icons for bubbles and buttons
const ICONS = {
  terminal: [["oooooooooo", "osssssssso", "osgsssssso", "ossgssssso", "osgsssssso", "osssggggso", "osssssssso", "oooooooooo", "...oooo...", "..oooooo.."],
    { o: "#1b1f2a", s: "#22303c", g: "#7cfc9a" }],
  zzz: [["......oooo", ".......oo.", "......oo..", "..oooooooo", "....oo....", "...oo.....", "..oooo....", "oooo......", "..oo......", ".oooo....."],
    { o: "#3c4a6b" }],
  pause: [["..........", ".oo....oo.", ".oo....oo.", ".oo....oo.", ".oo....oo.", ".oo....oo.", ".oo....oo.", ".oo....oo.", ".oo....oo.", ".........."],
    { o: "#3c4a6b" }],
  alert: [["....oo....", "...orro...", "...orro...", "...orro...", "...orro...", "....rr....", "..........", "....rr....", "...orro...", "....oo...."],
    { o: "#6b1a10", r: "#e0513c" }],
  ask: [["..oooooo..", ".oo....oo.", ".......oo.", "......oo..", ".....oo...", "....oo....", "....oo....", "..........", "....oo....", "....oo...."],
    { o: "#3c4a6b" }],
  dots: [["..........", "..........", "..........", "..........", ".oo.oo.oo.", ".oo.oo.oo.", "..........", "..........", "..........", ".........."],
    { o: "#3c4a6b" }],
  scroll: [[".oooooooo.", "oyyyyyyyyo", ".oppppppo.", ".opooopo..", ".oppppppo.", ".opoooopo.", ".oppppppo.", ".opooppo..", "oyyyyyyyyo", ".oooooooo."],
    { o: "#5a3d1e", p: "#f6ecd0", y: "#c9964a" }],
  plan: [[".oooooooo.", "oyyyyyyyyo", ".oppppppo.", ".oprpppro.", ".oppprppo.", ".opprpppo.", ".oppppppo.", ".opppppo..", "oyyyyyyyyo", ".oooooooo."],
    { o: "#5a3d1e", p: "#f6ecd0", y: "#c9964a", r: "#d97757" }],
  swords: [["o........o", ".o......o.", "..o....o..", "...o..o...", "....oo....", "....oo....", "...o..o...", ".bo....ob.", "bb......bb", "b........b"],
    { o: "#9aa3b2", b: "#6b4a2b" }],
  chat: [["..........", ".oooooooo.", "owwwwwwwwo", "owwwwwwwwo", "owdwdwdwwo", "owwwwwwwwo", ".oooooooo.", "..oow.....", "..ow......", "..o......."],
    { o: "#3c4a6b", w: "#fff8e8", d: "#d97757" }],
  heart: [["..........", ".rr...rr..", "rllr.rrrr.", "rlrrrrrrr.", "rrrrrrrrr.", ".rrrrrrr..", "..rrrrr...", "...rrr....", "....r.....", ".........."],
    { r: "#e0513c", l: "#f7a296" }],
  egg: [["...oooo...", "..occcco..", ".occsccco.", ".occcccco.", "occccccsco", "ocscccccco", "occcccccco", "oddcccccdo", ".oddcccdo.", "..oooooo.."],
    { o: "#6b5a3a", c: "#f6eed8", s: "#e2875f", d: "#d8c9a3" }],
  chart: [["o.........", "o.......gg", "o.......gg", "o....bb.gg", "o....bb.gg", "o.rr.bb.gg", "o.rr.bb.gg", "o.rr.bb.gg", "o.rr.bb.gg", "oooooooooo"],
    { o: "#3c4a6b", b: "#1c9fd6", g: "#3cc36b", r: "#d97757" }],
  globe: [["...oooo...", "..obwbbo..", ".obwbbwbo.", "obbwbbwbbo", "owwwwwwwwo", "obbwbbwbbo", "owwwwwwwwo", ".obwbbwbo.", "..obwbbo..", "...oooo..."],
    { o: "#1b3a5a", b: "#1c9fd6", w: "#d8eef8" }],
  tasks: [["..oyyyyo..", ".oooooooo.", ".owwwwwwo.", ".ogwllllo.", ".owwwwwwo.", ".ogwllllo.", ".owwwwwwo.", ".ogwllllo.", ".owwwwwwo.", ".oooooooo."],
    { o: "#5a3d1e", y: "#c9964a", w: "#f6ecd0", g: "#3cc36b", l: "#9aa3b2" }],
  gear: [["....oo....", ".oo.gg.oo.", ".oggggggo.", "..gglogg..", "oggl..lggo", "ogg....ggo", "..gg..gg..", ".oggggggo.", ".oo.gg.oo.", "....oo...."],
    { o: "#2f251b", g: "#8d8d96", l: "#c9c9cf" }],
  roster: [["oooooooooo", "obbowwwwwo", "obbowlllwo", "oooooooooo", "obbowwwwwo", "obbowlllwo", "oooooooooo", "obbowwwwwo", "obbowlllwo", "oooooooooo"],
    { o: "#3c4a6b", b: "#d97757", w: "#fff8e8", l: "#9aa3b2" }],
  key: [["..oooo....", ".oyyyyo...", "oyyooyyo..", "oyyooyyo..", ".oyyyyo...", "..oyyo....", "..oyyoo...", "..oyyyyo..", "..oyyo....", "..oyyyo..."],
    { o: "#5a3d1e", y: "#f5c542" }],
  plus: [["..........", "....oo....", "....oo....", "....oo....", ".oooooooo.", ".oooooooo.", "....oo....", "....oo....", "....oo....", ".........."], { o: "#2f251b" }],
  minus: [["..........", "..........", "..........", "..........", ".oooooooo.", ".oooooooo.", "..........", "..........", "..........", ".........."], { o: "#2f251b" }],
  fit: [["ooo....ooo", "oo......oo", "o.o....o.o", "..........", "...gggg...", "...gggg...", "..........", "o.o....o.o", "oo......oo", "ooo....ooo"], { o: "#2f251b", g: "#3cc36b" }],
  dice: [[".oooooooo.", "owwwwwwwwo", "owkkwwkkwo", "owkkwwkkwo", "owwwkkwwwo", "owwwkkwwwo", "owkkwwkkwo", "owkkwwkkwo", "owwwwwwwwo", ".oooooooo."],
    { o: "#1f2a44", w: "#fff8e8", k: "#d97757" }],
  plug: [["..mn..mn..", "..mn..mn..", "oooooooooo", "ohhhhhhhbo", "ohbbbbbbso", "obbbbbbbso", ".obbbbbso.", "..osssso..", "...occo...", "....cc...."],
    { o: "#2f251b", m: "#b7bfcc", n: "#6b7383", h: "#f2a07a", b: "#d97757", s: "#b45a3c", c: "#3c4a6b" }],
  quill: [["........oo", ".......owo", "......owwo", ".....owwo.", "....owwo..", "...owwo...", "..oowo....", "..ooo.....", ".ooo......", "oo........"],
    { o: "#3a2a1a", w: "#f6ecd0" }],
};
const iconURL = {};
function icon(name, scale = 1) {
  const k = name + scale;
  if (iconURL[k]) return iconURL[k];
  if (name === "party") {
    const s = critterSprite("straw", HAT_COLORS[0], { legs: 0 }), c = canvas(18, 18), g = c.getContext("2d");
    g.drawImage(s, 1, 0);
    return (iconURL[k] = c.toDataURL());
  }
  if (!ICONS[name]) return ""; // an unknown icon: no picture rather than a broken page
  const [rows, pal] = ICONS[name];
  return (iconURL[k] = paint(rows, pal, 10).toDataURL());
}

// ================================================================= HD sprites
/* The farm draws on a pixel grid twice as fine as the classics above: a critter is 32 x 36 HD pixels in the same
 * 16 x 18 world box, so the layout keeps its world pixels while the art gets shading, shines and crisp outlines. The
 * classics (critterSprite, miniSprite, EGG, LAPTOP_ON, SCARECROW) stay for the landing page's faller and the demos.
 * Shapes are filled on a Pix grid, then ringed in ink by outline(). */
const HD = 2;
const rgbOf = (hx) => [parseInt(hx.slice(1, 3), 16), parseInt(hx.slice(3, 5), 16), parseInt(hx.slice(5, 7), 16)];
function mix(a, b, t) { const A = rgbOf(a), B = rgbOf(b); return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join(""); }
class Pix {
  constructor(w, hgt) { this.w = w; this.h = hgt; this.p = new Array(w * hgt).fill(null); }
  set(x, y, c) { x = Math.floor(x); y = Math.floor(y); if (c && x >= 0 && y >= 0 && x < this.w && y < this.h) this.p[y * this.w + x] = c; return this; }
  get(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.p[y * this.w + x] : null; }
  rect(x, y, w, hgt, c) { for (let j = 0; j < hgt; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); return this; }
  /** An ellipse over pixel centres, optionally turned by `rot`; `c` may be a function (x, y, u, v) -> colour, where
   * u, v run -1..1 across it (so shading is "u < -0.4: lit side"). */
  oval(cx, cy, rx, ry, c, rot = 0) {
    const cs = Math.cos(rot), sn = Math.sin(rot), R = Math.max(rx, ry) + 1;
    for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, u = (dx * cs + dy * sn) / rx, v = (-dx * sn + dy * cs) / ry;
      if (u * u + v * v <= 1) this.set(x, y, typeof c === "function" ? c(x, y, u, v) : c);
    }
    return this;
  }
  line(x0, y0, x1, y1, c) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1); for (let i = 0; i <= n; i++) this.set(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), c); return this; }
  /** Ring every filled shape in `c` (the empty pixels next to a filled one). */
  outline(c, diag = false) {
    const add = [], f = (x, y) => !!this.get(x, y);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.p[y * this.w + x]) continue;
      if (f(x - 1, y) || f(x + 1, y) || f(x, y - 1) || f(x, y + 1) || (diag && (f(x - 1, y - 1) || f(x + 1, y - 1) || f(x - 1, y + 1) || f(x + 1, y + 1)))) add.push(y * this.w + x);
    }
    for (const i of add) this.p[i] = c;
    return this;
  }
  /** Recolour: fn(x, y, colour) returns the new colour, or undefined to keep it. */
  map(fn) { for (let i = 0; i < this.p.length; i++) if (this.p[i]) { const n = fn(i % this.w, Math.floor(i / this.w), this.p[i]); if (n !== undefined) this.p[i] = n; } return this; }
  canvas() {
    const c = canvas(this.w, this.h), g = c.getContext("2d"), img = g.createImageData(this.w, this.h), d = img.data, memo = {};
    this.p.forEach((col, i) => { if (!col) return; const v = memo[col] || (memo[col] = rgbOf(col)); d[i * 4] = v[0]; d[i * 4 + 1] = v[1]; d[i * 4 + 2] = v[2]; d[i * 4 + 3] = 255; });
    g.putImageData(img, 0, 0);
    return c;
  }
}
const EYE = "#231815", SHINE = "#ffffff";
/** A body colour's HD palette: ink outline, spec, highlight, base, shade, dark, blush. */
const bodyPalHD = (body) => body === CLAY.b
  ? { o: "#4a1f12", l: "#f7c3a3", h: "#ec9670", b: "#d97757", s: "#b95d3f", d: "#8a3a21", k: "#f3ab98" }
  : { o: mix(shade(body, -0.5), "#1a1216", 0.25), l: shade(body, 0.2), h: shade(body, 0.09), b: body, s: shade(body, -0.11), d: shade(body, -0.28), k: mix(body, "#ff9f9f", 0.45) };

/** Clawd in HD: the clay block with tall dark eyes, side nubs and four legs, 32 x 36 (the body starts at row 12, under
 * the hat). Poses: look (-1, 0, 1), legs (0 stand, 1 / 2 the walk's two steps), blink, sleep (sat down, eyes shut),
 * arms (0 down, 1 up: cheering, 2 / 3 tapping at a laptop), happy (a little open smile). */
function clawdHD(pal, { look = 0, legs = 0, blink = false, sleep = false, arms = 0, happy = false }) {
  const P = new Pix(32, 36);
  const x0 = sleep ? 4 : 5, x1 = sleep ? 27 : 26, y0 = sleep ? 18 : 13, y1 = sleep ? 33 : 30;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if ((x === x0 || x === x1) && (y === y0 || y === y1)) continue; // rounded corners
    let c = pal.b;
    if (y <= y0 + 1 || x <= x0 + 1) c = pal.h;
    if (y === y0 && x >= x0 + 2 && x <= x0 + 9) c = pal.l;
    if (x === x0 + 1 && y === y0 + 1) c = pal.l;
    if (x >= x1 - 1 || y >= y1 - 1) c = pal.s;
    if (y === y1 && x > x0 + 1 && x < x1 - 1) c = pal.d;
    P.set(x, y, c);
  }
  // nubs: down, both up (cheer), or tapping one then the other (typing)
  const ay = sleep ? [y1 - 5, y1 - 5] : arms === 1 ? [15, 15] : arms === 2 ? [19, 22] : arms === 3 ? [22, 19] : [21, 21];
  const tall = sleep ? 3 : 4;
  for (let k = 0; k < tall; k++) {
    P.set(x0 - 3, ay[0] + k, k === 0 ? pal.l : pal.h); P.set(x0 - 2, ay[0] + k, pal.h); P.set(x0 - 1, ay[0] + k, pal.b);
    P.set(x1 + 1, ay[1] + k, pal.b); P.set(x1 + 2, ay[1] + k, pal.s); P.set(x1 + 3, ay[1] + k, k === tall - 1 ? pal.d : pal.s);
  }
  if (!sleep) [6, 11, 19, 24].forEach((lx, i) => { // legs: the lifted pair is shorter
    const up = legs !== 0 && ((i % 2 === 0) === (legs === 1));
    for (let y = 31; y <= (up ? 32 : 33); y++) { P.set(lx, y, y === 31 ? pal.s : pal.d); P.set(lx + 1, y, pal.d); }
  });
  P.outline(pal.o);
  // eyes: tall and dark with a shine; blinking a line; asleep, happy little arcs
  const ey = y0 + 4, sh = look * 2;
  for (const ex of [10 + sh, 19 + sh]) {
    if (sleep) { P.set(ex, ey + 3, EYE); P.set(ex + 1, ey + 4, EYE); P.set(ex + 2, ey + 3, EYE); }
    else if (blink) { P.rect(ex, ey + 4, 3, 1, EYE); P.set(ex - 1, ey + 3, pal.s); P.set(ex + 3, ey + 3, pal.s); }
    else { P.rect(ex, ey, 3, 6, EYE); P.set(ex, ey, SHINE); P.set(ex, ey + 1, SHINE); P.set(ex + 2, ey + 4, "#4a3a36"); }
  }
  P.rect(7 + sh, ey + 7, 3, 1, pal.k); P.rect(22 + sh, ey + 7, 3, 1, pal.k); // blush
  if (happy && !sleep) { P.rect(15 + sh, ey + 7, 2, 1, EYE); P.rect(15 + sh, ey + 8, 2, 1, "#c8505a"); }
  return P;
}

/** HD hats, drawn over the body on their own layer and ringed in their own ink. c: {h, l, d, dd, b, bl, bd}. */
const HATS_HD = {
  straw(P, c) {
    const brim = (from) => P.oval(16, 12, 15.2, 2.9, (x, y, u, v) => y < from ? null : v < -0.25 ? c.l : v > 0.45 ? c.d : c.h);
    brim(0);
    P.oval(16, 8.5, 7.2, 5.5, (x, y, u) => y > 11 ? null : y === 9 ? c.bl : y === 10 ? c.b : y === 11 ? c.bd : u < -0.5 ? c.l : u > 0.62 ? c.d : c.h);
    brim(12);
    P.map((x, y, col) => col === c.h && (x * 3 + y * 5) % 7 === 0 ? c.d : undefined); // the weave
  },
  beanie(P, c) {
    P.oval(16, 14.5, 12.6, 11, (x, y, u, v) => y > 15 ? null : y >= 13 ? (x % 2 ? c.d : c.dd) : u < -0.45 && v < -0.1 ? c.l : x % 3 === 0 ? c.d : c.h);
    P.oval(16, 3.2, 3.3, 3.1, (x, y, u, v) => u < -0.1 && v < -0.1 ? c.bl : v > 0.5 ? c.bd : c.b);
  },
  cap(P, c) {
    P.oval(15, 13.5, 10.6, 8.6, (x, y, u, v) => y > 13 ? null : u < -0.45 && v < -0.2 ? c.l : u > 0.55 ? c.d : c.h);
    P.line(15, 6, 15, 12, c.d); P.rect(14, 4, 3, 1, c.b);
    P.rect(8, 9, 4, 3, c.b); P.set(8, 9, c.bl);
    P.rect(21, 12, 10, 1, c.h); P.rect(21, 13, 10, 1, c.dd); P.set(30, 12, c.d); P.rect(22, 11, 6, 1, c.d);
  },
  flower(P, c) {
    P.line(23, 9, 21, 13, "#3f8f35"); P.oval(19.5, 11, 2.2, 1.2, "#63b04a", -0.5);
    for (const [px, py] of [[20.5, 5], [26.5, 5], [23.5, 2.2], [23.5, 7.8]]) P.oval(px, py, 2.6, 2.4, (x, y, u, v) => u < -0.2 && v < -0.2 ? c.l : v > 0.5 ? c.d : c.h);
    P.oval(23.5, 5, 1.9, 1.9, (x, y, u, v) => u < 0 && v < 0 ? c.bl : c.b);
  },
  headphones(P, c) {
    P.oval(16, 15.5, 13.6, 11.5, (x, y, u, v) => y > 14 || u * u + v * v < 0.7 ? null : v < -0.9 ? c.bl : c.b);
    for (let y = 14; y <= 21; y++) {
      const edge = y === 14 || y === 21;
      if (!edge) { P.set(1, y, c.l); P.set(30, y, c.d); }
      P.rect(2, y, 2, 1, c.h); P.set(4, y, c.bd); P.set(27, y, c.bd); P.rect(28, y, 2, 1, y > 18 ? c.d : c.h);
    }
  },
  bow(P, c) {
    const loop = (x, y, u, v) => Math.abs(v) < 0.35 && Math.abs(u) > 0.55 ? c.d : v < -0.3 ? c.l : c.h;
    P.oval(10.5, 8.5, 4.6, 3.5, loop, -0.3); P.oval(21.5, 8.5, 4.6, 3.5, loop, 0.3);
    P.rect(13, 11, 2, 3, c.d); P.rect(17, 11, 2, 3, c.d);
    P.oval(16, 9.2, 2.3, 2.5, (x, y, u, v) => u < 0 && v < 0 ? c.bl : c.b);
  },
  crown(P, c) {
    for (const [px, top] of [[8, 4], [14, 2], [20, 4]]) {
      for (let y = top; y <= 9; y++) { const half = (y - top + 1) / (10 - top) * 2.2; for (let x = px; x < px + 4; x++) if (Math.abs(x + 0.5 - (px + 2)) <= half) P.set(x, y, x === px ? c.l : c.h); }
      P.rect(px + 1, top - 1, 2, 1, "#fff4c2");
    }
    P.rect(8, 9, 16, 4, c.h); P.rect(8, 9, 16, 1, c.l); P.rect(8, 12, 16, 1, c.d);
    P.rect(10, 10, 2, 2, c.b); P.rect(15, 10, 2, 2, "#3b7dd8"); P.rect(20, 10, 2, 2, c.b);
    P.set(10, 10, c.bl); P.set(15, 10, "#9cc6f5"); P.set(20, 10, c.bl);
  },
  sprout(P, c) {
    P.line(16, 13, 16, 7, c.bd); P.set(15, 13, c.bd);
    const leaf = (x, y, u, v) => Math.abs(v) < 0.2 && Math.abs(u) < 0.8 ? c.d : v < -0.25 ? c.l : c.h;
    P.oval(11.2, 6.5, 5.2, 2.6, leaf, 0.4); P.oval(20.8, 5.5, 5.2, 2.6, leaf, -0.4);
  },
  leaf(P, c) {
    P.line(5, 13, 8, 11, c.b);
    P.oval(16, 7.5, 10.4, 4.1, (x, y, u, v) => v < -0.35 ? c.l : v > 0.5 ? c.d : c.h, -0.45);
    P.line(8, 11, 24, 4, c.d);
    for (const k of [11, 15, 19]) P.line(k, 10 - (k - 8) * 0.43, k + 2, 7 - (k - 8) * 0.43, c.d);
  },
  wizard(P, c) {
    const brim = (from) => P.oval(16, 12.5, 14.6, 2.6, (x, y, u, v) => y < from ? null : v < -0.3 ? c.l : v > 0.4 ? c.dd : c.d);
    brim(0);
    for (let y = 0; y <= 11; y++) {
      const t = (11 - y) / 11, half = 7.6 * (1 - t) + 0.7, cx = 16 + t * t * 6;
      for (let x = 0; x < 32; x++) { const dx = x + 0.5 - cx; if (Math.abs(dx) <= half) P.set(x, y, y >= 9 && y <= 10 ? (y === 9 ? c.bl : c.b) : dx < -half * 0.45 ? c.l : dx > half * 0.5 ? c.d : c.h); }
    }
    for (const [sx, sy] of [[13, 6], [19, 3]]) { P.set(sx, sy, c.bl); P.set(sx - 1, sy, c.b); P.set(sx + 1, sy, c.b); P.set(sx, sy - 1, c.b); P.set(sx, sy + 1, c.b); }
    brim(12);
  },
  chef(P, c) {
    P.rect(9, 6, 14, 6, c.h);
    const puff = (x, y, u, v) => u < -0.3 && v < -0.2 ? c.l : v > 0.55 ? c.d : c.h;
    P.oval(11, 5.6, 4.3, 3.7, puff); P.oval(21, 5.6, 4.3, 3.7, puff); P.oval(16, 3.9, 4.7, 3.9, puff);
    for (const x of [12, 16, 20]) P.line(x, 7, x, 9, c.d);
    P.rect(9, 10, 14, 3, c.b); P.rect(9, 10, 14, 1, c.bl); P.rect(9, 12, 14, 1, c.bd); P.set(22, 11, c.bd);
  },
  none() {},
};
/** Accessories: `back` goes behind the body, `front` over it. dy: the body's drop when it sits down to nap. */
const ACC_HD = {
  scarf: { front(P, c, lk, dy) {
    P.rect(4, 25 + dy, 24, 3, c.b); P.rect(4, 25 + dy, 24, 1, c.bl);
    for (let x = 6; x < 28; x += 4) P.rect(x, 26 + dy, 1, 2, c.bd);
    if (!dy) { P.rect(21, 28, 3, 5, c.b); P.rect(21, 30, 3, 1, c.bd); P.set(21, 33, c.bd); P.set(23, 33, c.bd); }
  } },
  glasses: { ink: true, front(P, c, lk, dy) {
    const sh = lk * 2;
    for (const ex of [8 + sh, 17 + sh]) {
      P.rect(ex, 16 + dy, 7, 1, "#1c2233"); P.rect(ex, 23 + dy, 7, 1, "#1c2233"); P.rect(ex, 17 + dy, 1, 6, "#1c2233"); P.rect(ex + 6, 17 + dy, 1, 6, "#1c2233");
      P.set(ex + 5, 17 + dy, "#e9f6ff"); P.set(ex + 5, 18 + dy, "#bfe0f5");
    }
    P.rect(15 + sh, 18 + dy, 2, 1, "#1c2233");
  } },
  bowtie: { front(P, c, lk, dy) {
    const w = (x, y, u, v) => v < -0.3 ? c.bl : Math.abs(u) > 0.6 ? c.bd : c.b;
    P.oval(12.4, 26.5 + dy, 3.2, 2.3, w); P.oval(19.6, 26.5 + dy, 3.2, 2.3, w); P.rect(15, 25 + dy, 2, 3, c.bd);
  } },
  backpack: {
    back(P, c, lk, dy) { P.rect(26, 17 + dy, 6, 12, "#8a5a2b"); P.rect(26, 17 + dy, 6, 3, "#6d4420"); P.rect(29, 21 + dy, 2, 2, "#e0b64e"); P.rect(31, 20 + dy, 1, 9, "#6d4420"); },
    front(P, c, lk, dy) { P.rect(6, 13 + dy, 1, 16, "#6d4420"); P.rect(25, 13 + dy, 1, 16, "#6d4420"); P.set(6, 22 + dy, "#e0b64e"); P.set(25, 22 + dy, "#e0b64e"); },
  },
  cape: { back(P, c, lk, dy) {
    for (let y = 15 + dy; y <= 35; y++) { const half = 12.5 + (y - 15 - dy) * 0.16; for (let x = 0; x < 32; x++) { const d = x + 0.5 - 16; if (Math.abs(d) <= half) P.set(x, y, y === 15 + dy ? c.bl : Math.round(d) % 5 === 0 ? c.bd : c.b); } }
  } },
};
const hatPal = (hc, band) => ({ h: hc, l: shade(hc, 0.17), d: shade(hc, -0.17), dd: shade(hc, -0.3), b: band, bl: shade(band, 0.18), bd: shade(band, -0.2) });
const inkOf = (hc) => mix(hc, "#1b1420", 0.74);

/** One HD pose of a skin, 32 x 36. Bodies are shared by body colour and pose; the hat and accessory layers per skin. */
const bodyHDCache = new Map();
function skinFrameHD(skin, o) {
  const code = poseCode(o) + 144 * (o.happy ? 1 : 0);
  skin.hd = skin.hd || [];
  let c = skin.hd[code];
  if (c) return c;
  const bkey = skin.body + "|" + code;
  let body = bodyHDCache.get(bkey);
  if (!body) bodyHDCache.set(bkey, (body = clawdHD(bodyPalHD(skin.body), o).canvas()));
  c = canvas(32, 36);
  const g = c.getContext("2d"), dy = o.sleep ? 5 : 0, lk = o.look || 0, cp = hatPal(skin.band, skin.band), acc = ACC_HD[skin.acc];
  const layer = (fn, ink) => { const P = new Pix(32, 36); fn(P); if (ink) P.outline(ink); g.drawImage(P.canvas(), 0, 0); };
  if (acc?.back) layer((P) => acc.back(P, cp, lk, dy), "#1c1a24");
  g.drawImage(body, 0, 0);
  if (acc?.front) layer((P) => acc.front(P, cp, lk, dy), acc.ink ? null : "#1c1a24");
  if (skin.hat !== "none") {
    if (!skin.hatHD) { const P = new Pix(32, 36); HATS_HD[skin.hat](P, hatPal(skin.hatC, skin.band)); P.outline(inkOf(skin.hatC)); skin.hatHD = P.canvas(); }
    g.drawImage(skin.hatHD, 0, dy);
  }
  return (skin.hd[code] = c);
}

/** A sub-agent in HD: a small Claude with a headband in its colour, 20 x 16 (world 10 x 8). */
const miniHDCache = new Map();
function miniHD(color, { legs = 0, arms = 0, blink = false }) {
  const code = color + (legs + 3 * arms + 6 * (blink ? 1 : 0));
  let c = miniHDCache.get(code);
  if (c) return c;
  const P = new Pix(20, 16), pal = bodyPalHD(CLAY.b);
  for (let y = 2; y <= 11; y++) for (let x = 3; x <= 16; x++) {
    if ((x === 3 || x === 16) && (y === 2 || y === 11)) continue;
    P.set(x, y, y === 4 ? shade(color, 0.16) : y === 5 ? color : y === 2 || x === 3 ? pal.h : x === 16 || y === 11 ? pal.s : pal.b);
  }
  P.set(17, 5, color); P.set(18, 6, shade(color, -0.15)); // the headband's knot
  const ay = 7 - arms * 3;
  P.rect(1, ay, 2, 3, pal.h); P.rect(17, ay + (arms ? 0 : 0), 2, 3, pal.s);
  [4, 7, 11, 14].forEach((lx, i) => { const up = legs !== 0 && ((i % 2 === 0) === (legs === 1)); P.rect(lx, 12, 2, up ? 1 : 2, pal.d); });
  P.outline(pal.o);
  for (const ex of [6, 12]) { if (blink) P.rect(ex, 9, 2, 1, EYE); else { P.rect(ex, 7, 2, 3, EYE); P.set(ex, 7, SHINE); } }
  miniHDCache.set(code, (c = P.canvas()));
  return c;
}

/** The egg, the laptop and the scarecrow in HD. */
const EGG_HD = (() => {
  const P = new Pix(24, 24), cy = 13.5, ry = 10;
  for (let y = 3; y < 24; y++) {
    const t = (y + 0.5 - cy) / ry; if (Math.abs(t) > 1) continue;
    const half = 8.4 * Math.sqrt(1 - t * t) * (t < 0 ? 1 + t * 0.2 : 1);
    for (let x = 0; x < 24; x++) { const d = (x + 0.5 - 12) / half; if (Math.abs(d) <= 1) P.set(x, y, d < -0.35 && t < -0.1 ? "#fffaf0" : d > 0.55 || t > 0.7 ? "#dccba2" : "#f6eed8"); }
  }
  for (const [x, y, c] of [[9, 8, "#e2875f"], [10, 8, "#e2875f"], [15, 11, "#e2875f"], [7, 14, "#f0a57f"], [13, 17, "#e2875f"], [14, 17, "#e2875f"], [16, 20, "#f0a57f"], [10, 20, "#e2875f"], [17, 14, "#c9b489"]]) P.set(x, y, c);
  P.set(9, 6, "#ffffff"); P.set(8, 7, "#ffffff");
  return P.outline("#6b5a3a").canvas();
})();
const LAPTOP_HD = [0, 1, 2].map(f => {
  const P = new Pix(18, 14);
  P.rect(1, 0, 16, 9, "#1b1f2a"); P.rect(2, 1, 14, 7, f === 2 ? "#1d2833" : "#22303c");
  if (f < 2) {
    const rows = f ? [[3, 5, "#7cfc9a"], [4, 3, "#d97757"], [3, 7, "#7cfc9a"]] : [[3, 7, "#7cfc9a"], [5, 4, "#7cfc9a"], [3, 4, "#d97757"]];
    rows.forEach(([x, w, c], i) => P.rect(x, 2 + i * 2, w, 1, c));
    P.rect(12, 6, 2, 1, f ? "#7cfc9a" : "#22303c");
  } else P.set(3, 2, "#3a4a58");
  P.rect(0, 9, 18, 1, "#c3cad6"); P.rect(0, 10, 18, 2, "#9aa3b2"); P.rect(0, 12, 18, 1, "#1b1f2a");
  for (let x = 2; x < 16; x += 2) P.set(x, 10, "#6b7383");
  P.set(0, 9, "#1b1f2a"); P.set(17, 9, "#1b1f2a"); P.rect(0, 10, 1, 2, "#1b1f2a"); P.rect(17, 10, 1, 2, "#1b1f2a");
  return P.canvas();
});
const SCARECROW_HD = [0, 1, 2].map(f => {
  const off = f === 2, C = off ? { o: "#3a3a40", y: "#a39d8c", yd: "#857f70", b: "#b4ad9e", bd: "#958e80", r: "#80808a", rd: "#66666e", w: "#6b6158", e: "#3a3a40" }
    : { o: "#3a2616", y: "#e8be55", yd: "#c28f2c", b: "#dcc49a", bd: "#bfa57a", r: "#c0392b", rd: "#8e2a20", w: "#8a6038", e: "#231815" };
  const P = new Pix(32, 44), lift = f === 1 ? -1 : 0;
  P.rect(15, 24, 2, 19, C.w); P.set(15, 24, shade(C.w, 0.15));
  for (let x = 2; x <= 29; x++) for (let y = 18; y <= 22; y++) { const armY = y + (x < 10 ? lift : x > 21 ? -lift : 0); P.set(x, armY, (Math.floor(x / 3) + y) % 3 === 0 ? C.rd : C.r); }
  for (const [x, s] of [[0, -1], [31, 1]]) for (let k = 0; k < 4; k++) P.set(x - s * (k % 2), 18 + k + (x < 10 ? lift : -lift), k % 2 ? C.yd : C.y);
  for (let y = 17; y <= 30; y++) for (let x = 9; x <= 22; x++) P.set(x, y, (x % 4 === 1 || y % 4 === 1) ? C.rd : C.r);
  P.rect(9, 28, 14, 1, C.y); P.rect(10, 31, 3, 2, C.y); P.rect(15, 31, 2, 3, C.yd); P.rect(19, 31, 3, 2, C.y);
  const hy = off ? 1 : 0, hx = off ? 1 : 0;
  P.oval(16 + hx, 12 + hy, 6.4, 6, (x, y, u, v) => u < -0.4 && v < -0.2 ? shade(C.b, 0.08) : u > 0.5 || v > 0.6 ? C.bd : C.b);
  P.rect(8 + hx, 6 + hy, 17, 2, C.y); P.rect(8 + hx, 7 + hy, 17, 1, C.yd);
  P.oval(16 + hx, 3.5 + hy, 5.5, 3.6, (x, y, u) => y > 6 + hy ? null : u < -0.3 ? shade(C.y, 0.1) : C.y);
  P.rect(11 + hx, 5 + hy, 11, 1, C.r);
  P.outline(C.o);
  if (off) { P.rect(13 + hx, 12 + hy, 2, 1, C.e); P.rect(18 + hx, 12 + hy, 2, 1, C.e); }
  else for (const ex of [13, 18]) { P.set(ex, 10, C.e); P.set(ex + 1, 11, C.e); P.set(ex + 1, 10, C.e); P.set(ex, 11, C.e); }
  for (let x = 13; x <= 19; x++) P.set(x + hx, 15 + hy + (x === 13 || x === 19 ? -1 : 0), x % 2 ? C.e : C.bd); // stitched smile
  return P.canvas();
});
/** The field's crops, 8 x 16 HD (world 4 x 8), three sway frames each: seed, sprout, grow, ripe (Claude's spark), wilt. */
const SPARK = ["....o....", ".o..o..o.", "..o.o.o..", "...ooo...", "oooowoooo", "...ooo...", "..o.o.o..", ".o..o..o.", "....o...."];
const CROPS = {};
for (const stage of ["seed", "sprout", "grow", "ripe", "wilt"]) CROPS[stage] = [-1, 0, 1].map(sw => {
  const P = new Pix(10, 18), G1 = "#3f8f35", G2 = "#6fcf5b", G3 = "#a6e27a";
  if (stage === "seed") { P.rect(3, 15, 4, 1, "#4a3220"); P.set(4, 14, G2); P.set(5, 13, G2); P.set(3, 13, G1); P.set(6, 14, G3); }
  else if (stage === "wilt") { P.line(4, 16, 4, 10, "#7a6a3a"); P.line(4, 10, 7, 11, "#7a6a3a"); P.set(7, 12, "#5c4b27"); P.line(3, 13, 1, 14, "#8a7a45"); P.set(8, 12, "#5c4b27"); }
  else {
    const top = stage === "sprout" ? 10 : 6;
    for (let y = top; y <= 16; y++) P.set(4 + (y < top + 3 ? sw : 0), y, G1);
    P.rect(1 + sw, top + 3, 3, 1, G2); P.set(1 + sw, top + 2, G3); P.rect(5 + sw, top + 5, 3, 1, G2); P.set(7 + sw, top + 4, G3);
    if (stage !== "sprout") { P.rect(1, top + 8, 3, 1, G2); P.rect(5, top + 9, 3, 1, G1); }
    if (stage === "grow") { P.rect(3 + sw, top - 2, 3, 2, "#d97757"); P.set(4 + sw, top - 2, "#f2a07a"); }
    if (stage === "ripe") SPARK.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ".") P.set(x + sw - 0.5, y - 1, ch === "w" ? "#fff1cf" : x === 4 || y === 4 ? "#e8845f" : "#d97757"); }));
  }
  return P.canvas();
});
/** Small things drawn on the canvas: a shadow per size, the selection arrows, the waiting flag, a z for napping. */
const shadowHD = new Map();
function shadowSprite(rx, ry) {
  const k = rx + "x" + ry;
  if (!shadowHD.has(k)) { const P = new Pix(rx * 2 + 2, ry * 2 + 2); P.oval(rx + 1, ry + 1, rx, ry, "#14200c"); const c = P.canvas(); shadowHD.set(k, c); }
  return shadowHD.get(k);
}
const ARROW = (fill, ink) => { const P = new Pix(9, 7); for (let y = 0; y < 5; y++) P.rect(y, y, 9 - y * 2, 1, fill); P.set(1, 0, shade(fill, 0.2)); return P.outline(ink).canvas(); };
const ARROW_SEL = ARROW("#ffffff", "#1f2a44"), ARROW_MINE = ARROW("#ffd24a", "#6b4a07");
const FLAG_HD = [0, 1].map(f => { const P = new Pix(12, 20); P.rect(1, 0, 1, 19, "#3a1410"); const c = f ? "#ff8a70" : "#e0513c";
  for (let y = 1; y < 11; y++) P.rect(2, y, 8 - (y > 8 ? (y - 8) * 2 : 0) + (f && y > 3 && y < 7 ? 1 : 0), 1, c); P.rect(5, 3, 2, 3, "#fff"); P.rect(5, 7, 2, 1, "#fff"); return P.outline("#3a1410").canvas(); });
const ZED = (() => { const P = new Pix(6, 6); P.rect(0, 0, 5, 1, "#f4f1e8"); P.line(4, 1, 0, 4, "#f4f1e8"); P.rect(0, 4, 5, 1, "#f4f1e8"); return P.outline("#3c4a6b").canvas(); })();
const SPARKLE = ["#fff4c2", "#ffd59e", "#f2a07a", "#ffffff"].map(c => { const P = new Pix(7, 7); P.rect(3, 1, 1, 5, c); P.rect(1, 3, 5, 1, c); P.set(3, 3, "#ffffff"); P.set(3, 0, shade(c, -0.1)); P.set(3, 6, shade(c, -0.1)); P.set(0, 3, shade(c, -0.1)); P.set(6, 3, shade(c, -0.1)); return P.canvas(); });

/** The little meadow behind a portrait (drawn in device pixels, in blocks of u so it matches the sprite's grain). */
function tileBg(g, W) {
  const u = Math.max(2, Math.round(W / 48)), rnd = mulberry32(W);
  g.fillStyle = "#71923c"; g.fillRect(0, 0, W, W);
  for (let i = 0; i < 46; i++) { g.fillStyle = ["#648436", "#80a246", "#648436", "#93b552"][i % 4]; g.fillRect(Math.floor(rnd() * W / u) * u, Math.floor(rnd() * W / u) * u, u, u * (i % 3 ? 1 : 2)); }
  const cx = W / 2, cy = W - u * 4, rx = W * 0.38, ry = u * 3;
  for (let y = -ry; y <= ry; y += u) { const w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))) / u) * u; g.fillStyle = y < 0 ? "#8ea456" : "#7d9446"; g.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2, u); }
}
/** Draw an HD sprite to a canvas element crisply at `css` px: the backing store follows devicePixelRatio and the sprite
 * scales by a whole number. */
function paintSprite(cv, img, css, { bg = null, pad = 0, bottom = false, fixed = false } = {}) {
  const dpr = Math.min(3, devicePixelRatio || 1), W = Math.round(css * dpr);
  if (cv.width !== W) { cv.width = W; cv.height = W; }
  if (!fixed) cv.style.width = cv.style.height = css + "px"; // (fixed: CSS sizes it, css is its content width)
  const g = cv.getContext("2d"); g.imageSmoothingEnabled = false; g.clearRect(0, 0, W, W);
  if (bg) bg(g, W);
  const k = Math.max(1, Math.floor((W - pad * 2 * dpr) / Math.max(img.width, img.height)));
  const x = Math.round((W - img.width * k) / 2), y = bottom ? Math.round(W - pad * dpr - img.height * k) : Math.round((W - img.height * k) / 2);
  g.drawImage(img, x, y, img.width * k, img.height * k);
  return k;
}

// ======================================================================= world
const G = { // Thronglet-ish meadow palette
  g0: "#4a6524", g1: "#577530", g2: "#648436", g3: "#71923c", g4: "#80a246", worn: "#8ea456",
  t0: "#1c3519", t1: "#28501f", t2: "#346a27", t3: "#468a31", t4: "#63a93f", t5: "#8cc65a", trunk: "#4b3421",
  r0: "#34343c", r1: "#55555e", r2: "#6f6f78", r3: "#8d8d96", r4: "#aeaeb5",
  soil: "#6b4a2e", soil2: "#57391f", soil3: "#7d5a3a", soilo: "#3f2915",
  w0: "#2a5a8a", w1: "#3f7fb8", w2: "#5b9ed0", w3: "#9fd0ee",
};
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

function valueNoise(seed) {
  const rnd = mulberry32(seed), N = 64, grid = Array.from({ length: N * N }, rnd);
  const at = (x, y) => grid[((y % N + N) % N) * N + ((x % N + N) % N)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(at(xi, yi), at(xi + 1, yi), u), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), u), v);
  };
}

function pxCircle(g, cx, cy, r, color) {
  g.fillStyle = color;
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(r * r - y * y + r * 0.8));
    g.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
  }
}
function pxEllipse(g, cx, cy, rx, ry, color) {
  g.fillStyle = color;
  for (let y = -ry; y <= ry; y++) {
    const w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.6))));
    g.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
  }
}

const PLOT = { w: 30, h: 16, cx: 60, cy: 40 }, YARD = { cx: 19, cy: 17 };
// where a plot's sub-agents stand (their feet, from the plot's corner): above it, below it, then on its right
// sinaleiro: the minis work inside their Claude's plot, on the soil in two rows of four, instead of round its edges
// (where, by the field's fence, they looked like they were leaving it)
const SUB_SPOTS = [[8, 7], [22, 7], [8, PLOT.h], [22, PLOT.h], [15, 7], [15, PLOT.h], [1, 11], [29, 11]];
const MINIS_PER_PLOT = SUB_SPOTS.length;
const CROW_LANE = 22; // the scarecrow stands inside the field's fence, bottom left

function layoutWorld(W, H, opts = {}) {
  const T = clamp(Math.round(Math.min(W, H) * 0.14), 20, 40);
  const play = { x0: T + 2, y0: T + 8, x1: W - T - 2, y1: H - T - 4 };
  const portrait = H > W * 1.15;
  const barn = { w: 46, h: 44 };
  barn.x = opts.barnRight && !portrait ? play.x1 - barn.w - 6 : play.x0 + 6; barn.y = play.y0 - 2;
  const board = { x: opts.barnRight && !portrait ? barn.x - 36 : barn.x + barn.w + 10, y: barn.y + 16, w: 26, h: 20 };
  // opts.clearCenter keeps the middle free for a title (the landing page): the field goes to the right
  const reserve = opts.reserve || null;
  const cols = portrait || reserve ? 2 : (play.x1 - play.x0 > 300 ? 4 : 3), rows = portrait && reserve ? 2 : portrait || reserve ? 3 : 2;
  const pw = PLOT.w, ph = PLOT.h, gx = 22, gy = 18;
  const fw = cols * pw + (cols - 1) * gx, fh = rows * ph + (rows - 1) * gy;
  const fx = portrait ? Math.round((W - fw) / 2 + 8)
    : reserve ? Math.round(Math.min((reserve.x + reserve.w + play.x1) / 2 - fw / 2 + 6, play.x1 - fw - 4)) : Math.round(play.x1 - fw - 12);
  const fy = portrait ? Math.round(reserve ? reserve.y + reserve.h + 14 : barn.y + barn.h + 34) : Math.round(Math.max((play.y0 + play.y1) / 2 - fh / 2 + 12, opts.barnRight ? barn.y + barn.h + 20 : 0));
  const plots = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    plots.push({ x: fx + c * (pw + gx), y: fy + r * (ph + gy), w: pw, h: ph, i: plots.length });
  const field = { x: fx - 12, y: fy - 8, w: fw + 16, h: fh + 14 };
  const pond = { cx: play.x0 + 30, cy: play.y1 - 14, rx: 24, ry: 11 };
  const rest = { x: barn.x + 10, y: barn.y + barn.h + 12 };
  const door = { x: barn.x + barn.w / 2, y: barn.y + barn.h + 2 };
  return { W, H, T, play, portrait, barn, board, plots, field, pond, rest, door, rocks: [], decor: [], paths: [], reserve, yard: null, crow: null, z: 0 };
}

/** The real farm's layout, grown to fit it: a fenced field with a plot for every busy Claude (the scarecrow keeps its
 * corner), the barn with a yard where resting Claudes nap, the pond, and dirt paths between them. It tries field and yard
 * widths and keeps the one that shows the whole farm biggest in this window (`view`: the window in CSS px, the HUD's
 * insets, S, the classic zoom, and snap(), which rounds a zoom down to one that draws whole pixels). */
function layoutFarm(need, view) {
  const nP = Math.max(6, need.plots), nY = Math.max(5, need.yard);
  const avW = Math.max(120, view.w - view.left - view.right), avH = Math.max(120, view.h - view.top - view.bottom);
  const portrait = view.h > view.w * 1.15, GAP = 16;
  let best = null;
  for (let fc = 1; fc <= Math.min(nP, 30); fc++) {
    const fr = Math.ceil(nP / fc);
    if (fc > 1 && Math.ceil(nP / (fc - 1)) === fr) continue; // same rows as a narrower field
    for (const yc of [5, 7, 9, 12, 16, 22, 30]) {
      if (yc > 5 && yc > nY + 4) break;
      const fw = fc * PLOT.cx - (PLOT.cx - PLOT.w) + 35 + CROW_LANE, fh = fr * PLOT.cy - (PLOT.cy - PLOT.h) + 28;
      const yw = yc * YARD.cx + 8, yh = Math.ceil(nY / yc) * YARD.cy + 10;
      const lw = Math.max(yw, 96), lh = 8 + 44 + 16 + yh + 40; // weathervane, barn, path, yard, pond
      const cw = portrait ? Math.max(lw, fw) : lw + GAP + fw, ch = portrait ? lh + 8 + fh : Math.max(lh, fh);
      const z = Math.min(avW / cw, avH / ch);
      if (!best || z > best.z + 1e-6) best = { z, fc, fr, yc, cw, ch, fw, fh, lw, lh, yw, yh };
    }
  }
  const b = best, z = view.snap(Math.min(view.S, b.z));
  const T = clamp(Math.round(Math.min(view.w, view.h) / view.S * 0.14), 20, 40);
  const x0 = Math.max(T + 4, Math.round(view.left / z + (avW / z - b.cw) / 2)), y0 = Math.max(T + 6, Math.round(view.top / z + (avH / z - b.ch) / 2));
  const W = Math.max(Math.ceil(view.w / z), x0 + b.cw + T + 4), H = Math.max(Math.ceil(view.h / z), y0 + b.ch + T + 4);
  const play = { x0: T + 2, y0: T + 8, x1: W - T - 2, y1: H - T - 4 };
  const colX = portrait ? x0 + Math.round((b.cw - b.lw) / 2) : x0;
  const barn = { w: 46, h: 44, x: colX + Math.round((b.lw - 46) / 2), y: y0 + 8 };
  const yard = { x: colX + Math.round((b.lw - b.yw) / 2), y: barn.y + barn.h + 16, cols: b.yc, w: b.yw, h: b.yh, n: nY };
  const pond = { cx: colX + Math.round(b.lw / 2), cy: yard.y + yard.h + 21, rx: Math.min(30, Math.round(b.lw / 2) - 6), ry: 11 };
  const field = portrait ? { x: x0 + Math.round((b.cw - b.fw) / 2), y: y0 + b.lh + 8, w: b.fw, h: b.fh }
    : { x: x0 + b.lw + GAP, y: y0 + Math.round((b.ch - b.fh) / 2), w: b.fw, h: b.fh };
  const fx = field.x + 19 + CROW_LANE, fy = field.y + 15;
  const plots = [];
  for (let i = 0; i < b.fc * b.fr; i++) plots.push({ x: fx + (i % b.fc) * PLOT.cx, y: fy + Math.floor(i / b.fc) * PLOT.cy, w: PLOT.w, h: PLOT.h, i });
  const crow = { x: field.x + 13, y: field.y + field.h - 9 };
  const door = { x: barn.x + barn.w / 2, y: barn.y + barn.h + 2 };
  // dirt paths: the barn door to the yard's gate, and on to the field's gate
  const py = door.y + 7, paths = [[{ x: door.x, y: door.y - 1 }, { x: door.x, y: yard.y + 2 }]];
  let gate, sign;
  if (!portrait) {
    const gy = clamp(py, field.y + 12, Math.max(field.y + 12, field.y + field.h - 38)), mx = field.x - 8;
    paths.push(gy === py ? [{ x: door.x, y: py }, { x: field.x + 4, y: py }] : [{ x: door.x, y: py }, { x: mx, y: py }, { x: mx, y: gy }, { x: field.x + 4, y: gy }]);
    gate = { side: "left", at: gy }; sign = { x: field.x - 7, y: gy - 9 };
  } else {
    const rx = Math.min(W - T - 8, Math.max(yard.x + yard.w, pond.cx + pond.rx) + 10), gx = clamp(rx, field.x + CROW_LANE + 16, field.x + field.w - 12);
    paths.push([{ x: door.x, y: py }, { x: rx, y: py }, { x: rx, y: field.y - 6 }, { x: gx, y: field.y - 6 }, { x: gx, y: field.y + 4 }]);
    gate = { side: "top", at: gx }; sign = { x: gx + 12, y: field.y - 10 };
  }
  const board = { x: barn.x + barn.w + 10, y: barn.y + 16, w: 26, h: 20 };
  const content = { x: x0, y: y0, w: b.cw, h: b.ch };
  return { W, H, T, play, portrait, barn, board, plots, field, gate, pond, rest: yard, yard, door, rocks: [], decor: [], paths, sign, reserve: null, crow, content, z,
    cap: { plots: plots.length, yard: b.yc * Math.ceil(nY / b.yc) } };
}
/** Where the n-th resting Claude sits in the yard. */
function yardSpot(L, i) {
  const Y = L.yard;
  if (!Y) return { x: L.barn.x - 2 + (i % 5) * 19, y: L.barn.y + L.barn.h + 16 + Math.floor(i / 5) * 16 };
  return { x: Y.x + 13 + (i % Y.cols) * YARD.cx, y: Y.y + 19 + Math.floor(i / Y.cols) * YARD.cy };
}

function blocked(L, x, y) {
  const inR = (r, pad = 0) => x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad + 4;
  if (inR(L.barn, 8) || (Scene.passive && inR(L.board, 6)) || inR(L.field, 2) || (L.reserve && inR(L.reserve, 12))) return true;
  if (L.yard && inR(L.yard, 6)) return true;
  if (L.crow && Math.abs(x - L.crow.x) < 12 && y > L.crow.y - 24 && y < L.crow.y + 6) return true;
  if (L.sign && Math.abs(x - L.sign.x) < 8 && y > L.sign.y - 4 && y < L.sign.y + 14) return true;
  if (((x - L.pond.cx) / (L.pond.rx + 8)) ** 2 + ((y - L.pond.cy) / (L.pond.ry + 6)) ** 2 < 1) return true;
  if (L.decor.some(d => d.r && Math.abs(x - d.x) < d.r + 5 && y > d.y - d.r - 2 && y < d.y + 5)) return true;
  return L.rocks.some(r => Math.abs(x - r.x) < r.w / 2 + 6 && y > r.y - 4 && y < r.y + r.h + 4);
}
const onPath = (L, x, y, pad = 5) => L.paths.some(pts => pts.some((p, i) => i > 0 && x > Math.min(p.x, pts[i - 1].x) - pad && x < Math.max(p.x, pts[i - 1].x) + pad && y > Math.min(p.y, pts[i - 1].y) - pad && y < Math.max(p.y, pts[i - 1].y) + pad));

// ---- the background's pieces, drawn at HD pixels (world x HD) on the background canvas
const hdRect = (g, x, y, w, hgt, c) => { g.fillStyle = c; g.fillRect(x, y, w, hgt); };
function drawTreeHD(g, x, y, r, rnd) {
  pxEllipse(g, x + 4, y + r - 2, r + 3, Math.max(5, Math.round(r / 3)), "rgba(20,32,10,.32)");
  hdRect(g, x - 4, y + r - 15, 8, 15, G.trunk); hdRect(g, x - 4, y + r - 15, 2, 15, "#5e4330"); hdRect(g, x + 2, y + r - 15, 2, 15, "#35241a");
  hdRect(g, x - 6, y + r - 2, 3, 2, G.trunk); hdRect(g, x + 3, y + r - 2, 3, 2, "#35241a");
  const blobs = [[0, 0, 1], [-0.5, -0.15, 0.62], [0.5, -0.1, 0.6], [0, -0.52, 0.62], [-0.3, 0.3, 0.55], [0.35, 0.32, 0.5]].map(([dx, dy, k]) => [x + dx * r, y + dy * r, Math.max(3, r * k)]);
  for (const [bx, by, br] of blobs) pxCircle(g, bx, by, br + 2, G.t0);
  for (const [bx, by, br] of blobs) pxCircle(g, bx, by, br, G.t1);
  for (const [bx, by, br] of blobs) pxCircle(g, bx - br * 0.18, by - br * 0.22, br * 0.78, G.t2);
  for (const [bx, by, br] of blobs) if (by < y + r * 0.2) pxCircle(g, bx - br * 0.32, by - br * 0.38, br * 0.46, G.t3);
  for (const [bx, by, br] of blobs.slice(1, 4)) pxCircle(g, bx - br * 0.4, by - br * 0.46, br * 0.2, G.t4);
  for (let i = 0; i < r * 2.2; i++) { // leaves
    const a = rnd() * Math.PI * 2, d = rnd() * r * 0.95, lx = Math.round(x + Math.cos(a) * d), ly = Math.round(y + Math.sin(a) * d * 0.9);
    hdRect(g, lx, ly, 2, 1, ly < y ? G.t4 : G.t1); if (ly < y - r * 0.3) hdRect(g, lx, ly - 1, 1, 1, G.t5);
  }
}
function drawRockHD(g, r) { // a mossy boulder; some have Claude's spark carved in
  const cx = Math.round(r.x * HD), rx = r.w, ry = Math.round(r.h * 0.9), cy = Math.round((r.y + r.h) * HD - ry);
  pxEllipse(g, cx + 3, cy + ry, rx + 2, 4, "rgba(20,32,10,.38)");
  pxEllipse(g, cx, cy, rx + 1, ry + 1, G.r0); pxEllipse(g, cx, cy, rx, ry, G.r1);
  pxEllipse(g, cx - Math.round(rx * 0.15), cy - Math.round(ry * 0.2), Math.round(rx * 0.72), Math.round(ry * 0.62), G.r2);
  pxEllipse(g, cx - Math.round(rx * 0.35), cy - Math.round(ry * 0.45), Math.round(rx * 0.32), Math.round(ry * 0.22), G.r3);
  hdRect(g, cx - Math.round(rx * 0.5), cy - Math.round(ry * 0.55), 2, 1, G.r4);
  pxEllipse(g, cx + Math.round(rx * 0.3), cy - ry + 1, Math.round(rx * 0.32), 1, "#5f8a34"); hdRect(g, cx + Math.round(rx * 0.2), cy - ry, 3, 1, "#86b04a");
  if (Math.round(r.x + r.y) % 2) SPARK.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== "." && (i + j) % 2 === 0) hdRect(g, cx - 4 + i, cy - 3 + j, 1, 1, "#45454e"); }));
}
function drawHay(g, x, y) { // a bale, 18 x 14 HD
  hdRect(g, x, y, 18, 14, "#7a5a1a"); hdRect(g, x + 1, y + 1, 16, 12, "#e0b64e"); hdRect(g, x + 1, y + 1, 16, 3, "#f0cf7a");
  hdRect(g, x + 1, y + 10, 16, 3, "#c7973a"); hdRect(g, x + 5, y + 1, 2, 12, "#a8782a"); hdRect(g, x + 12, y + 1, 2, 12, "#a8782a");
  for (let i = 0; i < 6; i++) hdRect(g, x + 2 + i * 3, y - 1 + (i % 2), 1, 2, "#f0cf7a");
}
function drawBarnHD(g, b) {
  const x = b.x * HD, y = b.y * HD, w = b.w * HD, hh = b.h * HD, roofH = 32;
  pxEllipse(g, x + w / 2 + 6, y + hh + 1, w / 2 + 12, 8, "rgba(20,32,10,.36)");
  // walls: red planks, white corner trim, a stone footing
  const wy = y + roofH - 2, wh = hh - roofH + 2;
  hdRect(g, x, wy, w, wh, "#3a1410");
  for (let px = x + 2, i = 0; px < x + w - 2; px += 6, i++) { hdRect(g, px, wy, 6, wh - 2, i % 2 ? "#a8432f" : "#b34a33"); hdRect(g, px, wy, 1, wh - 2, "#8e3624"); }
  hdRect(g, x + 2, wy, w - 4, 2, "#c95c42");
  for (let i = 0; i < 18; i++) hdRect(g, x + 4 + ((i * 37) % (w - 10)), wy + 6 + ((i * 23) % (wh - 12)), 2, 1, "#933826");
  hdRect(g, x + 2, wy, 4, wh - 2, "#efe4cf"); hdRect(g, x + w - 6, wy, 4, wh - 2, "#d6c8ad");
  hdRect(g, x, y + hh - 5, w, 5, "#6f6a66"); for (let px = x + 2; px < x + w - 2; px += 7) hdRect(g, px, y + hh - 5, 5, 3, "#8d8783");
  // roof: a stepped gable of shingles with white trim
  for (let i = 0; i < roofH; i++) {
    const inset = Math.max(0, Math.round((roofH - i) * 0.95) - 6), rx = x - 4 + inset, rw = w + 8 - inset * 2;
    hdRect(g, rx, y + i, rw, 1, "#2d1511");
    hdRect(g, rx + 2, y + i, Math.max(0, rw - 4), 1, i % 4 === 3 ? "#4a2019" : "#6a3024");
    if (i % 4 !== 3) for (let sx = rx + 4 + ((i >> 2) % 2) * 4; sx < rx + rw - 4; sx += 8) hdRect(g, sx, y + i, 1, 1, "#4f231b");
    hdRect(g, rx + 2, y + i, 2, 1, "#f3ead8"); hdRect(g, rx + rw - 4, y + i, 2, 1, "#d6c8ad");
  }
  hdRect(g, x - 4, y + roofH - 2, w + 8, 2, "#f3ead8");
  // loft window with hay in it
  const lx = x + w / 2 - 10, ly = y + 10;
  hdRect(g, lx, ly, 20, 16, "#f3ead8"); hdRect(g, lx + 2, ly + 2, 16, 12, "#2d1a10"); hdRect(g, lx + 2, ly + 9, 16, 5, "#e0b64e");
  for (let i = 0; i < 5; i++) hdRect(g, lx + 3 + i * 3, ly + 7 + (i % 2), 1, 3, "#f0cf7a");
  hdRect(g, lx + 9, ly + 2, 2, 12, "#f3ead8");
  // the big door with its white X
  const dw = 34, dh = wh - 9, dx = x + w / 2 - dw / 2, dy = wy + 6;
  hdRect(g, dx - 2, dy - 2, dw + 4, dh + 2, "#f3ead8"); hdRect(g, dx, dy, dw, dh, "#7a2c1f");
  for (let px = dx + 3; px < dx + dw; px += 4) hdRect(g, px, dy, 1, dh, "#6a2519");
  for (let i = 0; i < dh; i++) { const t = Math.round((i / dh) * (dw / 2 - 2)); hdRect(g, dx + t, dy + i, 2, 1, "#f3ead8"); hdRect(g, dx + dw / 2 - 2 - t, dy + i, 2, 1, "#f3ead8"); hdRect(g, dx + dw / 2 + t, dy + i, 2, 1, "#f3ead8"); hdRect(g, dx + dw - 2 - t, dy + i, 2, 1, "#f3ead8"); }
  hdRect(g, dx + dw / 2 - 1, dy, 2, dh, "#f3ead8");
  hdRect(g, dx - 1, dy + 4, 3, 2, "#2d1a10"); hdRect(g, dx - 1, dy + dh - 7, 3, 2, "#2d1a10"); hdRect(g, dx + dw - 2, dy + 4, 3, 2, "#2d1a10"); hdRect(g, dx + dw - 2, dy + dh - 7, 3, 2, "#2d1a10");
  // a lantern and the weathervane: Claude's spark on the ridge
  hdRect(g, x + w / 2 + 22, wy + 8, 4, 6, "#2d1a10"); hdRect(g, x + w / 2 + 23, wy + 9, 2, 4, "#ffd27a");
  const vx = x + w / 2, vy = y - 12;
  hdRect(g, vx - 1, vy + 6, 2, 8, "#2d1511");
  SPARK.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== ".") hdRect(g, vx - 5 + i, vy - 4 + j, 1, 1, ch === "w" ? "#ffd59e" : "#d97757"); }));
  drawHay(g, x + w + 2, y + hh - 14); drawHay(g, x - 20, y + hh - 14); drawHay(g, x + w + 6, y + hh - 26);
}
function drawPlotHD(g, p) {
  const x = p.x * HD, y = p.y * HD, w = p.w * HD, hh = p.h * HD;
  hdRect(g, x - 2, y, w + 4, hh + 2, G.soilo); hdRect(g, x, y - 2, w, hh + 6, G.soilo);
  hdRect(g, x, y, w, hh + 2, "#4f3420");
  hdRect(g, x, y, w, hh, G.soil);
  for (let yy = y + 3; yy < y + hh - 1; yy += 6) { hdRect(g, x + 2, yy, w - 4, 2, G.soil3); hdRect(g, x + 2, yy + 2, w - 4, 2, G.soil2); hdRect(g, x + 3, yy, w - 8, 1, "#8e6a46"); }
  for (let i = 0; i < 10; i++) hdRect(g, x + 3 + ((i * 17) % (w - 6)), y + 2 + ((i * 11) % (hh - 4)), 1, 1, i % 2 ? "#3f2915" : "#9a7650");
}
function drawPathHD(g, pts, rnd) {
  const seg = (a, b, pad, c) => { const x0 = Math.min(a.x, b.x) * HD - pad, y0 = Math.min(a.y, b.y) * HD - pad; hdRect(g, x0, y0, Math.abs(a.x - b.x) * HD + pad * 2, Math.abs(a.y - b.y) * HD + pad * 2, c); };
  for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i], 8, "#7f6a3d");
  for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i], 7, "#a88a58");
  for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i], 5, "#b69866");
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.round((Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) * 0.8);
    for (let k = 0; k < n; k++) { const t = rnd(), px = Math.round(lerp(a.x, b.x, t) * HD + (rnd() - 0.5) * 11), py = Math.round(lerp(a.y, b.y, t) * HD + (rnd() - 0.5) * 11); hdRect(g, px, py, 2, 1, rnd() < 0.5 ? "#cdb07c" : "#8b7045"); }
  }
}
function drawFenceHD(g, F, gate) {
  const x0 = F.x * HD, y0 = F.y * HD, x1 = (F.x + F.w) * HD, y1 = (F.y + F.h) * HD, gw = 16 * HD;
  const gl = gate?.side === "left" ? [gate.at * HD - gw / 2, gate.at * HD + gw / 2] : null, gt = gate?.side === "top" ? [gate.at * HD - gw / 2, gate.at * HD + gw / 2] : null;
  const post = (x, y) => { hdRect(g, x - 2, y - 11, 5, 13, "#3a2616"); hdRect(g, x - 1, y - 10, 3, 11, "#8a6038"); hdRect(g, x - 1, y - 10, 3, 2, "#b08250"); hdRect(g, x - 2, y + 2, 6, 2, "rgba(20,32,10,.3)"); };
  const hrail = (xa, xb, y) => { hdRect(g, xa, y - 8, xb - xa, 2, "#3a2616"); hdRect(g, xa, y - 7, xb - xa, 1, "#a37446"); hdRect(g, xa, y - 4, xb - xa, 2, "#3a2616"); hdRect(g, xa, y - 3, xb - xa, 1, "#8a6038"); };
  const vrail = (x, ya, yb) => { hdRect(g, x - 1, ya, 3, yb - ya, "#3a2616"); hdRect(g, x, ya, 1, yb - ya, "#8a6038"); };
  // top edge (maybe with a gate), the sides, then the bottom edge
  if (gt) { hrail(x0, gt[0], y0); hrail(gt[1], x1, y0); } else hrail(x0, x1, y0);
  if (gl) { vrail(x0, y0, gl[0]); vrail(x0, gl[1], y1); } else vrail(x0, y0, y1);
  vrail(x1, y0, y1);
  for (let x = x0; x <= x1; x += 20) if (!gt || x < gt[0] - 2 || x > gt[1] + 2) post(Math.min(x, x1), y0);
  for (let y = y0 + 20; y < y1; y += 20) { if (!gl || y < gl[0] - 2 || y > gl[1] + 2) post(x0, y); post(x1, y); }
  if (gt) { post(gt[0], y0); post(gt[1], y0); } if (gl) { post(x0, gl[0]); post(x0, gl[1]); }
  hrail(x0, x1, y1);
  for (let x = x0; x <= x1; x += 20) post(Math.min(x, x1), y1);
}
function drawYardHD(g, Y, rnd) {
  const x = Y.x * HD, y = Y.y * HD, w = Y.w * HD, hh = Y.h * HD;
  hdRect(g, x - 2, y - 2, w + 4, hh + 4, "rgba(90,70,30,.3)");
  hdRect(g, x, y, w, hh, "#b99a55");
  for (let i = 0; i < (w * hh) / 18; i++) hdRect(g, Math.round(x + rnd() * (w - 3)), Math.round(y + rnd() * (hh - 1)), 3, 1, ["#d8bb6c", "#a4843f", "#c9a95c", "#e6cc84"][i % 4]);
  const gate = [Math.round(((Y.x + Y.w / 2) * HD) - 16), Math.round(((Y.x + Y.w / 2) * HD) + 16)];
  const post = (px, py) => { hdRect(g, px - 2, py - 9, 5, 12, "#3a2616"); hdRect(g, px - 1, py - 8, 3, 10, "#8a6038"); hdRect(g, px - 1, py - 8, 3, 2, "#b08250"); };
  const rail = (xa, xb, py) => { hdRect(g, xa, py - 6, xb - xa, 2, "#3a2616"); hdRect(g, xa, py - 5, xb - xa, 1, "#a37446"); hdRect(g, xa, py - 2, xb - xa, 2, "#3a2616"); };
  rail(x - 4, gate[0], y); rail(gate[1], x + w + 4, y);
  for (const px of [x - 4, x + w + 3]) { hdRect(g, px - 1, y, 3, hh, "#3a2616"); hdRect(g, px, y, 1, hh, "#8a6038"); }
  rail(x - 4, x + w + 4, y + hh);
  for (let px = x - 4; px <= x + w + 4; px += 18) { if (px < gate[0] - 3 || px > gate[1] + 3) post(px, y); post(px, y + hh); }
  post(gate[0], y); post(gate[1], y);
  for (let py = y + 18; py < y + hh; py += 18) { post(x - 4, py); post(x + w + 3, py); }
}
function drawPondHD(g, P, rnd) {
  const cx = P.cx * HD, cy = P.cy * HD, rx = P.rx * HD, ry = P.ry * HD;
  pxEllipse(g, cx, cy + 2, rx + 7, ry + 6, "#8e7a4c");
  pxEllipse(g, cx, cy + 1, rx + 5, ry + 4, "#c8b27a");
  pxEllipse(g, cx, cy + 1, rx + 2, ry + 2, "#3d5a22");
  pxEllipse(g, cx, cy, rx, ry, G.w0);
  pxEllipse(g, cx, cy + 2, rx - 1, ry - 1, G.w1);
  pxEllipse(g, cx - 6, cy - 3, rx - 14, ry - 8, G.w2);
  for (let i = 0; i < 10; i++) hdRect(g, Math.round(cx - rx * 0.6 + rnd() * rx * 1.2), Math.round(cy - ry * 0.5 + rnd() * ry), 4 + Math.round(rnd() * 4), 1, G.w3);
  for (const [dx, dy, s] of [[-0.45, 0.2, 1], [0.35, -0.15, 0.8], [0.15, 0.45, 0.7]]) { // lily pads
    const px = cx + dx * rx, py = cy + dy * ry, r = 5 * s + 2;
    pxEllipse(g, px, py, r + 1, r * 0.6 + 1, "#1f4d1d"); pxEllipse(g, px, py, r, r * 0.6, "#4f9a3a"); hdRect(g, px, py - 1, Math.ceil(r), 2, G.w1); hdRect(g, px - r * 0.5, py - 2, 3, 1, "#7cc35a");
  }
  hdRect(g, cx - rx * 0.45 - 1, cy + ry * 0.2 - 4, 3, 3, "#f59cc0"); hdRect(g, cx - rx * 0.45, cy + ry * 0.2 - 3, 1, 1, "#fff4c2");
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { // reeds and cattails
    const rxp = Math.round(cx + s * (rx - 6 + i * 4)), top = cy - 10 - i * 3 - (i % 2) * 3;
    hdRect(g, rxp, top, 1, cy + 4 - top, i % 2 ? "#2f5a1f" : "#3f7a2a"); hdRect(g, rxp - 1, top - 1, 3, 5, "#6b4a2b"); hdRect(g, rxp, top - 3, 1, 2, "#3f7a2a");
  }
}
function drawSignHD(g, s) {
  const x = s.x * HD, y = s.y * HD;
  hdRect(g, x - 1, y + 6, 3, 18, "#3a2616"); hdRect(g, x, y + 6, 1, 18, "#8a6038"); hdRect(g, x - 3, y + 23, 8, 2, "rgba(20,32,10,.35)");
  hdRect(g, x - 11, y - 2, 22, 11, "#3a2616"); hdRect(g, x - 10, y - 1, 20, 9, "#c9964a"); hdRect(g, x - 10, y - 1, 20, 2, "#dcae62");
  hdRect(g, x - 7, y + 3, 9, 2, "#3a2616"); hdRect(g, x + 2, y + 1, 1, 6, "#3a2616"); hdRect(g, x + 3, y + 2, 1, 4, "#3a2616"); hdRect(g, x + 4, y + 3, 1, 2, "#3a2616"); // an arrow: to the field
}
const FLOWER_C = ["#f4f1e8", "#f5c542", "#f59cc0", "#b9d9ff", "#ff8f6b", "#c99bf0"];
function drawDecorHD(g, d, rnd) {
  const x = Math.round(d.x * HD), y = Math.round(d.y * HD);
  if (d.kind === "flowers") for (let i = 0; i < 3 + Math.floor(rnd() * 4); i++) {
    const fx = x + Math.round((rnd() - 0.5) * 16), fy = y + Math.round((rnd() - 0.5) * 8), c = FLOWER_C[(d.c + i) % FLOWER_C.length];
    hdRect(g, fx, fy, 1, 3, "#3f7a2a"); hdRect(g, fx - 1, fy - 2, 3, 1, c); hdRect(g, fx, fy - 3, 1, 3, c); hdRect(g, fx, fy - 2, 1, 1, "#f5c542");
  }
  if (d.kind === "bush") {
    pxEllipse(g, x + 2, y + 1, 12, 4, "rgba(20,32,10,.3)");
    for (const [dx, dy, r] of [[-5, -4, 6], [5, -4, 6], [0, -8, 6], [0, -3, 7]]) pxCircle(g, x + dx, y + dy, r + 1, G.t0);
    for (const [dx, dy, r] of [[-5, -4, 6], [5, -4, 6], [0, -8, 6], [0, -3, 7]]) { pxCircle(g, x + dx, y + dy, r, G.t2); pxCircle(g, x + dx - 1, y + dy - 2, r * 0.55, G.t3); }
    if (d.c % 2) for (const [dx, dy] of [[-6, -5], [3, -9], [6, -3], [-1, -2]]) { hdRect(g, x + dx, y + dy, 2, 2, "#d6334a"); hdRect(g, x + dx, y + dy, 1, 1, "#ff8a9a"); }
  }
  if (d.kind === "pumpkin") for (const [dx, s] of [[-5, 0.8], [4, 1]]) {
    const px = x + dx, r = 5 * s;
    pxEllipse(g, px + 1, y + 1, r + 2, 2, "rgba(20,32,10,.3)"); pxEllipse(g, px, y - r * 0.8, r + 2, r * 0.8 + 1, "#6b2f10"); pxEllipse(g, px, y - r * 0.8, r + 1, r * 0.8, "#e07b24");
    hdRect(g, px - 1, y - r * 1.6, 2, r * 1.6 - 1, "#c4631a"); hdRect(g, px - r * 0.6, y - r * 1.2, 2, 3, "#f5a04a"); hdRect(g, px - 1, y - r * 1.6 - 3, 2, 3, "#4f6b25");
  }
  if (d.kind === "log") {
    pxEllipse(g, x + 1, y + 1, 13, 3, "rgba(20,32,10,.3)"); hdRect(g, x - 12, y - 8, 22, 9, "#3a2616"); hdRect(g, x - 11, y - 7, 20, 7, "#7a5433"); hdRect(g, x - 11, y - 7, 20, 2, "#9a6d45");
    pxEllipse(g, x + 10, y - 4, 3, 4, "#3a2616"); pxEllipse(g, x + 10, y - 4, 2, 3, "#d8b27a"); hdRect(g, x + 10, y - 4, 1, 1, "#9a6d45");
  }
  if (d.kind === "mushrooms") for (const [dx, s] of [[-3, 1], [3, 0.7], [0, 0.55]]) {
    const px = x + dx, r = 3 * s + 1;
    hdRect(g, px - 1, y - 4 * s, 2, 4 * s, "#f4ecd8"); pxEllipse(g, px, y - 4 * s - 1, r + 1, r * 0.7 + 1, "#5c130e"); pxEllipse(g, px, y - 4 * s - 1, r, r * 0.7, "#d6334a"); hdRect(g, px - 1, y - 4 * s - 2, 1, 1, "#fff"); hdRect(g, px + 1, y - 4 * s - 1, 1, 1, "#fff");
  }
}

function buildWorld(L, seed = 7) {
  const W = L.W, H = L.H, rnd = mulberry32(seed);
  const bg = canvas(W * HD, H * HD), g = bg.getContext("2d");
  g.imageSmoothingEnabled = false;
  // grass: two octaves of value noise, ordered dithering between five tones, a worn clearing round the farm; at world
  // pixels, blown up to HD, with HD blades and flowers on top
  const lo = canvas(W, H), lg = lo.getContext("2d");
  const n1 = valueNoise(seed + 1), n2 = valueNoise(seed + 2), img = lg.createImageData(W, H), d = img.data;
  const tones = [G.g0, G.g1, G.g2, G.g3, G.g4, G.worn].map(rgbOf);
  const C = L.content || { x: L.play.x0, y: L.play.y0, w: L.play.x1 - L.play.x0, h: L.play.y1 - L.play.y0 };
  const cx = C.x + C.w / 2, cy = C.y + C.h / 2 + 6, rx = Math.max(60, C.w * 0.62), ry = Math.max(50, C.h * 0.64);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    let t = n1(x / 22, y / 22) * 0.62 + n2(x / 7, y / 7) * 0.38 + (1 - Math.min(1.4, e)) * 0.3;
    t += (BAYER[y & 3][x & 3] / 16 - 0.5) * 0.14;
    const k = clamp(Math.floor((t - 0.18) * 5.2), 0, 5), i = (y * W + x) * 4;
    [d[i], d[i + 1], d[i + 2]] = tones[k]; d[i + 3] = 255;
  }
  lg.putImageData(img, 0, 0);
  g.drawImage(lo, 0, 0, W * HD, H * HD);
  for (let i = 0; i < (W * H) / 40; i++) { // blades and flecks
    const x = Math.floor(rnd() * W * HD), y = Math.floor(rnd() * H * HD), r = rnd();
    if (r < 0.55) { const c = rnd() < 0.5 ? G.g0 : G.g1; hdRect(g, x, y, 1, 3, c); hdRect(g, x + 2, y + 1, 1, 2, c); hdRect(g, x + 1, y + 2, 1, 1, c); }
    else if (r < 0.85) hdRect(g, x, y, 1, 2, rnd() < 0.5 ? G.g4 : "#93b552");
    else if (!blocked(L, x / HD, y / HD)) { const c = FLOWER_C[Math.floor(rnd() * FLOWER_C.length)]; hdRect(g, x - 1, y, 3, 1, c); hdRect(g, x, y - 1, 1, 3, c); hdRect(g, x, y, 1, 1, "#f5e27a"); }
  }
  for (const pts of L.paths || []) drawPathHD(g, pts, rnd);
  drawPondHD(g, L.pond, rnd);
  // rocks and bits of nature in the meadow, where nothing else is
  const clear = (x, y, pad) => !blocked(L, x, y) && !onPath(L, x, y, pad) && Math.hypot(x - L.door.x, y - L.door.y) > 30
    && !(C && L.content && x > C.x - 4 && x < C.x + C.w + 4 && y > C.y - 4 && y < C.y + C.h + 6);
  for (let tries = 0, want = clamp(Math.round((W * H) / 45000), 2, 10); L.rocks.length < want && tries < 400; tries++) {
    const w = 12 + Math.floor(rnd() * 8), r = { x: L.play.x0 + 10 + rnd() * (L.play.x1 - L.play.x0 - 20), y: L.play.y0 + rnd() * (L.play.y1 - L.play.y0 - 12), w, h: Math.round(w * 0.75) };
    if (clear(r.x, r.y, 10) && clear(r.x, r.y + r.h, 10) && L.rocks.every(o => Math.hypot(o.x - r.x, o.y - r.y) > 44)) L.rocks.push(r);
  }
  const KINDS = [["flowers", 0.5, 0], ["bush", 0.27, 7], ["mushrooms", 0.09, 0], ["pumpkin", 0.09, 6], ["log", 0.05, 8]];
  for (let tries = 0, want = clamp(Math.round((W * H) / 2600), 8, 70); L.decor.length < want && tries < 900; tries++) {
    const x = L.play.x0 + 8 + rnd() * (L.play.x1 - L.play.x0 - 16), y = L.play.y0 + 10 + rnd() * (L.play.y1 - L.play.y0 - 14);
    let p = rnd(), kind = KINDS[0];
    for (const k of KINDS) { if (p < k[1]) { kind = k; break; } p -= k[1]; }
    if (!clear(x, y, 9) || L.decor.some(o => Math.hypot(o.x - x, o.y - y) < 22) || L.rocks.some(o => Math.hypot(o.x - x, o.y - y) < 20)) continue;
    L.decor.push({ kind: kind[0], x, y, r: kind[2], c: Math.floor(rnd() * 6) });
  }
  // flowers along the barn's front and round the pond
  const B = L.barn;
  for (const fx of [B.x + 4, B.x + B.w - 6]) L.decor.push({ kind: "flowers", x: fx, y: B.y + B.h + 4, r: 0, c: Math.floor(rnd() * 6) });
  if (L.yard) L.decor.push({ kind: "flowers", x: L.pond.cx - L.pond.rx - 8, y: L.pond.cy + 6, r: 0, c: 2 }, { kind: "flowers", x: L.pond.cx + L.pond.rx + 8, y: L.pond.cy + 4, r: 0, c: 4 });
  L.rocks.forEach(r => drawRockHD(g, r));
  L.decor.sort((a, b) => a.y - b.y).forEach(dd => drawDecorHD(g, dd, rnd));
  if (L.yard) drawYardHD(g, L.yard, rnd);
  if (L.gate) drawFenceHD(g, L.field, L.gate);
  L.plots.forEach(p => drawPlotHD(g, p));
  drawBarnHD(g, L.barn);
  if (L.sign) drawSignHD(g, L.sign);
  // trees round the edge: back rows on the background, the bottom row in front of everything (its own strip)
  const trees = [], T = L.T;
  for (let x = -6; x < W + 12; x += 12 + rnd() * 9) { trees.push([x, 2 + rnd() * (T - 16), 10 + rnd() * 5]); if (rnd() < 0.6) trees.push([x + 6, -6 + rnd() * 8, 11 + rnd() * 4]); }
  for (let y = T - 4; y < H - T + 6; y += 12 + rnd() * 8) {
    trees.push([2 + rnd() * (T - 14), y, 9 + rnd() * 5]); trees.push([W - 2 - rnd() * (T - 14), y, 9 + rnd() * 5]);
    if (rnd() < 0.5) trees.push([-4, y + 6, 11]); if (rnd() < 0.5) trees.push([W + 4, y + 6, 11]);
  }
  const front = [];
  for (let x = -6; x < W + 12; x += 12 + rnd() * 9) front.push([x, H - T + 12 + rnd() * 10, 11 + rnd() * 5]);
  trees.sort((a, b) => a[1] - b[1]).forEach(([x, y, r]) => drawTreeHD(g, Math.round(x * HD), Math.round(y * HD), Math.round(r * HD), rnd));
  const fgY = Math.max(0, H - T - 8), fg = canvas(W * HD, (H - fgY) * HD), f = fg.getContext("2d");
  front.sort((a, b) => a[1] - b[1]).forEach(([x, y, r]) => drawTreeHD(f, Math.round(x * HD), Math.round((y - fgY) * HD), Math.round(r * HD), rnd));
  return { L, bg, fg, fgY };
}

/** One crop at a world point (the demos draw their own fields with it). */
function drawCrop(g, x, y, stage, t) { g.drawImage(CROPS[stage][REDUCED ? 1 : Math.round(Math.sin(t * 1.6 + x) * 0.9) + 1], x - 2.5, y - 9, 5, 9); }
/** Crops: the field shows the work. Running tasks grow; finished ones bloom into Claude's spark; failed ones wilt.
 * Two staggered rows of three per plot. */
function drawCrops(g, p, stage, t, glow) {
  for (let row = 0; row < 2; row++) for (let k = 0; k < 3; k++) {
    const x = p.x + 6 + k * 9 + row * 4, y = row ? p.y + p.h - 1 : p.y + 8, sw = Math.round(Math.sin(t * 1.6 + x * 0.7) * 0.9) + 1;
    g.drawImage(CROPS[stage][REDUCED ? 1 : sw], x - 2.5, y - 9, 5, 9);
  }
}

// ==================================================================== critters
class Critter {
  constructor(key, x, y) {
    Object.assign(this, { key, x, y, tx: x, ty: y, wait: Math.random() * 2, dir: 0, moving: false, phase: 0,
      phaseT: 0, blinkT: 2 + Math.random() * 3, blink: 0, born: performance.now(), hop: 0, speed: 20 + Math.random() * 6 });
    this.mode = "wander"; this.kind = "claude"; this.hat = "straw"; this.color = HAT_COLORS[0]; this.skin = null;
    this.label = ""; this.bubble = null; this.gone = 0; this.home = null;
    this.seed = (hashStr(key) % 97) / 7; this.look = 0; this.lookT = 1 + Math.random() * 4; this.step = 0; this.cheerUntil = 0;
  }
  setTarget(x, y) { this.tx = x; this.ty = y; }
  update(dt, world) {
    const L = world.L;
    if (this.kind === "egg") { this.hop = (this.hop + dt) % 3; return; }
    this.blinkT -= dt;
    if (this.blinkT < 0) { this.blink = 0.14; this.blinkT = 2 + Math.random() * 4; }
    this.blink = Math.max(0, this.blink - dt);
    let goal = null;
    if ((this.mode === "work" || this.mode === "subwait") && this.spot) {
      // at work it doesn't just sit: now and then it walks round its plot to look at the crops, then goes back
      this.strollT = (this.strollT ?? 4 + Math.random() * 10) - dt;
      if (this.strollT < 0) {
        if (this.stroll) { this.stroll = null; this.strollT = 6 + Math.random() * 12; }
        else { this.stroll = { x: this.spot.x + 4 + Math.random() * 30, y: this.spot.y - 2 - Math.random() * 24 }; this.strollT = 2 + Math.random() * 2.5; }
      }
      goal = this.stroll || this.spot;
    }
    else if (this.mode === "sleep") goal = this.home || world.restSpot(this);
    else if (this.mode === "starting") goal = { x: L.door.x + ((hashStr(this.key) % 5) - 2) * 7, y: L.door.y + 8 };
    this.lookT -= dt; // idle: it looks round now and then
    if (this.lookT < 0) { this.look = this.look ? 0 : Math.random() < 0.5 ? -1 : 1; this.lookT = this.look ? 0.8 + Math.random() : 2 + Math.random() * 4; }
    if (goal) { this.tx = goal.x; this.ty = goal.y; }
    else if (this.mode === "wander" || this.mode === "offline" || this.mode === "rest") { // strolling round the farm
      if (Math.abs(this.tx - this.x) + Math.abs(this.ty - this.y) < 1.5) {
        this.wait -= dt;
        if (this.wait <= 0) { const p = world.randomSpot(); this.tx = p.x; this.ty = p.y; this.wait = 1 + Math.random() * 4; }
      }
    } else { this.tx = this.x; this.ty = this.y; }
    const dx = this.tx - this.x, dy = this.ty - this.y;
    if (Math.abs(dx) + Math.abs(dy) < 1.2) { this.moving = false; this.phase = 0; this.step = 0; if (this.mode === "work") this.dir = 1; }
    else {
      const dist = Math.hypot(dx, dy);
      this.moving = true;
      const sp = (this.mode === "work" ? 34 : this.speed) * dt * (REDUCED ? 0.7 : 1);
      const nx = this.x + (dx / dist) * Math.min(sp, dist), ny = this.y + (dy / dist) * Math.min(sp, dist);
      const R = L.reserve, inside = (x, y) => R && x > R.x - 6 && x < R.x + R.w + 6 && y > R.y - 2 && y < R.y + R.h + 16;
      if (!inside(nx, ny) || inside(this.x, this.y)) { this.x = nx; this.y = ny; }
      else if (!inside(nx, this.y)) this.x = nx; // slide round the title instead of walking through it
      else if (!inside(this.x, ny)) this.y = ny;
      else if (this.mode === "wander" || this.mode === "offline" || this.mode === "rest") { const p = world.randomSpot(); this.tx = p.x; this.ty = p.y; }
      this.dir = Math.abs(dx) > 0.5 ? Math.sign(dx) : this.dir;
      this.phaseT += dt; // the walk: step, pass, the other step, pass
      if (this.phaseT > 0.11) { this.phaseT = 0; this.step = (this.step + 1) % 4; this.phase = [1, 0, 2, 0][this.step]; }
    }
    if (this.mode === "error") this.hop = (this.hop + dt * 6) % (Math.PI * 2);
  }
  sprite(t) {
    if (this.kind === "egg") return EGG_HD;
    const blink = this.blink > 0, now = performance.now();
    if (this.mini) return miniHD(this.color, { legs: this.phase, blink: blink || this.mode === "subwait",
      arms: this.mode === "work" && !this.moving && Math.floor(t * 6 + this.seed) % 2 ? 1 : 0 });
    const sleep = this.mode === "sleep" && !this.moving;
    const typing = this.mode === "work" && !this.moving;
    const cheer = now < this.cheerUntil || now - this.born < 1800;
    return skinFrameHD(this.skin || (this.skin = skinOf(this.hat, null, "", this.color)), {
      look: this.moving || typing ? this.dir : this.look, legs: this.phase, blink: blink || this.mode === "offline", sleep,
      arms: typing ? (Math.floor(t * 7 + this.seed) % 2 ? 2 : 3) : cheer && !this.moving ? (Math.floor(t * 5) % 2 ? 1 : 0) : 0, happy: cheer && !sleep,
    });
  }
  /** How far it's lifted this frame, in world pixels (halves: the HD grid). */
  bob(t) {
    if (this.kind === "egg") return 0;
    if (this.mode === "error") return -Math.abs(Math.sin(this.hop)) * 3;
    if (!this.mini && !this.moving && performance.now() < this.cheerUntil) return -Math.round(Math.abs(Math.sin(t * 8)) * 5) / 2;
    if (this.moving) return this.step % 2 ? -0.5 : 0;
    if (this.mini && this.mode === "subwait") return 0;
    if (this.mode === "sleep") return Math.sin(t * 1.6 + this.seed) > 0.2 ? 0.5 : 0; // breathing
    return Math.sin(t * 2 + this.seed) > 0.7 ? -0.5 : 0; // idle breathing
  }
}

// ======================================================================= scene
/** The farm's canvas. The world can be bigger than the window: a camera (x, y in world pixels, z = CSS px per world
 * pixel) fits it by default; drag or swipe to pan, wheel or pinch to zoom. The landing page and the title screen keep
 * the old fixed view (the world is the window, z = S). The canvas's backing store is the window at devicePixelRatio,
 * and it draws at a zoom snapped to whole device pixels (an even number per world pixel once there's room, so every
 * HD sprite pixel is whole too): crisp, and no shimmer while panning. cam.z is the zoom asked for; snap() the drawn one. */
const Scene = {
  cv: $("#world"), ctx: null, S: 3, world: null, critters: new Map(), sparkles: [],
  labels: $("#labels"), selected: null, hover: null, plotTasks: [], plotMore: [], boardCount: 0, demo: false, t: 0,
  cam: { x: 0, y: 0, z: 3, auto: true }, goal: null, dpr: 1, need: null, farm: false, planner: null, pendingFor: {},
  TAGS_AT: 2.6, BUBBLES_AT: 1.9, MINI_BUBBLES_AT: 3.6, // zoom (CSS px per world px) from which every name tag / bubble shows
  init() {
    this.ctx = this.cv.getContext("2d", { alpha: false });
    addEventListener("resize", () => { clearTimeout(this.resizeT); this.resizeT = setTimeout(() => this.resize(), 80); });
    const watchDpr = () => { // dragged to another screen, or the browser zoomed: a new backing store
      const m = matchMedia(`(resolution: ${devicePixelRatio || 1}dppx)`);
      m.addEventListener?.("change", () => { this.resize(); watchDpr(); }, { once: true });
    };
    watchDpr();
    this.bindPointer();
    this.resize();
    const hudTop = $("#hud-top");
    if (hudTop && window.ResizeObserver) new ResizeObserver(() => { // the HUD grew (your Claude's card, approvals): refit
      if (!this.farm || !this.insets || !hudTop.getBoundingClientRect().width) return;
      const v = this.viewBox(), o = this.insets;
      if (Math.abs(v.left - o.left) > 30 || Math.abs(v.top - o.top) > 30) { clearTimeout(this.resizeT); this.resizeT = setTimeout(() => this.resize(), 150); }
    }).observe(hudTop);
    let last = performance.now();
    // sinaleiro: time never runs backwards (the first frame's timestamp can be older than `last`), and one bad frame
    // doesn't stop the farm: it's logged and the next frame draws as usual
    const loop = (now) => {
      const dt = clamp((now - last) / 1000, 0, 0.05); last = now; this.t += dt;
      try { this.frame(dt); } catch (x) { if (!this.frameErr || now - this.frameErr > 5000) { this.frameErr = now; console.error("sinaleiro: frame", x); } }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },
  /** The window in CSS px, and how much of it the HUD covers (the fit keeps the farm clear of it). */
  viewBox() {
    const w = innerWidth, hh = innerHeight, phone = w < 760, S = clamp(Math.round(Math.min(w / 330, hh / 205)), 2, 6);
    if (!this.farm) return { w, h: hh, S, top: 0, bottom: 0, left: 0, right: 0 };
    // the counter and chips sit top-left: beside the farm on a wide window, above it on a tall one
    const r = $("#hud-top")?.getBoundingClientRect(), hud = r && r.width ? r : { right: 300, bottom: 200 };
    this.hudBox = { right: Math.round(hud.right), bottom: Math.round(hud.bottom) };
    const wide = w > hh * 1.15 && hud.right < w * 0.4;
    const dock = $(".dock")?.getBoundingClientRect(), bottom = dock && dock.height ? Math.round(hh - dock.top + 8) : phone ? 150 : 100;
    return { w, h: hh, S, top: wide ? 8 : hud.bottom + 6, bottom: Math.max(bottom, phone ? 80 : 90), left: wide ? hud.right + 10 : 0, right: phone ? 52 : 64, snap: (z) => this.snap(z, true) };
  },
  /** The zoom actually drawn for a zoom z: whole device pixels per world pixel (even ones on a sharp screen, from 4 up,
   * so the half-pixel HD sprites land on whole pixels too). Far out, below 2 device px, it stays as asked. */
  snap(z, down = false) {
    const Zr = z * this.dpr;
    if (Zr < 2) return z;
    const step = Zr >= 4 && this.dpr >= 1.5 ? 2 : 1, n = down ? Math.floor(Zr / step + 1e-6) : Math.round(Zr / step);
    return Math.max(step, n * step) / this.dpr;
  },
  resize() {
    this.dpr = Math.min(3, devicePixelRatio || 1);
    const v = this.viewBox(), S = v.S;
    this.S = S; this.insets = { left: v.left, top: v.top };
    this.cv.width = Math.round(v.w * this.dpr); this.cv.height = Math.round(v.h * this.dpr);
    this.cv.style.width = v.w + "px"; this.cv.style.height = v.h + "px";
    let L;
    if (this.farm) L = layoutFarm(this.need || { plots: 6, yard: 5 }, v);
    else {
      const zS = this.snap(S, true), W = Math.ceil(v.w / zS), H = Math.ceil(v.h / zS), opts = { ...(this.layout || {}) };
      const keep = opts.clearOf && document.querySelector(opts.clearOf);
      if (keep) { // keep this element's area free of the field and the critters (in world pixels)
        const r = keep.getBoundingClientRect();
        opts.reserve = { x: Math.floor(r.left / zS) - 10, y: Math.floor(r.top / zS) - 4, w: Math.ceil(r.width / zS) + 20, h: Math.ceil(r.height / zS) + 8 };
      }
      L = layoutWorld(W, H, opts); L.z = zS;
    }
    this.world = buildWorld(L, 7);
    this.world.randomSpot = () => this.randomSpot();
    this.world.restSpot = (c) => yardSpot(L, hashStr(c.key) % 10);
    if (this.cam.auto || !this.farm) this.fit(); else { this.cam.z = Math.max(this.cam.z, L.z); this.clampCam(); }
    this.goal = null;
    for (const c of this.critters.values()) {
      if (c.x > L.W || c.y > L.H || (c.mode === "wander" && blocked(L, c.x, c.y))) { const p = this.randomSpot(); c.x = p.x; c.y = p.y; }
      c.tx = c.x; c.ty = c.y;
    }
    this.relayout = true; // reconcile moves everyone to their new spots
    if (this.farm && App.state && !this.reconciling) reconcile(App.state);
  },
  /** Grow (or shrink) the world when the farm outgrows its plots or yard. True when it rebuilt. */
  setNeed(n) {
    const cap = this.world?.L.cap;
    if (cap && n.plots <= cap.plots && n.yard <= cap.yard && !(cap.plots > 8 && n.plots < cap.plots * 0.45)
      && !(cap.yard > 12 && n.yard < cap.yard * 0.45)) return false;
    this.need = { plots: Math.ceil(n.plots * 1.15) + 1, yard: Math.ceil(n.yard * 1.1) + 2 };
    this.resize();
    return true;
  },
  // ------------------------------------------------------------------ camera
  fit() {
    const L = this.world.L, v = this.viewBox(), c = this.cam, box = L.content;
    c.z = L.z; c.auto = true;
    if (box) {
      c.x = box.x + box.w / 2 - (v.left + (v.w - v.left - v.right) / 2) / c.z;
      c.y = box.y + box.h / 2 - (v.top + (v.h - v.top - v.bottom) / 2) / c.z;
    } else { c.x = 0; c.y = 0; }
    this.clampCam();
  },
  clampCam(c = this.cam) {
    const L = this.world.L, z = this.snap(c.z), vw = innerWidth / z, vh = innerHeight / z;
    c.x = L.W <= vw ? (L.W - vw) / 2 : clamp(c.x, 0, L.W - vw);
    c.y = L.H <= vh ? (L.H - vh) / 2 : clamp(c.y, 0, L.H - vh);
  },
  zoomLimits() { const z0 = this.world.L.z; return [z0, Math.max(8, z0 * 3)]; },
  zoomAt(sx, sy, factor) {
    const c = this.cam, [lo, hi] = this.zoomLimits(), z0 = this.snap(c.z), wx = c.x + sx / z0, wy = c.y + sy / z0;
    this.goal = null;
    c.z = clamp(c.z * factor, lo, hi);
    const z1 = this.snap(c.z); c.x = wx - sx / z1; c.y = wy - sy / z1; c.auto = false;
    this.clampCam();
  },
  zoomBy(factor) { this.zoomAt(innerWidth / 2, innerHeight / 2, factor); },
  /** Glide the camera to a world point, zoomed in enough to see names. */
  focus(x, y, z) {
    const [lo, hi] = this.zoomLimits();
    z = this.snap(clamp(z || Math.max(this.cam.z, this.TAGS_AT + 0.6, this.S), lo, hi));
    const g = { x: x - innerWidth / 2 / z, y: y - innerHeight / 2 / z, z };
    this.clampCam(g); this.goal = g; this.cam.auto = false;
  },
  focusCritter(c) { if (c) { this.focus(c.x, c.y - 8); this.follow = { key: c.key, until: performance.now() + 6000 }; } },
  // ------------------------------------------------------------------- input
  toWorld(e) { const r = this.rt; return r ? { x: (e.clientX * r.dpr - r.ox) / r.Zr, y: (e.clientY * r.dpr - r.oy) / r.Zr } : { x: this.cam.x + e.clientX / this.cam.z, y: this.cam.y + e.clientY / this.cam.z }; },
  bindPointer() {
    const cv = this.cv, pts = new Map();
    let drag = null, pinch = null;
    const off = () => this.demo || this.passive || !this.farm;
    cv.addEventListener("pointerdown", (e) => {
      if (off()) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      try { cv.setPointerCapture(e.pointerId); } catch { /* fine */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false };
      else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: this.cam.z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        if (drag) drag.moved = true;
      }
    });
    cv.addEventListener("pointermove", (e) => {
      if (off()) return;
      if (!pts.has(e.pointerId)) { if (e.pointerType === "mouse") this.onMove(e); return; }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        this.zoomAt(mx, my, (pinch.z * d / pinch.d) / this.cam.z);
        this.cam.x -= (mx - pinch.mx) / this.cam.z; this.cam.y -= (my - pinch.my) / this.cam.z; this.clampCam();
        pinch.mx = mx; pinch.my = my;
      } else if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 6) { drag.moved = true; cv.classList.add("grabbing"); }
        if (drag.moved) { this.goal = null; this.cam.auto = false; this.cam.x = drag.cx - dx / this.cam.z; this.cam.y = drag.cy - dy / this.cam.z; this.clampCam(); }
      }
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) {
        if (drag && !drag.moved && e.type === "pointerup") this.onClick(e);
        drag = null; cv.classList.remove("grabbing");
      } else if (drag) { const [p] = [...pts.values()]; drag = { x: p.x, y: p.y, cx: this.cam.x, cy: this.cam.y, moved: true }; }
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", (e) => {
      if (off()) return;
      e.preventDefault();
      const k = e.deltaMode === 1 ? 16 : 1; // lines -> pixels
      this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * k * (e.ctrlKey ? 0.012 : 0.0018)));
    }, { passive: false });
    cv.addEventListener("pointerleave", () => { if (this.hover) { this.hover = null; } });
  },
  randomSpot() {
    const L = this.world.L;
    for (let i = 0; i < 60; i++) {
      const x = L.play.x0 + 8 + Math.random() * (L.play.x1 - L.play.x0 - 16), y = L.play.y0 + 16 + Math.random() * (L.play.y1 - L.play.y0 - 16);
      if (!blocked(L, x, y)) return { x, y };
    }
    return { x: L.door.x, y: L.door.y + 12 };
  },
  restSpot(c) { return this.world.restSpot(c); },
  hit(p) {
    let best = null;
    for (const c of this.critters.values()) {
      if (c.gone) continue;
      const w = c.kind === "egg" ? 7 : c.mini ? 6 : 9, top = c.mini ? 10 : 19;
      if (p.x > c.x - w && p.x < c.x + w && p.y > c.y - top && p.y < c.y + 2 && (!best || c.y > best.y)) best = c;
    }
    if (best) return { critter: best };
    const extra = window.sinaleiroHit?.(p); // sinaleiro: the cop, the barn, the pond
    if (extra) return extra;
    const cr = this.world.L.crow;
    if (cr && this.planner && Math.abs(p.x - cr.x) < 9 && p.y > cr.y - 23 && p.y < cr.y + 2) return { crow: true };
    return null;
  },
  onMove(e) {
    if (this.demo || this.passive) return;
    const r = this.hit(this.toWorld(e));
    this.hover = r?.critter || null; this.hoverCrow = !!r?.crow;
    this.cv.classList.toggle("pointing", !!r);
  },
  onClick(e) {
    if (this.demo || this.passive) return;
    const r = this.hit(this.toWorld(e));
    if (!r) { this.selected = null; return; }
    if (r.extra) return r.extra(); // sinaleiro
    if (r.crow) return UI.openPlanner();
    if (r.critter) { this.selected = r.critter; UI.openCritter(r.critter); }
  },
  sparkle(x, y, n = 14, color) {
    if (this.sparkles.length > 400) return;
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = 10 + Math.random() * 26;
      this.sparkles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 12, life: 0.7 + Math.random() * 0.5, k: i % 4, c: color || null }); }
  },
  frame(dt) {
    const g = this.ctx, w = this.world, L = w.L, t = this.t, cam = this.cam, now = performance.now();
    if (this.goal) { // glide
      const k = 1 - Math.exp(-dt * 7), G2 = this.goal;
      cam.x = lerp(cam.x, G2.x, k); cam.y = lerp(cam.y, G2.y, k); cam.z = lerp(cam.z, G2.z, k);
      if (Math.abs(cam.x - G2.x) + Math.abs(cam.y - G2.y) < 0.3 && Math.abs(cam.z - G2.z) < 0.01) { Object.assign(cam, { x: G2.x, y: G2.y, z: G2.z }); this.goal = null; }
    }
    // the drawn zoom, and the camera's offset rounded to whole device pixels (the labels and clicks use the same)
    const dpr = this.dpr, z = this.snap(cam.z), Zr = z * dpr, ox = Math.round(-cam.x * Zr), oy = Math.round(-cam.y * Zr);
    this.rt = { z, Zr, ox, oy, dpr };
    const vx0 = -ox / Zr, vy0 = -oy / Zr, vx1 = vx0 + this.cv.width / Zr, vy1 = vy0 + this.cv.height / Zr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (vx0 < 0 || vy0 < 0 || vx1 > L.W || vy1 > L.H) { g.fillStyle = G.t0; g.fillRect(0, 0, this.cv.width, this.cv.height); }
    g.setTransform(Zr, 0, 0, Zr, ox, oy);
    g.imageSmoothingEnabled = Zr < 1.5; // far out (a huge farm on a small screen), smoothing beats dropped pixels
    const sx = Math.max(0, Math.floor(vx0)), sy = Math.max(0, Math.floor(vy0));
    const sw = Math.min(L.W, Math.ceil(vx1) + 1) - sx, sh = Math.min(L.H, Math.ceil(vy1) + 1) - sy;
    if (sw > 0 && sh > 0) g.drawImage(w.bg, sx * HD, sy * HD, sw * HD, sh * HD, sx, sy, sw, sh);
    const seen = (x, y, m = 24) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m + 20;
    const hx = (v) => Math.round(v * HD) / HD; // on the HD grid
    // crops, and a sign on plots with more minis than they draw
    this.plotTasks.forEach((task, i) => {
      const p = L.plots[i]; if (!p || !task || !seen(p.x, p.y, 40)) return;
      const stage = task.status === "done" ? "ripe" : task.status === "waiting" ? "grow" : task.status === "failed" ? "wilt"
        : (nowS() - (task.started || task.updated || nowS())) < 120 ? "seed" : (nowS() - (task.started || 0)) < 900 ? "sprout" : "grow";
      drawCrops(g, p, stage, t, task.status === "done");
    });
    this.plotMore.forEach((n, i) => { const p = L.plots[i]; if (n > 0 && p && seen(p.x, p.y, 40)) drawSign(g, p.x + p.w + 1, p.y - 13, "+" + n); });
    // the planner's scarecrow
    const cr = L.crow;
    if (cr && this.planner && seen(cr.x, cr.y)) {
      const on = this.planner.on, f = on ? (REDUCED ? 0 : Math.abs(Math.floor(t * 1.4)) % 2) : 2 /* sinaleiro: never -1 */, sh2 = shadowSprite(8, 2);
      g.globalAlpha = 0.35; g.drawImage(sh2, cr.x - sh2.width / 4, cr.y - sh2.height / 4, sh2.width / 2, sh2.height / 2); g.globalAlpha = 1;
      g.drawImage(SCARECROW_HD[f], cr.x - 8, cr.y - 21.5 + (on && !REDUCED && Math.floor(t * 2.8) % 2 ? -0.5 : 0), 16, 22);
      if (this.hoverCrow) g.drawImage(ARROW_SEL, cr.x - 2.25, hx(cr.y - 28 + Math.sin(t * 5)), 4.5, 3.5);
    }
    if (cr && this.planner?.light && seen(cr.x, cr.y)) window.sinaleiroDrawFlag?.(g, t, cr, hx); // sinaleiro: the arbiter's flag
    // the quest board: the landing page's scripted farm only (the real farm has no queue to pin up)
    if (this.passive) {
      const b = L.board;
      g.fillStyle = "rgba(20,32,10,.35)"; g.fillRect(b.x + 1, b.y + b.h + 5, b.w, 3);
      g.fillStyle = "#4a3120"; g.fillRect(b.x + 2, b.y + 4, 2, b.h + 4); g.fillRect(b.x + b.w - 4, b.y + 4, 2, b.h + 4);
      g.fillStyle = "#3a2616"; g.fillRect(b.x, b.y, b.w, b.h - 2);
      g.fillStyle = "#8a6038"; g.fillRect(b.x + 1, b.y + 1, b.w - 2, b.h - 4);
      g.fillStyle = "#a37446"; g.fillRect(b.x + 1, b.y + 1, b.w - 2, 1);
      for (let i = 0; i < Math.min(6, this.boardCount); i++) {
        const nx = b.x + 3 + (i % 3) * 7, ny = b.y + 3 + Math.floor(i / 3) * 7;
        g.fillStyle = i % 2 ? "#fff4c2" : "#f6f1e4"; g.fillRect(nx, ny, 5, 5);
        g.fillStyle = "#b9ad90"; g.fillRect(nx + 1, ny + 2, 3, 1);
        g.fillStyle = "#c0392b"; g.fillRect(nx + 2, ny, 1, 1);
      }
    }
    // critters, depth-sorted; only the ones in view are drawn
    const list = [...this.critters.values()];
    for (const c of list) c.update(dt, w);
    list.sort((a, c) => a.y - c.y);
    const vis = [], shC = shadowSprite(7, 2), shM = shadowSprite(4, 1), shE = shadowSprite(5, 2);
    for (const c of list) {
      if (!seen(c.x, c.y)) continue;
      vis.push(c);
      const s = c.sprite(t), bob = c.bob(t), X = hx(c.x), Y = hx(c.y);
      const fade = c.gone ? clamp(1 - (now - c.gone) / 500, 0, 1) : clamp((now - c.born) / 350, 0, 1);
      const sh2 = c.kind === "egg" ? shE : c.mini ? shM : shC;
      g.globalAlpha = fade * 0.35; g.drawImage(sh2, X - sh2.width / 4, Y - sh2.height / 4, sh2.width / 2, sh2.height / 2);
      g.globalAlpha = fade;
      if (c.mini) {
        g.drawImage(s, X - 5, Y - 8 + bob, 10, 8);
        if (c.mode === "work" && !c.moving) { // a tiny laptop
          g.fillStyle = "#1b1f2a"; g.fillRect(X + 3, Y - 4, 4.5, 3); g.fillStyle = Math.floor(t * 3 + c.seed) % 2 ? "#7cfc9a" : "#2c4a3c"; g.fillRect(X + 3.5, Y - 3.5, 3.5, 1);
          g.fillStyle = "#d97757"; g.fillRect(X + 3.5, Y - 2.5, 2, 0.5); g.fillStyle = "#9aa3b2"; g.fillRect(X + 2.5, Y - 1, 5.5, 1);
        }
      } else if (c.kind === "egg") {
        const wob = Math.floor(c.hop * 4) % 6 === 0 ? (Math.floor(c.hop * 8) % 2 ? 0.5 : -0.5) : 0;
        g.drawImage(s, X - 6 + wob, Y - 12, 12, 12);
      } else {
        g.drawImage(s, X - 8, Y - 17 + bob, 16, 18);
        if (c.mode === "work" && !c.moving) g.drawImage(LAPTOP_HD[Math.floor(t * 3 + c.seed) % 2], X + 4, Y - 6, 9, 7);
        if (c.mode === "sleep" && !c.moving && !REDUCED) for (let k = 0; k < 2; k++) { // Zzz
          const ph = (t * 0.4 + k * 0.5 + c.seed) % 1;
          g.globalAlpha = fade * Math.min(1, (1 - ph) * 1.6);
          g.drawImage(ZED, hx(X + 5 + ph * 4 + Math.sin(ph * 6 + k) * 1.5), hx(Y - 14 - ph * 11), 3, 3);
        }
      }
      g.globalAlpha = 1;
      if (c.gone || c.mini) continue;
      const top = Y - (c.kind === "egg" ? 19 : 26);
      if (c === this.selected) g.drawImage(ARROW_SEL, X - 2.25, hx(top + Math.sin(t * 5) * 1.5), 4.5, 3.5);
      else if (c.agent?.mine) g.drawImage(ARROW_MINE, X - 2.25, top + (Math.floor(t * 2) % 2) * 0.5, 4.5, 3.5);
      if (this.pendingFor[c.agent?.id]) g.drawImage(FLAG_HD[Math.floor(t * 3) % 2], X + 4.5, Y - 27, 6, 10); // missions waiting for its person
    }
    for (const c of list) if (c.gone && now - c.gone > 520) { this.critters.delete(c.key); c.el?.remove(); c.tagEl?.remove(); }
    const fy0 = Math.max(sy, w.fgY), fh = Math.min(L.H, sy + sh) - fy0;
    if (sw > 0 && fh > 0) g.drawImage(w.fg, sx * HD, (fy0 - w.fgY) * HD, sw * HD, fh * HD, sx, fy0, sw, fh);
    // sparkles: little four-point stars that twinkle as they fall
    this.sparkles = this.sparkles.filter(p => (p.life -= dt) > 0);
    for (const p of this.sparkles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 40 * dt;
      if (p.c) { g.fillStyle = p.c; g.fillRect(hx(p.x), hx(p.y), 1, 1); continue; }
      if (p.life < 0.3 && Math.floor(p.life * 20) % 2) continue;
      g.drawImage(SPARKLE[p.k], hx(p.x - 1.75), hx(p.y - 1.75), 3.5, 3.5);
    }
    window.sinaleiroOverlay?.(g, t, L, hx, seen); // sinaleiro: links, letters and flags between the sessions
    this.placeLabels(list, vis);
  },
  /** Speech bubbles and name tags (DOM, so they stay crisp): only for critters in view, and only when zoomed in far
   * enough to read them (or on hover / selection). They sit on whole CSS pixels, centred by their measured width
   * (translate(-50%) would land half of them between pixels and blur the text). */
  placeLabels(list, vis) {
    if (this.demo) return;
    const r = this.rt, z = r.z, px = (x) => Math.round((r.ox + x * r.Zr) / r.dpr), py = (y) => Math.round((r.oy + y * r.Zr) / r.dpr);
    const put = (el, x, y, above) => {
      if (el._w == null) { el._w = el.offsetWidth; el._h = el.offsetHeight; }
      const tr = `translate(${x - Math.round(el._w / 2)}px, ${above ? y - el._h : y}px)`;
      if (el._tr !== tr) { el._tr = tr; el.style.transform = tr; }
    };
    const inView = new Set(vis);
    for (const c of list) {
      const focus = c === this.selected || c === this.hover;
      let want = c.gone || !inView.has(c) ? null : c.bubble;
      if (want && !focus && z < (c.mini ? this.MINI_BUBBLES_AT : this.BUBBLES_AT) && !want.alert) want = null;
      if (want && !focus && c.mode === "offline" && z < this.TAGS_AT + 1.4) want = null; // a yard of "not running" icons is noise
      if (want?.title) want = { ...want, text: focus ? want.title.slice(0, 30) : "" };
      if (want) {
        if (!c.el) { c.el = h("div", { class: "bubble" }); this.labels.append(c.el); }
        const sig = want.icon + "|" + (want.text || "") + "|" + (want.alert ? 1 : 0);
        if (c.el.dataset.sig !== sig) {
          c.el.dataset.sig = sig; c.el._w = null; c.el.className = "bubble" + (want.alert ? " alert" : ""); fill(c.el, h("img", { src: icon(want.icon), alt: "" }), want.text ? h("span", { text: want.text }) : null);
        }
        put(c.el, px(c.x), py(c.y - (c.kind === "egg" ? 16 : c.mini ? 13 : 25)), true);
      } else if (c.el) { c.el.remove(); c.el = null; }
      const showTag = inView.has(c) && !c.gone && c.label && (focus || c.agent?.mine || (z >= this.TAGS_AT && c.mode !== "sleep" && c.mode !== "offline"));
      if (showTag) {
        if (!c.tagEl) { c.tagEl = h("div", { class: "tag" }); this.labels.append(c.tagEl); }
        if (c.tagEl.textContent !== c.label) { c.tagEl.textContent = c.label; c.tagEl._w = null; }
        c.tagEl.classList.toggle("sel", focus);
        c.tagEl.classList.toggle("mine", !!c.agent?.mine);
        put(c.tagEl, px(c.x), py(c.y + 2.5), false);
      } else if (c.tagEl) { c.tagEl.remove(); c.tagEl = null; }
    }
    // the scarecrow says what the planner is doing
    const cr = this.world.L.crow, P = this.planner;
    if (cr && P && this.farm) {
      if (!this.crowEl) { this.crowEl = h("div", { class: "bubble crow" }); this.labels.append(this.crowEl); }
      // sinaleiro: the scarecrow is the arbiter; a crossing (P.light) always shows its words, red as an alert
      const text = !P.on ? "ZZZ" : z < this.BUBBLES_AT && !this.hoverCrow && !P.light ? "…" : String(P.state || "planning").slice(0, 28).toUpperCase();
      const sig = (P.on ? 1 : 0) + (P.light || "") + text;
      if (this.crowEl.dataset.sig !== sig) {
        this.crowEl.dataset.sig = sig; this.crowEl._w = null;
        fill(this.crowEl, h("img", { src: icon(P.icon || (P.on ? "plan" : "zzz")), alt: "" }), h("span", { text }));
        this.crowEl.classList.toggle("off", !P.on); this.crowEl.classList.toggle("alert", P.light === "red"); this.crowEl.classList.toggle("warn", P.light === "yellow");
      }
      put(this.crowEl, px(cr.x), py(cr.y - 24), true);
    } else if (this.crowEl) { this.crowEl.remove(); this.crowEl = null; }
  },
};

// ============================================================== farm state sync
const App = { state: null, me: null, seenAgents: null, seenEvents: 0, lastTitles: {}, polling: null, user: null, plotOf: new Map(), approvals: null };

/** How a Claude's Remote Control session is named in the Claude app (runner.session_name). */
const sessionName = (st, name) => `[clodfarm] ${name === st.farm ? name : st.farm + " · " + name}`;

function colorFor(id) { return HAT_COLORS[hashStr(id) % HAT_COLORS.length]; }


/** The farm from the state: one critter per Claude, and a mini Claude for each of its sub-agents (tinted with the
 * colour of the Claude whose account runs it). A Claude with sub-agents at work gets a plot and watches them there (a
 * plot draws at most 8 minis and a "+N" sign); resting Claudes nap in the yard by the barn. The world grows to fit. */
function reconcile(st) {
  Scene.reconciling = true;
  try { reconcileNow(st); } finally { Scene.reconciling = false; }
}
function reconcileNow(st) {
  const first = App.seenAgents === null;
  App.seenAgents = App.seenAgents || new Set();
  const subs = st.subagents || [], byId = new Map(st.agents.map(a => [a.id, a]));
  const home = (st.agents.find(a => a.primary) || st.agents[0] || {}).id;
  const ownerOf = (t) => byId.has(t.owner) ? t.owner : home;
  const subsOf = new Map();
  for (const t of subs) { const o = ownerOf(t); if (!subsOf.has(o)) subsOf.set(o, []); subsOf.get(o).push(t); }
  const active = st.agents.filter(a => a.talking || subsOf.has(a.id)); // at work: a turn or sub-agents
  const isActive = new Set(active.map(a => a.id));
  const modeOf = (a) => !a.loggedIn && !a.remote ? "egg" : !a.alive && !a.up ? "offline" : !a.up ? "starting" : a.error ? "error"
    : isActive.has(a.id) ? "work" : st.paused ? "rest" : a.resting ? "sleep" : "wander";
  const modes = new Map(st.agents.map(a => [a.id, modeOf(a)]));
  // the yard is where napping Claudes (paced by their budget) sleep; everyone free walks round the farm
  const yardIds = st.agents.filter(a => modes.get(a.id) === "sleep").map(a => a.id).sort();
  if (Scene.farm) Scene.setNeed({ plots: active.length + Math.min(2, (st.recent || []).length), yard: yardIds.length });
  const L = Scene.world.L, relayout = Scene.relayout || first;
  Scene.relayout = false;
  // plots stay put: a Claude keeps its plot while it's busy, a newly busy one takes the first free plot
  const plotOf = App.plotOf;
  for (const [id, i] of plotOf) if (!isActive.has(id) || i >= L.plots.length) plotOf.delete(id);
  const taken = new Set(plotOf.values());
  let free = 0;
  for (const a of active) {
    if (plotOf.has(a.id)) continue;
    while (taken.has(free)) free++;
    if (free >= L.plots.length) break;
    plotOf.set(a.id, free); taken.add(free);
  }
  const yardIdx = new Map(yardIds.map((id, i) => [id, i]));
  const want = new Map();
  const more = [];
  for (const a of st.agents) {
    const pi = plotOf.get(a.id), plot = pi != null ? L.plots[pi] : null, mode = modes.get(a.id);
    const skin = agentSkin(a);
    want.set((mode === "egg" ? "egg:" : "claude:") + a.id, { agent: a, hat: skin.hat, color: skin.hatC, skin,
      kind: mode === "egg" ? "egg" : "claude", mode, spot: plot ? { x: plot.x - 7, y: plot.y + plot.h } : null,
      home: yardIdx.has(a.id) ? yardSpot(L, yardIdx.get(a.id)) : null });
    if (!plot) continue;
    const mine = (subsOf.get(a.id) || []).slice().sort((x, y) => (y.status === "running") - (x.status === "running"));
    more[pi] = Math.max(0, mine.length - MINIS_PER_PLOT);
    mine.slice(0, MINIS_PER_PLOT).forEach((t, n) => {
      const [dx, dy] = SUB_SPOTS[n];
      const on = t.on && byId.get(t.on);
      want.set("sub:" + t.id, { agent: a, sub: t, kind: "claude", mini: true, hat: "", color: on ? agentSkin(on).hatC : t.on ? colorFor(t.on) : "#9aa3b2",
        mode: t.status === "running" ? "work" : "subwait", spot: { x: plot.x + dx, y: plot.y + dy } });
    });
  }
  Scene.plotMore = more;
  const eggs = new Map();
  for (const c of Scene.critters.values()) if (c.kind === "egg" && !c.gone) eggs.set(c.agent.id, c);
  const nSubs = (id) => (subsOf.get(id) || []).length;
  for (const [key, d] of want) {
    let c = Scene.critters.get(key);
    const at = d.mode === "work" || d.mini ? d.spot : d.home;
    if (!c) {
      const egg = !d.mini && eggs.get(d.agent.id), owner = d.mini && Scene.critters.get("claude:" + d.agent.id);
      let p = first ? Scene.randomSpot() : { x: L.door.x + (Math.random() - 0.5) * 6, y: L.door.y + 4 };
      if (egg && d.kind === "claude") { p = { x: egg.x, y: egg.y }; Scene.sparkle(egg.x, egg.y - 6, 24); }
      if (owner) p = { x: owner.x, y: owner.y }; // a new sub-agent pops out of its Claude
      if (d.kind === "egg" && !first) p = Scene.randomSpot();
      if (first && at) p = { ...at }; // on the first look, everyone is already where they belong
      c = new Critter(key, p.x, p.y);
      if (!first && d.kind === "claude") { c.born = performance.now(); if (!egg) Scene.sparkle(p.x, p.y - 8, d.mini ? 8 : 16); }
      else c.born = performance.now() - 5000;
      Scene.critters.set(key, c);
      if (!d.mini && !first && !App.seenAgents.has(d.agent.id)) UI.say(`Apareceu ${d.agent.name.toUpperCase()}! Uma nova sessão Claude chegou à quinta.`) // sinaleiro: pt-PT;
      
    } else if (relayout && at) { c.x = at.x; c.y = at.y; } // the world was rebuilt: everyone is at their new spot
    c.gone = 0;
    Object.assign(c, { kind: d.kind, agent: d.agent, sub: d.sub || null, hat: d.hat, color: d.color, skin: d.skin || null, mode: d.mode, mini: !!d.mini, spot: d.spot, home: d.home || null });
    const n = nSubs(d.agent.id);
    c.label = d.mini ? "" : d.agent.name;
    c.bubble = c.kind === "egg" ? { icon: d.agent.login?.state === "waiting_code" ? "dots" : "ask" }
      : d.mini ? (d.mode === "work" ? { icon: "terminal", title: d.sub.title } : { icon: "dots", title: d.sub.title })
      : c.mode === "work" ? { icon: "terminal", title: n ? `${n} SUB-AGENTE${n === 1 ? "" : "S"}` : (d.agent.talking?.title || "a trabalhar").toUpperCase() } /* sinaleiro: pt-PT */
      : c.mode === "sleep" ? null : c.mode === "rest" ? { icon: "pause" } : c.mode === "error" ? { icon: "alert", alert: true }
      : c.mode === "starting" ? { icon: "dots" } : c.mode === "offline" ? { icon: "alert", alert: true } : null;
  }
  for (const [key, c] of Scene.critters) if (!want.has(key) && !c.gone) { c.gone = performance.now(); if (c.kind !== "egg" && Scene.sparkles.length < 200) Scene.sparkle(c.x, c.y - 8, 8, "#d8e6c4"); }
  for (const a of st.agents) App.seenAgents.add(a.id);
  // the field: a plot growing per Claude with sub-agents at work, then the latest harvests on the free plots
  const since = (a) => Math.min(a.talking?.since || nowS(), ...(subsOf.get(a.id) || []).map(t => t.started || t.created || nowS()));
  const crops = [], recent = [...(st.recent || [])];
  for (const a of active) { const i = plotOf.get(a.id); if (i != null) crops[i] = { id: "claude:" + a.id, status: "running", started: since(a) }; }
  for (let i = 0; i < L.plots.length && recent.length; i++) if (!crops[i]) crops[i] = recent.shift();
  Scene.plotTasks = crops;
  const f = Scene.follow; // the world was rebuilt while the camera was on its way to a Claude: go where it is now
  if (relayout && f && performance.now() < f.until) { const c = Scene.critters.get(f.key); if (c) Scene.focus(c.x, c.y - 8, Scene.goal?.z || Scene.cam.z); }
  Scene.planner = Scene.farm ? st.planner || null : null;
}

