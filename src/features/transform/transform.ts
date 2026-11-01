/* Crop, rotate, flip and resize. Each changes the photo's pixels and carries the selection and the
   background matte along with it, so they stay lined up with the subject. */
import { $, state } from "../../state";
import { MAX, base, bctx, upload, fit, frame } from "../../render/gl";
import { renderThumbs, requestDraw } from "../../ui/adjustments";
import { scheduleHist } from "../../ui/histogram";
import { toast } from "../../ui/toast";
import { setCompare } from "../../ui/compare";
import { ai, setSelecting, replaceSelection } from "../select/select";
import { bgw, useMatte, snapshotBackground, restoreBackground, type BgSnapshot } from "../background/background";
import { setErasing, syncBrushLayer } from "../eraser/eraser";
import { flushHistory, isBusy, onHistoryChange, pushEntry } from "../../history";

type Geometry = {
  w: number; h: number;
  /* Draws the old photo into the new canvas. */
  paint: (x: CanvasRenderingContext2D, src: HTMLCanvasElement) => void;
  /* For a position in the new photo (0-1), the same position in the old one. */
  map: (u: number, v: number) => [number, number];
};
type PhotoState = { w: number; h: number; pixels: ImageData; selW: number; selH: number; sel: Uint8Array; bg: BgSnapshot };

const editBlock = document.createElement("div");
editBlock.className = "block"; editBlock.id = "editBlock";
editBlock.innerHTML = `<h2 class="section-title">Edit</h2>
  <div class="row2">
    <button id="rotL" class="btn" type="button">Rotate left</button>
    <button id="rotR" class="btn" type="button">Rotate right</button>
    <button id="flipH" class="btn" type="button">Flip across</button>
    <button id="flipV" class="btn" type="button">Flip down</button>
  </div>
  <button id="cropMode" class="btn wide" type="button" aria-pressed="false">Crop</button>
  <div id="cropOpts" class="block" hidden>
    <div class="seg seg-crop" role="group" aria-label="Crop shape">
      <button type="button" data-ar="0" aria-pressed="true">Free</button>
      <button type="button" data-ar="1" aria-pressed="false">Square</button>
      <button type="button" data-ar="0.8" aria-pressed="false">4:5</button>
      <button type="button" data-ar="1.5" aria-pressed="false">3:2</button>
      <button type="button" data-ar="1.7778" aria-pressed="false">16:9</button>
      <button type="button" data-ar="0.5625" aria-pressed="false">9:16</button>
    </div>
    <div class="row2">
      <button id="cropCancel" class="btn" type="button">Cancel</button>
      <button id="cropApply" class="btn" type="button">Apply crop</button>
    </div>
  </div>
  <div class="ctl">
    <div class="ctl-head"><label for="sizeW">Resize (px)</label></div>
    <div class="size-row">
      <input id="sizeW" class="num" type="number" min="16" step="1" aria-label="Width in pixels">
      <span aria-hidden="true">×</span>
      <input id="sizeH" class="num" type="number" min="16" step="1" aria-label="Height in pixels">
    </div>
    <button id="resizeApply" class="btn wide" type="button" disabled>Resize</button>
  </div>`;
const q = <T extends HTMLElement>(id: string) => editBlock.querySelector("#" + id) as T;

/* The same position lookup applied to a mask, with bilinear sampling so soft edges stay soft. */
function remap(src: Uint8Array, sw: number, sh: number, nw: number, nh: number, map: Geometry["map"]) {
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const [u, v] = map((x + 0.5) / nw, (y + 0.5) / nh);
    const fx = Math.max(0, Math.min(sw - 1, u * sw - 0.5)), fy = Math.max(0, Math.min(sh - 1, v * sh - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1), a = fx - x0, b = fy - y0;
    const top = src[y0 * sw + x0] * (1 - a) + src[y0 * sw + x1] * a, low = src[y1 * sw + x0] * (1 - a) + src[y1 * sw + x1] * a;
    out[y * nw + x] = top * (1 - b) + low * b + 0.5;
  }
  return out;
}

const capture = (): PhotoState => {
  const { img, sel } = state;
  return { w: img.w, h: img.h, pixels: bctx.getImageData(0, 0, img.w, img.h), selW: sel.w, selH: sel.h, sel: sel.data.slice(), bg: snapshotBackground() };
};

function photoChanged(w: number, h: number) {
  state.img.w = w; state.img.h = h;
  upload(base);
  ai.encodedId = -1; ai.encodingId = -1;
  $("meta").textContent = ($("meta").textContent || "").replace(/^\d+ × \d+ px/, `${w} × ${h} px`);
  syncBrushLayer(); fit();
  renderThumbs(); scheduleHist(); requestDraw();
}

function restorePhoto(s: PhotoState) {
  base.width = s.w; base.height = s.h;
  bctx.putImageData(s.pixels, 0, 0);
  photoChanged(s.w, s.h);
  replaceSelection(s.selW, s.selH, s.sel);
  restoreBackground(s.bg);
}

export function applyGeometry(label: string, g: Geometry) {
  if (isBusy()) { toast("Still working. Try again in a moment."); return; }
  if (state.selecting) setSelecting(false);
  if (state.erasing) setErasing(false);
  if (state.compare) setCompare(false);
  flushHistory();
  const before = capture(), { sel } = state;

  const tmp = document.createElement("canvas");
  tmp.width = base.width; tmp.height = base.height;
  tmp.getContext("2d")!.drawImage(base, 0, 0);
  base.width = g.w; base.height = g.h;
  bctx.save();
  bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = "high";
  g.paint(bctx, tmp);
  bctx.restore();
  photoChanged(g.w, g.h);

  const s = Math.min(1, 1024 / Math.max(g.w, g.h));
  const nw = Math.max(1, Math.round(g.w * s)), nh = Math.max(1, Math.round(g.h * s));
  replaceSelection(nw, nh, remap(sel.data, sel.w, sel.h, nw, nh, g.map));
  if (bgw.matte) {
    const M = bgw.matte;
    useMatte({ data: remap(M.data, M.w, M.h, M.w, M.h, g.map), w: M.w, h: M.h });
    requestDraw();
  }

  const after = capture();
  pushEntry({
    label, bytes: before.pixels.data.length + after.pixels.data.length + before.sel.length + after.sel.length,
    undo: () => restorePhoto(before), redo: () => restorePhoto(after),
  });
}

function turn(clockwise: boolean) {
  const { w: ow, h: oh } = state.img;
  applyGeometry(clockwise ? "Rotate right" : "Rotate left", {
    w: oh, h: ow,
    paint: (x, src) => {
      x.imageSmoothingEnabled = false;
      if (clockwise) { x.translate(oh, 0); x.rotate(Math.PI / 2); } else { x.translate(0, ow); x.rotate(-Math.PI / 2); }
      x.drawImage(src, 0, 0);
    },
    map: clockwise ? (u, v) => [v, 1 - u] : (u, v) => [1 - v, u],
  });
}
function flip(across: boolean) {
  const { w, h } = state.img;
  applyGeometry(across ? "Flip across" : "Flip down", {
    w, h,
    paint: (x, src) => {
      x.imageSmoothingEnabled = false;
      if (across) { x.translate(w, 0); x.scale(-1, 1); } else { x.translate(0, h); x.scale(1, -1); }
      x.drawImage(src, 0, 0);
    },
    map: across ? (u, v) => [1 - u, v] : (u, v) => [u, 1 - v],
  });
}

/* ---------- Crop ---------- */
const cropLayer = document.createElement("div");
cropLayer.className = "crop-layer"; cropLayer.id = "cropLayer"; cropLayer.hidden = true;
cropLayer.innerHTML = `<div class="crop-box" id="cropBox">${["nw", "ne", "sw", "se"].map(h => `<i class="crop-h ${h}" data-h="${h}"></i>`).join("")}</div>`;
const cropBox = cropLayer.firstElementChild as HTMLElement;
let rect = { x: 0, y: 0, w: 1, h: 1 }, shape = 0;
let drag: { h: string | null; px: number; py: number; start: typeof rect } | null = null;
const MIN = 0.02;

function drawCrop() {
  cropBox.style.left = rect.x * 100 + "%"; cropBox.style.top = rect.y * 100 + "%";
  cropBox.style.width = rect.w * 100 + "%"; cropBox.style.height = rect.h * 100 + "%";
}
/* Largest centred box of the chosen shape. The shape is width / height in pixels. */
function fitShape() {
  const { w, h } = state.img;
  if (!shape) rect = { x: 0, y: 0, w: 1, h: 1 };
  else {
    const n = shape * h / w;   // the same shape in 0-1 coordinates
    const rw = n <= 1 ? n : 1, rh = n <= 1 ? 1 : 1 / n;
    rect = { x: (1 - rw) / 2, y: (1 - rh) / 2, w: rw, h: rh };
  }
  drawCrop();
}
export function setCropping(on: boolean) {
  if (on) {
    if (state.selecting) setSelecting(false);
    if (state.erasing) setErasing(false);
    if (state.compare) setCompare(false);
  }
  cropLayer.hidden = !on;
  q("cropOpts").hidden = !on;
  q("cropMode").setAttribute("aria-pressed", String(on));
  if (on) fitShape();
}
function applyCrop() {
  const { w: ow, h: oh } = state.img, r = rect;
  const x = Math.round(r.x * ow), y = Math.round(r.y * oh);
  const w = Math.max(1, Math.min(ow - x, Math.round(r.w * ow))), h = Math.max(1, Math.min(oh - y, Math.round(r.h * oh)));
  setCropping(false);
  if (w === ow && h === oh) return;
  applyGeometry("Crop", {
    w, h,
    paint: (c, src) => { c.imageSmoothingEnabled = false; c.drawImage(src, -x, -y); },
    map: (u, v) => [(x + u * w) / ow, (y + v * h) / oh],
  });
}
function moveCrop(e: PointerEvent) {
  if (!drag) return;
  const b = frame.getBoundingClientRect(), dx = (e.clientX - drag.px) / b.width, dy = (e.clientY - drag.py) / b.height, s = drag.start;
  if (!drag.h) {
    rect = { ...s, x: Math.max(0, Math.min(1 - s.w, s.x + dx)), y: Math.max(0, Math.min(1 - s.h, s.y + dy)) };
    drawCrop();
    return;
  }
  // The corner opposite the handle stays put.
  const west = drag.h.includes("w"), north = drag.h.includes("n");
  const ax = west ? s.x + s.w : s.x, ay = north ? s.y + s.h : s.y;
  const spanX = west ? ax : 1 - ax, spanY = north ? ay : 1 - ay;
  let w = Math.max(MIN, Math.min(spanX, s.w + (west ? -dx : dx))), h = Math.max(MIN, Math.min(spanY, s.h + (north ? -dy : dy)));
  if (shape) {
    const n = shape * state.img.h / state.img.w;
    h = w / n;
    if (h > spanY) { h = spanY; w = h * n; }
    if (h < MIN) { h = MIN; w = h * n; }
  }
  rect = { x: west ? ax - w : ax, y: north ? ay - h : ay, w, h };
  drawCrop();
}

export function initTransform() {
  $("selectBlock").before(editBlock);
  frame.append(cropLayer);

  q("rotL").addEventListener("click", () => turn(false));
  q("rotR").addEventListener("click", () => turn(true));
  q("flipH").addEventListener("click", () => flip(true));
  q("flipV").addEventListener("click", () => flip(false));

  q("cropMode").addEventListener("click", () => setCropping(cropLayer.hidden));
  q("cropCancel").addEventListener("click", () => setCropping(false));
  q("cropApply").addEventListener("click", applyCrop);
  const shapes = [...editBlock.querySelectorAll<HTMLElement>("[data-ar]")];
  shapes.forEach(b => b.addEventListener("click", () => {
    shape = +b.dataset.ar!;
    shapes.forEach(o => o.setAttribute("aria-pressed", String(o === b)));
    fitShape();
  }));
  cropLayer.addEventListener("pointerdown", e => {
    const t = e.target as HTMLElement;
    if (t !== cropBox && !t.dataset.h) return;
    e.preventDefault(); e.stopPropagation();
    cropLayer.setPointerCapture(e.pointerId);
    drag = { h: t.dataset.h || null, px: e.clientX, py: e.clientY, start: { ...rect } };
  });
  cropLayer.addEventListener("pointermove", moveCrop);
  cropLayer.addEventListener("pointerup", () => { drag = null; });
  document.addEventListener("keydown", e => {
    if (cropLayer.hidden) return;
    if (e.key === "Enter") { e.preventDefault(); applyCrop(); }
    if (e.key === "Escape") setCropping(false);
  });
  [$("selectMode"), $("eraseMode"), $("compare")].forEach(b => b.addEventListener("click", () => setCropping(false)));

  const sizeW = q<HTMLInputElement>("sizeW"), sizeH = q<HTMLInputElement>("sizeH"), go = q<HTMLButtonElement>("resizeApply");
  const refreshGo = () => {
    const w = +sizeW.value, h = +sizeH.value;
    go.disabled = !(w >= 16 && h >= 16 && w <= MAX && h <= MAX && (w !== state.img.w || h !== state.img.h));
  };
  // Width and height stay in proportion, and a typed size can't pass what the graphics chip can hold.
  sizeW.addEventListener("input", () => { sizeH.value = String(Math.max(1, Math.round(+sizeW.value * state.img.h / state.img.w))); refreshGo(); });
  sizeH.addEventListener("input", () => { sizeW.value = String(Math.max(1, Math.round(+sizeH.value * state.img.w / state.img.h))); refreshGo(); });
  go.addEventListener("click", () => {
    const w = Math.round(+sizeW.value), h = Math.round(+sizeH.value);
    applyGeometry("Resize", { w, h, paint: (x, src) => x.drawImage(src, 0, 0, w, h), map: (u, v) => [u, v] });
  });
  onHistoryChange(() => {
    if (document.activeElement !== sizeW && document.activeElement !== sizeH) { sizeW.value = String(state.img.w); sizeH.value = String(state.img.h); }
    refreshGo();
    if (!cropLayer.hidden) fitShape();
  });
}
