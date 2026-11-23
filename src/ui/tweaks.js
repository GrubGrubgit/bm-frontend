// src/ui/tweaks.js -- cheats panel (Blaster Master RAM cheats).
// Built dynamically by app.js L6 wiring (no index.html change). Per-frame
// pins run via the host cheatsApply hook while the engine is suspended in
// host_frame; one-shot writes go straight through the bm_ram_wr export.
// Wasm engine only (MesenHost has no RAM exports). All addresses verified
// against recomp/gen/combined_off.c + ROM tables (see CURRENT_TASK.md).
export const cheatState = {
  pinLives: false, lives: 2,
  pinCont: false, cont: 5,
  invincible: false,
  ammoH: 0, ammoL: 0, ammoM: 0, pinAmmo: false,
  pinHover: false,
  gunSel: 7, gunLock: false,
  upgrades99: 0,
};
// Tank-part names for 9 bits (pause-overlay names); SPIKE 0 is dead.
const PARTS = [
  ["HOVER", 0x01], ["DIVE", 0x02], ["WALL1", 0x04], ["WALL2", 0x08],
  ["CRUSHER", 0x10], ["SPIKE*", 0x20], ["HYPER", 0x40], ["KEY", 0x80],
];
// Boss-grant link: 9 bit -> FC bit (L_BF8A per area, via b4_9FF1).
const FC_LINK = { 0x40: 0x01, 0x10: 0x02, 0x01: 0x04, 0x80: 0x08, 0x02: 0x10, 0x04: 0x20, 0x08: 0x40 };
export function applyTweaks(ex) {
  if (!ex || !ex.bm_ram_wr) return;
  const s = cheatState;
  if (s.pinLives) ex.bm_ram_wr(0xDD, s.lives);
  if (s.pinCont) ex.bm_ram_wr(0x37E, s.cont);
  if (s.invincible) ex.bm_ram_wr(0x7E, 0);
  if (s.pinHover) ex.bm_ram_wr(0x92, 0xFF);
  if (s.pinAmmo) { ex.bm_ram_wr(0x6F0, 99); ex.bm_ram_wr(0x6F1, 99); ex.bm_ram_wr(0x6F2, 99); }
  if (s.gunLock) ex.bm_ram_wr(0xC3, s.gunSel);
}
function numInput(parent, label, value, min, max, onSet) {
  const lab = document.createElement("label");
  lab.textContent = label + " ";
  const inp = document.createElement("input");
  inp.type = "number"; inp.min = String(min); inp.max = String(max);
  inp.value = String(value); inp.style.width = "56px";
  inp.addEventListener("change", () => {
    let v = Math.round(Number(inp.value));
    if (!(v >= min)) v = min;
    if (v > max) v = max;
    inp.value = String(v);
    onSet(v);
  });
  lab.appendChild(inp);
  parent.appendChild(lab);
  return inp;
}
function checkBox(parent, label, value, onSet) {
  const lab = document.createElement("label");
  const inp = document.createElement("input");
  inp.type = "checkbox"; inp.checked = !!value;
  inp.addEventListener("change", () => onSet(!!inp.checked));
  lab.appendChild(inp);
  lab.appendChild(document.createTextNode(" " + label));
  parent.appendChild(lab);
  return inp;
}
function btn(parent, label, onClick) {
  const b = document.createElement("button");
  b.textContent = label;
  b.addEventListener("click", () => { try { onClick(); } catch (e) {} });
  parent.appendChild(b);
  return b;
}
function row(parent) {
  const d = document.createElement("div");
  d.className = "shellRow";
  parent.appendChild(d);
  return d;
}
export function buildTweaksPanel(env) {
  const log = env.log || (() => {});
  const ram = () => { try { return env.ram() || null; } catch (e) { return null; } };
  const anchor = document.getElementById("logEl");
  if (!anchor) { log("tweaks: logEl missing"); return; }
  const det = document.createElement("details");
  det.id = "tweaksCtn";
  const sum = document.createElement("summary");
  sum.textContent = "Tweaks (cheats, wasm engine only)";
  sum.style.cssText = "cursor:pointer;padding:8px;background:#223;font-size:16px";
  det.appendChild(sum);
  const s = cheatState;
  let r = row(det);
  const livesInp = numInput(r, "lives", s.lives, 0, 99, (v) => { s.lives = v; });
  btn(r, "Set", () => { const ex = ram(); if (!ex) return log("tweaks: start the game first (wasm)"); ex.bm_ram_wr(0xDD, s.lives); log("tweaks: lives=" + s.lives); });
  checkBox(r, "unlimited", s.pinLives, (v) => { s.pinLives = v; s.lives = Math.round(Number(livesInp.value)); log("tweaks: unlimited lives " + (v ? "on" : "off")); });
  r = row(det);
  const contInp = numInput(r, "continues", s.cont, 0, 9, (v) => { s.cont = v; });
  btn(r, "Set", () => { const ex = ram(); if (!ex) return log("tweaks: start the game first (wasm)"); ex.bm_ram_wr(0x37E, s.cont); log("tweaks: continues=" + s.cont); });
  checkBox(r, "unlimited", s.pinCont, (v) => { s.pinCont = v; s.cont = Math.round(Number(contInp.value)); log("tweaks: unlimited continues " + (v ? "on" : "off")); });
  r = row(det);
  checkBox(r, "invincible (no contact damage)", s.invincible, (v) => { s.invincible = v; log("tweaks: invincible " + (v ? "on" : "off")); });
  r = row(det);
  const aH = numInput(r, "homing", s.ammoH, 0, 99, (v) => { s.ammoH = v; });
  const aL = numInput(r, "lightning", s.ammoL, 0, 99, (v) => { s.ammoL = v; });
  const aM = numInput(r, "multi", s.ammoM, 0, 99, (v) => { s.ammoM = v; });
  btn(r, "Set", () => {
    const ex = ram(); if (!ex) return log("tweaks: start the game first (wasm)");
    s.ammoH = Math.round(Number(aH.value)); s.ammoL = Math.round(Number(aL.value)); s.ammoM = Math.round(Number(aM.value));
    ex.bm_ram_wr(0x6F0, s.ammoH); ex.bm_ram_wr(0x6F1, s.ammoL); ex.bm_ram_wr(0x6F2, s.ammoM);
    log("tweaks: ammo=" + s.ammoH + "/" + s.ammoL + "/" + s.ammoM);
  });
  checkBox(r, "unlimited (99)", s.pinAmmo, (v) => { s.pinAmmo = v; log("tweaks: unlimited ammo " + (v ? "on" : "off")); });
  r = row(det);
  checkBox(r, "unlimited hover energy", s.pinHover, (v) => { s.pinHover = v; log("tweaks: unlimited hover " + (v ? "on" : "off")); });
  r = row(det);
  const glab = document.createElement("label");
  glab.textContent = "gun ";
  const gsel = document.createElement("select");
  for (let g = 0; g <= 7; g++) { const o = document.createElement("option"); o.value = String(g); o.textContent = String(g); gsel.appendChild(o); }
  gsel.value = String(s.gunSel);
  gsel.addEventListener("change", () => { s.gunSel = Math.round(Number(gsel.value)); });
  glab.appendChild(gsel);
  r.appendChild(glab);
  btn(r, "Set", () => { const ex = ram(); if (!ex) return log("tweaks: start the game first (wasm)"); ex.bm_ram_wr(0xC3, s.gunSel); log("tweaks: gun=" + s.gunSel); });
  checkBox(r, "lock (no loss on damage)", s.gunLock, (v) => { s.gunLock = v; log("tweaks: gun lock " + (v ? "on" : "off")); });
  r = row(det);
  const ulab = document.createElement("span");
  ulab.textContent = "tank: ";
  r.appendChild(ulab);
  const boxes = [];
  for (const pair of PARTS) {
    const lab = document.createElement("label");
    const inp = document.createElement("input");
    inp.type = "checkbox";
    lab.appendChild(inp);
    lab.appendChild(document.createTextNode(pair[0]));
    lab.title = "$" + pair[1].toString(16).toUpperCase();
    r.appendChild(lab);
    boxes.push([pair[1], inp]);
  }
  const applyUp = () => {
    const ex = ram(); if (!ex) { log("tweaks: start the game first (wasm)"); return; }
    let m = 0, fc = 0;
    for (const pr of boxes) { if (pr[1].checked) { m |= pr[0]; if (FC_LINK[pr[0]]) fc |= FC_LINK[pr[0]]; } }
    s.upgrades99 = m;
    ex.bm_ram_wr(0x99, m);
    ex.bm_ram_wr(0x3FC, (ex.bm_ram_rd(0x3FC) | fc) & 0xFF);
    log("tweaks: tank=$" + m.toString(16));
  };
  btn(r, "Apply tank", applyUp);
  btn(r, "All", () => { for (const pr of boxes) pr[1].checked = (pr[0] !== 0x20); applyUp(); });
  btn(r, "Clear", () => { for (const pr of boxes) pr[1].checked = false; applyUp(); });
  r = row(det);
  const wlab = document.createElement("span");
  wlab.textContent = "warp: ";
  r.appendChild(wlab);
  for (let a = 1; a <= 8; a++) {
    ((area) => btn(r, "A" + area, () => {
      if (env.engine && env.engine() !== "wasm") return log("tweaks: warp needs the wasm engine");
      try { env.warp(area - 1); log("tweaks: warp area " + area + " (load resets lives to 2; pins re-apply)"); }
      catch (e) { log("tweaks: warp err " + String((e && e.message) || e).slice(0, 80)); }
    }))(a);
  }
  anchor.before(det);
  return det;
}
