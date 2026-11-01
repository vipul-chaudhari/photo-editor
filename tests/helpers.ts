import { expect, type Page } from "@playwright/test";

/** Collects page errors and console errors, like the `errs` list in the legacy Python checks. */
export function watchErrors(page: Page) {
  const errs: string[] = [];
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !m.text().includes("ERR_TUNNEL")) errs.push("console: " + m.text()); });
  return errs;
}

/** Opens the editor and waits for the sample photo to be on screen. */
export async function openEditor(page: Page) {
  await page.goto("/");
  await expect(page.locator("#meta")).toContainText("Sample photo (generated)");
}

/** Waits until Smart select has its model and the photo is analysed, so clicks are not turned away. */
export async function waitForAnalysis(page: Page) {
  await expect(page.locator("#aiTag")).not.toContainText("on device");
  await expect(page.locator("#frame")).not.toHaveClass(/busy/);
}

/** Exports at full resolution and reads back pixels at fractional positions. */
export async function exportPixels(page: Page, points: [number, number][]) {
  await page.click("#export");
  await expect(page.locator("#sheet")).toBeVisible();
  await expect(page.locator("#exportImg")).toHaveJSProperty("complete", true);
  const out = await page.evaluate(async (pts) => {
    const im = document.getElementById("exportImg") as HTMLImageElement;
    await im.decode();
    const c = new OffscreenCanvas(im.naturalWidth, im.naturalHeight);
    const x = c.getContext("2d")!;
    x.drawImage(im, 0, 0);
    return {
      px: pts.map(([fx, fy]) => Array.from(x.getImageData(fx * c.width | 0, fy * c.height | 0, 1, 1).data)),
      note: (document.getElementById("exportNote") as HTMLElement).textContent || "",
    };
  }, points);
  await page.click("#closeSheet");
  await expect(page.locator("#sheet")).toBeHidden();
  return out;
}

export const chroma = (p: number[]) => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);

/** Share of the photo currently selected, read off the Selection button. */
export async function selectionPct(page: Page) {
  const t = (await page.textContent("#tgtLocal")) || "";
  const m = t.match(/(\d+)%/);
  return m ? +m[1] : 0;
}

/** A stand-in Worker that answers the real message protocol. Installed before any page script runs. */
export const fakeWorker = (body: string) => `
window.__calls = [];
window.Worker = class {
  constructor() {}
  postMessage(m) {
    window.__calls.push(m);
    const send = (d) => setTimeout(() => this.onmessage && this.onmessage({ data: d }), 25);
    ${body}
  }
  terminate() {}
};`;

/** Exports through the UI and leaves the decoded pixels in window.__rgba; returns their hash. */
export async function exportHash(page: Page) {
  const before = await page.locator("#exportImg").getAttribute("src");
  await page.click("#export");
  await expect(page.locator("#sheet")).toBeVisible();
  await expect.poll(() => page.locator("#exportImg").getAttribute("src")).not.toBe(before);
  const out = await page.evaluate(async () => {
    const im = document.getElementById("exportImg") as HTMLImageElement;
    await im.decode();
    const c = new OffscreenCanvas(im.naturalWidth, im.naturalHeight);
    const x = c.getContext("2d")!;
    x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    (window as any).__rgba = d;
    const h = await crypto.subtle.digest("SHA-256", d);
    return { w: c.width, h: c.height, hash: Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, "0")).join("") };
  });
  await page.click("#closeSheet");
  await expect(page.locator("#sheet")).toBeHidden();
  return out;
}

/* A stand-in for all three AI workers, so the code around the models is compared on identical input.
   Its output is deterministic and deliberately messy (blocky edges, noise, holes, stray islands, haze),
   so refineMask and cleanMatte have real work to do. Everything sent to a worker is logged as a hash. */
export const FAKE_AI = `
window.__pending = 0; window.__log = [];
const fnv = a => {
  const b = a instanceof ArrayBuffer ? new Uint8Array(a) : new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let h = 2166136261;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
};
const noise = (x, y, k) => ((Math.imul(x * 73856093 ^ y * 19349663 ^ k * 83492791, 2654435761) >>> 16) & 255) / 255;
function logits(points, s, gw, gh, k) {
  const lg = new Float32Array(gw * gh).fill(-6), B = 8;
  const disc = (cx, cy, r, set) => {
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const bx = (x / B | 0) * B + B / 2, by = (y / B | 0) * B + B / 2;
      set(y * gw + x, r - Math.hypot(bx - cx, by - cy), x, y);
    }
  };
  for (const p of points) if (p.label === 1) {
    const cx = p.x * gw, cy = p.y * gh;
    disc(cx, cy, 28 * s, (i, d, x, y) => { lg[i] = Math.max(lg[i], d * 0.8 + (noise(x, y, k) - 0.5) * 3); });
    disc((cx + 70) % gw, cy, 16 * s, (i, d) => { lg[i] = Math.max(lg[i], d * 0.8); });   // island kept by size
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++)
      if (Math.hypot(x - cx - 10, y - cy) < 3) lg[y * gw + x] = -6;                      // small hole
  }
  for (const p of points) if (p.label === 0)
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++)
      if (Math.hypot(x - p.x * gw, y - p.y * gh) < 14) lg[y * gw + x] = -6;
  for (let y = 27; y < 33; y++) for (let x = 227; x < 233; x++) lg[y * gw + x] = 6;      // stray speck
  return lg;
}
function matte() {
  const W = 1024, H = 1024, u8 = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - 512) / 300, dy = (y - 560) / 380, e = dx * dx + dy * dy;
    let v = e < 1 ? Math.min(255, (1 - e) * 2000) : e < 1.5 ? 25 : 0;
    if (Math.hypot(x - 100, y - 100) < 12) v = 255;                                      // detached speck
    if (v > 0 && v < 255) v = Math.min(255, v + noise(x, y, 5) * 20);
    u8[y * W + x] = v;
  }
  return { w: W, h: H, data: u8 };
}
window.Worker = class {
  constructor() {}
  postMessage(m) {
    if (!(m.type === 'decode' && m.hover)) window.__log.push(Object.keys(m).filter(k => k !== 'modelBase').sort().map(k => {
      const v = m[k];
      return k + ':' + (ArrayBuffer.isView(v) || v instanceof ArrayBuffer ? fnv(v) : JSON.stringify(v));
    }).join(' '));
    const send = d => { window.__pending++; setTimeout(() => { window.__pending--; if (!this.dead && this.onmessage) this.onmessage({ data: d }); }, 25); };
    if (m.type === 'load') send({ type:'ready', device:'Graphics chip (WebGPU)', cached:true, gpu:true });
    if (m.type === 'encode') { window.__enc = { w:m.w, h:m.h }; send({ type:'encoded', id:m.id, ms:5 }); }
    if (m.type === 'decode') {
      const gw = 256, gh = Math.round(256 * window.__enc.h / window.__enc.w);
      send({ type:'mask', id:m.id, hover:m.hover, key:m.key, gw, gh, scores:[0.8,0.95,0.7], best:1,
             logits:[0.6, 1, 1.6].map((s, k) => logits(m.points, s, gw, gh, k)) });
    }
    if (m.type === 'run' && m.img) {
      const n = m.w * m.h, out = new Uint8Array(3 * n); out.set(m.img);
      for (let i = 0; i < n; i++) if (m.mask[i] === 0) {
        const x = i % m.w, y = i / m.w | 0;
        out[i] = (x * 3 + y) % 256; out[n + i] = (y * 3 + m.w) % 256; out[2 * n + i] = (x + y + m.h) % 256;
      }
      send({ type:'result', job:m.job, data:out, ms:5 });
    } else if (m.type === 'run') send({ type:'matte', id:m.id, ms:5, ...matte() });
    if (m.type === 'enhance') {
      const data = new Uint8ClampedArray(m.rgb.length);
      for (let i = 0; i < data.length; i++) data[i] = 255 - m.rgb[i];
      send({ type:'tile', done:1, total:1 });
      send({ type:'enhanced', job:m.job, w:m.w, h:m.h, data, ms:5, gpu:true });
    }
  }
  terminate() { this.dead = true; }
};`;

export const settle = async (p: Page) => {
  await p.waitForFunction(() => (window as any).__pending === 0);
  await p.waitForTimeout(150);
};
export async function at(p: Page, fx: number, fy: number) {
  const box = (await p.locator("#frame").boundingBox())!;
  return [box.x + box.width * fx, box.y + box.height * fy] as const;
}
export async function clickAt(p: Page, fx: number, fy: number, modifier?: "Alt" | "Shift") {
  const xy = await at(p, fx, fy);
  if (modifier) await p.keyboard.down(modifier);
  await p.mouse.move(...xy);
  await settle(p);
  await p.mouse.click(...xy);
  if (modifier) await p.keyboard.up(modifier);
}
