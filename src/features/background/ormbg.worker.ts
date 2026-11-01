/* Background removal: ormbg (Apache-2.0) via Transformers.js 4.3.2, in its own module worker. */

import { hasLocalModel } from "../localModels";

export {};

// A dedicated worker's own globals. Declared here so this file type-checks against the DOM lib.
declare const self: {
  postMessage(message: unknown, transfer?: any[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
  navigator: any;
};

const LIB: string = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/+esm";
const MODEL = "onnx-community/ormbg-ONNX";
let T: any, model: any = null, processor: any = null, onGpu = false;
const queue: any[] = [];
let busy = false;

async function cacheWorks() {
  try { await caches.open("lightbox-probe"); return true; } catch { return false; }
}
const progress_callback = (p: any) => {
  if (p.status === "progress") self.postMessage({ type: "progress", file: p.file, loaded: p.loaded, total: p.total });
};
async function loadCpu() {
  model = await T.AutoModel.from_pretrained(MODEL, { device: "wasm", dtype: "q8", progress_callback });
  onGpu = false;
}
async function load(modelBase?: string) {
  T = await import(/* @vite-ignore */ LIB);
  T.env.allowLocalModels = await hasLocalModel(modelBase, MODEL);
  if (T.env.allowLocalModels) { T.env.localModelPath = modelBase; T.env.allowRemoteModels = false; }
  T.env.useBrowserCache = await cacheWorks();
  let gpu = false;
  try { gpu = !!(self.navigator.gpu && await self.navigator.gpu.requestAdapter()); } catch {}
  try {
    if (!gpu) throw new Error("no gpu");
    model = await T.AutoModel.from_pretrained(MODEL, { device: "webgpu", dtype: "fp16", progress_callback });
    onGpu = true;
  } catch { await loadCpu(); }
  processor = await T.AutoProcessor.from_pretrained(MODEL);
  self.postMessage({ type: "ready", gpu: onGpu });
}
async function infer(m: any) {
  const inp = await processor(new T.RawImage(m.rgb, m.w, m.h, 3));
  const name = model.sessions.model.inputNames[0];
  const out = await model({ [name]: inp.pixel_values });
  return out[Object.keys(out)[0]];
}
async function run(m: any) {
  const t0 = performance.now();
  let a: any;
  try { a = await infer(m); }
  catch (err: any) {
    if (!onGpu) throw err;
    await loadCpu();                       // some GPUs fail mid-run: retry once on the CPU
    self.postMessage({ type: "ready", gpu: false });
    a = await infer(m);
  }
  const H = a.dims[a.dims.length - 2], W = a.dims[a.dims.length - 1], d = a.data;
  const u8 = new Uint8Array(W * H);
  for (let i = 0; i < u8.length; i++) { const v = d[i]; u8[i] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0; }
  self.postMessage({ type: "matte", id: m.id, w: W, h: H, data: u8, ms: Math.round(performance.now() - t0) }, [u8.buffer]);
}
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const m = queue.shift();
    try {
      if (m.type === "load") await load(m.modelBase);
      else if (m.type === "run") await run(m);
    } catch (err: any) {
      self.postMessage({ type: "error", stage: m.type, message: String((err && err.message) || err) });
    }
  }
  busy = false;
}
self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === "run") for (let i = queue.length - 1; i >= 0; i--) if (queue[i].type === "run") queue.splice(i, 1);
  queue.push(m);
  pump();
};
