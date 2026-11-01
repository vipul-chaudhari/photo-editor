/* WebGL2 context, program, textures and the two ways of drawing:
   draw() to the visible canvas, renderPixels() off-screen for thumbnails, histogram, AI input and export. */
import { $, state, BG, ORDER, ORIGINAL, type Params, type ParamSet } from "../state";
import { VS, FS } from "./shaders";

export const view = $<HTMLCanvasElement>("view");
const ctx = view.getContext("webgl2", { antialias: false, premultipliedAlpha: false, alpha: true });
if (!ctx) {
  document.querySelector(".work")!.innerHTML = '<p class="fatal">This editor needs WebGL2, which this browser has turned off. Try a recent Chrome, Edge or Firefox, or check that hardware acceleration is enabled in your browser settings.</p>';
  throw new Error("WebGL2 is not available");
}
export const gl: WebGL2RenderingContext = ctx;

function compile(type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader failed to compile");
  return s;
}
const prog = gl.createProgram()!;
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "program failed to link");
gl.useProgram(prog);
gl.bindVertexArray(gl.createVertexArray());
const U: Record<string, WebGLUniformLocation | null> = {};
["uTex","uMask","uG","uL","uHasMask","uVig","uAspect","uSplit","uMatte","uBgMode","uBlurLod","uBlurUV","uBgColor","uSharpen","uTexel","uFg","uFgOn"]
  .forEach(n => U[n] = gl.getUniformLocation(prog, n));
gl.uniform1i(U.uTex, 0);
gl.uniform1i(U.uMask, 2);
gl.uniform1i(U.uMatte, 3);
gl.uniform1i(U.uFg, 4);

export const MAX = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 8192);
const srcTex = gl.createTexture();

function singleChannel(unit: number, tex: WebGLTexture | null, data: Uint8Array, w: number, h: number) {
  gl.activeTexture(unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.activeTexture(gl.TEXTURE0);
}

/* Selection mask lives on texture unit 2 as a single-channel 8-bit image. */
const maskTex = gl.createTexture();
export function uploadMask(data: Uint8Array, w: number, h: number) { singleChannel(gl.TEXTURE2, maskTex, data, w, h); }
uploadMask(new Uint8Array([0]), 1, 1);

/* Subject matte from background removal lives on texture unit 3 (1024x1024, stretched over the photo). */
const matteTex = gl.createTexture();
export function uploadMatte(data: Uint8Array, w: number, h: number) { singleChannel(gl.TEXTURE3, matteTex, data, w, h); }
uploadMatte(new Uint8Array([255]), 1, 1);

/* The subject's own colours, for clean cut-out edges, on texture unit 4 (same size as the matte). */
const fgTex = gl.createTexture();
export function uploadForeground(rgb: Uint8Array, w: number, h: number) {
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, fgTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, w, h, 0, gl.RGB, gl.UNSIGNED_BYTE, rgb);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.activeTexture(gl.TEXTURE0);
}
uploadForeground(new Uint8Array([0, 0, 0]), 1, 1);

const pack = (p: ParamSet) => ORDER.map(k => k === "exposure" ? p[k] : k === "hue" ? p[k] * Math.PI / 180 : p[k] / 100);

function setUniforms(p: Params, splitAt: number) {
  const { sel, img } = state;
  gl.uniform1fv(U.uG, pack(p.global));
  gl.uniform1fv(U.uL, pack(p.local));
  gl.uniform1f(U.uHasMask, sel.has ? 1 : 0);
  gl.uniform1f(U.uVig, p.global.vignette / 100);
  gl.uniform1f(U.uSharpen, p.global.sharpen / 100);
  const sharpPx = Math.max(1.5, Math.max(img.w, img.h) / 1000);
  gl.uniform2f(U.uTexel, sharpPx / img.w, sharpPx / img.h);
  gl.uniform1f(U.uAspect, img.w / img.h);
  gl.uniform1f(U.uSplit, splitAt);
  // The untouched original (AI input, auto-adjust analysis) never gets a replaced background.
  gl.uniform1f(U.uBgMode, p === ORIGINAL ? 0 : BG.mode);
  gl.uniform3fv(U.uBgColor, BG.color);
  gl.uniform1f(U.uFgOn, BG.cleanEdges ? 1 : 0);
  const radiusPx = BG.blur / 100 * 0.035 * Math.max(img.w, img.h);
  gl.uniform2f(U.uBlurUV, radiusPx / img.w, radiusPx / img.h);
  gl.uniform1f(U.uBlurLod, Math.max(0, Math.log2(radiusPx / 3)));
}

export function draw() {
  if (!state.img.w) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, view.width, view.height);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcTex);
  setUniforms(state.params, state.compare ? state.split : -1);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/* Render the edit off-screen and read the pixels back (rows come out bottom-up). */
export function renderPixels(p: Params, w: number, h: number): Uint8Array {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, w, h);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcTex);
  setUniforms(p, -1);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(tex);
  return px;
}

export function toImageData(px: Uint8Array, w: number, h: number): ImageData {
  const out = new ImageData(w, h);
  const row = w * 4;
  for (let y = 0; y < h; y++) out.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  return out;
}

/* The untouched original photo at w x h, as top-down RGB bytes for the AI models. */
export function originalRGB(w: number, h: number): Uint8ClampedArray {
  const px = renderPixels(ORIGINAL, w, h);
  const rgb = new Uint8ClampedArray(w * h * 3);
  for (let y = 0; y < h; y++) {
    const s = (h - 1 - y) * w * 4, d = y * w * 3;
    for (let x = 0; x < w; x++) { rgb[d + x * 3] = px[s + x * 4]; rgb[d + x * 3 + 1] = px[s + x * 4 + 1]; rgb[d + x * 3 + 2] = px[s + x * 4 + 2]; }
  }
  return rgb;
}

export function upload(source: TexImageSource) {
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/* Full-resolution copy of the unedited photo. The Magic eraser paints into it, then re-uploads it. */
export const base = document.createElement("canvas");
export const bctx = base.getContext("2d", { willReadFrequently: true })!;

/* ---------- Display sizing ---------- */
export const viewport = $("viewport"), frame = $("frame");
/* Zoomed in, the display needs more of the photo's real pixels to stay sharp. */
let detail = 1;
export function setDetail(z: number) { detail = z; fit(); }
export function fit() {
  const { img } = state;
  if (!img.w) return;
  const cs = getComputedStyle(viewport);
  const aw = viewport.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const ah = viewport.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (aw <= 0 || ah <= 0) return;
  const s = Math.min(aw / img.w, ah / img.h, 1);
  const cw = Math.max(1, Math.floor(img.w * s)), ch = Math.max(1, Math.floor(img.h * s));
  frame.style.width = cw + "px"; frame.style.height = ch + "px";
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.width = Math.min(img.w, Math.round(cw * dpr * detail));
  view.height = Math.min(img.h, Math.round(ch * dpr * detail));
  draw();
}
new ResizeObserver(fit).observe(viewport);
