/* Sliders, filter thumbnails, the whole-photo / selection switch and Reset. */
import {
  $, state, activePreset, zero, KEYS, CONTROLS, PRESETS,
  type ControlItem, type ParamSet, type Params, type Target,
} from "../state";
import { onFlush, pushEntry } from "../history";
import { draw, renderPixels, toImageData } from "../render/gl";
import { scheduleHist } from "./histogram";
import { drawOverlay } from "../features/select/select";

export { CONTROLS, PRESETS };

const inputs: Record<string, { el: HTMLInputElement; sync: () => void }> = {};

function fmt(item: ControlItem, v: number) {
  if (item.unit === "EV") return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2) + " EV";
  const u = item.unit || "";
  return v > 0 ? "+" + v + u : v < 0 ? "−" + Math.abs(v) + u : "0" + u;
}
function paintTrack(item: ControlItem, el: HTMLInputElement) {
  if (item.cls) return;
  const t = (v: number) => ((v - item.min) / (item.max - item.min)) * 100;
  const a = Math.min(t(0), t(+el.value)), b = Math.max(t(0), t(+el.value));
  el.style.setProperty("--trk", `linear-gradient(90deg, var(--track) ${a}%, var(--accent) ${a}%, var(--accent) ${b}%, var(--track) ${b}%)`);
}

let rafPending = false;
export function requestDraw() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; draw(); scheduleHist(); });
}

export function syncSliders() {
  const p = state.params[state.target];
  KEYS.forEach(k => { inputs[k].el.value = String(p[k]); inputs[k].sync(); });
  // Vignette frames the whole photo, so it only exists on the whole-photo set.
  inputs.vignette.el.disabled = state.target === "local";
  inputs.sharpen.el.disabled = state.target === "local";
}

export function applyParams(p: Partial<ParamSet>) {
  state.params[state.target] = { ...zero(), ...p };
  if (state.target === "local") { state.params.local.vignette = 0; state.params.local.sharpen = 0; }
  syncSliders();
  requestDraw();
}

/* ---------- History ---------- */
export type AdjustSnapshot = { params: Params; preset: Record<Target, number>; target: Target };
export const snapshotAdjust = (): AdjustSnapshot =>
  ({ params: structuredClone(state.params), preset: { ...activePreset }, target: state.target });
export function restoreAdjust(s: AdjustSnapshot) {
  state.params = structuredClone(s.params);
  Object.assign(activePreset, s.preset);
  adjustBefore = null;
  setTarget(s.target);
  syncSliders(); markPreset(); renderThumbs(); requestDraw();
}
/* A slider drag is one step: the state before its first move, committed when it is released. */
let adjustBefore: AdjustSnapshot | null = null;
export function beginAdjust() { adjustBefore ??= snapshotAdjust(); }
export function dropAdjust() { adjustBefore = null; }
export function commitAdjust(label: string) {
  const before = adjustBefore;
  adjustBefore = null;
  if (!before) return;
  const after = snapshotAdjust();
  if (JSON.stringify([before.params, before.preset]) === JSON.stringify([after.params, after.preset])) return;
  pushEntry({ label, bytes: 0, undo: () => restoreAdjust(before), redo: () => restoreAdjust(after) });
}

/* ---------- Filters ---------- */
let filterBtns: HTMLButtonElement[] = [];
export function markPreset() {
  filterBtns.forEach((b, i) => b.setAttribute("aria-pressed", String(i === activePreset[state.target])));
}
/* Thumbnails preview each filter on whatever the sliders currently target. */
export function renderThumbs() {
  const { img, params, target } = state;
  if (!img.w || !filterBtns.length) return;
  const tw = 148, th = Math.max(1, Math.min(220, Math.round(tw * img.h / img.w)));
  PRESETS.forEach((preset, i) => {
    const cv = filterBtns[i].querySelector("canvas") as HTMLCanvasElement;
    cv.width = tw; cv.height = th;
    const p = { ...params, [target]: { ...zero(), ...preset.p } };
    cv.getContext("2d")!.putImageData(toImageData(renderPixels(p, tw, th), tw, th), 0, 0);
  });
  markPreset();
}

/* ---------- Adjust target: whole photo or selection ---------- */
const tgtGlobal = $<HTMLButtonElement>("tgtGlobal"), tgtLocal = $<HTMLButtonElement>("tgtLocal");
export function setTarget(t: Target) {
  if (t === "local" && !state.sel.has) t = "global";
  if (t === state.target) return;
  state.target = t;
  tgtGlobal.setAttribute("aria-pressed", String(t === "global"));
  tgtLocal.setAttribute("aria-pressed", String(t === "local"));
  syncSliders(); renderThumbs(); drawOverlay();
}

export function initAdjustments() {
  const controlsEl = $("controls");
  CONTROLS.forEach(group => {
    const block = document.createElement("div");
    block.className = "block";
    block.innerHTML = `<h2 class="section-title">${group.group}</h2>`;
    group.items.forEach(item => {
      const row = document.createElement("div");
      row.className = "ctl";
      const id = "ctl-" + item.key;
      row.innerHTML = `<div class="ctl-head"><label for="${id}" title="Double-click to reset">${item.label}</label><output for="${id}"></output></div>
      <input type="range" id="${id}" min="${item.min}" max="${item.max}" step="${item.step}" value="0" class="${item.cls || ""}">`;
      const el = row.querySelector("input") as HTMLInputElement, out = row.querySelector("output") as HTMLOutputElement;
      const sync = () => { out.textContent = fmt(item, +el.value); row.classList.toggle("changed", +el.value !== 0); paintTrack(item, el); };
      el.addEventListener("input", () => { beginAdjust(); state.params[state.target][item.key] = +el.value; activePreset[state.target] = -1; markPreset(); sync(); requestDraw(); });
      el.addEventListener("change", () => commitAdjust(item.label));
      (row.querySelector("label") as HTMLLabelElement).addEventListener("dblclick", () => { if (el.disabled) return; beginAdjust(); el.value = "0"; state.params[state.target][item.key] = 0; activePreset[state.target] = -1; markPreset(); sync(); requestDraw(); commitAdjust(item.label); });
      inputs[item.key] = { el, sync };
      sync();
      block.appendChild(row);
    });
    controlsEl.appendChild(block);
  });

  const filtersEl = $("filters");
  filterBtns = PRESETS.map((preset, i) => {
    const btn = document.createElement("button");
    btn.className = "filter"; btn.type = "button";
    btn.innerHTML = `<canvas width="148" height="108"></canvas><span>${preset.name}</span>`;
    btn.addEventListener("click", () => { beginAdjust(); activePreset[state.target] = i; markPreset(); applyParams(preset.p); commitAdjust(preset.name); });
    filtersEl.appendChild(btn);
    return btn;
  });

  tgtGlobal.addEventListener("click", () => setTarget("global"));
  tgtLocal.addEventListener("click", () => setTarget("local"));

  $("reset").addEventListener("click", () => {
    beginAdjust();
    state.params = { global: zero(), local: zero() };
    activePreset.global = activePreset.local = 0;
    markPreset(); syncSliders(); renderThumbs(); requestDraw();
    commitAdjust("Reset all");
  });
  onFlush(() => commitAdjust("Adjustment"));
}
