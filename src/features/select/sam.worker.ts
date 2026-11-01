/* Smart select: SAM 2.1 tiny via Transformers.js 4.3.2, in its own module worker. */

import { hasLocalModel } from "../localModels";

export {};

// A dedicated worker's own globals. Declared here so this file type-checks against the DOM lib.
declare const self: {
  postMessage(message: unknown, transfer?: any[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
  navigator: any;
};

const LIB: string = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/+esm";
const MODEL = "onnx-community/sam2.1-hiera-tiny-ONNX";   // SAM 2.1 tiny, Apache-2.0
let SamModel: any, AutoProcessor: any, RawImage: any, Tensor: any, env: any;

let model: any = null, processor: any = null, onGpu = false, progressCb: any = null;
let inputs: any = null, emb: any = null, embId = -1;
const queue: any[] = [];
let busy = false;

async function cacheWorks() {
  try { await caches.open("lightbox-probe"); return true; } catch { return false; }
}

async function load(modelBase?: string) {
  const T = await import(/* @vite-ignore */ LIB);
  ({ AutoProcessor, RawImage, Tensor, env } = T);
  SamModel = T.Sam2Model;
  env.allowLocalModels = await hasLocalModel(modelBase, MODEL);
  if (env.allowLocalModels) { env.localModelPath = modelBase; env.allowRemoteModels = false; }
  env.useBrowserCache = await cacheWorks();
  let gpu = false, f16 = false;
  try {
    const a = self.navigator.gpu && await self.navigator.gpu.requestAdapter();
    if (a) { gpu = true; f16 = a.features.has("shader-f16"); }
  } catch {}
  progressCb = (p: any) => {
    if (p.status === "progress") self.postMessage({ type: "progress", file: p.file, loaded: p.loaded, total: p.total });
  };
  let label;
  try {
    if (!gpu) throw new Error("no gpu");
    // Image encoder on the graphics chip; the small decoder runs fastest on the CPU.
    model = await SamModel.from_pretrained(MODEL, {
      device: { vision_encoder: "webgpu", prompt_encoder_mask_decoder: "wasm" },
      dtype: { vision_encoder: f16 ? "fp16" : "fp32", prompt_encoder_mask_decoder: "q8" },
      progress_callback: progressCb,
    });
    onGpu = true;
    label = "Graphics chip (WebGPU)";
  } catch {
    await loadCpu();
    label = "CPU (WebAssembly)";
  }
  processor = await AutoProcessor.from_pretrained(MODEL);
  self.postMessage({ type: "ready", device: label, cached: env.useBrowserCache });
}
async function loadCpu() {
  model = await SamModel.from_pretrained(MODEL, { device: "wasm", dtype: "q8", progress_callback: progressCb });
  onGpu = false;
}

async function encode(m: any) {
  emb = null; embId = -1;
  const t = performance.now();
  inputs = await processor(new RawImage(m.rgb, m.w, m.h, 3));
  try { emb = await model.get_image_embeddings(inputs); }
  catch (err: any) {
    if (!onGpu) throw err;
    await loadCpu();                                  // some GPUs fail mid-run: retry once on the CPU
    self.postMessage({ type: "ready", device: "CPU (WebAssembly)", cached: env.useBrowserCache });
    emb = await model.get_image_embeddings(inputs);
  }
  embId = m.id;
  self.postMessage({ type: "encoded", id: m.id, ms: Math.round(performance.now() - t) });
}

// Points: [{x, y, label}] in 0..1 image coordinates; label 1 = include, 0 = exclude.
async function decode(m: any) {
  if (m.id !== embId) return;
  const rs = inputs.reshaped_input_sizes[0];
  const coords: number[] = [], labels: bigint[] = [];
  for (const p of m.points) { coords.push(p.x * rs[1], p.y * rs[0]); labels.push(BigInt(p.label)); }
  const out = await model({
    ...emb,
    input_points: new Tensor("float32", coords, [1, 1, m.points.length, 2]),
    input_labels: new Tensor("int64", labels, [1, 1, m.points.length]),
  });
  // SAM proposes 3 masks. pred_masks are 256x256 logits over the padded 1024px square;
  // keep the part covering the image and return all three, smallest to largest.
  const gh = Math.round(rs[0] / 4), gw = Math.round(rs[1] / 4);
  const d = out.pred_masks.data, sc = out.iou_scores.data;
  const masks: Float32Array[] = [], areas: number[] = [];
  for (let k = 0; k < 3; k++) {
    const lg = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) lg.set(d.subarray(k * 65536 + y * 256, k * 65536 + y * 256 + gw), y * gw);
    let a = 0;
    for (let i = 0; i < lg.length; i++) if (lg[i] > 0) a++;
    masks.push(lg); areas.push(a);
  }
  const order = [0, 1, 2].sort((a, b) => areas[a] - areas[b]);
  const logits = order.map(i => masks[i]), scores = order.map(i => sc[i]);
  let best = 0;
  for (let k = 1; k < 3; k++) if (scores[k] > scores[best]) best = k;
  self.postMessage({ type: "mask", id: m.id, hover: m.hover, key: m.key, gw, gh, logits, scores, best }, logits.map(l => l.buffer));
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const m = queue.shift();
    try {
      if (m.type === "load") await load(m.modelBase);
      else if (m.type === "encode") await encode(m);
      else if (m.type === "decode") await decode(m);
    } catch (err: any) {
      self.postMessage({ type: "error", stage: m.type, message: String((err && err.message) || err) });
    }
  }
  busy = false;
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  // Only the newest hover matters; a new photo makes every queued request stale.
  if (m.type === "decode" && m.hover) for (let i = queue.length - 1; i >= 0; i--) if (queue[i].hover) queue.splice(i, 1);
  if (m.type === "encode") for (let i = queue.length - 1; i >= 0; i--) if (queue[i].type !== "load") queue.splice(i, 1);
  queue.push(m);
  pump();
};
