import { $, state } from "../state";
import { renderPixels } from "../render/gl";

const hist = $<HTMLCanvasElement>("hist");
let histTimer = 0;
export function scheduleHist() { clearTimeout(histTimer); histTimer = window.setTimeout(drawHist, 90); }

export function drawHist() {
  const { img, params } = state;
  if (!img.w) return;
  const w = Math.min(320, img.w), h = Math.max(1, Math.round(w * img.h / img.w));
  const px = renderPixels(params, w, h);
  const BINS = 64, r = new Float32Array(BINS), g = new Float32Array(BINS), b = new Float32Array(BINS), l = new Float32Array(BINS);
  for (let i = 0; i < px.length; i += 4) {
    r[px[i] >> 2]++; g[px[i + 1] >> 2]++; b[px[i + 2] >> 2]++;
    l[Math.min(63, (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) >> 2)]++;
  }
  const peak = Math.max(...l, ...r, ...g, ...b) || 1;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = hist.clientWidth, ch = hist.clientHeight;
  hist.width = Math.round(cw * dpr); hist.height = Math.round(ch * dpr);
  const x = hist.getContext("2d")!;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, cw, ch);
  const muted = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim();
  x.strokeStyle = muted; x.globalAlpha = 0.18; x.lineWidth = 1;
  for (let q = 1; q < 4; q++) { x.beginPath(); x.moveTo(Math.round(cw * q / 4) + 0.5, 0); x.lineTo(Math.round(cw * q / 4) + 0.5, ch); x.stroke(); }
  x.globalAlpha = 1;
  const pad = 3, plotH = ch - pad;
  const path = (arr: Float32Array) => {
    x.beginPath(); x.moveTo(0, ch);
    for (let i = 0; i < BINS; i++) x.lineTo(i / (BINS - 1) * cw, ch - Math.sqrt(arr[i] / peak) * plotH);
    x.lineTo(cw, ch); x.closePath();
  };
  path(l); x.fillStyle = muted; x.globalAlpha = 0.28; x.fill();
  x.globalAlpha = 0.9; x.lineWidth = 1.25;
  const series: [Float32Array, string][] = [[r, "#e0524f"], [g, "#3fae5a"], [b, "#4a7fe0"]];
  series.forEach(([arr, col]) => {
    x.beginPath();
    for (let i = 0; i < BINS; i++) { const yy = ch - Math.sqrt(arr[i] / peak) * plotH, xx = i / (BINS - 1) * cw; i ? x.lineTo(xx, yy) : x.moveTo(xx, yy); }
    x.strokeStyle = col; x.stroke();
  });
  x.globalAlpha = 1;
}
