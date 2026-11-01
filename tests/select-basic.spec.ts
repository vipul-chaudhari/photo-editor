/* Ported from tests/legacy/test_select_basic.py.
   The fake SAM returns one disc per include point, as three proposals. */
import { test, expect } from "@playwright/test";
import { watchErrors, openEditor, exportPixels, chroma, selectionPct, fakeWorker } from "./helpers";

const FAKE = fakeWorker(`
  if (m.type === 'load') { send({ type:'progress', file:'a', loaded:5e6, total:2e7 }); send({ type:'ready', device:'CPU (WebAssembly)', cached:false }); }
  if (m.type === 'encode') { window.__enc = { w:m.w, h:m.h, px: Array.from(m.rgb.slice(0,6)) }; send({ type:'encoded', id:m.id, ms:5 }); }
  if (m.type === 'decode') {
    const gw = 256, gh = Math.round(256 * window.__enc.h / window.__enc.w);
    const logits = [0.6, 1, 1.6].map(s => {
      const lg = new Float32Array(gw*gh).fill(-5);
      for (const p of m.points) for (let y=0;y<gh;y++) for (let x=0;x<gw;x++) {
        const d = Math.hypot(x - p.x*gw, y - p.y*gh);
        if (p.label === 1) lg[y*gw+x] = Math.max(lg[y*gw+x], (30*s - d) * 0.8);
      }
      for (const p of m.points) if (p.label === 0) for (let y=0;y<gh;y++) for (let x=0;x<gw;x++) {
        if (Math.hypot(x - p.x*gw, y - p.y*gh) < 18) lg[y*gw+x] = -5;
      }
      return lg;
    });
    send({ type:'mask', id:m.id, hover:m.hover, key:m.key, gw, gh, logits, scores:[0.8,0.95,0.7], best:1 });
  }`);

test("click to select, then adjust only the selection", async ({ page }) => {
  const errs = watchErrors(page);
  await page.addInitScript(FAKE);
  await openEditor(page);

  await page.click("#selectMode");
  // The photo is encoded once, at 1024 px on the long side (sample is 1600 x 1067).
  await expect.poll(() => page.evaluate(() => (window as any).__enc)).toEqual(
    expect.objectContaining({ w: 1024, h: 683 }));

  const box = (await page.locator("#frame").boundingBox())!;
  const at = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;

  await page.mouse.move(...at(0.68, 0.55));
  await page.mouse.click(...at(0.68, 0.55));
  await expect(page.locator("#tgtLocal")).toHaveAttribute("aria-pressed", "true");
  const one = await selectionPct(page);
  expect(one).toBeGreaterThan(0);

  // A second object is unioned with the first.
  await page.mouse.click(...at(0.15, 0.5));
  await expect.poll(() => selectionPct(page)).toBeGreaterThan(one);

  await page.click("#selectMode");
  await page.click(".filter:nth-child(7)");           // Mono, on the selection only
  await expect(page.locator("#ctl-vignette")).toBeDisabled();

  const { px } = await exportPixels(page, [[0.68, 0.55], [0.68, 0.2], [0.5, 0.9]]);
  expect(chroma(px[0])).toBeLessThan(8);              // inside the selection: greyscale
  expect(chroma(px[1])).toBeGreaterThan(12);          // sky, untouched
  expect(chroma(px[2])).toBeGreaterThan(8);           // water, untouched

  // Back to the whole photo: the sliders show the global set, which is still zeroed.
  await page.click("#tgtGlobal");
  await expect(page.locator("#ctl-vignette")).toBeEnabled();
  expect(await page.evaluate(() =>
    [...document.querySelectorAll('.ctl output[for^="ctl-"]')].map(o => o.getAttribute("for") + "=" + o.textContent).filter(s => !/=0/.test(s)))).toEqual([]);

  await page.click("#clearSel");
  await expect(page.locator("#tgtLocal")).toBeDisabled();
  await expect(page.locator("#tgtLocal")).toHaveText("Selection");
  expect(errs).toEqual([]);
});
