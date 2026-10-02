/* The thief: whatever spends your 5-hour limit outside this PC (another computer, the Claude apps), as one red Claude
 * in a dark beanie who doesn't work a plot: he goes to the pond (the farm's tokens) and scoops from it, blue drops
 * flying, while the account's % rises more than this PC's tokens explain (limit.outside_at / outside_recent, from
 * sinaleiro/limits.py). The farm can't tell who it is, so there is one thief, not one per session. He keeps at it
 * while that happened in the last NAP minutes, then slips away. Tapping him (or the pond) opens the limit. */
"use strict";

const Ladrao = {
  ID: "ladrao",
  NAP: 20 * 60, // seconds without outside spend before he leaves
  LOOK: { hat: "beanie", colors: { hat: "#1c2233", band: "#e85b5b", body: "#d63a2f" }, accessory: "glasses" },
  on(l) { return !!(l?.available && l.outside_at && Date.now() / 1000 - l.outside_at < this.NAP); },
};

(() => {
  // on the farm: an agent with nothing to do (no plot), whose walking the pond decides
  const adapt = Sin.adapt;
  Sin.adapt = (st) => {
    const out = adapt(st), l = st.limit;
    if (Ladrao.on(l)) {
      const pct = Math.round(l.outside_recent || 0);
      out.agents.push({ id: Ladrao.ID, name: pct >= 1 ? `ladrão +${pct}%` : "ladrão", loggedIn: true, alive: true,
        up: true, error: false, primary: false, mine: false, resting: false, talking: null, ...Ladrao.LOOK });
    }
    return out;
  };

  // his walk: along the pond's shore (just outside the water), a scoop every couple of seconds while he stands
  const update = Critter.prototype.update;
  Critter.prototype.update = function (dt, world) {
    if (this.agent?.id !== Ladrao.ID) return update.call(this, dt, world);
    const P = world.L.pond;
    this.shoreT = (this.shoreT ?? 0) - dt;
    if (!this.shore || this.shoreT <= 0) {
      const a = Math.PI * (Math.random() < 0.5 ? 0.1 + Math.random() * 0.8 : 1.1 + Math.random() * 0.8);
      this.shore = { x: P.cx + Math.cos(a) * (P.rx + 10), y: P.cy + Math.sin(a) * (P.ry + 8) };
      this.shoreT = 5 + Math.random() * 6;
    }
    const mode = this.mode, home = this.home;
    this.mode = "sleep"; this.home = this.shore; // the engine walks a sleeper to its home: here, the shore
    update.call(this, dt, world);
    this.mode = mode; this.home = home;
    if (!this.moving) {
      this.dir = this.x < P.cx ? 1 : -1; // facing the water
      this.scoopT = (this.scoopT ?? 1) - dt;
      if (this.scoopT <= 0 && !REDUCED) { Scene.sparkle(this.x + this.dir * 7, this.y - 3, 5, "#5aa9e6"); this.scoopT = 1.6 + Math.random(); }
    }
  };

  const open = UI.openCritter.bind(UI);
  UI.openCritter = (c) => (c?.agent?.id === Ladrao.ID ? UI.openLimit() : open(c));

  // the pond knows who's at it
  const hit = window.sinaleiroHit;
  window.sinaleiroHit = (p) => {
    const r = hit?.(p), l = Sin.raw?.limit, pd = Scene.world?.L?.pond;
    if (r && pd && Ladrao.on(l) && ((p.x - pd.cx) / pd.rx) ** 2 + ((p.y - pd.cy) / pd.ry) ** 2 < 1)
      return { extra: () => UI.say(`🦝 Um ladrão anda a tirar tokens do lago: +${Math.round(l.outside_recent || 0)}% do teu limite na última meia hora, fora deste PC. Toca nele para ver o limite.`) };
    return r;
  };
})();
