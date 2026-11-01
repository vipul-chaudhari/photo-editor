import { boxFilter, components } from "../select/refine";

/* Pulls the matte's edge inward by a few pixels, because the model's edge usually takes in some background
   at full strength. Averaging first means the new edge fades in instead of being cut hard. */
export function tightenMatte(data: Uint8Array, w: number, h: number) {
  const A = new Float32Array(w * h);
  for (let i = 0; i < A.length; i++) A[i] = data[i] / 255;
  const near = boxFilter(A, w, h, Math.round(w / 256));   // ~4 px at 1024
  for (let i = 0; i < A.length; i++) {
    const t = Math.min(1, Math.max(0, (near[i] - 0.55) / 0.4));
    data[i] = t * t * (3 - 2 * t) * 255 + 0.5;
  }
  return data;
}

/* The subject's own colour at every pixel, including under its soft edge: each channel averaged over nearby
   pixels weighted by how much subject they hold (the "blur fusion" estimate of Forte, 2021), done at two scales. */
export function estimateForeground(rgb: Uint8ClampedArray, matte: Uint8Array, w: number, h: number) {
  const n = w * h, out = new Uint8Array(n * 3), A = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = matte[i] / 255; A[i] = a * a * a; }   // cubed: lean hard on solid subject
  const wide = boxFilter(A, w, h, Math.round(w / 64)), near = boxFilter(A, w, h, Math.round(w / 256));
  for (let c = 0; c < 3; c++) {
    const P = new Float32Array(n);
    for (let i = 0; i < n; i++) P[i] = rgb[i * 3 + c] * A[i];
    const pw = boxFilter(P, w, h, Math.round(w / 64)), pn = boxFilter(P, w, h, Math.round(w / 256));
    for (let i = 0; i < n; i++) out[i * 3 + c] = near[i] > 0.02 ? pn[i] / near[i] : wide[i] > 1e-4 ? pw[i] / wide[i] : rgb[i * 3 + c];
  }
  return out;
}

/* Background matte cleanup: drop detached specks (e.g. bits of a fence) and faint haze away from the subject. */
export function cleanMatte(data: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h, on = new Uint8Array(n);
  for (let i = 0; i < n; i++) on[i] = data[i] > 127 ? 1 : 0;
  const { lab, sizes } = components(on, w, h);
  let big = 0;
  for (let k = 1; k < sizes.length; k++) if (sizes[k] > big) big = sizes[k];
  const kept = new Float32Array(n);
  for (let i = 0; i < n; i++) if (lab[i] && sizes[lab[i]] >= big * 0.05) kept[i] = 1;
  const near = boxFilter(kept, w, h, Math.round(w / 128));   // ~8 px at 1024
  for (let i = 0; i < n; i++) {
    if (on[i] && !kept[i]) data[i] = 0;                       // a speck that isn't part of the subject
    else if (near[i] === 0) data[i] = 0;                      // haze far from the subject
  }
  return data;
}
