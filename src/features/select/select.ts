/* Smart select: SAM 2.1 tiny in a background thread, click-to-select, overlay and selection state. */
import { $, state, activePreset, zero, type SelPoint } from "../../state";
import { frame, uploadMask } from "../../render/gl";
import { originalRGB } from "../../render/gl";
import { refineMask, smoothLogits, upsample, resetGuide } from "./refine";
import { setTarget, renderThumbs, requestDraw, snapshotAdjust, restoreAdjust, dropAdjust, type AdjustSnapshot } from "../../ui/adjustments";
import { toast } from "../../ui/toast";
import { setCompare } from "../../ui/compare";
import { setErasing } from "../eraser/eraser";
import { MODEL_BASE } from "../../modelHost";
import { notifyHistory, onBusyCheck, onFlush, pushEntry, setUndoIntercept } from "../../history";

type SamRes = {
  gw: number; gh: number; logits: Float32Array[]; scores: number[]; best: number;
  cache: Record<string | number, Uint8Array>;
};
type SelObject = { points: SelPoint[]; key: string; res: SamRes | null };

const overlay = $<HTMLCanvasElement>("overlay"), octx = overlay.getContext("2d")!;
const selBtn = $("selectMode"), aiStatus = $("aiStatus"), aiText = $("aiText"), aiMeter = $("aiMeter"), aiTag = $("aiTag");
const sizeNote = $("sizeNote");
const tgtLocal = $<HTMLButtonElement>("tgtLocal");

export const ai = {
  worker: null as Worker | null,
  state: "off",
  encodedId: -1,
  encodingId: -1,
  files: {} as Record<string, { loaded?: number; total?: number }>,
  failed: false,
  slow: false,
};
let pointerIn = false, lastPointer: { x: number; y: number } | null = null, altDown = false;

/* The selection is the union of finished objects (sel.data) plus the object being refined (cur).
   cur.points are include (1) / exclude (0) clicks that SAM sees together, so an exclude click
   carves a part out of this object instead of deleting a whole segment. */
const newObject = (): SelObject => ({ points: [], key: "", res: null });
let cur = newObject();
let comp: Uint8Array | null = null;   // composite mask shown and used by the shader
let hover: { key: string; res: SamRes } | null = null;   // preview for "what a click here would do"
let hoverKey = "";
let level: number | null = null;      // null = model's best guess, else 0 part / 1 object / 2 whole
const SIZE = ["Part", "Object", "Whole"];

export const currentMask = () => comp || state.sel.data;
export function clearHover() { hover = null; }
export function resetCurrentObject() { cur = newObject(); level = null; }

/* History: the selection as it was at the last recorded step. Clicks within one object stay
   with Undo click; the object joins the history as one step when it is finished. */
let selBaseline: Uint8Array = new Uint8Array(1);
const sameMask = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/* The selection's change since the last recorded step, or null. Marks it as recorded. */
export function takeSelectionChange() {
  const now = comp || state.sel.data;
  if (sameMask(now, selBaseline)) return null;
  const change = { before: selBaseline, after: now.slice() };
  selBaseline = change.after;
  return change;
}
export function restoreSelection(data: Uint8Array) {
  state.sel.data.set(data);
  cur = newObject(); level = null; hover = null; hoverKey = "";
  refresh(true);
  selBaseline = data;
}
/* The photo's size changed: the selection comes along at its new size, and clicks are finished with. */
export function replaceSelection(w: number, h: number, data: Uint8Array) {
  const { target } = state;
  state.sel = { w, h, data: data.slice(), has: false, area: 0 };
  comp = state.sel.data;
  cur = newObject(); level = null; hover = null; hoverKey = "";
  resetGuide();
  overlay.width = w; overlay.height = h;
  refresh(true);
  selBaseline = state.sel.data.slice();
  setTarget(target);
  drawOverlay();
}
export function recordSelection(label: string, adjust?: AdjustSnapshot) {
  const change = takeSelectionChange();
  if (!change) return;
  const adjustAfter = adjust && snapshotAdjust();
  pushEntry({
    label, bytes: change.before.length + change.after.length,
    undo: () => { restoreSelection(change.before); if (adjust) restoreAdjust(adjust); },
    redo: () => { restoreSelection(change.after); if (adjustAfter) restoreAdjust(adjustAfter); },
  });
}

function setAiStatus(text: string | null, mode?: string) {
  aiStatus.hidden = !text;
  aiText.textContent = text || "";
  aiStatus.classList.toggle("err", mode === "err");
  aiMeter.hidden = !(mode === "bar" || mode === "spin");
  aiMeter.classList.toggle("indeterminate", mode === "spin");
}
const setBar = (pct: number) => (aiMeter.firstElementChild as HTMLElement).style.width = pct + "%";

function startWorker() {
  if (ai.worker) return true;
  ai.failed = false; ai.files = {};
  try {
    ai.worker = new Worker(new URL("./sam.worker.ts", import.meta.url), { type: "module" });
  } catch (e) { aiFail(e); return false; }
  ai.worker.onmessage = onAi;
  ai.worker.onerror = e => { e.preventDefault(); aiFail(e.message || "worker failed to start"); };
  ai.state = "loading";
  ai.worker.postMessage({ type: "load", modelBase: MODEL_BASE });
  setAiStatus("Downloading the AI model…", "bar"); setBar(0);
  return true;
}

function aiFail(detail: unknown) {
  ai.failed = true; ai.state = "off";
  if (ai.worker) { ai.worker.terminate(); ai.worker = null; }
  ai.encodedId = ai.encodingId = -1;
  setSelecting(false);
  const why = typeof detail === "string" ? detail : ((detail as { message?: string })?.message) || "";
  setAiStatus("Couldn't load the AI model. Check your internet connection, then click Select objects to try again." + (why ? " Details: " + why : ""), "err");
  console.warn("[Lightbox AI]", detail);
}

function onAi(e: MessageEvent) {
  const m = e.data;
  if (m.type === "progress") {
    ai.files[m.file] = m;
    let L = 0, T = 0;
    for (const f of Object.values(ai.files)) { L += f.loaded || 0; T += f.total || 0; }
    if (T) { setBar(Math.round(L / T * 100)); aiText.textContent = `Downloading the AI model… ${(L / 1048576).toFixed(0)} of ${(T / 1048576).toFixed(0)} MB`; }
  } else if (m.type === "ready") {
    ai.state = "ready";
    ai.slow = !m.device.startsWith("Graphics");
    if (ai.slow || !m.cached) toast(location.protocol === "file:"
      ? "Running in slow mode because this page was opened from a file. For faster AI, start the editor with start.bat."
      : "Running on the CPU because WebGPU isn't available here, so analysing a photo takes longer.");
    aiTag.textContent = "SAM 2.1 · " + (ai.slow ? "CPU" : "GPU");
    aiTag.title = "Running on: " + m.device;
    setAiStatus(null);
    ensureEncoded();
  } else if (m.type === "encoded") {
    if (m.id !== state.imageId) return;
    ai.encodedId = m.id; ai.encodingId = -1;
    frame.classList.remove("busy");
    setAiStatus(null);
    if (state.selecting && pointerIn && lastPointer) requestHover();
  } else if (m.type === "mask") {
    if (m.id !== state.imageId || m.id !== ai.encodedId) return;
    const res: SamRes = { gw: m.gw, gh: m.gh, logits: m.logits, scores: m.scores, best: m.best, cache: [] as unknown as Record<string | number, Uint8Array> };
    if (m.hover) {
      if (state.selecting && pointerIn && m.key === hoverKey) { hover = { key: m.key, res }; drawOverlay(); showSize(); }
    } else if (m.key === cur.key) {
      cur.res = res; refresh();
    }
  } else if (m.type === "error") {
    if (m.stage === "load") aiFail(m.message);
    else if (m.stage === "encode") {
      ai.encodingId = -1; frame.classList.remove("busy");
      setAiStatus("Couldn't analyse this photo. Try opening it again. (" + m.message + ")", "err");
    } else console.warn("[Lightbox AI]", m.message);
  }
}

/* Send the original photo (not the edited one) at the AI's working size, as RGB bytes. */
export function ensureEncoded() {
  if (ai.state !== "ready" || !state.img.w || !ai.worker) return;
  if (ai.encodedId === state.imageId || ai.encodingId === state.imageId) return;
  ai.encodingId = state.imageId;
  const { w, h } = state.sel;
  const rgb = originalRGB(w, h);
  ai.worker.postMessage({ type: "encode", id: state.imageId, w, h, rgb }, [rgb.buffer]);
  frame.classList.add("busy");
  setAiStatus(ai.slow ? "Analysing the photo on the CPU. This takes up to 30 seconds, once per photo."
                      : "Analysing the photo. This takes a few seconds, once per photo.", "spin");
}

const pick = (res: SamRes) => level === null ? res.best : level;
/* refine = true: drop stray islands and snap the edge to the photo (used for the real selection).
   refine = false: raw upsampled mask (used for the fast hover preview). */
function maskOf(res: SamRes, lvl: number, refine?: boolean, points?: SelPoint[]): Uint8Array {
  const key = refine ? "r" + lvl : lvl;
  if (!res.cache[key]) {
    const raw = res.cache[lvl] || (res.cache[lvl] = upsample(smoothLogits(res.logits[lvl], res.gw, res.gh), res.gw, res.gh, state.sel.w, state.sel.h));
    if (refine) res.cache[key] = refineMask(raw, state.sel.w, state.sel.h, points || []);
  }
  return res.cache[key];
}

export function resetSelection() {
  const { img } = state;
  const s = Math.min(1, 1024 / Math.max(img.w, img.h));
  const w = Math.max(1, Math.round(img.w * s)), h = Math.max(1, Math.round(img.h * s));
  state.sel = { w, h, data: new Uint8Array(w * h), has: false, area: 0 };
  comp = state.sel.data;
  selBaseline = state.sel.data.slice();
  dropAdjust();
  cur = newObject(); hover = null; hoverKey = ""; level = null;
  resetGuide();
  overlay.width = w; overlay.height = h;
  uploadMask(state.sel.data, w, h);
  ai.encodedId = -1;
  state.params.local = zero(); activePreset.local = 0;
  if (state.target === "local") setTarget("global");
  updateSelectUi(); drawOverlay(); showSize();
}

/* Rebuild the composite (finished objects + current object) and push it everywhere. */
export function refresh(quiet = false) {
  const { sel } = state;
  const wasEmpty = !sel.has;
  if (cur.res) {
    const m = maskOf(cur.res, pick(cur.res), true, cur.points), d = sel.data;
    comp = new Uint8Array(d.length);
    for (let i = 0; i < d.length; i++) comp[i] = m[i] > d[i] ? m[i] : d[i];
  } else comp = sel.data;
  let n = 0;
  for (let i = 0; i < comp.length; i++) if (comp[i] > 127) n++;
  sel.has = n > 0; sel.area = n / comp.length;
  uploadMask(comp, sel.w, sel.h);
  if (!sel.has) setTarget("global");
  else if (wasEmpty) { setTarget("local"); if (!quiet) toast("Selected. Sliders and filters now change only the selection."); }
  updateSelectUi(); drawOverlay(); showSize(); renderThumbs(); requestDraw();
}

/* Fold the current object into the finished selection. */
function commitCurrent() {
  if (cur.res) {
    const m = maskOf(cur.res, pick(cur.res), true, cur.points), d = state.sel.data;
    for (let i = 0; i < d.length; i++) if (m[i] > d[i]) d[i] = m[i];
  }
  cur = newObject(); level = null; hover = null; hoverKey = "";
}

function decodeCurrent() {
  cur.key = JSON.stringify(cur.points);
  if (!cur.points.length) { cur = newObject(); refresh(); return; }
  ai.worker!.postMessage({ type: "decode", id: state.imageId, points: cur.points, key: cur.key, hover: false });
}

function updateSelectUi() {
  const { sel } = state;
  $<HTMLButtonElement>("invertSel").disabled = !sel.has;
  $<HTMLButtonElement>("eraseSel").disabled = !sel.has;
  $<HTMLButtonElement>("clearSel").disabled = !sel.has && !cur.points.length;
  $<HTMLButtonElement>("undoPt").disabled = !cur.points.length;
  $<HTMLButtonElement>("newObj").disabled = !cur.points.length;
  tgtLocal.disabled = !sel.has;
  tgtLocal.textContent = sel.has ? `Selection · ${Math.max(1, Math.round(sel.area * 100))}%` : "Selection";
  tgtLocal.title = sel.has ? "Share of the photo that is selected" : "Select objects first";
  notifyHistory();
}

function showSize() {
  const res = (state.selecting && hover && hover.res) || cur.res;
  sizeNote.hidden = !state.selecting || !res;
  if (sizeNote.hidden) return;
  const on = pick(res!);
  sizeNote.innerHTML = "<b>Size</b>" + SIZE.map((s, i) => `<span class="${i === on ? "on" : ""}">${s}</span>`).join("") + "<span style='border:0;padding:0'>· scroll to change</span>";
}

function undoPoint() {
  if (!cur.points.length) return;
  cur.points.pop(); cur.res = null; hover = null;
  if (cur.points.length) decodeCurrent(); else { cur = newObject(); level = null; refresh(); }
  updateSelectUi();
}

export function setSelecting(on: boolean) {
  state.selecting = on;
  selBtn.setAttribute("aria-pressed", String(on));
  selBtn.textContent = on ? "Done selecting" : "Select objects";
  frame.classList.toggle("selecting", on);
  if (on) {
    if (state.compare) setCompare(false);
    if (state.erasing) setErasing(false);
    if (startWorker()) ensureEncoded();
  } else {
    if (cur.points.length) { commitCurrent(); refresh(); }
    recordSelection("Selection");
    hover = null; hoverKey = "";
  }
  drawOverlay(); showSize(); updateSelectUi();
}

function normPoint(e: MouseEvent) {
  const r = frame.getBoundingClientRect();
  return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
}
/* Preview: what the current object would become if you clicked here. */
function hoverPoints(shift?: boolean): SelPoint[] | null {
  const p = { x: lastPointer!.x, y: lastPointer!.y, label: altDown ? 0 : 1 };
  const base = shift ? [] : cur.points;          // Shift previews a brand-new object
  if (altDown && !base.length) return null;      // nothing to cut from yet
  return base.concat([p]);
}
function requestHover(shift?: boolean) {
  if (!ai.worker || ai.encodedId !== state.imageId || !lastPointer) return;
  const pts = hoverPoints(shift);
  if (!pts) { if (hover) { hover = null; drawOverlay(); } return; }
  hoverKey = JSON.stringify(pts);
  ai.worker.postMessage({ type: "decode", id: state.imageId, points: pts, key: hoverKey, hover: true });
}

/* Overlay: blue tint + outline for the selection, white outline for the click preview. */
function edgeAt(d: Uint8Array, i: number, x: number, y: number, w: number, h: number) {
  if (d[i] <= 127) return false;
  if (x < 2 || y < 2 || x > w - 3 || y > h - 3) return true;
  return d[i - 1] <= 127 || d[i + 1] <= 127 || d[i - w] <= 127 || d[i + w] <= 127 ||
         d[i - 2] <= 127 || d[i + 2] <= 127 || d[i - 2 * w] <= 127 || d[i + 2 * w] <= 127;
}
export function drawOverlay() {
  const { sel, selecting, target, img } = state;
  const hv = selecting && hover ? maskOf(hover.res, pick(hover.res)) : null;
  const show = img.w && (selecting || (target === "local" && sel.has));
  overlay.hidden = !show;
  const data = comp || sel.data;
  if (!show || (!sel.has && !hv)) { octx.clearRect(0, 0, overlay.width, overlay.height); return; }
  const { w, h } = sel;
  const id = octx.createImageData(w, h), o = id.data;
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      let r = 0, g = 0, b = 0, a = 0;
      if (selecting && data[i]) { r = 56; g = 128; b = 255; a = data[i] * 0.4; }
      if (hv && hv[i] > 127) {
        if (edgeAt(hv, i, x, y, w, h)) { r = g = b = 255; a = 235; }
        else if (!a) { r = g = b = 255; a = 50; }
      }
      if (edgeAt(data, i, x, y, w, h)) { r = 120; g = 178; b = 255; a = 255; }
      const k = i * 4; o[k] = r; o[k + 1] = g; o[k + 2] = b; o[k + 3] = a;
    }
  }
  octx.putImageData(id, 0, 0);
}

export function initSelect() {
  selBtn.addEventListener("click", () => setSelecting(!state.selecting));
  $("undoPt").addEventListener("click", undoPoint);
  $("newObj").addEventListener("click", () => { commitCurrent(); refresh(); recordSelection("Selection"); toast("Click the next object to add it."); });
  $("invertSel").addEventListener("click", () => {
    commitCurrent(); refresh(); recordSelection("Selection");
    const d = state.sel.data;
    for (let i = 0; i < d.length; i++) d[i] = 255 - d[i];
    refresh(); recordSelection("Invert selection"); toast("Selection inverted.");
  });
  $("clearSel").addEventListener("click", () => {
    recordSelection("Selection");
    const adjust = snapshotAdjust();
    state.sel.data.fill(0); cur = newObject(); level = null; hover = null;
    state.params.local = zero(); activePreset.local = 0;
    refresh();
    recordSelection("Clear selection", adjust);
  });

  onBusyCheck(() => ai.encodingId !== -1);
  onFlush(() => recordSelection("Selection"));
  setUndoIntercept({ active: () => state.selecting && cur.points.length > 0, run: undoPoint });

  frame.addEventListener("pointermove", e => {
    if (!state.selecting || e.pointerType === "touch") return;
    pointerIn = true; lastPointer = normPoint(e); altDown = e.altKey;
    requestHover(e.shiftKey);
  });
  frame.addEventListener("pointerleave", () => { pointerIn = false; hoverKey = ""; if (hover) { hover = null; drawOverlay(); showSize(); } });
  document.addEventListener("keydown", e => {
    if (!state.selecting) return;
    if ((e.key === "Alt" || e.key === "Shift") && pointerIn) { altDown = e.altKey; requestHover(e.shiftKey); }
    if (e.key === "Alt") e.preventDefault();
  });
  document.addEventListener("keyup", e => {
    if (state.selecting && (e.key === "Alt" || e.key === "Shift") && pointerIn) { altDown = e.altKey; requestHover(e.shiftKey); }
  });

  frame.addEventListener("click", e => {
    if (!state.selecting) return;
    if (ai.encodedId !== state.imageId) {
      toast(ai.state === "ready" ? "Still analysing the photo. Try again in a moment." : "The AI model is still loading.");
      return;
    }
    const p = normPoint(e), label = e.altKey ? 0 : 1;
    if (e.shiftKey && cur.points.length) { const keep = hover; commitCurrent(); hover = keep; }
    if (label === 0 && !cur.points.length) { toast("Click an object first, then Alt-click the parts to leave out."); return; }
    cur.points.push({ x: p.x, y: p.y, label });
    cur.key = JSON.stringify(cur.points);
    // The hover preview was computed for exactly these points: use it instead of waiting.
    if (hover && hover.key === cur.key) { cur.res = hover.res; refresh(); }
    else decodeCurrent();
    updateSelectUi();
  });

  /* Scroll over the photo to step between SAM's three proposals. */
  frame.addEventListener("wheel", e => {
    if (!state.selecting) return;
    const res = (hover && hover.res) || cur.res;
    if (!res) return;
    e.preventDefault();
    const now = pick(res), next = Math.max(0, Math.min(2, now + (e.deltaY < 0 ? 1 : -1)));
    if (next === now) return;
    level = next;
    if (cur.res) refresh(); else { drawOverlay(); showSize(); }
  }, { passive: false });
}
