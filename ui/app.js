/* Sinaleiro: the clodfarm farm (vendor/engine.js) fed by the Claude Code sessions open on this machine, with a
 * traffic cop where the planner's scarecrow stood. Everything on the farm is clickable: a Claude opens its card, a
 * mini-Claude its sub-agent, the cop the crossings, the barn the repos.
 * Everything here is namespaced (Sin, UI) because the engine's globals share this scope. */
"use strict";

const Sin = {
  state: null, raw: null, seenEvents: 0, seenSubs: new Map(), seenMail: new Set(), first: true, flights: [],
  cop: null, lastT: 0, focus: 0, focusT: 0, detail: null, detailAt: 0,
};

// ----------------------------------------------------------------- small helpers
Sin.fmtN = (n) => Math.round(Number(n) || 0).toLocaleString("pt-PT");
Sin.short = (n) => { n = Number(n) || 0; return n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "K" : String(Math.round(n)); };
Sin.ago = (ts) => {
  if (!ts) return "–";
  const s = Math.max(0, Date.now() / 1000 - ts);
  return s < 60 ? "agora mesmo" : s < 5400 ? `há ${Math.round(s / 60)} min` : s < 172800 ? `há ${(s / 3600).toFixed(1).replace(".", ",")} h` : `há ${Math.round(s / 86400)} dias`;
};
Sin.hm = (ts) => (ts ? new Date(ts * 1000).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }) : "–");
Sin.base = (p) => String(p || "").split("/").filter(Boolean).pop() || String(p || "");
Sin.home = (p) => String(p || "").replace(/^\/home\/[^/]+/, "~");
Sin.byId = (id) => Sin.raw?.sessions.find((s) => s.id === id);
Sin.nameOf = (id) => (id === "*" ? "qualquer sessão" : Sin.byId(id)?.name || String(id).slice(0, 8));
Sin.critterOf = (id) => Scene.critters.get("claude:" + id);
Sin.post = async (path, body) => {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Sinaleiro": "1" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
};
Sin.copy = async (text, what) => {
  try { await navigator.clipboard.writeText(text); UI.say(`Copiado: ${what}.`); }
  catch { UI.say("Não consegui copiar; seleciona o texto à mão."); }
};

/** busy -> working at a plot; idle a little -> strolling; idle for 5 min -> napping in the yard. */
Sin.mode = (s) => (s.status === "busy" ? "work" : Date.now() / 1000 - Math.max(s.last_at || 0, s.updated || 0) > 300 ? "sleep" : "wander");

/** The local sessions in the shape the engine's reconcile() wants (clodfarm's /api/state). */
Sin.adapt = (st) => {
  const now = Date.now() / 1000, agents = [], subagents = [], recent = [];
  for (const s of st.sessions) {
    const mode = Sin.mode(s), look = s.look || {};
    agents.push({ id: s.id, name: s.name, loggedIn: true, alive: true, up: true, error: false, primary: false, mine: false,
      talking: mode === "work" ? { title: s.prompt || s.tool || "a trabalhar", since: s.prompt_at || s.started } : null,
      resting: mode === "sleep", hat: look.hat, colors: look.colors, accessory: look.accessory });
    for (const a of s.subagents || []) {
      if (a.status === "running") subagents.push({ id: a.id, owner: s.id, on: s.id, status: "running", title: a.title, started: a.started, type: a.type });
      else if (a.ended && now - a.ended < 600) recent.push({ id: a.id, status: a.status === "failed" ? "failed" : "done", started: a.started, updated: a.ended });
    }
  }
  // the scarecrow, as on the original farm: awake and swaying while anyone works, asleep and grey when nobody does
  const busy = st.sessions.filter((s) => s.status === "busy").length, minis = subagents.length;
  let planner = { on: busy > 0, state: busy ? (minis ? `${minis} mini-Claude${minis === 1 ? "" : "s"} na horta` : `${busy} a trabalhar`) : "zzz" };
  const d = Sin.duty(), nd = (st.decisions || []).length;
  if (d) { // the arbiter: awake, flag up, shouting where
    const what = d.files.length ? d.files.map(Sin.base).join(", ") : (d.component === "." ? Sin.base(d.repo) : d.component) + "/";
    planner = { on: true, light: d.light, icon: d.light === "red" ? "alert" : "swords", state: nd ? `PARA! ${nd} decisão${nd === 1 ? "" : "ões"}` : `${d.light === "red" ? "PARA!" : "ATENÇÃO"} ${what}` };
  }
  return { agents, subagents, recent: recent.sort((a, b) => b.updated - a.updated), paused: false, planner };
};

// ----------------------------------------------------------------- the arbiter: the scarecrow, with a flag
/** A little flag on a pole in the crossing's colour, two frames of wind. 12 x 20 HD. */
Sin.flag = (() => {
  const cache = {};
  return (light, f) => {
    const k = light + f;
    if (cache[k]) return cache[k];
    const C = { red: ["#e0513c", "#ff8a70"], yellow: ["#e8b923", "#ffe08a"] }[light] || ["#3cc36b", "#8be6a8"];
    const P = new Pix(12, 20);
    P.rect(1, 0, 1, 19, "#3a1410");
    for (let y = 1; y <= 7; y++) for (let x = 2; x <= 10; x++) { const wave = f ? Math.round(Math.sin(x * 0.9) * 0.7) : Math.round(Math.sin(x * 0.9 + 2) * 0.7); P.set(x, y + wave, (x + y) % 5 === 0 ? C[1] : C[0]); }
    return (cache[k] = P.outline(SIN_INK).canvas());
  };
})();
const SIN_INK = "#1f2a44";
Sin.letter = (() => { const P = new Pix(12, 9); P.rect(0, 0, 12, 9, "#f4f1e8"); P.line(0, 0, 6, 5, "#c9bfa8"); P.line(11, 0, 6, 5, "#c9bfa8"); P.rect(5, 4, 2, 2, "#c0392b"); return P.outline(SIN_INK).canvas(); })();

/** The worst crossing right now (red first): what the scarecrow shouts about. Several take turns every 7 s. */
Sin.duty = () => {
  const cs = Sin.raw?.conflicts || [];
  if (!cs.length) return null;
  const red = cs.filter((c) => c.light === "red"), pool = red.length ? red : cs;
  return pool[Math.floor(Date.now() / 7000) % pool.length];
};
window.sinaleiroDrawFlag = (g, t, cr, hx) => {
  g.drawImage(Sin.flag(Scene.planner.light, REDUCED ? 0 : Math.floor(t * 3) % 2), hx(cr.x + 5), hx(cr.y - 26), 6, 10);
};

/** Dashed links between crossing sessions, and the letters they send each other, flying. */
window.sinaleiroOverlay = (g, t, L, hx, seen) => {
  for (const k of Sin.raw?.conflicts || []) {
    const [a, b] = k.sessions.map(Sin.critterOf).filter(Boolean);
    if (!a || !b) continue;
    g.fillStyle = k.light === "red" ? "#ff5a52" : "#ffd24a";
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2), off = REDUCED ? 0 : Math.floor(t * 6) % 2;
    for (let i = off; i < n; i += 2) { const u = i / n; g.fillRect(hx(a.x + (b.x - a.x) * u), hx(a.y - 6 + (b.y - a.y) * u), 1, 1); }
  }
  const now = performance.now();
  Sin.flights = Sin.flights.filter((f) => now - f.t0 < 2600);
  for (const f of Sin.flights) {
    const a = Sin.critterOf(f.from), b = Sin.critterOf(f.to);
    if (!a || !b) continue;
    const u = clamp((now - f.t0) / 2400, 0, 1), e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
    const x = lerp(a.x, b.x, e), y = lerp(a.y - 14, b.y - 14, e) - Math.sin(e * Math.PI) * 18;
    g.drawImage(Sin.letter, hx(x - 3), hx(y - 2.25), 6, 4.5);
    if (u >= 1 && !f.done) { f.done = true; Scene.sparkle(b.x, b.y - 12, 8, "#fff4c2"); }
  }
};

/** What else on the farm answers a click: the barn, the pond (the scarecrow is the engine's own). */
window.sinaleiroHit = (p) => {
  const L = Scene.world.L, b = L.barn;
  if (b && p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h) return { extra: () => UI.openRepos() };
  const pd = L.pond;
  if (pd && ((p.x - pd.cx) / pd.rx) ** 2 + ((p.y - pd.cy) / pd.ry) ** 2 < 1) return { extra: () => UI.say(`O lago reflete ${Sin.fmtN(Sin.raw?.tokens_today)} tokens queimados hoje. Os patos não querem saber.`) };
  return null;
};

// ----------------------------------------------------------------- the UI
const UI = {
  queue: [], typing: null,
  say(text) { this.queue.push(text); if (this.queue.length > 6) this.queue.splice(0, this.queue.length - 6); if (!this.typing) this.next(); },
  next() {
    const box = $("#textbox"), p = $("#textbox-text");
    clearTimeout(this.hideT);
    const text = this.queue.shift();
    if (text == null) { this.typing = null; this.hideT = setTimeout(() => box.classList.add("idle"), 7000); return; }
    box.classList.remove("idle");
    let i = 0;
    this.typing = { text, done: false };
    clearInterval(this.typeT);
    this.typeT = setInterval(() => {
      i = Math.min(text.length, i + (REDUCED ? text.length : 2));
      p.textContent = text.slice(0, i);
      if (i >= text.length) { clearInterval(this.typeT); this.typing.done = true; this.hideT = setTimeout(() => this.next(), this.queue.length ? 1800 : 5000); }
    }, 28);
  },
  skip() {
    if (!this.typing) return $("#textbox").classList.add("idle");
    if (!this.typing.done) { clearInterval(this.typeT); $("#textbox-text").textContent = this.typing.text; this.typing.done = true; clearTimeout(this.hideT); this.hideT = setTimeout(() => this.next(), 4000); }
    else { clearTimeout(this.hideT); this.next(); }
  },

  open(id) { for (const d of $$("dialog[open]")) if (d.id !== id) d.close(); const d = $("#" + id); if (!d.open) d.showModal(); return d; },

  bind() {
    for (const img of $$("img[data-icon]")) img.src = icon(img.dataset.icon);
    document.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act) return this.act(act);
      if (e.target.closest("[data-close]")) return e.target.closest("dialog").close();
      if (e.target.tagName === "DIALOG") return e.target.close(); // a click on the backdrop
    });
    $("#textbox").addEventListener("click", () => this.skip());
    for (const d of $$("dialog")) d.addEventListener("close", () => { if (d.id === "dlg-summary") { Scene.selected = null; this.summaryKey = null; } });
    addEventListener("keydown", (e) => {
      if (e.target.closest("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
      if ($$("dialog[open]").length && e.key !== "Escape") return;
      const k = { "+": "zoomin", "=": "zoomin", "-": "zoomout", "0": "fit", "?": "help", l: "limit", d: "decisions", r: "roster", j: "tasks", m: "mail", x: "cop", o: "events", n: "new", t: "phone", c: "chat" }[e.key.toLowerCase()];
      if (k) { e.preventDefault(); this.act(k); }
    });
  },
  act(a) {
    if (a === "zoomin") return Scene.zoomBy(1.4);
    if (a === "zoomout") return Scene.zoomBy(1 / 1.4);
    if (a === "fit") return Scene.fit();
    const fn = { limit: "openLimit", help: "openHelp", roster: "openRoster", tasks: "openTasks", mail: "openMail", cop: "openCop", decisions: "openDecisions", events: "openEvents", new: "openNew", phone: "openPhone", chat: "openChat", tokens: "openRoster" }[a];
    if (fn) this[fn]();
  },

  // ------------------------------------------------------------- HUD
  renderHud(st) {
    const tok = st.tokens_today || 0, el = $("#tok-total");
    this.tokTarget = tok;
    if (this.tokShown == null) this.tokShown = tok;
    if (!this.tokRAF) { const step = () => { this.tokRAF = null; const d = this.tokTarget - this.tokShown; this.tokShown += Math.abs(d) < 1 ? d : d * 0.12; el.textContent = Sin.fmtN(this.tokShown); if (Math.abs(this.tokTarget - this.tokShown) >= 1) this.tokRAF = requestAnimationFrame(step); }; this.tokRAF = requestAnimationFrame(step); }
    const live = st.sessions.reduce((n, s) => n + (s.tokens_today || 0), 0);
    $("#tok-today").textContent = `HOJE · ${Sin.short(live)} NAS SESSÕES ABERTAS`;
    fill($("#tokens-sign"), h("span", { class: "tok-grid" },
      st.sessions.slice().sort((a, b) => (b.tokens_today || 0) - (a.tokens_today || 0)).map((s) => [h("span", { text: s.name }), h("b", { text: Sin.short(s.tokens_today) }), h("span", { text: Sin.short(s.tokens_total) + " total" })])),
      h("span", { class: "tok-note", text: "Tokens de entrada, saída e escrita em cache (as leituras de cache não contam), lidos das transcrições locais." }));
    this.renderLimit(st.limit);
    const busy = st.sessions.filter((s) => s.status === "busy").length, subs = st.sessions.reduce((n, s) => n + (s.subagents || []).filter((a) => a.status === "running").length, 0);
    const red = st.conflicts.filter((c) => c.light === "red").length, yellow = st.conflicts.length - red, nd = (st.decisions || []).length;
    const ap = $("#approve-chip");
    ap.hidden = !nd; ap.textContent = `⚑ ${nd} DECIS${nd === 1 ? "ÃO" : "ÕES"} PARA TOMAR`;
    const n = $("#dec-n"); n.hidden = !nd; n.textContent = String(nd);
    $("#dec-tool").classList.toggle("call", !!nd);
    fill($("#chips"),
      h("button", { type: "button", class: "chip", "data-act": "roster" }, h("span", { class: "dot" + (busy ? "" : " off") }), h("b", { text: String(st.sessions.length) }), ` SESSÕ${st.sessions.length === 1 ? "ÃO" : "ES"} · ${busy} A TRABALHAR`),
      subs ? h("button", { type: "button", class: "chip", "data-act": "tasks" }, h("span", { class: "dot" }), h("b", { text: String(subs) }), ` MINI-CLAUDE${subs === 1 ? "" : "S"}`) : null,
      red ? h("button", { type: "button", class: "chip warn", "data-act": "cop" }, h("span", { class: "dot red" }), h("b", { text: String(red) }), " PARA!") : null,
      yellow ? h("button", { type: "button", class: "chip amber", "data-act": "cop" }, h("span", { class: "dot yellow" }), h("b", { text: String(yellow) }), ` CRUZAMENTO${yellow === 1 ? "" : "S"}`) : null,
      !st.conflicts.length ? h("button", { type: "button", class: "chip", "data-act": "cop" }, h("span", { class: "dot" }), "TUDO VERDE") : null);
  },

  // ------------------------------------------------------------- the 5-hour limit
  renderLimit(l) {
    const el = $("#limit"), on = l?.available && l.resets_at;
    const pct = on ? l.pct : 0;
    el.classList.toggle("warn", on && pct >= 60 && pct < 85);
    el.classList.toggle("hot", on && pct >= 85);
    el.classList.toggle("off", !on);
    $("#lim-pct").textContent = on ? `${Math.round(pct)}%` : (l?.available ? "0%" : "–");
    $("#lim-reset").textContent = on ? ` · ↺ ${Sin.hm(l.resets_at)}` : "";
    $("#lim-here").style.width = on ? `${Math.min(100, l.here)}%` : "0";
    $("#lim-out").style.width = on ? `${Math.min(100 - Math.min(100, l.here), l.outside)}%` : "0";
    $("#lim-note").textContent = !l?.available ? "à espera da 1.ª leitura"
      : !on ? "janela nova: começa quando uma sessão falar"
      : l.eta ? `a este ritmo, limite às ${Sin.hm(l.eta)}`
      : `aqui ${Math.round(l.here)}% · fora ${Math.round(l.outside)}%`;
  },
  openLimit() {
    const l = Sin.raw?.limit;
    if (!l?.available) {
      return this.list("O LIMITE DE 5 HORAS", "Ainda sem leituras.",
        [h("p", { text: "A percentagem vem da tua conta: o Claude Code entrega-a à statusline, e a statusline do sinaleiro guarda-a." }),
          h("p", { text: "Corre sinaleiro install (outra vez, se já tinhas corrido) e reinicia as sessões. A primeira leitura chega na primeira resposta de uma sessão." })]);
    }
    const pct = (x) => `${Math.round(x)}%`, models = Object.entries(l.models || {}).sort((a, b) => b[1] - a[1]);
    const tot = models.reduce((n, [, v]) => n + v, 0) || 1, NAME = { fable: "FABLE", opus: "OPUS", sonnet: "SONNET", haiku: "HAIKU", outro: "OUTRO" };
    const r = l.rates || {}, both = r.fable && r.opus;
    const bar = (w, cls) => h("span", { class: "lim-bar big" }, h("i", { class: cls || "here", style: `width:${Math.min(100, w)}%` }));
    this.list("O LIMITE DE 5 HORAS", l.resets_at ? `Janela aberta às ${Sin.hm(l.started)}, renova às ${Sin.hm(l.resets_at)}.` : "A janela anterior acabou; a próxima começa na próxima resposta.",
      [h("div", { class: "lim-hero" },
        h("b", { class: "lim-big", text: pct(l.pct) }),
        h("span", { class: "lim-bar big" }, h("i", { class: "here", style: `width:${Math.min(100, l.here)}%` }), h("i", { class: "out", style: `width:${Math.min(100 - Math.min(100, l.here), l.outside)}%` })),
        h("span", { class: "lim-legend" }, h("span", { class: "sw here" }), `AQUI, ESTE PC ≈ ${pct(l.here)}`, h("span", { class: "sw out" }), `FORA (OUTRO PC, APPS) ≈ ${pct(l.outside)}`)),
        l.learning ? h("p", { class: "muted small", text: "Ainda a aprender quanto vale cada modelo: até lá, o que corre aqui conta todo como 'aqui'." }) : null,
        h("h3", { text: "O RITMO" }),
        h("p", { text: l.per_hour > 0 ? `${l.per_hour.toFixed(1).replace(".", ",")} % por hora na última meia hora. ` + (l.eta ? `A este ritmo chegas ao limite às ${Sin.hm(l.eta)}, antes de renovar.` : `A este ritmo, renova (${Sin.hm(l.resets_at)}) antes de chegares ao limite.`) : "Parado na última meia hora." }),
        models.length ? [h("h3", { text: "OS MODELOS, NESTA JANELA (ESTE PC)" }),
          h("ul", { class: "lim-models" }, models.map(([f, n]) => h("li", {}, h("b", { text: NAME[f] || f.toUpperCase() }), bar(n / tot * 100, "m-" + f), h("span", { text: `${Sin.short(n)} · ${Math.round(n / tot * 100)}%` }))))] : null,
        Object.keys(r).length ? [h("h3", { text: "QUANTO CUSTA CADA UM" }),
          h("ul", { class: "lim-models" }, Object.entries(r).map(([f, v]) => h("li", {}, h("b", { text: NAME[f] || f.toUpperCase() }), h("span", { text: `100K tokens ≈ ${v.toFixed(1).replace(".", ",")}% do limite` })))),
          both ? h("p", { class: "small", text: `O Fable gasta ≈ ${(r.fable / r.opus).toFixed(1).replace(".", ",")}× mais limite por token que o Opus.` }) : null] : null,
        l.week ? [h("h3", { text: "A SEMANA" }), h("p", { text: `${pct(l.week.pct)} dos 7 dias · renova ${new Date(l.week.resets_at * 1000).toLocaleString("pt-PT", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` })] : null,
        h("p", { class: "muted small", text: "A % é da tua conta inteira (todas as máquinas e apps) e só se atualiza quando uma sessão deste PC recebe uma resposta. 'Fora' é a subida que os tokens deste PC não explicam: uma estimativa." })]);
  },

  // ------------------------------------------------------------- the critter card
  openCritter(c) {
    for (const d of $$("dialog[open]")) d.close();
    this.summaryKey = c.key; Scene.selected = c;
    this.renderSummary(c);
    $("#dlg-summary").showModal();
    if (!c.mini) this.loadDetail(c.agent.id);
  },
  async loadDetail(id) {
    try {
      const r = await fetch("api/session?id=" + encodeURIComponent(id), { cache: "no-store" });
      if (!r.ok) return;
      Sin.detail = await r.json(); Sin.detailAt = Date.now();
      const c = Scene.critters.get(this.summaryKey);
      if (c && !c.mini && c.agent.id === id && $("#dlg-summary").open) this.renderSummary(c);
      if ($("#dlg-talk").open && this.talkFor === id) this.renderTalk();
    } catch { /* the next poll tries again */ }
  },
  badgeFor(s) {
    const m = Sin.mode(s);
    return h("span", { class: "badge " + (m === "work" ? "running" : m === "sleep" ? "cancelled" : "waiting"), text: m === "work" ? "A TRABALHAR" : m === "sleep" ? "A DORMIR" : "EM ESPERA" });
  },
  renderSummary(c) {
    const st = Sin.raw;
    if (c.mini) return this.renderSub(c);
    const s = Sin.byId(c.agent.id);
    if (!s) return $("#dlg-summary").close();
    const d = Sin.detail?.id === s.id ? Sin.detail : null;
    paintSprite($("#sum-sprite"), skinFrameHD(c.skin || agentSkin(c.agent), { legs: 0 }), 96, { bg: tileBg, pad: 8, bottom: true });
    $("#sum-name").textContent = s.name.toUpperCase();
    $("#sum-sub").textContent = Sin.home(s.cwd);
    const mine = st.conflicts.filter((k) => k.sessions.includes(s.id));
    fill($("#sum-top"), h("p", { class: "tags" }, this.badgeFor(s),
      mine.map((k) => h("button", { type: "button", class: "badge " + (k.light === "red" ? "failed" : "waiting") + " linkish", onclick: () => this.openCop(), text: `${k.light === "red" ? "🔴" : "🟡"} ${k.component === "." ? Sin.base(k.repo) : k.component}` }))));
    const subs = s.subagents || [], files = s.touching || [], holds = d?.holds || [];
    const others = st.sessions.filter((x) => x.id !== s.id);
    const fileRow = (f) => {
      const held = holds.find((x) => x.rel === f.rel);
      return h("li", {}, h("span", { class: "badge " + (f.hot ? "failed" : f.kind === "edit" ? "done" : "queued"), text: f.hot ? "EM DISPUTA" : f.kind === "edit" ? "EDITOU" : "LEU" }),
        h("span", { class: "fname", title: f.rel, text: f.rel }),
        held ? h("span", { class: "row-acts" },
          h("button", { class: "btn mini", type: "button", onclick: () => this.release(s, held.path) }, "LIBERTAR"),
          others.length ? h("select", { class: "mini", "aria-label": "Passar a", onchange: (e) => { if (e.target.value) this.grant(s, held.path, e.target.value); } },
            h("option", { value: "", text: "PASSAR A…" }), others.map((o) => h("option", { value: o.id, text: o.name }))) : null) : null);
    };
    const convo = (d?.convo || []).filter((m) => m.role !== "tool").slice(-3);
    fill($("#sum-body"),
      h("dl", { class: "stat-row" },
        h("dt", { text: "PEDIDO" }), h("dd", { text: s.prompt || "–" }),
        h("dt", { text: "AGORA" }), h("dd", { text: s.tool ? `${s.tool} · ${Sin.ago(s.tool_at)}` : "–" }),
        h("dt", { text: "TOKENS" }), h("dd", { text: `${Sin.fmtN(s.tokens_today)} hoje · ${Sin.fmtN(s.tokens_total)} nesta sessão` }),
        h("dt", { text: "ABERTA" }), h("dd", { text: Sin.ago(s.started) })),
      subs.length ? [h("h3", { text: `MINI-CLAUDES (${subs.length})` }), h("ul", { class: "subs" }, subs.map((a) => h("li", {},
        h("span", { class: "badge " + (a.status === "running" ? "running" : a.status === "failed" ? "failed" : "done"), text: a.status === "running" ? "A TRABALHAR" : a.status === "failed" ? "FALHOU" : "COLHIDO" }),
        h("span", { text: `${a.title} · ${a.type}` }))))] : null,
      h("h3", { text: `FICHEIROS (${files.length})` }),
      files.length ? h("ul", { class: "subs files" }, files.slice().reverse().map(fileRow))
        : h("p", { class: "muted small", text: "Ainda não tocou em nada que o sinaleiro tenha visto (precisa do hook instalado e de uma sessão nova)." }),
      h("h3", { text: "CONVERSA" }),
      convo.length ? h("div", { class: "talk" }, convo.map((m) => this.turn(m, 220))) : h("p", { class: "muted small", text: d?.convo_hidden ? "🔒 A conversa fica no PC: no telemóvel vês o pedido, a ferramenta e os tokens." : d ? "Sem mensagens recentes." : "A carregar…" }));
    fill($("#sum-actions"),
      s.chat ? h("button", { class: "btn primary", type: "button", onclick: () => Chat.open(s.id) }, "💬 CHAT") : null,
      Sin.raw?.viewer?.convo === false ? null : h("button", { class: "btn" + (s.chat ? "" : " primary"), type: "button", onclick: () => this.openTalk(s.id) }, "VER CONVERSA"),
      h("button", { class: "btn", type: "button", onclick: () => this.openLook(s, c) }, "APARÊNCIA"),
      Sin.raw?.viewer?.remote ? null : h("button", { class: "btn", type: "button", onclick: () => Sin.copy(d?.resume || `cd ${s.cwd} && claude --resume ${s.id}`, "o comando para retomar esta sessão") }, "COPIAR RETOMAR"),
      h("button", { class: "btn", type: "button", onclick: () => { $("#dlg-summary").close(); Scene.focusCritter(c); } }, "CENTRAR"));
  },
  renderSub(c) {
    const s = Sin.byId(c.agent.id), a = (s?.subagents || []).find((x) => x.id === c.sub.id) || c.sub;
    paintSprite($("#sum-sprite"), miniHD(c.color, {}), 96, { bg: tileBg, pad: 8, bottom: true });
    $("#sum-name").textContent = `MINI-CLAUDE · ${c.agent.name}`.toUpperCase();
    $("#sum-sub").textContent = `Sub-agente ${a.type || ""} lançado por ${c.agent.name}`;
    fill($("#sum-top"), h("p", { class: "tags" }, h("span", { class: "badge running", text: "A TRABALHAR" })));
    fill($("#sum-body"), h("dl", { class: "stat-row" }, h("dt", { text: "COMEÇOU" }), h("dd", { text: Sin.ago(a.started) })),
      h("h3", { text: "O TRABALHO DELE" }), h("p", { class: "job-text", text: a.title }),
      h("p", { class: "muted small", text: "Quando acabar, colhe-se no talhão: a cultura floresce com a faísca do Claude." }));
    fill($("#sum-actions"), h("button", { class: "btn", type: "button", onclick: () => { const p = Sin.critterOf(c.agent.id); if (p) this.openCritter(p); } }, `◀ ${c.agent.name.toUpperCase()}`));
  },
  turn(m, max) {
    const who = m.role === "user" ? "TU" : m.role === "tool" ? "FERRAMENTA" : "CLAUDE";
    const text = max && m.text.length > max ? m.text.slice(0, max - 1) + "…" : m.text;
    return h("div", { class: "turn" + (m.role === "user" ? " user" : m.role === "tool" ? " k-tool" : "") }, h("b", { text: `${who} · ${Sin.ago(m.ts)}` }), text);
  },
  openTalk(id) { this.talkFor = id; this.renderTalk(); this.open("dlg-talk"); this.loadDetail(id); },
  renderTalk() {
    const d = Sin.detail?.id === this.talkFor ? Sin.detail : null, s = Sin.byId(this.talkFor);
    $("#talk-kicker").textContent = s ? Sin.home(s.cwd) : "";
    $("#talk-h").textContent = `CONVERSA · ${(s?.name || "").toUpperCase()}`;
    fill($("#talk-body"), d ? (d.convo.length ? d.convo.map((m) => this.turn(m)) : h("p", { class: "muted", text: "Sem mensagens." })) : h("p", { class: "muted", text: "A carregar…" }));
    fill($("#talk-actions"),
      h("button", { class: "btn", type: "button", onclick: () => { const c = Sin.critterOf(this.talkFor); if (c) this.openCritter(c); } }, "◀ CARTÃO"),
      h("button", { class: "btn primary", type: "button", onclick: () => Sin.copy(d?.resume || "", "o comando para retomar") }, "COPIAR RETOMAR"));
    requestAnimationFrame(() => { const b = $("#talk-body"); b.lastElementChild?.scrollIntoView({ block: "end" }); });
  },
  async release(s, path) {
    try { await Sin.post("api/release", { session: s.id, path }); UI.say(`Libertaste ${Sin.base(path)} por ${s.name}.`); poll(true); this.loadDetail(s.id); }
    catch (x) { UI.say("Não deu: " + x.message); }
  },
  async grant(s, path, to) {
    try { await Sin.post("api/grant", { session: s.id, path, to }); UI.say(`${Sin.base(path)} passou de ${s.name} para ${Sin.nameOf(to)}.`); poll(true); this.loadDetail(s.id); }
    catch (x) { UI.say("Não deu: " + x.message); }
  },

  // ------------------------------------------------------------- the look picker
  openLook(s, c) {
    const look = s.look || {};
    let pick = { hat: look.hat || "straw", colors: { ...(look.colors || {}) }, accessory: look.accessory || "" };
    $("#look-sub").textContent = `Fica guardada para ${Sin.home(s.cwd)}: a próxima sessão nessa pasta veste-a também.`;
    fill($("#look-body"), Picker.skinPicker({ ...pick, keepBand: !!look.colors?.band }, (v) => { pick = v; }));
    fill($("#look-actions"),
      h("button", { class: "btn", type: "button", onclick: () => this.openCritter(c) }, "◀ VOLTAR"),
      h("button", { class: "btn primary", type: "button", onclick: async () => {
        try { await Sin.post("api/look", { session: s.id, look: pick }); s.look = pick; Scene.sparkle(c.x, c.y - 10, 18); UI.say(`${s.name.toUpperCase()} estreou visual novo!`); await poll(true); this.openCritter(Sin.critterOf(s.id) || c); }
        catch (x) { UI.say("Não guardou: " + x.message); }
      } }, "GUARDAR"));
    this.open("dlg-look");
  },

  // ------------------------------------------------------------- lists
  list(title, sub, body) {
    $("#list-h").textContent = title; $("#list-sub").textContent = sub || "";
    fill($("#list-body"), body);
    return this.open("dlg-list");
  },
  sprite(s, px = 40) {
    const c = h("canvas", { class: "roster-sprite", width: px, height: px, "aria-hidden": "true" });
    const cr = Sin.critterOf(s.id);
    paintSprite(c, skinFrameHD(cr?.skin || agentSkin({ id: s.id, ...(s.look || {}) }), { legs: 0, sleep: Sin.mode(s) === "sleep" }), px, { bg: tileBg, pad: 3, bottom: true });
    return c;
  },
  openRoster() {
    const st = Sin.raw; if (!st) return;
    const order = { work: 0, wander: 1, sleep: 2 };
    this.list("TODAS AS SESSÕES", `${st.sessions.length} sessões Claude abertas nesta máquina. Toca numa para abrir o cartão.`,
      h("ul", { class: "roster-list" }, st.sessions.slice().sort((a, b) => order[Sin.mode(a)] - order[Sin.mode(b)]).map((s) => h("li", {},
        h("button", { type: "button", class: "roster-row", onclick: () => { const c = Sin.critterOf(s.id); if (c) { this.openCritter(c); Scene.focusCritter(c); } } },
          this.sprite(s),
          h("span", { class: "roster-main" }, h("b", { text: s.name.toUpperCase() }), h("span", { class: "muted", text: Sin.home(s.cwd) }), h("span", { class: "roster-prompt", text: s.prompt || "–" })),
          h("span", { class: "roster-side" }, this.badgeFor(s), h("span", { class: "small", text: Sin.short(s.tokens_today) + " hoje" })))))));
  },
  openTasks() {
    const st = Sin.raw; if (!st) return;
    const all = st.sessions.flatMap((s) => (s.subagents || []).map((a) => ({ ...a, s })));
    this.list("MINI-CLAUDES", "Os sub-agentes que as sessões lançaram: a trabalhar, ou colhidos nos últimos 10 minutos.",
      all.length ? h("ul", { class: "subs" }, all.sort((a, b) => b.started - a.started).map((a) => h("li", {},
        h("span", { class: "badge " + (a.status === "running" ? "running" : a.status === "failed" ? "failed" : "done"), text: a.status === "running" ? "A TRABALHAR" : a.status === "failed" ? "FALHOU" : "COLHIDO" }),
        h("span", {}, h("b", { class: "who", text: a.s.name }), ` ${a.title} · ${a.type} · ${Sin.ago(a.started)}`))))
        : h("p", { class: "muted", text: "Nenhum mini-Claude agora. Quando uma sessão usar a ferramenta Agent, aparecem à volta do talhão dela." }));
  },
  openMail() {
    const st = Sin.raw; if (!st) return;
    const mail = st.sessions.flatMap((s) => (s.sent || []).map((m) => ({ ...m, s }))).sort((a, b) => b.ts - a.ts);
    this.list("CORREIO", "As mensagens que as sessões mandaram umas às outras (SendMessage), nas últimas 6 horas.",
      mail.length ? h("ul", { class: "subs" }, mail.map((m) => h("li", {}, h("span", { class: "badge done", text: "✉" }),
        h("span", {}, h("b", { class: "who", text: `${m.s.name} → ${m.to_id ? Sin.nameOf(m.to_id) : m.to}` }), ` ${m.summary || ""} · ${Sin.ago(m.ts)}`))))
        : h("p", { class: "muted", text: "Ainda ninguém escreveu a ninguém. Quando o sinaleiro trava uma sessão, é por aqui que elas combinam." }));
  },
  openCop() {
    const st = Sin.raw; if (!st) return;
    const cs = st.conflicts;
    const card = (k) => {
      const holds = st.holds.filter((x) => x.repo === k.repo && x.component === k.component);
      return h("div", { class: "cross " + k.light },
        h("p", { class: "cross-h" }, h("span", { class: "lamp-dot " + k.light }), `${Sin.base(k.repo)}/${k.component === "." ? "" : k.component}`),
        h("p", { text: k.sessions.map(Sin.nameOf).join(" ↔ ") }),
        h("p", { class: "muted small", text: k.files.length ? "Mesmo ficheiro: " + k.files.join(", ") : "Mesma pasta, ficheiros diferentes." }),
        holds.length ? h("ul", { class: "subs" }, holds.map((x) => h("li", {}, h("span", { class: "badge waiting", text: "✎ " + Sin.nameOf(x.session) }), h("span", { class: "fname", text: x.path.slice(x.repo.length + 1) }),
          h("button", { class: "btn mini", type: "button", onclick: () => this.release(Sin.byId(x.session), x.path) }, "LIBERTAR")))) : null);
    };
    this.list("CRUZAMENTOS", "O espantalho levanta a bandeira: 🟡 duas sessões na mesma pasta, avisa · 🔴 a mesma edição no mesmo ficheiro, trava até decidires ou elas combinarem.",
      [cs.length ? cs.map(card) : h("div", { class: "cross green" }, h("p", { class: "cross-h" }, h("span", { class: "lamp-dot green" }), "TUDO VERDE"), h("p", { class: "muted", text: "Ninguém está a mexer no mesmo sítio." })),
        h("h3", { text: "COMO SE DESTRAVA" }),
        h("p", { class: "small", text: "Decide em DECISÕES, ou liberta daqui (LIBERTAR). As sessões também podem combinar entre si e correr sinaleiro grant <ficheiro> <sessão> ou sinaleiro release. Se a sessão fechar, ou passarem 10 minutos sem tocar no ficheiro, destrava sozinho." })]);
  },
  eventText(e) {
    const f = Sin.base(e.path), o = e.other_names.join(", ");
    if (e.light === "red") return `${e.session_name} foi travado em ${f}: está com ${o}.`;
    if (e.light === "yellow") return `${e.session_name} foi avisado: ${o} anda por perto (${f}).`;
    if (e.light === "say") return e.tool === "spawn" ? `Abriste um Claude novo em ${Sin.home(e.path)} (${e.note}).` : `Disseste a ${e.session_name}: ${e.note}`;
    if (e.tool === "keep") return `Decidiste: ${f} fica com ${e.session_name}.`;
    if (e.tool === "release") return `${e.session_name} libertou ${f}${e.note ? " (pela quinta)" : ""}.`;
    return `${e.session_name} passou ${f} a ${o}${e.note ? " (pela quinta)" : ""}.`;
  },
  openEvents() {
    const st = Sin.raw; if (!st) return;
    this.list("OCORRÊNCIAS", "Tudo o que o sinaleiro fez nas últimas 6 horas.",
      st.events.length ? h("ul", { class: "subs events" }, st.events.map((e) => h("li", {},
        h("span", { class: "lamp-dot " + (e.light === "grant" || e.light === "say" ? "blue" : e.light) }),
        h("span", {}, h("b", { class: "who", text: new Date(e.ts * 1000).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }) }), " " + this.eventText(e)))))
        : h("p", { class: "muted", text: "Ainda sem ocorrências. Com o hook instalado, cada aviso e cada paragem aparecem aqui." }));
  },
  openRepos() {
    const st = Sin.raw; if (!st) return;
    const repos = new Map();
    for (const s of st.sessions) { const r = s.field || s.cwd; if (!repos.has(r)) repos.set(r, []); repos.get(r).push(s); }
    this.list("O CELEIRO", "Os repositórios onde as sessões andam a trabalhar.",
      h("ul", { class: "roster-list" }, [...repos].map(([r, ss]) => h("li", {}, h("div", { class: "roster-row static" },
        h("span", { class: "roster-main" }, h("b", { text: Sin.base(r).toUpperCase() }), h("span", { class: "muted", text: Sin.home(r) }),
          h("span", { class: "roster-prompt", text: ss.map((s) => s.name).join(", ") })),
        h("span", { class: "roster-side" }, h("span", { class: "small", text: `${ss.length} sess${ss.length === 1 ? "ão" : "ões"}` })))))));
  },
  /** + NOVA SESSÃO. With the chat on: walk the folders (from ~/Documentos) and open a Claude there, in tmux, with a
   * terminal window on the PC; without it, the commands to copy. `then` runs after a Claude was opened. */
  async openNew(path = "", then = null) {
    const dirs = [...new Set((Sin.raw?.sessions || []).map((s) => s.cwd))];
    const row = (cmd) => h("div", { class: "copy-row" }, h("code", { class: "pre", text: cmd }), h("button", { class: "btn", type: "button", onclick: () => Sin.copy(cmd, "o comando") }, "COPIAR"));
    const sub = "Cada sessão Claude Code que abrires nesta máquina entra na quinta sozinha, pelo portão do celeiro.";
    if (!Sin.raw?.viewer?.chat) {
      return this.list("+ NOVA SESSÃO", sub,
        [h("p", { text: "Abre um terminal e corre o Claude na pasta onde queres trabalhar:" }), row("claude"),
          dirs.length ? [h("h3", { text: "NAS PASTAS ONDE JÁ HÁ SESSÕES" }), dirs.map((d) => row(`cd ${d} && claude`))] : null,
          h("p", { class: "muted small", text: "Para abrires Claudes daqui, a escolher a pasta, corre o servidor com: sinaleiro serve --lan --chat" })]);
    }
    let f;
    try { const r = await fetch("api/dirs?path=" + encodeURIComponent(path), { cache: "no-store" }); f = await r.json(); if (!r.ok) throw new Error(f.error || r.status); }
    catch (x) { return UI.say("Não deu para ver as pastas: " + x.message); }
    const remote = !!Sin.raw?.viewer?.remote;
    const win = remote ? null : h("input", { type: "checkbox", checked: true });
    const go = async (cwd) => {
      try {
        const r = await Sin.post("api/spawn", { cwd, window: !!win?.checked });
        UI.say(`Um Claude novo está a nascer em ${Sin.base(cwd)} (${r.tmux})${r.window ? ", com uma janela de terminal no PC" : ""}. Entra na quinta daqui a pouco.`);
        $("#dlg-list").close(); then?.();
      } catch (x) { UI.say("Não deu: " + x.message); }
    };
    const crumbs = Sin.home(f.path);
    this.list("+ NOVA SESSÃO", sub, [
      h("h3", { text: "ESCOLHE A PASTA" }),
      h("div", { class: "copy-row" }, h("code", { class: "pre", text: crumbs }),
        h("button", { class: "btn primary", type: "button", onclick: () => go(f.path) }, "ABRIR CLAUDE AQUI")),
      win ? h("label", { class: "check dir-win" }, win, " Abrir também uma janela de terminal neste PC") : null,
      h("ul", { class: "dir-list" },
        f.parent ? h("li", {}, h("button", { class: "btn dir", type: "button", onclick: () => this.openNew(f.parent, then) }, "↑ ACIMA")) : null,
        f.dirs.map((d) => h("li", {}, h("button", { class: "btn dir", type: "button", onclick: () => this.openNew(f.path + "/" + d, then) }, "▸ " + d)))),
      !f.dirs.length ? h("p", { class: "muted small", text: "Não há pastas aqui dentro." }) : null,
      f.more ? h("p", { class: "muted small", text: `E mais ${f.more} pastas que não cabem na lista.` }) : null,
      dirs.length ? [h("h3", { text: "NAS PASTAS ONDE JÁ HÁ SESSÕES" }),
        dirs.map((d) => h("div", { class: "copy-row" }, h("code", { class: "pre", text: Sin.home(d) }), h("button", { class: "btn", type: "button", onclick: () => go(d) }, "ABRIR AQUI")))] : null,
      remote ? null : [h("h3", { text: "OU NUM TERMINAL TEU" }), row(`cd ${f.path} && claude`)],
      h("p", { class: "muted small", text: "Duas sessões no mesmo repo? O sinaleiro trata dos cruzamentos." })]);
  },
  async openPhone() {
    if (Sin.raw?.viewer?.remote) return;
    let p;
    try { const r = await fetch("api/phone", { cache: "no-store" }); if (!r.ok) throw new Error(r.status); p = await r.json(); }
    catch (x) { return UI.say("Não deu para ler o link do telemóvel: " + x.message); }
    if (!p.lan) {
      const cmd = "sinaleiro serve --lan";
      return this.list("CONTINUAR NO TELEMÓVEL", "Esta quinta só está aberta neste PC.",
        [h("p", { text: "Para a abrir no telemóvel (na mesma rede Wi-Fi), para o servidor e volta a corrê-lo assim:" }),
          h("div", { class: "copy-row" }, h("code", { class: "pre", text: cmd }), h("button", { class: "btn", type: "button", onclick: () => Sin.copy(cmd, "o comando") }, "COPIAR")),
          h("p", { class: "muted small", text: "Depois carrega outra vez em TELEMÓVEL e aparece aqui o QR code." })]);
    }
    const [first, ...more] = p.links;
    this.list("CONTINUAR NO TELEMÓVEL", "Lê o QR code com a câmara do telemóvel, na mesma rede Wi-Fi.",
      [p.qr ? h("img", { class: "phone-qr", src: p.qr, alt: "QR code com o link da quinta para o telemóvel" }) : h("p", { class: "muted", text: "Não consegui desenhar o QR code (instala qrencode). Abre o link no telemóvel:" }),
        h("div", { class: "copy-row" }, h("code", { class: "pre", text: first.url }), h("button", { class: "btn", type: "button", onclick: () => Sin.copy(first.url, "o link do telemóvel") }, "COPIAR")),
        more.length ? [h("h3", { text: "NOUTRAS REDES" }), more.map((l) => h("div", { class: "copy-row" }, h("code", { class: "pre", text: `${l.iface}: ${l.url}` }), h("button", { class: "btn", type: "button", onclick: () => Sin.copy(l.url, "o link") }, "COPIAR")))] : null,
        h("p", { class: "muted small", text: "Quem tiver este link entra na quinta e pode tomar as decisões. Para o trocar (o antigo deixa de valer): sinaleiro serve --lan --new-token" })]);
  },
  openChat() { Chat.open(); },
  openPlanner() { (Sin.raw?.decisions || []).length ? this.openDecisions() : this.openCop(); },
  decisionCard(d) {
    const req = Sin.nameOf(d.requester).toUpperCase(), hold = Sin.nameOf(d.holder).toUpperCase();
    const go = async (choice, said) => {
      try { await Sin.post("api/decide", { path: d.path, requester: d.requester, holder: d.holder, choice }); UI.say(said); await poll(true); this.openDecisions(); }
      catch (x) { UI.say("Não deu: " + x.message); }
    };
    const who = (id) => { const s = Sin.byId(id); return s ? this.sprite(s, 32) : null; };
    return h("div", { class: "cross red decision" },
      h("p", { class: "cross-h" }, h("span", { class: "lamp-dot red" }), d.rel),
      h("div", { class: "duel" },
        h("div", {}, who(d.requester), h("b", { text: req }), h("span", { class: "muted small", text: `quer editar · travado ${Sin.ago(d.ts)}` })),
        h("span", { class: "vs", text: "⚔" }),
        h("div", {}, who(d.holder), h("b", { text: hold }), h("span", { class: "muted small", text: `tem o ficheiro · desde ${Sin.ago(d.held_since).replace("há ", "há ")}` }))),
      h("div", { class: "dlg-actions choices" },
        h("button", { class: "btn primary", type: "button", onclick: () => go("give", `${Sin.base(d.path)} passou para ${req}. Quando tentar de novo, passa.`) }, `DAR A ${req}`),
        h("button", { class: "btn", type: "button", onclick: () => go("keep", `${Sin.base(d.path)} fica com ${hold}. ${req} vai ser avisado para fazer outra coisa.`) }, `FICA COM ${hold}`),
        h("button", { class: "btn", type: "button", onclick: () => go("release", `${Sin.base(d.path)} ficou livre para todos.`) }, "LIBERTAR")));
  },
  openDecisions() {
    const ds = Sin.raw?.decisions || [];
    this.list("DECISÕES", ds.length ? "O espantalho travou estas edições: duas sessões querem o mesmo ficheiro. Quem fica com ele?" : "Nada para decidir.",
      [ds.length ? ds.map((d) => this.decisionCard(d)) : h("div", { class: "cross green" }, h("p", { class: "cross-h" }, h("span", { class: "lamp-dot green" }), "NADA PARA DECIDIR"),
        h("p", { class: "muted", text: "Quando o espantalho travar uma edição, a decisão aparece aqui e no botão DECISÕES da dock." })),
        h("p", { class: "muted small", text: "As sessões ficam a saber na próxima vez que tentarem editar: o espantalho diz-lhes o que decidiste." }),
        h("p", { class: "small" }, h("button", { class: "btn mini", type: "button", onclick: () => this.openCop() }, "VER TODOS OS CRUZAMENTOS"))]);
  },
  openHelp() {
    const item = (k, v) => [h("dt", { text: k }), h("dd", { text: v })];
    this.list("O QUE É O QUÊ", "A quinta mostra as sessões Claude Code abertas nesta máquina. Tudo é clicável.",
      h("dl", { class: "stat-row help" },
        item("UM CLAUDE", "Uma sessão aberta. A trabalhar vai para um talhão e escreve no portátil; em espera passeia; 5 minutos parada, vai dormir no pátio."),
        item("MINI-CLAUDES", "Os sub-agentes de uma sessão, à volta do talhão dela. Quando acabam, a cultura floresce."),
        item("O ESPANTALHO", "O árbitro, no canto do campo. Balança enquanto há sessões a trabalhar e dorme quando estão paradas. Quando duas se cruzam, levanta a bandeira: 🟡 avisa, 🔴 trava. Toca nele para decidir."),
        item("DECISÕES", "Quando o espantalho trava uma edição, és tu que decides: dar o ficheiro a quem o pediu, deixá-lo com quem o tem, ou libertá-lo."),
        item("A BANDEIRA", "Uma sessão envolvida num 🔴."),
        item("AS CARTAS", "Mensagens entre sessões (SendMessage), a voar de um Claude para o outro."),
        item("O CELEIRO", "Os repositórios onde há sessões."),
        item("CHAT", "Com sinaleiro serve --chat: fala com os Claudes que correm no tmux. O que escreves entra no terminal deles; o ECRÃ mostra os pedidos de permissão e os botões respondem."),
        item("TELEMÓVEL", "O QR code para abrir esta quinta no telemóvel, na mesma rede Wi-Fi (só aparece no PC)."),
        item("TECLAS", "+ − 0 câmara · D decisões · R sessões · J mini-Claudes · M correio · X cruzamentos · O ocorrências · N nova · C chat · T telemóvel · ? ajuda"),
        item("ARRASTAR", "Move a câmara; a roda do rato aproxima.")));
  },

  // ------------------------------------------------------------- what's new
  announce(st) {
    const names = (id) => Sin.nameOf(id), l = st.limit;
    if (l?.available && l.resets_at) { // the scarecrow calls out 80 % and 95 %, once per window
      const lvl = l.pct >= 95 ? 95 : l.pct >= 80 ? 80 : 0, key = `${l.resets_at}:${lvl}`;
      if (lvl && Sin.limitSaid !== key && !Sin.first) UI.say(`⏳ ${Math.round(l.pct)}% do limite de 5 horas, renova às ${Sin.hm(l.resets_at)}.` + (l.models?.fable ? " Passar para Opus poupa limite." : " Abranda ou espera pelo reset."));
      if (lvl) Sin.limitSaid = key;
    }
    for (const e of st.events.slice().reverse()) {
      if (e.ts <= Sin.seenEvents) continue;
      if (!Sin.first) {
        if (e.light === "red") UI.say(`🔴 PARA! ${e.session_name.toUpperCase()} queria mexer em ${Sin.base(e.path)}, que está com ${e.other_names.join(", ")}. Toca em DECISÕES para escolher quem fica com ele.`);
        else if (e.light === "yellow") UI.say(`🟡 ${e.session_name.toUpperCase()} e ${e.other_names.join(", ")} andam pelo mesmo sítio (${Sin.base(e.path)}).`);
        else UI.say(this.eventText(e));
        if (e.light === "red") { const c = Sin.critterOf(e.session); if (c) Scene.sparkle(c.x, c.y - 10, 10, "#ff5a52"); }
      }
      Sin.seenEvents = Math.max(Sin.seenEvents, e.ts);
    }
    for (const s of st.sessions) {
      for (const a of s.subagents || []) {
        const was = Sin.seenSubs.get(a.id);
        if (!Sin.first && !was && a.status === "running") UI.say(`${s.name.toUpperCase()} pôs um mini-Claude a trabalhar: ${a.title}.`);
        if (!Sin.first && was === "running" && a.status !== "running") UI.say(`O mini-Claude de ${s.name.toUpperCase()} ${a.status === "failed" ? "falhou" : "acabou"}: ${a.title}.`);
        Sin.seenSubs.set(a.id, a.status);
      }
      for (const m of s.sent || []) {
        const k = s.id + m.ts;
        if (Sin.seenMail.has(k)) continue;
        Sin.seenMail.add(k);
        if (Sin.first) continue;
        if (m.to_id) Sin.flights.push({ from: s.id, to: m.to_id, t0: performance.now() });
        UI.say(`✉ ${s.name.toUpperCase()} escreveu a ${m.to_id ? names(m.to_id).toUpperCase() : m.to}: ${m.summary || "…"}`);
      }
    }
    Sin.first = false;
  },
};

// ----------------------------------------------------------------- the loop
async function poll(once) {
  try {
    const r = await fetch("api/state", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    const st = await r.json();
    $("#offline").hidden = true;
    Sin.raw = st;
    document.body.classList.toggle("remote", !!st.viewer?.remote);
    $(".chat-tool").hidden = !st.viewer?.chat;
    // a red flag waves over every session in a red crossing
    Scene.pendingFor = {};
    for (const k of st.conflicts) if (k.light === "red") for (const id of k.sessions) Scene.pendingFor[id] = 1;
    App.state = Sin.adapt(st);
    reconcile(App.state);
    UI.renderHud(st);
    UI.announce(st);
    const c = UI.summaryKey && Scene.critters.get(UI.summaryKey);
    if (c && $("#dlg-summary").open && !document.activeElement?.closest?.("select")) {
      UI.renderSummary(c);
      if (!c.mini && Date.now() - Sin.detailAt > 5000) UI.loadDetail(c.agent.id);
    }
    if ($("#dlg-talk").open && Date.now() - Sin.detailAt > 5000) UI.loadDetail(UI.talkFor);
    Chat.tick(st);
  } catch (x) {
    $("#offline").hidden = false;
  }
  if (!once) setTimeout(poll, 2000);
}

// ------------------------------------------------------------- the chat (serve --chat)
// One chat for the whole farm: the feed mixes the conversations of the Claudes that run in tmux; what you send is
// typed into the chosen one's terminal (or every one's, with @todos). The ECRÃ is that terminal now: the permission
// prompts aren't in the transcripts, so you read them there and answer with the buttons.
const Chat = {
  to: null, convos: {}, fetchedAt: 0, screenAt: 0,
  live: () => (Sin.raw?.sessions || []).filter((s) => s.chat),
  open(id) {
    if (!Sin.raw?.viewer?.chat) return UI.list("CHAT", "O chat está desligado.",
      [h("p", { text: "Para falares com os Claudes daqui (e do telemóvel), corre o servidor assim:" }),
        h("div", { class: "copy-row" }, h("code", { class: "pre", text: "sinaleiro serve --lan --chat" }), h("button", { class: "btn", type: "button", onclick: () => Sin.copy("sinaleiro serve --lan --chat", "o comando") }, "COPIAR"))]);
    if (id) this.to = id;
    if (!this.to || (this.to !== "*" && !Sin.byId(this.to)?.chat)) this.to = this.live()[0]?.id || null;
    UI.open("dlg-chat");
    this.render(); this.fetchedAt = 0; this.screenAt = 0; this.tick(Sin.raw);
    if (!matchMedia("(pointer: coarse)").matches) $("#chat-text").focus();
  },
  render() {
    const ss = this.live();
    fill($("#chat-to"), ss.map((s) => h("button", { type: "button", role: "radio", "aria-checked": String(this.to === s.id), class: "chip" + (this.to === s.id ? " on" : ""), onclick: () => this.pick(s.id) },
      h("span", { class: "dot" + (Sin.mode(s) === "work" ? "" : " off") }), s.name.toUpperCase())),
      ss.length > 1 ? h("button", { type: "button", role: "radio", "aria-checked": String(this.to === "*"), class: "chip" + (this.to === "*" ? " on" : ""), onclick: () => this.pick("*") }, "@TODOS") : null,
      h("button", { type: "button", class: "chip", onclick: () => this.spawnDlg() }, "+ CLAUDE"));
    const off = (Sin.raw?.sessions || []).filter((s) => !s.chat);
    $("#chat-note").textContent = !ss.length ? "Nenhum Claude no tmux ainda. Abre um com + CLAUDE, ou no PC: tmux new -s nome claude"
      : off.length ? `Fora do chat (não estão no tmux): ${off.map((s) => s.name).join(", ")}.` : "";
    $("#chat-screen-box").hidden = !this.to || this.to === "*";
    $("#chat-screen-who").textContent = this.to && this.to !== "*" ? "· " + Sin.nameOf(this.to) : "";
    fill($("#chat-keys"), [["1", "1"], ["2", "2"], ["3", "3"], ["Enter", "ENTER"], ["Escape", "ESC"], ["Up", "↑"], ["Down", "↓"]].map(([k, l]) =>
      h("button", { class: "btn", type: "button", onclick: () => this.key(k) }, l)));
    this.renderFeed();
  },
  renderFeed() {
    const ids = this.to && this.to !== "*" ? [this.to] : this.live().map((s) => s.id);
    const all = ids.flatMap((id) => (this.convos[id] || []).map((m) => ({ ...m, who: Sin.nameOf(id) }))).sort((a, b) => a.ts - b.ts).slice(-60);
    const feed = $("#chat-feed"), atEnd = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
    fill(feed, all.length ? all.map((m) => {
      const t = UI.turn(m);
      if (ids.length > 1 && m.role !== "user") t.firstChild.textContent = `${m.who.toUpperCase()} · ${t.firstChild.textContent}`;
      if (ids.length > 1 && m.role === "user") t.firstChild.textContent = `TU → ${m.who.toUpperCase()} · ${Sin.ago(m.ts)}`;
      return t;
    }) : h("p", { class: "muted", text: ids.length ? "A carregar a conversa…" : "Sem Claudes no chat." }));
    if (atEnd) feed.scrollTop = feed.scrollHeight;
  },
  pick(id) { this.to = id; this.screenAt = 0; this.render(); this.tick(Sin.raw); },
  async tick(st) {
    if (!$("#dlg-chat").open) return;
    const now = Date.now();
    if (now - this.fetchedAt > 2500) {
      this.fetchedAt = now;
      const ids = this.to && this.to !== "*" ? [this.to] : this.live().map((s) => s.id);
      await Promise.all(ids.map(async (id) => {
        try { const r = await fetch("api/session?id=" + encodeURIComponent(id), { cache: "no-store" }); if (r.ok) this.convos[id] = (await r.json()).convo || []; } catch { /* next tick */ }
      }));
      this.render();
    }
    if (this.to && this.to !== "*" && $("#chat-screen-box").open && now - this.screenAt > 1500) {
      this.screenAt = now;
      try { const r = await fetch("api/screen?id=" + encodeURIComponent(this.to), { cache: "no-store" }); if (r.ok) $("#chat-screen").textContent = (await r.json()).screen || ""; } catch { /* next tick */ }
    }
  },
  target(text) {
    // "@nome resto" sends to that Claude (and makes it the chosen one); "@todos resto" to everyone
    const m = text.match(/^@(\S+)\s+([\s\S]+)$/);
    if (!m) return [this.to, text];
    if (/^(todos|all|\*)$/i.test(m[1])) return ["*", m[2]];
    const s = this.live().find((x) => x.name.toLowerCase() === m[1].toLowerCase());
    return s ? [s.id, m[2]] : [null, text];
  },
  async send(e) {
    e.preventDefault();
    const box = $("#chat-text"), raw = box.value.trim();
    if (!raw) return;
    const [to, text] = this.target(raw);
    if (!to) return UI.say(raw.startsWith("@") ? "Não há nenhum Claude no chat com esse nome." : "Escolhe primeiro para quem é.");
    try {
      const r = await Sin.post("api/say", { session: to, text });
      box.value = ""; if (to !== this.to) this.pick(to);
      UI.say(`Enviado a ${r.sent.map((id) => Sin.nameOf(id)).join(", ")}.`);
      this.fetchedAt = 0; this.screenAt = 0; setTimeout(() => this.tick(Sin.raw), 800);
    } catch (x) { UI.say("Não deu: " + x.message); }
  },
  async key(k) {
    try { await Sin.post("api/say", { session: this.to, key: k }); this.screenAt = 0; setTimeout(() => this.tick(Sin.raw), 400); }
    catch (x) { UI.say("Não deu: " + x.message); }
  },
  spawnDlg() { UI.openNew("", () => this.open()); }, // the same folder walk as + NOVA SESSÃO, back to the chat after
};
$("#chat-form").addEventListener("submit", (e) => Chat.send(e));
$("#chat-text").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); $("#chat-form").requestSubmit(); } });
$("#chat-screen-box").addEventListener("toggle", () => { Chat.screenAt = 0; Chat.tick(Sin.raw); });

UI.bind();
Scene.farm = true;
Scene.init();
UI.say("Bem-vindo à quinta! Cada sessão Claude aberta nesta máquina é um Claude. Toca em qualquer coisa.");
poll();
