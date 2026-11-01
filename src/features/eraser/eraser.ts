/* Magic eraser: MI-GAN in its own background thread, brush and crop-around-the-hole. */
import { $, state, BG } from "../../state";
import { frame, base, bctx, upload } from "../../render/gl";
import { renderThumbs, requestDraw } from "../../ui/adjustments";
import { scheduleHist } from "../../ui/histogram";
import { toast } from "../../ui/toast";
import { resetGuide } from "../select/refine";
import { ai, ensureEncoded, setSelecting, refresh, resetCurrentObject, currentMask, takeSelectionChange, restoreSelection, recordSelection } from "../select/select";
import { rerunMatteAfterEdit, snapshotBackground, restoreBackground, bgHooks } from "../background/background";
import { MODEL_BASE } from "../../modelHost";
import { onBusyCheck, onHistoryChange, pushEntry, topEntry, undo } from "../../history";
import { releaseSam } from "../models";
import { setCompare } from "../../ui/compare";

type EraseJob = { job: number; imageId: number; x: number; y: number; w: number; h: number; before: ImageData; mask: Uint8Array };

const eraseBtn = $("eraseMode"), eraseStatus = $("eraseStatus"), eraseText = $("eraseText"), eraseMeter = $("eraseMeter");
const brushLayer = $<HTMLCanvasElement>("brushLayer");
const brushCtx = brushLayer.getContext("2d", { willReadFrequently: true })!;
const brushCursor = $("brushCursor");
const brushSize = $<HTMLInputElement>("brushSize");

const er = {
  worker: null as Worker | null,
  state: "off",
  job: 0,
  running: null as EraseJob | null,
  pending: null as { hole: Uint8Array; w: number; h: number } | null,
};
let stroke: { last: { x: number; y: number } | null } | null = null;

function setEraseStatus(text: string | null, mode?: string) {
  eraseStatus.hidden = !text;
  eraseText.textContent = text || "";
  eraseStatus.classList.toggle("err", mode === "err");
  eraseMeter.hidden = !(mode === "bar" || mode === "spin");
  eraseMeter.classList.toggle("indeterminate", mode === "spin");
}
const eraseBar = (pct: string) => (eraseMeter.firstElementChild as HTMLElement).style.width = pct;

function startEraseWorker() {
  if (er.worker) return true;
  try {
    er.worker = new Worker(new URL("./migan.worker.ts", import.meta.url), { type: "module" });
  } catch (e) { eraseFail((e as Error).message); return false; }
  er.worker.onmessage = onErase;
  er.worker.onerror = e => { e.preventDefault(); eraseFail(e.message || "worker failed to start"); };
  er.state = "loading";
  er.worker.postMessage({ type: "load", modelBase: MODEL_BASE });
  setEraseStatus("Downloading the eraser model…", "bar");
  eraseBar("0%");
  return true;
}

function eraseFail(why: string) {
  if (er.worker) { er.worker.terminate(); er.worker = null; }
  er.state = "off"; er.running = null; er.pending = null;
  frame.classList.remove("busy");
  clearBrush();
  recordSelection("Selection");   // Erase selection clears it first, even if the erase then fails
  setEraseStatus("Couldn't load the eraser model. Check your internet connection, then try again." + (why ? " Details: " + why : ""), "err");
}

function onErase(e: MessageEvent) {
  const m = e.data;
  if (m.type === "progress") {
    eraseBar(Math.min(100, Math.round(m.loaded / m.total * 100)) + "%");
    eraseText.textContent = `Downloading the eraser model… ${(m.loaded / 1048576).toFixed(0)} of ${(m.total / 1048576).toFixed(0)} MB`;
  } else if (m.type === "ready") {
    er.state = "ready";
    setEraseStatus(null);
    if (er.pending) { const p = er.pending; er.pending = null; runErase(p.hole, p.w, p.h); }
  } else if (m.type === "result") {
    const job = er.running;
    if (!job || job.job !== m.job) return;
    er.running = null;
    frame.classList.remove("busy");
    if (job.imageId !== state.imageId) { setEraseStatus(null); clearBrush(); return; }
    // Keep untouched pixels exactly; take the model's pixels only inside the hole.
    const { x, y, w, h, before, mask } = job, out = new ImageData(w, h), d = m.data, n = w * h;
    for (let i = 0; i < n; i++) {
      const k = i * 4;
      if (mask[i]) { out.data[k] = before.data[k]; out.data[k + 1] = before.data[k + 1]; out.data[k + 2] = before.data[k + 2]; }
      else { out.data[k] = d[i]; out.data[k + 1] = d[n + i]; out.data[k + 2] = d[2 * n + i]; }
      out.data[k + 3] = 255;
    }
    const sel = takeSelectionChange(), bgBeforeErase = snapshotBackground();
    bctx.putImageData(out, x, y);
    imageChanged();
    // The matte is redone for the new pixels after this step is recorded, so its result is filled in when it arrives.
    let bgAfterErase = snapshotBackground();
    bgHooks.afterRerun = s => { bgAfterErase = s; };
    pushEntry({
      label: "Erase", kind: "erase", bytes: 2 * before.data.length + (sel ? sel.before.length + sel.after.length : 0),
      undo: () => { bctx.putImageData(before, x, y); pixelsRestored(); if (sel) restoreSelection(sel.before); restoreBackground(bgBeforeErase); },
      redo: () => { bctx.putImageData(out, x, y); pixelsRestored(); if (sel) restoreSelection(sel.after); restoreBackground(bgAfterErase); },
    });
    clearBrush();
    setEraseStatus(null);
    toast(`Erased in ${(m.ms / 1000).toFixed(1)} s. Undo erase brings it back.`);
  } else if (m.type === "error") {
    if (m.stage === "load") eraseFail(m.message);
    else { er.running = null; frame.classList.remove("busy"); clearBrush(); recordSelection("Selection"); setEraseStatus("Couldn't erase that area. (" + m.message + ")", "err"); }
  }
}

/* The photo's pixels changed: re-upload, and mark AI results based on the old pixels as stale. */
export function imageChanged() {
  upload(base);
  resetGuide();
  ai.encodedId = -1; ai.encodingId = -1;
  if (state.selecting) ensureEncoded();
  rerunMatteAfterEdit();
  renderThumbs(); scheduleHist(); requestDraw();
}
/* Undo or redo put pixels back: the matte for them is restored by the step, so nothing is rerun. */
export function pixelsRestored() {
  upload(base);
  resetGuide();
  ai.encodedId = -1; ai.encodingId = -1;
  if (state.selecting) ensureEncoded();
  renderThumbs(); scheduleHist(); requestDraw();
}

/* hole: Uint8Array at lw x lh (1 = erase). Crops the photo around it at full resolution and sends it off. */
function runErase(hole: Uint8Array, lw: number, lh: number) {
  const { img } = state;
  if (er.running) return;
  let minX = lw, minY = lh, maxX = -1, maxY = -1;
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) if (hole[y * lw + x]) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (maxX < 0) { clearBrush(); return; }
  if (er.state !== "ready") { er.pending = { hole, w: lw, h: lh }; startEraseWorker(); return; }
  const sx = img.w / lw, sy = img.h / lh;
  const bx0 = minX * sx, by0 = minY * sy, bx1 = (maxX + 1) * sx, by1 = (maxY + 1) * sy;
  const margin = Math.max(32, 0.75 * Math.max(bx1 - bx0, by1 - by0));   // context the model needs around the hole
  const x = Math.max(0, Math.floor(bx0 - margin)), y = Math.max(0, Math.floor(by0 - margin));
  const w = Math.min(img.w, Math.ceil(bx1 + margin)) - x, h = Math.min(img.h, Math.ceil(by1 + margin)) - y;
  const before = bctx.getImageData(x, y, w, h), n = w * h;
  const planar = new Uint8Array(3 * n), mask = new Uint8Array(n);
  for (let j = 0; j < h; j++) {
    const ly = Math.min(lh - 1, Math.floor((y + j + 0.5) / sy));
    for (let i = 0; i < w; i++) {
      const p = j * w + i, k = p * 4;
      planar[p] = before.data[k]; planar[n + p] = before.data[k + 1]; planar[2 * n + p] = before.data[k + 2];
      mask[p] = hole[ly * lw + Math.min(lw - 1, Math.floor((x + i + 0.5) / sx))] ? 0 : 255;
    }
  }
  const job = ++er.job;
  er.running = { job, imageId: state.imageId, x, y, w, h, before, mask };
  er.worker!.postMessage({ type: "run", job, w, h, img: planar, mask: mask.slice() }, [planar.buffer]);
  frame.classList.add("busy");
  setEraseStatus("Erasing…", "spin");
}

function clearBrush() { brushCtx.clearRect(0, 0, brushLayer.width, brushLayer.height); }
function brushHole() {
  const { width: w, height: h } = brushLayer, a = brushCtx.getImageData(0, 0, w, h).data, hole = new Uint8Array(w * h);
  for (let i = 0; i < hole.length; i++) hole[i] = a[i * 4 + 3] > 20 ? 1 : 0;
  return hole;
}

export function setErasing(on: boolean) {
  state.erasing = on;
  eraseBtn.setAttribute("aria-pressed", String(on));
  eraseBtn.textContent = on ? "Done erasing" : "Erase objects";
  frame.classList.toggle("erasing", on);
  brushLayer.hidden = !on;
  $("brushRow").hidden = !on;
  if (!on) brushCursor.hidden = true;
  if (on) {
    if (state.selecting) setSelecting(false);
    if (state.compare) setCompare(false);
    releaseSam();
    startEraseWorker();
  }
}

function setBrush(v: number) {
  brushSize.value = String(Math.max(8, Math.min(160, v)));
  $("brushOut").textContent = brushSize.value + " px";
  brushCursor.style.width = brushCursor.style.height = brushSize.value + "px";
}

function brushPoint(e: PointerEvent) {
  const r = frame.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * brushLayer.width, y: (e.clientY - r.top) / r.height * brushLayer.height, sx: e.clientX - r.left, sy: e.clientY - r.top };
}
function paintTo(p: { x: number; y: number }) {
  const rad = +brushSize.value / 2 * brushLayer.width / frame.getBoundingClientRect().width;
  brushCtx.fillStyle = brushCtx.strokeStyle = "#ff3d63";
  brushCtx.lineCap = brushCtx.lineJoin = "round";
  brushCtx.lineWidth = rad * 2;
  if (stroke!.last) { brushCtx.beginPath(); brushCtx.moveTo(stroke!.last!.x, stroke!.last!.y); brushCtx.lineTo(p.x, p.y); brushCtx.stroke(); }
  brushCtx.beginPath(); brushCtx.arc(p.x, p.y, rad, 0, Math.PI * 2); brushCtx.fill();
  stroke!.last = p;
}

function undoErase() {
  if (topEntry()?.kind === "erase") undo();
}

export function syncBrushLayer() {
  brushLayer.width = state.sel.w; brushLayer.height = state.sel.h;
  clearBrush();
}
export function resetEraser() {
  er.running = null; er.pending = null;
  bgHooks.afterRerun = null;
  brushLayer.width = state.sel.w; brushLayer.height = state.sel.h;
  clearBrush();
  $<HTMLButtonElement>("undoErase").disabled = true;
  frame.classList.remove("busy");
}

export function initEraser() {
  eraseBtn.addEventListener("click", () => setErasing(!state.erasing));
  brushSize.addEventListener("input", () => setBrush(+brushSize.value));
  setBrush(40);

  frame.addEventListener("pointerdown", e => {
    // Also wait for a matte being redone after the last erase: it belongs to that step's pixels.
    if (!state.erasing || er.running || BG.pendingMode > 0 || e.button !== 0) return;
    e.preventDefault();
    frame.setPointerCapture(e.pointerId);
    stroke = { last: null };
    paintTo(brushPoint(e));
  });
  frame.addEventListener("pointermove", e => {
    if (!state.erasing) return;
    const p = brushPoint(e);
    brushCursor.hidden = false;
    brushCursor.style.left = p.sx + "px"; brushCursor.style.top = p.sy + "px";
    if (stroke) paintTo(p);
  });
  frame.addEventListener("pointerup", () => {
    if (!state.erasing || !stroke) return;
    stroke = null;
    runErase(brushHole(), brushLayer.width, brushLayer.height);
  });
  frame.addEventListener("pointerleave", () => { if (state.erasing && !stroke) brushCursor.hidden = true; });
  document.addEventListener("keydown", e => {
    if (!state.erasing) return;
    if (e.key === "[") setBrush(+brushSize.value - 8);
    if (e.key === "]") setBrush(+brushSize.value + 8);
  });

  /* Erase whatever Smart select has selected, grown a few pixels so no outline is left behind. */
  $("eraseSel").addEventListener("click", () => {
    if (!state.sel.has || er.running || BG.pendingMode > 0) return;
    const { w, h } = state.sel, src = currentMask(), hole = new Uint8Array(w * h), R = 4;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (src[y * w + x] <= 127) continue;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && dx * dx + dy * dy <= R * R) hole[yy * w + xx] = 1;
      }
    }
    if (state.selecting) setSelecting(false);
    // The erased object is gone, so its selection no longer means anything.
    state.sel.data.fill(0); resetCurrentObject(); refresh();
    startEraseWorker();
    runErase(hole, w, h);
  });

  $("undoErase").addEventListener("click", undoErase);
  onHistoryChange(() => { $<HTMLButtonElement>("undoErase").disabled = topEntry()?.kind !== "erase"; });
  onBusyCheck(() => !!(er.running || er.pending || stroke));
}
