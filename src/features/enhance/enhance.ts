/* Enhance: sharpens a photo with an AI model on this device, then puts the original's fine texture back,
   because the model alone leaves skin looking smooth. Small photos also come out at double the size.
   Measured on a face: this kept the original's texture and about doubled its edge sharpness at the same size. */
import { $, state } from "../../state";
import { MAX, base, frame } from "../../render/gl";
import { toast } from "../../ui/toast";
import { applyGeometry } from "../transform/transform";
import { releaseSam } from "../models";
import { MODEL_BASE } from "../../modelHost";
import { isBusy, onBusyCheck, topEntry, undo, type HistoryEntry } from "../../history";

const WORK_PIXELS = 2_000_000;   // beyond this the CPU takes too long, so very large photos are reduced first
const TEXTURE = 0.8;             // how much of the original's fine detail is added back

const block = document.createElement("div");
block.className = "block"; block.id = "enhanceBlock";
block.innerHTML = `<div class="hist-head"><h2 class="section-title">Enhance</h2><span class="ai-tag" id="enhanceTag">Real-ESRGAN · on device</span></div>
  <button id="enhanceRun" class="btn wide" type="button">Enhance photo</button>
  <div class="ctl">
    <div class="ctl-head"><label for="enhanceStrength">Strength</label><output for="enhanceStrength" id="enhanceStrengthOut">75%</output></div>
    <input type="range" id="enhanceStrength" min="0" max="100" step="1" value="75">
  </div>
  <div class="ai-status" id="enhanceStatus" hidden aria-live="polite">
    <span id="enhanceText"></span>
    <div class="meter" id="enhanceMeter"><i></i></div>
    <button id="enhanceCancel" class="btn" type="button">Cancel</button>
  </div>
  <p class="note">Sharpens the photo and doubles the size of smaller ones. It can't recover detail that was never captured, so check faces and text, and lower Strength if eyes or fine detail look unnatural. Larger photos can take a few minutes, and the first use downloads about 5 MB. Runs on this computer.</p>`;
const q = <T extends HTMLElement>(id: string) => block.querySelector("#" + id) as T;
const run = q<HTMLButtonElement>("enhanceRun"), status = q("enhanceStatus"), text = q("enhanceText"), meter = q("enhanceMeter");

let worker: Worker | null = null, running = false, job = 0;
/* The model's raw output, kept so Strength can re-blend it instantly while Enhance is the latest step. */
type Result = { w: number; h: number; data: Uint8ClampedArray; ms: number };
let last: { result: Result; entry: HistoryEntry | null } | null = null;
const strength = () => +q<HTMLInputElement>("enhanceStrength").value / 100;

function setStatus(msg: string | null, mode?: string) {
  status.hidden = !msg;
  text.textContent = msg || "";
  status.classList.toggle("err", mode === "err");
  meter.hidden = !(mode === "bar" || mode === "spin");
  meter.classList.toggle("indeterminate", mode === "spin");
  q("enhanceCancel").hidden = !running;
}
const setBar = (pct: number) => (meter.firstElementChild as HTMLElement).style.width = pct + "%";

function stop() {
  if (worker) { worker.terminate(); worker = null; }
  running = false;
  run.disabled = false;
  frame.classList.remove("busy");
}
function fail(why: string) {
  stop();
  setStatus("Couldn't enhance this photo. Check your internet connection, then try again." + (why ? " Details: " + why : ""), "err");
}

/* The photo as RGB bytes for the model. It starts from the current pixels, without slider edits. */
function workingPixels() {
  const { w, h } = state.img, f = Math.max(1, Math.sqrt(w * h / WORK_PIXELS));
  const tw = Math.max(1, Math.round(w / f)), th = Math.max(1, Math.round(h / f));
  const c = document.createElement("canvas");
  c.width = tw; c.height = th;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.imageSmoothingQuality = "high";
  x.drawImage(base, 0, 0, tw, th);
  const d = x.getImageData(0, 0, tw, th).data, rgb = new Uint8ClampedArray(tw * th * 3);
  for (let i = 0, n = tw * th; i < n; i++) { rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2]; }
  return { w: tw, h: th, rgb };
}

const sized = (src: CanvasImageSource, w: number, h: number, filter?: string) => {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.imageSmoothingQuality = "high";
  if (filter) x.filter = filter;
  x.drawImage(src, 0, 0, w, h);
  return x.getImageData(0, 0, w, h);
};

function apply(m: Result, announce = true) {
  const { w, h } = state.img;
  const k = Math.max(w, h) * 2 <= Math.min(MAX, 4096) ? 2 : 1, W = w * k, H = h * k;

  const big = new ImageData(m.w, m.h);
  for (let i = 0, n = m.w * m.h; i < n; i++) { big.data[i * 4] = m.data[i * 3]; big.data[i * 4 + 1] = m.data[i * 3 + 1]; big.data[i * 4 + 2] = m.data[i * 3 + 2]; big.data[i * 4 + 3] = 255; }
  const c = document.createElement("canvas");
  c.width = m.w; c.height = m.h;
  c.getContext("2d")!.putImageData(big, 0, 0);

  // Result + (original - original blurred): the second part is exactly the fine texture the model smoothed away.
  // Strength then mixes all of that with a plain enlargement, so zero means no AI at all.
  const out = sized(c, W, H), up = sized(base, W, H), low = sized(base, W, H, `blur(${k}px)`), s = strength();
  for (let i = 0; i < out.data.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) out.data[i + ch] = up.data[i + ch] + s * (out.data[i + ch] - up.data[i + ch] + TEXTURE * (up.data[i + ch] - low.data[i + ch]));
    out.data[i + 3] = up.data[i + 3];   // keep the photo's own transparency
  }
  applyGeometry("Enhance", { w: W, h: H, paint: x => x.putImageData(out, 0, 0), map: (u, v) => [u, v] });
  last = { result: m, entry: topEntry() };
  if (announce) toast(`Enhanced in ${Math.round(m.ms / 1000)} s. Move Strength to adjust it, or Undo to bring the original back.`);
}

function onMessage(e: MessageEvent) {
  const m = e.data;
  if (m.type === "progress") {
    setBar(Math.round(m.loaded / m.total * 100));
    text.textContent = `Downloading the enhance model… ${(m.loaded / 1048576).toFixed(0)} of ${(m.total / 1048576).toFixed(0)} MB`;
  } else if (m.type === "ready") {
    q("enhanceTag").textContent = "Real-ESRGAN · CPU";
    setStatus("Enhancing…", "bar"); setBar(0);
    const p = workingPixels();
    worker!.postMessage({ type: "enhance", job, w: p.w, h: p.h, rgb: p.rgb }, [p.rgb.buffer]);
  } else if (m.type === "tile") {
    setBar(Math.round(m.done / m.total * 100));
    text.textContent = `Enhancing… ${m.done} of ${m.total} parts`;
  } else if (m.type === "enhanced") {
    if (m.job !== job) return;
    stop();
    setStatus(null);
    apply(m);
  } else if (m.type === "error") fail(m.message);
}

export function initEnhance() {
  $("selectBlock").before(block);
  run.addEventListener("click", () => {
    if (isBusy()) { toast("Still working. Try again in a moment."); return; }
    releaseSam();
    job++; running = true;
    run.disabled = true;
    frame.classList.add("busy");
    setStatus("Downloading the enhance model…", "bar"); setBar(0);
    try {
      worker = new Worker(new URL("./esrgan.worker.ts", import.meta.url), { type: "module" });
    } catch (e) { fail((e as Error).message); return; }
    worker.onmessage = onMessage;
    worker.onerror = e => { e.preventDefault(); fail(e.message || "worker failed to start"); };
    worker.postMessage({ type: "load", modelBase: MODEL_BASE });
  });
  q("enhanceCancel").addEventListener("click", () => { stop(); setStatus(null); toast("Enhance cancelled. Your photo is unchanged."); });
  q<HTMLInputElement>("enhanceStrength").addEventListener("input", () => { q("enhanceStrengthOut").textContent = Math.round(strength() * 100) + "%"; });
  q<HTMLInputElement>("enhanceStrength").addEventListener("change", () => {
    if (!last || topEntry() !== last.entry || isBusy()) return;
    const { result } = last;
    undo(true);
    apply(result, false);
  });
  onBusyCheck(() => running);
}
