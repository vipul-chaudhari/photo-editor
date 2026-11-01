/* Background removal: ormbg in its own background thread, plus the four background modes. */
import { $, state, BG } from "../../state";
import { uploadMatte, uploadForeground, originalRGB } from "../../render/gl";
import { renderThumbs, requestDraw, setTarget } from "../../ui/adjustments";
import { toast } from "../../ui/toast";
import { cleanMatte, tightenMatte, estimateForeground } from "./cleanMatte";
import { releaseSam } from "../models";
import { refresh, resetCurrentObject, recordSelection } from "../select/select";
import { onBusyCheck, onFlush, pushEntry } from "../../history";
import { MODEL_BASE } from "../../modelHost";

// The v6 comparison test turns clean edges off, so it can keep checking everything else against v6.
BG.cleanEdges = !new URLSearchParams(location.search).has("v6matte");


const bgBtn = $<HTMLButtonElement>("bgRemove"), bgStatus = $("bgStatus"), bgText = $("bgText"),
      bgMeter = $("bgMeter"), bgOptions = $("bgOptions");

export type Matte = { data: Uint8Array; w: number; h: number; fg?: Uint8Array };
/* Makes this matte the one in use. Its subject colours come from the current pixels, so set the photo first. */
export function useMatte(M: Matte) {
  bgw.matte = M;
  uploadMatte(M.data, M.w, M.h);
  if (!BG.cleanEdges) return;
  M.fg ??= estimateForeground(originalRGB(M.w, M.h), M.data, M.w, M.h);
  uploadForeground(M.fg, M.w, M.h);
}

export const bgw = {
  worker: null as Worker | null,
  state: "off",
  files: {} as Record<string, { loaded?: number; total?: number }>,
  doneId: -1,
  runningId: -1,
  matte: null as Matte | null,
};
let bgSeg: HTMLElement[] = [];

/* History. The matte is never changed once made, so steps share it and redo never reruns the model. */
export type BgSnapshot = { mode: number; hex: string; blur: number; matte: typeof bgw.matte };
export const snapshotBackground = (): BgSnapshot =>
  ({ mode: BG.mode, hex: $<HTMLInputElement>("bgColor").value, blur: BG.blur, matte: bgw.matte });
export function restoreBackground(s: BgSnapshot) {
  BG.pendingMode = 0; bgBefore = null;
  if (!s.matte) resetBackground();
  else {
    if (bgw.matte !== s.matte) useMatte(s.matte);
    bgw.doneId = state.imageId;
    bgBtn.hidden = true; bgBtn.disabled = false;
    bgOptions.hidden = false;
  }
  setBgColor(s.hex);
  BG.blur = s.blur;
  $<HTMLInputElement>("bgBlur").value = String(s.blur); $("bgBlurOut").textContent = String(s.blur);
  setBgMode(s.mode);
}
let bgBefore: BgSnapshot | null = null;
function beginBg() { bgBefore ??= snapshotBackground(); }
function commitBg(label: string) {
  const before = bgBefore;
  bgBefore = null;
  if (!before) return;
  const after = snapshotBackground();
  if (before.mode === after.mode && before.hex === after.hex && before.blur === after.blur && before.matte === after.matte) return;
  pushEntry({
    label, bytes: before.matte === after.matte ? 0 : (after.matte?.data.length || 0),
    undo: () => restoreBackground(before), redo: () => restoreBackground(after),
  });
}
/* Called with the new background once the matte rerun that follows an erase has finished. */
export const bgHooks = { afterRerun: null as ((s: BgSnapshot) => void) | null };

function setBgStatus(text: string | null, mode?: string) {
  bgStatus.hidden = !text;
  bgText.textContent = text || "";
  bgStatus.classList.toggle("err", mode === "err");
  bgMeter.hidden = !(mode === "bar" || mode === "spin");
  bgMeter.classList.toggle("indeterminate", mode === "spin");
}
const bgBar = (pct: string) => (bgMeter.firstElementChild as HTMLElement).style.width = pct;

function startBgWorker() {
  releaseSam();
  if (bgw.worker) return true;
  bgw.files = {};
  try {
    bgw.worker = new Worker(new URL("./ormbg.worker.ts", import.meta.url), { type: "module" });
  } catch (e) { bgFail((e as Error).message); return false; }
  bgw.worker.onmessage = onBg;
  bgw.worker.onerror = e => { e.preventDefault(); bgFail(e.message || "worker failed to start"); };
  bgw.state = "loading";
  bgw.worker.postMessage({ type: "load", modelBase: MODEL_BASE });
  setBgStatus("Downloading the background model…", "bar");
  bgBar("0%");
  return true;
}

function bgFail(why: string) {
  if (bgw.worker) { bgw.worker.terminate(); bgw.worker = null; }
  bgw.state = "off"; bgw.runningId = -1; BG.pendingMode = 0;
  bgBtn.disabled = false;
  setBgStatus("Couldn't load the background model. Check your internet connection, then try again." + (why ? " Details: " + why : ""), "err");
}

function onBg(e: MessageEvent) {
  const m = e.data;
  if (m.type === "progress") {
    bgw.files[m.file] = m;
    let L = 0, T = 0;
    for (const f of Object.values(bgw.files)) { L += f.loaded || 0; T += f.total || 0; }
    if (T) { bgBar(Math.round(L / T * 100) + "%"); bgText.textContent = `Downloading the background model… ${(L / 1048576).toFixed(0)} of ${(T / 1048576).toFixed(0)} MB`; }
  } else if (m.type === "ready") {
    bgw.state = "ready";
    $("bgTag").textContent = "ormbg · " + (m.gpu ? "GPU" : "CPU");
    runMatte();
  } else if (m.type === "matte") {
    if (m.id !== state.imageId) return;
    bgw.runningId = -1; bgw.doneId = m.id;
    // Free the model's graphics memory straight away; it reloads from the browser cache if needed again.
    if (bgw.worker) { bgw.worker.terminate(); bgw.worker = null; bgw.state = "off"; }
    const clean = cleanMatte(m.data, m.w, m.h);
    useMatte({ data: BG.cleanEdges ? tightenMatte(clean, m.w, m.h) : clean, w: m.w, h: m.h });
    setBgStatus(null);
    bgBtn.hidden = true; bgBtn.disabled = false;
    bgOptions.hidden = false;
    const rerun = BG.pendingMode > 0;
    setBgMode(BG.pendingMode || 1);
    BG.pendingMode = 0;
    if (rerun) bgHooks.afterRerun?.(snapshotBackground());
    else commitBg("Remove background");
    toast(`Background removed in ${(m.ms / 1000).toFixed(1)} s.`);
  } else if (m.type === "error") {
    if (m.stage === "load") bgFail(m.message);
    else { bgw.runningId = -1; BG.pendingMode = 0; bgBtn.disabled = false; setBgStatus("Couldn't remove the background from this photo. (" + m.message + ")", "err"); }
  }
}

export function runMatte() {
  const { img } = state;
  if (bgw.state !== "ready" || !img.w || bgw.doneId === state.imageId || bgw.runningId === state.imageId) return;
  bgw.runningId = state.imageId;
  // The model resizes to 1024x1024 itself; send at most 1024 px on the long side.
  const s = Math.min(1, 1024 / Math.max(img.w, img.h));
  const w = Math.max(1, Math.round(img.w * s)), h = Math.max(1, Math.round(img.h * s));
  const rgb = originalRGB(w, h);
  bgw.worker!.postMessage({ type: "run", id: state.imageId, w, h, rgb }, [rgb.buffer]);
  setBgStatus(bgw.state === "ready" && $("bgTag").textContent!.endsWith("CPU")
    ? "Finding the subject on the CPU. This takes about 10 seconds." : "Finding the subject…", "spin");
}

function setBgMode(n: number) {
  BG.mode = n;
  bgSeg.forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.bg! === n)));
  $("bgColorRow").hidden = n !== 2;
  $("bgBlurRow").hidden = n !== 3;
  renderThumbs(); requestDraw();
}

const hexToRgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
function setBgColor(hex: string) {
  BG.color = hexToRgb(hex);
  $<HTMLInputElement>("bgColor").value = hex;
  $("bgColorOut").textContent = hex.toUpperCase();
  requestDraw();
}

export function resetBackground() {
  bgw.doneId = -1; bgw.matte = null; bgBefore = null;
  uploadMatte(new Uint8Array([255]), 1, 1);
  BG.mode = 0;
  bgSeg.forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.bg! === 0)));
  bgOptions.hidden = true; bgBtn.hidden = false; bgBtn.disabled = false;
  if (bgw.runningId !== -1) setBgStatus(null);
}

/* The eraser changed the pixels: redo the matte if one had been made. */
export function rerunMatteAfterEdit() {
  if (!bgw.matte) return;
  const prev = BG.mode;
  resetBackground();
  if (prev > 0) { BG.pendingMode = prev; bgBtn.disabled = true; if (startBgWorker()) runMatte(); }
}

export function initBackground() {
  bgSeg = [...document.querySelectorAll<HTMLElement>("#bgOptions [data-bg]")];

  bgBtn.addEventListener("click", () => {
    beginBg();
    bgBtn.disabled = true;
    if (startBgWorker()) runMatte();
  });
  bgSeg.forEach(b => b.addEventListener("click", () => { beginBg(); setBgMode(+b.dataset.bg!); commitBg("Background mode"); }));

  ["#ffffff", "#000000", "#e9e4d8", "#d8e4f0", "#2f5d50", "#c0392b", "#f2b134"].forEach(hex => {
    const b = document.createElement("button");
    b.type = "button"; b.style.background = hex; b.title = hex; b.setAttribute("aria-label", "Background colour " + hex);
    b.addEventListener("click", () => { beginBg(); setBgColor(hex); commitBg("Background colour"); });
    $("swatches").appendChild(b);
  });
  $("bgColor").addEventListener("input", e => { beginBg(); setBgColor((e.target as HTMLInputElement).value); });
  $("bgColor").addEventListener("change", () => commitBg("Background colour"));
  $("bgBlur").addEventListener("input", e => {
    beginBg();
    const v = (e.target as HTMLInputElement).value;
    BG.blur = +v; $("bgBlurOut").textContent = v; requestDraw();
  });
  $("bgBlur").addEventListener("change", () => commitBg("Background blur"));
  // The button stays disabled from the click until the matte arrives or the run fails, including while the model loads.
  onBusyCheck(() => bgw.runningId !== -1 || bgBtn.disabled);
  onFlush(() => commitBg("Background"));

  /* Copy the subject matte into the selection, so the subject (or, inverted, the background) can be adjusted on its own. */
  $("bgToSel").addEventListener("click", () => {
    const M = bgw.matte; if (!M) return;
    recordSelection("Selection");
    const { w, h } = state.sel, d = state.sel.data;
    for (let y = 0; y < h; y++) {
      const my = Math.min(M.h - 1, Math.floor((y + 0.5) / h * M.h));
      for (let x = 0; x < w; x++) d[y * w + x] = M.data[my * M.w + Math.min(M.w - 1, Math.floor((x + 0.5) / w * M.w))];
    }
    resetCurrentObject();
    refresh();
    recordSelection("Use subject as selection");
    if (state.sel.has) { setTarget("local"); toast("Subject selected. Use Invert to adjust the background instead."); }
  });
}
