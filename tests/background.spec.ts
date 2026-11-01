/* Ported from tests/legacy/test_background.py. The fake matte is a centred ellipse. */
import { test, expect } from "@playwright/test";
import { watchErrors, openEditor, exportPixels, fakeWorker } from "./helpers";

const FAKE = fakeWorker(`
  if (m.type === 'load') send({ type:'ready', device:'Graphics chip (WebGPU)', cached:true, gpu:true });
  if (m.type === 'run') {
    const W = 1024, H = 1024, u8 = new Uint8Array(W*H);
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) { const dx=(x-512)/300, dy=(y-560)/380; u8[y*W+x] = dx*dx+dy*dy < 1 ? 255 : 0; }
    send({ type:'matte', id:m.id, w:W, h:H, data:u8, ms:1400 });
  }`);

test("remove background, then switch between the four modes", async ({ page }) => {
  const errs = watchErrors(page);
  await page.addInitScript(FAKE);
  await openEditor(page);

  await page.click("#bgRemove");
  await expect(page.locator("#bgOptions")).toBeVisible();
  await expect(page.locator("#bgTag")).toHaveText("ormbg · GPU");
  await expect(page.locator("[data-bg='1']")).toHaveAttribute("aria-pressed", "true");

  const corner: [number, number] = [0.05, 0.05], centre: [number, number] = [0.5, 0.55];
  const transparent = await exportPixels(page, [corner, centre]);
  expect(transparent.px[0][3]).toBe(0);               // background cut away
  expect(transparent.px[1][3]).toBe(255);             // subject kept
  expect(transparent.note).toContain("transparent background");

  await page.click("[data-bg='2']");
  await expect(page.locator("#bgColorRow")).toBeVisible();
  await page.click("#swatches button:nth-child(6)");  // #c0392b
  const red = await exportPixels(page, [corner, centre]);
  expect(red.px[0][3]).toBe(255);
  expect(red.px[0][0]).toBeGreaterThan(red.px[0][1] + 40);
  expect(red.px[0][0]).toBeGreaterThan(red.px[0][2] + 40);

  await page.click("[data-bg='3']");
  await expect(page.locator("#bgBlurRow")).toBeVisible();
  const blur = await exportPixels(page, [corner, centre]);
  expect(blur.px[0][3]).toBe(255);

  await page.click("[data-bg='0']");
  const original = await exportPixels(page, [corner, centre]);
  expect(original.px[0][3]).toBe(255);
  expect(original.note).not.toContain("transparent");

  await page.click("#bgToSel");
  await expect(page.locator("#tgtLocal")).toBeEnabled();
  await expect(page.locator("#tgtLocal")).toContainText("%");
  await expect(page.locator("#tgtLocal")).toHaveAttribute("aria-pressed", "true");

  // Phone width: the layout stacks and nothing overflows sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errs).toEqual([]);
});
