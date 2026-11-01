/* Ported from tests/legacy/test_select_refine.py.
   Include points add a disc (r = 30 grid px), exclude points cut one out (r = 18);
   three proposals at x0.6 / x1 / x1.6 so size switching can be checked. */
import { test, expect } from "@playwright/test";
import { watchErrors, openEditor, waitForAnalysis, selectionPct, fakeWorker } from "./helpers";

const FAKE = fakeWorker(`
  if (m.type === 'load') send({ type:'ready', device:'Graphics chip (WebGPU)', cached:true });
  if (m.type === 'encode') { window.__enc = { w:m.w, h:m.h }; send({ type:'encoded', id:m.id, ms:5 }); }
  if (m.type === 'decode') {
    window.__decodes = window.__decodes || [];
    window.__decodes.push({ hover:m.hover, labels:m.points.map(p=>p.label).join('') });
    const gw = 256, gh = Math.round(256 * window.__enc.h / window.__enc.w);
    const logits = [0.6, 1, 1.6].map(s => {
      const lg = new Float32Array(gw*gh).fill(-5);
      for (let y=0;y<gh;y++) for (let x=0;x<gw;x++) {
        let v = -5;
        for (const p of m.points) { const d = Math.hypot(x-p.x*gw, y-p.y*gh); if (p.label===1) v = Math.max(v, (30*s - d)*0.8); }
        for (const p of m.points) { const d = Math.hypot(x-p.x*gw, y-p.y*gh); if (p.label===0 && d < 18) v = Math.min(v, (d-18)*0.8); }
        lg[y*gw+x] = v;
      }
      return lg;
    });
    send({ type:'mask', id:m.id, hover:m.hover, key:m.key, gw, gh, logits, scores:[0.8,0.95,0.7], best:1 });
  }`);

test("refine one object: exclude, size, undo, new object", async ({ page }) => {
  const errs = watchErrors(page);
  await page.addInitScript(FAKE);
  await openEditor(page);
  await page.click("#selectMode");
  await waitForAnalysis(page);

  const box = (await page.locator("#frame").boundingBox())!;
  const at = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;

  await page.mouse.move(...at(0.5, 0.5));
  await page.mouse.click(...at(0.5, 0.5));
  await expect.poll(() => selectionPct(page)).toBeGreaterThan(0);
  const base = await selectionPct(page);
  await expect(page.locator("#sizeNote")).toBeVisible();

  // Scrolling up steps to the largest of SAM's three proposals.
  await page.mouse.wheel(0, -100);
  await expect(page.locator("#sizeNote span.on")).toHaveText("Whole");
  await expect.poll(() => selectionPct(page)).toBeGreaterThan(base);
  await page.mouse.wheel(0, 100);
  await expect(page.locator("#sizeNote span.on")).toHaveText("Object");

  // Alt-click cuts a part out of the same object.
  const ex = at(0.5 + 30 / 256 * 0.8, 0.5);
  await page.keyboard.down("Alt");
  await page.mouse.move(...ex);
  await page.mouse.click(...ex);
  await page.keyboard.up("Alt");
  await expect.poll(() => selectionPct(page)).toBeLessThan(base);

  await page.click("#undoPt");
  await expect.poll(() => selectionPct(page)).toBe(base);

  // Shift-click commits the current object and starts another one.
  const sx = at(0.15, 0.2);
  await page.keyboard.down("Shift");
  await page.mouse.move(...sx);
  await page.mouse.click(...sx);
  await page.keyboard.up("Shift");
  await expect.poll(() => selectionPct(page)).toBeGreaterThan(base);

  await page.click("#selectMode");
  await expect(page.locator("#undoPt")).toBeDisabled();
  expect(await page.evaluate(() =>
    (window as any).__decodes.filter((d: any) => !d.hover).map((d: any) => d.labels))).toContain("10");
  expect(errs).toEqual([]);
});
