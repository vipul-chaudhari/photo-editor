/* Magic eraser: MI-GAN (MIT) inpainting pipeline on ONNX Runtime Web 1.22.0 (CPU/wasm). */

import { localFile } from "../localModels";

export {};

// A dedicated worker's own globals. Declared here so this file type-checks against the DOM lib.
declare const self: {
  postMessage(message: unknown, transfer?: any[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
  navigator: any;
};

const ORT: string = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
const MODEL_URL = "https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx";
let ort: any, session: any = null;
const queue: any[] = [];
let busy = false;

async function fetchModel(modelBase?: string) {
  let cache: Cache | null = null;
  try {
    cache = await caches.open("lightbox-models");
    const hit = await cache.match(MODEL_URL);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch { cache = null; }
  const own = await localFile(modelBase, "andraniksargsyan/migan/migan_pipeline_v2.onnx");
  if (own) {
    if (cache) { try { await cache.put(MODEL_URL, new Response(own as BodyInit)); } catch {} }
    return own;
  }
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error("download failed (" + res.status + ")");
  const total = +res.headers.get("content-length")! || 28000000;
  const reader = res.body!.getReader(), parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    self.postMessage({ type: "progress", loaded: got, total });
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  if (cache) { try { await cache.put(MODEL_URL, new Response(buf)); } catch {} }
  return buf;
}
async function load(modelBase?: string) {
  ort = await import(/* @vite-ignore */ ORT + "ort.wasm.min.mjs");
  ort.env.wasm.wasmPaths = ORT;
  ort.env.wasm.numThreads = 1;
  session = await ort.InferenceSession.create(await fetchModel(modelBase), { executionProviders: ["wasm"] });
  self.postMessage({ type: "ready" });
}
async function run(m: any) {
  const t = performance.now();
  const out = await session.run({
    image: new ort.Tensor("uint8", m.img, [1, 3, m.h, m.w]),
    mask: new ort.Tensor("uint8", m.mask, [1, 1, m.h, m.w]),
  });
  const data = new Uint8Array(out.result.data);
  self.postMessage({ type: "result", job: m.job, data, ms: Math.round(performance.now() - t) }, [data.buffer]);
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
      self.postMessage({ type: "error", stage: m.type, job: m.job, message: String((err && err.message) || err) });
    }
  }
  busy = false;
}
self.onmessage = (e: MessageEvent) => { queue.push(e.data); pump(); };
