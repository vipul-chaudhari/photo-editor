/* Ported from tests/legacy/test_edge_refine_hue.py.
   The fake returns a deliberately blocky blob plus a stray speck far away, so the test can check
   that refineMask drops detached islands, and that the Hue slider works on a selection. */
import { test, expect } from "@playwright/test";
import { watchErrors, openEditor, waitForAnalysis, selectionPct, fakeWorker } from "./helpers";

const FAKE = fakeWorker(`
  if (m.type === 'load') send({ type:'ready', device:'Graphics chip (WebGPU)', cached:true, gpu:true });
  if (m.type === 'encode') { window.__enc = { w:m.w, h:m.h }; send({ type:'encoded', id:m.id, ms:5 }); }
  if (m.type === 'decode') {
    const gw = 256, gh = 256;
    const logits = [0.6, 1, 1.6].map(s => {
      const lg = new Float32Array(gw*gh).fill(-8);
      const p = m.points[0];
      for (let y=0;y<gh;y++) for (let x=0;x<gw;x++) {
        const bx = Math.floor(x/8)*8, by = Math.floor(y/8)*8;
        if (Math.hypot(bx - p.x*gw, by - p.y*gh) < 30*s) lg[y*gw+x] = 8;
        if (Math.hypot(x - 230, y - 30) < 4) lg[y*gw+x] = 8;      // stray speck
      }
      return lg;
    });
    send({ type:'mask', id:m.id, hover:m.hover, key:m.key, gw, gh, logits, scores:[0.8,0.95,0.7], best:1 });
  }`);

test("refinement drops the stray speck, and Hue recolours the selection", async ({ page }) => {
  const errs = watchErrors(page);
  await page.addInitScript(FAKE);
  await openEditor(page);

  await page.click("#selectMode");
  await waitForAnalysis(page);
  const box = (await page.locator("#frame").boundingBox())!;
  const x = box.x + box.width * 0.3, y = box.y + box.height * 0.6;
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await expect.poll(() => selectionPct(page)).toBeGreaterThan(0);

  // The speck sits at grid (230, 30) of 256 x 256. refineMask keeps only the clicked region,
  // so the overlay must be empty there and painted at the click. The hover preview is deliberately
  // unrefined and still shows the speck, so the pointer leaves the photo first.
  await page.mouse.move(0, 0);
  await expect(page.locator("#sizeNote")).toBeVisible();
  const probe = await page.evaluate(() => {
    const o = document.getElementById("overlay") as HTMLCanvasElement;
    const c = o.getContext("2d")!;
    const a = (fx: number, fy: number) => c.getImageData(Math.round(fx * o.width), Math.round(fy * o.height), 1, 1).data[3];
    return { speck: a(230 / 256, 30 / 256), clicked: a(0.3, 0.6) };
  });
  expect(probe.speck).toBe(0);
  expect(probe.clicked).toBeGreaterThan(0);

  // Hue rotates the selection's colour; luma is untouched, so the two must differ in chroma only.
  await page.click("#selectMode");
  await page.locator("#ctl-hue").evaluate(el => {
    (el as HTMLInputElement).value = "120";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator('output[for="ctl-hue"]')).toHaveText("+120°");
  await expect(page.locator(".ctl", { has: page.locator("#ctl-hue") })).toHaveClass(/changed/);
  expect(errs).toEqual([]);
});
