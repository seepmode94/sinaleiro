/* Vendored from clodfarm (MIT, see vendor/engine.js for the notice): the look picker, clodfarm/ui/app.js lines 3069-3177. */
"use strict";
const Picker = {
  /** A Claude's look: a live preview on a patch of meadow, hats as tiles, one palette for the hat, band and body colours
   * (pick what to paint, then the colour), accessories as tiles, and SURPRISE ME. Every group is a radio group: arrow keys
   * move and pick. `onChange` gets {hat, colors: {hat, band, body}, accessory} (what POST /api/agents and SETTINGS take
   * as `skin`). */
  skinPicker(start, onChange) {
    const s = { hat: start.hat || "straw", colors: { ...start.colors }, accessory: start.accessory || "" };
    let target = "hat", hopUntil = 0, sparkUntil = 0;
    const skinNow = () => skinOf(s.hat, s.colors, s.accessory);
    // the preview: it walks, looks round, blinks; it hops when you change something
    const stage = h("canvas", { class: "skin-stage", role: "img" }), comp = canvas(48, 44), cg = comp.getContext("2d");
    const caption = h("p", { class: "skin-caption", "aria-live": "polite" });
    const t0 = performance.now();
    const drawStage = () => {
      const now = performance.now(), t = (now - t0) / 1000, cyc = t % 7, hop = now < hopUntil, walk = [1, 0, 2, 0][Math.floor(t * 9) % 4];
      const pose = hop ? { arms: Math.floor(t * 7) % 2 ? 1 : 0, happy: true } : REDUCED ? {}
        : cyc < 1.2 ? { legs: walk, look: 1 } : cyc < 2.4 ? { look: 1 } : cyc < 2.55 ? { blink: true } : cyc < 3.6 ? {} : cyc < 4.6 ? { look: -1 } : cyc < 5.6 ? { legs: walk, look: -1 } : cyc < 5.75 ? { blink: true } : {};
      const lift = hop ? Math.round(Math.abs(Math.sin(t * 10)) * 4) : !REDUCED && Math.sin(t * 2.2) > 0.75 ? 1 : 0;
      cg.clearRect(0, 0, 48, 44);
      cg.globalAlpha = 0.3; cg.drawImage(shadowSprite(8, 2), 23 - 8 - 1 + 1, 44 - 6); cg.globalAlpha = 1;
      cg.drawImage(skinFrameHD(skinNow(), pose), 8, 44 - 36 - 3 - lift);
      if (now < sparkUntil) for (let i = 0; i < 4; i++) { const a = t * 3 + i * 1.57; cg.drawImage(SPARKLE[i], Math.round(21 + Math.cos(a) * 18), Math.round(18 + Math.sin(a) * 13)); }
      paintSprite(stage, comp, stage.clientWidth || 176, { bg: tileBg, bottom: true, fixed: true });
    };
    clearInterval(this.previewT);
    this.previewT = setInterval(() => { if (!stage.isConnected) return clearInterval(this.previewT); drawStage(); }, REDUCED ? 400 : 90);
    requestAnimationFrame(drawStage);
    // the tiles: little canvases painted from the skin they'd give
    const art = (cls) => h("canvas", { class: "tile-art " + cls, "aria-hidden": "true" }), phone = innerWidth < 760, hatCss = phone ? 48 : 64, accCss = phone ? 56 : 72;
    const headCrop = (sk) => { const c = canvas(32, 27); c.getContext("2d").drawImage(skinFrameHD(sk, {}), 0, -1); return c; };
    const hats = this.radioGrid("Hat", Object.keys(HATS), () => s.hat, (v) => { if (s.hat !== v && !start.keepBand) s.colors.band = HATS[v].band; s.hat = v; changed(); }, {
      build: (v) => [art("hat-art"), h("span", { class: "tile-lbl", text: HAT_NAMES[v] })], label: (v) => `${HAT_NAMES[v].toLowerCase()} hat`,
      paint: (b, v) => { const sk = skinOf(v, s.colors, ""); if (b._k !== sk.key) { b._k = sk.key; paintSprite(b.firstChild, headCrop(sk), hatCss); } } }, "hat");
    const accs = this.radioGrid("Extra", ACCESSORIES, () => s.accessory, (v) => { s.accessory = v; changed(); }, {
      build: (v) => [art("acc-art"), h("span", { class: "tile-lbl", text: ACC_NAMES[v] })], label: (v) => ACC_NAMES[v].toLowerCase(),
      paint: (b, v) => { const sk = skinOf(s.hat, s.colors, v); if (b._k !== sk.key) { b._k = sk.key; paintSprite(b.firstChild, skinFrameHD(sk, {}), accCss); } } }, "acc");
    // colours: what to paint, then one palette
    const TARGETS = [["hat", "HAT"], ["band", "BAND"], ["body", "BODY"]];
    const chipOf = {};
    const targets = this.radioGrid("Paint", TARGETS.map(t => t[0]), () => target, (v) => { if (v === "hat" && s.hat === "none") return; target = v; drawPalette(); targets.refresh(); }, {
      build: (v) => [(chipOf[v] = h("i", { class: "chip-swatch", "aria-hidden": "true" })), h("span", { text: TARGETS.find(t => t[0] === v)[1] })], label: (v) => `paint the ${v}`,
      paint: (b, v) => { chipOf[v].style.background = s.colors[v]; b.disabled = v === "hat" && s.hat === "none"; } }, "target");
    const paletteBox = h("div", { class: "palette-box" });
    let palette = null;
    const drawPalette = () => {
      const list = target === "body" ? BODY_TINTS : SWATCHES, names = target === "body" ? BODY_NAMES : SWATCH_NAMES, cur = s.colors[target];
      const values = list.includes(cur) || !HEX.test(cur || "") ? list : [cur, ...list];
      palette = this.radioGrid(`${target} colour`, values, () => s.colors[target], (v) => { s.colors[target] = v; changed(); }, {
        build: (v) => { const i = h("i", { "aria-hidden": "true" }); i.style.background = v; return [i]; },
        label: (v) => `${target} ${names[list.indexOf(v)] || "custom colour"}` }, "swatch");
      fill(paletteBox, palette.el);
      palette.refresh();
    };
    const surprise = h("button", { type: "button", class: "btn surprise" }, h("img", { src: icon("dice"), alt: "" }), "SURPRISE ME");
    surprise.addEventListener("click", () => {
      const r = Math.random, pick = (a) => a[Math.floor(r() * a.length)];
      s.hat = r() < 0.05 ? "none" : pick(Object.keys(HATS).filter(x => x !== "none"));
      const hc = pick(SWATCHES);
      s.colors = { hat: hc, band: pick(SWATCHES.filter(c => c !== hc)), body: r() < 0.5 ? CLAY.b : pick(BODY_TINTS) };
      s.accessory = r() < 0.4 ? "" : pick(ACCESSORIES.slice(1));
      if (s.hat === "none" && target === "hat") target = "band";
      sparkUntil = performance.now() + 900;
      changed(); drawPalette();
    });
    const describe = () => {
      const nm = (list, names, c) => names[list.indexOf(String(c).toLowerCase())] || "custom";
      const hn = nm(SWATCHES, SWATCH_NAMES, s.colors.hat);
      const hatTxt = s.hat === "none" ? "No hat" : `${HAT_NAMES[s.hat][0]}${HAT_NAMES[s.hat].slice(1).toLowerCase()} in ${hn === "custom" ? "a custom colour" : hn}`;
      return `${hatTxt}, ${nm(SWATCHES, SWATCH_NAMES, s.colors.band)} trim, ${nm(BODY_TINTS, BODY_NAMES, s.colors.body)} body${s.accessory ? ", " + ACC_NAMES[s.accessory].toLowerCase() : ""}.`;
    };
    const changed = () => {
      if (s.hat === "none" && target === "hat") { target = "band"; drawPalette(); }
      onChange({ hat: s.hat, colors: { ...s.colors }, accessory: s.accessory });
      hats.refresh(); accs.refresh(); targets.refresh(); palette?.refresh();
      caption.textContent = describe();
      stage.setAttribute("aria-label", "Preview: " + describe());
      hopUntil = performance.now() + 650;
    };
    drawPalette();
    changed(); hopUntil = 0;
    return h("div", { class: "skin" },
      h("div", { class: "skin-left" }, stage, caption, surprise),
      h("div", { class: "skin-right" },
        h("p", { class: "skin-h", text: "CHAPÉU" }), hats.el,
        h("p", { class: "skin-h", text: "CORES" }), targets.el, paletteBox,
        h("p", { class: "skin-h", text: "EXTRA" }), accs.el));
  },
  /** Tiles that act as radio buttons: click or arrow keys pick; only the picked one is in the tab order. */
  radioGrid(label, values, get, set, { build, paint, label: aria }, kind) {
    const btns = values.map(v => {
      const b = h("button", { type: "button", role: "radio", class: `tile ${kind}-tile`, "aria-label": aria ? aria(v) : String(v) }, build(v));
      b.addEventListener("click", () => set(v));
      return b;
    });
    const el = h("div", { class: `tiles ${kind}-grid`, role: "radiogroup", "aria-label": label }, btns);
    el.addEventListener("keydown", (e) => {
      const i = btns.indexOf(document.activeElement); if (i < 0) return;
      const cols = Math.max(1, getComputedStyle(el).gridTemplateColumns.split(" ").length);
      const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -i, End: btns.length - 1 - i }[e.key];
      if (d == null) return;
      e.preventDefault();
      let j = clamp(i + d, 0, btns.length - 1);
      while (btns[j].disabled && j !== i) j = clamp(j + Math.sign(d), 0, btns.length - 1);
      btns[j].focus(); set(values[j]);
    });
    const refresh = () => btns.forEach((b, i) => { paint?.(b, values[i]); const on = values[i] === get(); b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; b.classList.toggle("on", on); });
    refresh();
    return { el, refresh };
  },

};
