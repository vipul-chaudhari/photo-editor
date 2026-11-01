/* Mask refinement: everything that turns SAM's coarse logits into a clean, photo-aligned mask.
   Moved unchanged from the single-file v6; only type annotations were added. */
import { state, type SelPoint } from "../../state";
import { originalRGB } from "../../render/gl";

// Luminance of the original photo at the selection's working size: the "guide" that edges snap to.
let guide: { w: number; h: number; L: Float32Array } | null = null;
export function getGuide(): Float32Array {
  const { sel } = state;
  if (guide && guide.w === sel.w && guide.h === sel.h) return guide.L;
  const rgb = originalRGB(sel.w, sel.h), n = sel.w * sel.h, L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = (0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]) / 255;
  guide = { w: sel.w, h: sel.h, L };
  return L;
}

/* The photo's pixels changed, so the guide must be rebuilt on next use. */
export function resetGuide() { guide = null; }

/* SAM's masks are ~256 px logits. Smooth them (removes the blocky staircase), upsample bilinearly
   to the working size, and map to a soft 0–255 alpha with a gentle edge. */
export function smoothLogits(lg: Float32Array, gw: number, gh: number): Float32Array {
  const tmp = new Float32Array(lg.length), out = new Float32Array(lg.length);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const i = y * gw + x, l = x > 0 ? i - 1 : i, r = x < gw - 1 ? i + 1 : i;
    tmp[i] = (lg[l] + 2 * lg[i] + lg[r]) / 4;
  }
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const i = y * gw + x, u = y > 0 ? i - gw : i, d = y < gh - 1 ? i + gw : i;
    out[i] = (tmp[u] + 2 * tmp[i] + tmp[d]) / 4;
  }
  return out;
}
export function upsample(lg: Float32Array, gw: number, gh: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const sx = gw / w, sy = gh / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, (y + 0.5) * sy - 0.5), y0 = Math.min(gh - 1, fy | 0), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, (x + 0.5) * sx - 0.5), x0 = Math.min(gw - 1, fx | 0), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
      const v = (lg[y0 * gw + x0] * (1 - tx) + lg[y0 * gw + x1] * tx) * (1 - ty) + (lg[y1 * gw + x0] * (1 - tx) + lg[y1 * gw + x1] * tx) * ty;
      const a = v * 0.45 + 0.5;
      out[y * w + x] = a <= 0 ? 0 : a >= 1 ? 255 : (a * 255) | 0;
    }
  }
  return out;
}

// Mean over a (2r+1)² window, O(n) with running sums, separable.
export function boxFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[o + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = s;
      s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
    }
  }
  const norm = 1 / ((2 * r + 1) * (2 * r + 1));
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s * norm;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

// He et al. guided filter: the mask follows the photo's own edges instead of the model's coarse 256 px grid.
export function guidedFilter(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = w * h, Ip = new Float32Array(n), II = new Float32Array(n);
  for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mI = boxFilter(I, w, h, r), mp = boxFilter(p, w, h, r), mIp = boxFilter(Ip, w, h, r), mII = boxFilter(II, w, h, r);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = mII[i] - mI[i] * mI[i], c = mIp[i] - mI[i] * mp[i];
    a[i] = c / (v + eps); b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = boxFilter(a, w, h, r), mb = boxFilter(b, w, h, r), q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}

// Connected regions of on[] (4-neighbour). Returns labels and the size of each region.
export function components(on: Uint8Array, w: number, h: number): { lab: Int32Array; sizes: number[] } {
  const lab = new Int32Array(w * h), sizes: number[] = [0], stack = new Int32Array(w * h);
  for (let s = 0; s < on.length; s++) {
    if (!on[s] || lab[s]) continue;
    const id = sizes.length;
    let top = 0, size = 0;
    stack[top++] = s; lab[s] = id;
    while (top) {
      const i = stack[--top]; size++;
      const x = i % w;
      if (x > 0 && on[i - 1] && !lab[i - 1]) { lab[i - 1] = id; stack[top++] = i - 1; }
      if (x < w - 1 && on[i + 1] && !lab[i + 1]) { lab[i + 1] = id; stack[top++] = i + 1; }
      if (i >= w && on[i - w] && !lab[i - w]) { lab[i - w] = id; stack[top++] = i - w; }
      if (i < on.length - w && on[i + w] && !lab[i + w]) { lab[i + w] = id; stack[top++] = i + w; }
    }
    sizes.push(size);
  }
  return { lab, sizes };
}

export function refineMask(raw: Uint8Array, w: number, h: number, points: SelPoint[]): Uint8Array {
  const n = w * h, on = new Uint8Array(n);
  for (let i = 0; i < n; i++) on[i] = raw[i] > 127 ? 1 : 0;
  // 1. Keep only the pieces you clicked on (plus any piece at least a quarter as big as the largest one kept).
  const { lab, sizes } = components(on, w, h);
  const keep = new Uint8Array(sizes.length);
  let biggest = 0;
  for (const p of points) {
    if (p.label !== 1) continue;
    const id = lab[Math.min(h - 1, Math.floor(p.y * h)) * w + Math.min(w - 1, Math.floor(p.x * w))];
    if (id) { keep[id] = 1; biggest = Math.max(biggest, sizes[id]); }
  }
  if (!biggest) { let best = 0; for (let k = 1; k < sizes.length; k++) if (sizes[k] > sizes[best]) best = k; if (best) { keep[best] = 1; biggest = sizes[best]; } }
  for (let k = 1; k < sizes.length; k++) if (sizes[k] >= biggest * 0.25) keep[k] = 1;
  const p = new Float32Array(n);
  for (let i = 0; i < n; i++) p[i] = lab[i] && keep[lab[i]] ? raw[i] / 255 : 0;
  // 2. Fill small holes inside the object (gaps under 0.3% of the photo that don't touch the border).
  const off = new Uint8Array(n);
  for (let i = 0; i < n; i++) off[i] = p[i] > 0.5 ? 0 : 1;
  const holes = components(off, w, h), touches = new Uint8Array(holes.sizes.length);
  for (let x = 0; x < w; x++) { touches[holes.lab[x]] = 1; touches[holes.lab[(h - 1) * w + x]] = 1; }
  for (let y = 0; y < h; y++) { touches[holes.lab[y * w]] = 1; touches[holes.lab[y * w + w - 1]] = 1; }
  for (let i = 0; i < n; i++) { const id = holes.lab[i]; if (id && !touches[id] && holes.sizes[id] < n * 0.003) p[i] = 1; }
  // 3. Snap the edge to the photo, then firm it up so it is crisp but not jagged.
  const r = Math.max(2, Math.round(Math.max(w, h) / 170));
  const q = guidedFilter(getGuide(), p, w, h, r, 0.0008), out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, Math.max(0, (q[i] - 0.2) / 0.6)), v = t * t * (3 - 2 * t);
    out[i] = (v * 255 + 0.5) | 0;
  }
  return out;
}
