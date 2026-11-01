/* Auto-adjust: exposure, contrast and white balance measured from the original. */
import { $, state, activePreset, ORIGINAL } from "../state";
import { renderPixels } from "../render/gl";
import { applyParams, markPreset, beginAdjust, commitAdjust } from "./adjustments";
import { toast } from "./toast";

export function initAutoAdjust() {
  $("auto").addEventListener("click", () => {
    const { img, target } = state;
    if (!img.w) return;
    beginAdjust();
    const w = Math.min(256, img.w), h = Math.max(1, Math.round(w * img.h / img.w));
    const px = renderPixels(ORIGINAL, w, h);
    const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    let R = 0, G = 0, B = 0;
    const n = px.length / 4;
    const lum = new Float32Array(n);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const r = lin(px[i]), g = lin(px[i + 1]), b = lin(px[i + 2]);
      R += r; G += g; B += b;
      lum[j] = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    }
    R /= n; G /= n; B /= n;
    const meanLin = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const sorted = Array.from(lum).sort((a, b) => a - b);
    const pct = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))] / 255;
    const round = (v: number, s: number) => Math.round(v / s) * s;
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    const range = pct(0.99) - pct(0.01);
    applyParams({
      exposure: round(clamp(Math.log2(0.18 / Math.max(meanLin, 1e-4)) * 0.6, -1.5, 1.5), 0.05),
      contrast: Math.round(clamp((0.85 - range) * 90, -20, 40)),
      shadows: pct(0.1) < 0.08 ? 20 : 0,
      highlights: pct(0.98) > 0.97 ? -20 : 0,
      temperature: Math.round(clamp((B - R) / Math.max(R + B, 1e-4) * 120, -35, 35)),
      vibrance: 15,
    });
    activePreset[state.target] = -1; markPreset();
    commitAdjust("Auto-adjust");
    toast(target === "local" ? "Auto-adjust applied to the selection." : "Auto-adjust applied. Fine-tune with the sliders.");
  });
}
