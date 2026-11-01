/* Enhance: Real-ESRGAN general x4 v3 (BSD-3-Clause) on ONNX Runtime Web 1.22.0 (CPU/wasm), in its own
   module worker. It works through the photo in overlapping tiles so large photos fit in memory. */

import { localFile } from "../localModels";

export {};

// A dedicated worker's own globals. Declared here so this file type-checks against the DOM lib.
declare const self: {
  postMessage(message: unknown, transfer?: any[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
  navigator: any;
};

const ORT: string = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
// Pinned to one upload of the model and checked by hash, because it is a third-party copy of the original.
const MODEL_URL = "https://huggingface.co/Heliosoph/realesrgan-onnx/resolve/488e5dda07333179f229a6205d92135eea4c25e9/realesr-general-x4v3.onnx";
const MODEL_SHA256 = "09b757accd747d7e423c1d352b3e8f23e77cc5742d04bae958d4eb8082b76fa4";
const TILE = 128, OVERLAP = 16, SCALE = 4;

let ort: any, session: any = null;

async function sha256(bytes: Uint8Array) {
  const h = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, "0")).join("");
}

async function fetchModel(modelBase?: string) {
  let cache: Cache | null = null;
  try {
    cache = await caches.open("lightbox-models");
    const hit = await cache.match(MODEL_URL);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch { cache = null; }
  const own = await localFile(modelBase, "Heliosoph/realesrgan-onnx/realesr-general-x4v3.onnx");
  if (own && await sha256(own) === MODEL_SHA256) {
    if (cache) { try { await cache.put(MODEL_URL, new Response(own as BodyInit)); } catch {} }
    return own;
  }
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error("download failed (" + res.status + ")");
  const total = +res.headers.get("content-length")! || 4871181;
  const reader = res.body!.getReader(), parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    self.postMessage({ type: "progress", file: "model", loaded: got, total });
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  if (await sha256(buf) !== MODEL_SHA256) throw new Error("the downloaded model did not match its expected hash");
  if (cache) { try { await cache.put(MODEL_URL, new Response(buf)); } catch {} }
  return buf;
}

async function load(modelBase?: string) {
  ort = await import(/* @vite-ignore */ ORT + "ort.wasm.min.mjs");
  ort.env.wasm.wasmPaths = ORT;
  ort.env.wasm.numThreads = 1;
  session = await ort.InferenceSession.create(await fetchModel(modelBase), { executionProviders: ["wasm"] });
  self.postMessage({ type: "ready", device: "CPU (WebAssembly)", gpu: false });
}

/* Tile starts along one side: each tile is whole, and the last one is pushed back to end at the edge. */
function starts(size: number) {
  if (size <= TILE) return [0];
  const out: number[] = [], step = TILE - OVERLAP;
  for (let p = 0; p < size - TILE; p += step) out.push(p);
  out.push(size - TILE);
  return out;
}

async function runTile(rgb: Uint8ClampedArray, w: number, x0: number, y0: number, tw: number, th: number) {
  const input = new Float32Array(3 * tw * th);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const s = ((y0 + y) * w + x0 + x) * 3, d = y * tw + x;
    input[d] = rgb[s] / 255; input[tw * th + d] = rgb[s + 1] / 255; input[2 * tw * th + d] = rgb[s + 2] / 255;
  }
  const result = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, th, tw]) });
  return result[session.outputNames[0]].data as Float32Array;
}

async function enhance(m: { job: number; w: number; h: number; rgb: Uint8ClampedArray }) {
  const t0 = performance.now(), { w, h, rgb } = m;
  const xs = starts(w), ys = starts(h), total = xs.length * ys.length;
  const W = w * SCALE, H = h * SCALE, sum = new Float32Array(W * H * 3), weight = new Float32Array(W * H);
  const tw = Math.min(TILE, w), th = Math.min(TILE, h), ow = tw * SCALE, oh = th * SCALE, ramp = OVERLAP * SCALE;
  let done = 0;
  for (const y0 of ys) for (const x0 of xs) {
    const o = await runTile(rgb, w, x0, y0, tw, th), n = ow * oh;
    // Blend across the overlap so tile edges don't show. Sides on the photo's edge get no fade.
    for (let y = 0; y < oh; y++) {
      const wy = Math.min(1, Math.min(y0 === 0 ? ramp : y + 1, y0 + th >= h ? ramp : oh - y) / ramp);
      for (let x = 0; x < ow; x++) {
        const wx = Math.min(1, Math.min(x0 === 0 ? ramp : x + 1, x0 + tw >= w ? ramp : ow - x) / ramp);
        const a = wx * wy, d = (y0 * SCALE + y) * W + x0 * SCALE + x, s = y * ow + x;
        sum[d * 3] += o[s] * a; sum[d * 3 + 1] += o[n + s] * a; sum[d * 3 + 2] += o[2 * n + s] * a;
        weight[d] += a;
      }
    }
    done++;
    self.postMessage({ type: "tile", done, total });
  }
  const out = new Uint8ClampedArray(W * H * 3);
  for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = sum[i * 3 + c] / weight[i] * 255;
  self.postMessage({ type: "enhanced", job: m.job, w: W, h: H, data: out, ms: Math.round(performance.now() - t0), gpu: false }, [out.buffer]);
}

self.onmessage = async e => {
  const m = e.data;
  try {
    if (m.type === "load") await load(m.modelBase);
    if (m.type === "enhance") await enhance(m);
  } catch (err) {
    self.postMessage({ type: "error", stage: m.type, message: (err as Error).message || String(err) });
  }
};
