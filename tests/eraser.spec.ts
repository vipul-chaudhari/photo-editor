/* Ported from tests/legacy/test_eraser.py.
   The fake eraser fills the hole with pure green, so erased pixels are unmistakable;
   the same fake also answers the background worker with a centred ellipse matte. */
import { test, expect } from "@playwright/test";
import { watchErrors, openEditor, exportPixels, fakeWorker } from "./helpers";

const FAKE = fakeWorker(`
  window.__runs = window.__runs || [];
  if (m.type === 'load') send({ type:'ready', device:'Graphics chip (WebGPU)', cached:true, gpu:true });
  if (m.type === 'run' && m.img) {
    const n = m.w * m.h, out = new Uint8Array(3 * n); out.set(m.img);
    let holes = 0;
    for (let i = 0; i < n; i++) if (m.mask[i] === 0) { out[i] = 0; out[n + i] = 255; out[2 * n + i] = 0; holes++; }
    window.__runs.push({ w: m.w, h: m.h, holes });
    send({ type:'result', job:m.job, data:out, ms:1500 });
  } else if (m.type === 'run') {
    const W = 1024, H = 1024, u8 = new Uint8Array(W*H);
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) { const dx=(x-512)/200, dy=(y-512)/200; u8[y*W+x] = dx*dx+dy*dy < 1 ? 255 : 0; }
    send({ type:'matte', id:m.id, w:W, h:H, data:u8, ms:900 });
  }`);

const isGreen = (p: number[]) => p[1] > 180 && p[0] < 80 && p[2] < 80;

test("brush to erase, undo, then erase the selection", async ({ page }) => {
  const errs = watchErrors(page);
  await page.addInitScript(FAKE);
  await openEditor(page);

  const before = await exportPixels(page, [[0.3, 0.3], [0.7, 0.7]]);
  expect(isGreen(before.px[0])).toBe(false);

  await page.click("#eraseMode");
  await expect(page.locator("#brushRow")).toBeVisible();
  const box = (await page.locator("#frame").boundingBox())!;
  const at = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;

  await page.mouse.move(...at(0.25, 0.3));
  await page.mouse.down();
  for (let k = 0; k < 10; k++) await page.mouse.move(...at(0.25 + 0.01 * k, 0.3));
  await page.mouse.up();

  await expect(page.locator("#undoErase")).toBeEnabled();
  const runs = await page.evaluate(() => (window as any).__runs);
  expect(runs.length).toBe(1);
  expect(runs[0].holes).toBeGreaterThan(0);

  const after = await exportPixels(page, [[0.3, 0.3], [0.7, 0.7]]);
  expect(isGreen(after.px[0])).toBe(true);                  // painted area was filled in
  expect(after.px[1]).toEqual(before.px[1]);                // untouched pixels are byte-identical

  await page.click("#undoErase");
  const undone = await exportPixels(page, [[0.3, 0.3]]);
  expect(undone.px[0]).toEqual(before.px[0]);

  // Erase whatever the subject matte selects.
  await page.click("#eraseMode");
  await page.click("#bgRemove");
  await expect(page.locator("#bgOptions")).toBeVisible();
  await page.click("[data-bg='0']");
  await page.click("#bgToSel");
  await expect(page.locator("#eraseSel")).toBeEnabled();

  await page.click("#eraseSel");
  await expect.poll(() => page.evaluate(() => (window as any).__runs.length)).toBeGreaterThan(1);
  const centre = await exportPixels(page, [[0.5, 0.5]]);
  expect(isGreen(centre.px[0])).toBe(true);
  await expect(page.locator("#tgtLocal")).toHaveText("Selection");   // selection cleared with the object
  expect(errs).toEqual([]);
});
