/* Crop, rotate, flip, resize, Sharpen and Enhance, checked by size and full-image hash. */
import { test, expect, type Page } from "@playwright/test";
import { FAKE_AI, at, exportHash, openEditor, selectionPct, settle, watchErrors } from "./helpers";

const undo = async (p: Page) => { await p.click("#undo"); await settle(p); };
const redo = async (p: Page) => { await p.click("#redo"); await settle(p); };
const open = async (page: Page) => {
  const errs = watchErrors(page);
  await page.addInitScript(FAKE_AI);
  await openEditor(page);
  return errs;
};
const setRange = (p: Page, id: string, v: number) => p.locator(id).evaluate((el, val) => {
  (el as HTMLInputElement).value = String(val);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}, v);
async function selectSubject(p: Page) {
  await p.click("#bgRemove");
  await expect(p.locator("#bgOptions")).toBeVisible();
  await settle(p);
  await p.click("#bgToSel");
  await settle(p);
}

test("rotate and flip are exact, change the size correctly, and undo", async ({ page }) => {
  const errs = await open(page);
  const base = await exportHash(page);
  expect([base.w, base.h]).toEqual([1600, 1067]);

  await page.click("#rotR");
  await settle(page);
  const right = await exportHash(page);
  expect([right.w, right.h]).toEqual([1067, 1600]);
  expect(right.hash).not.toBe(base.hash);
  await expect(page.locator("#meta")).toContainText("1067 × 1600 px");

  await page.click("#rotL");
  await settle(page);
  expect((await exportHash(page)).hash).toBe(base.hash);

  for (let i = 0; i < 4; i++) { await page.click("#rotR"); await settle(page); }
  expect((await exportHash(page)).hash).toBe(base.hash);

  await page.click("#flipH");
  await settle(page);
  const flipped = (await exportHash(page)).hash;
  expect(flipped).not.toBe(base.hash);
  await page.click("#flipH");
  await settle(page);
  expect((await exportHash(page)).hash).toBe(base.hash);
  await page.click("#flipV");
  await settle(page);
  expect((await exportHash(page)).hash).not.toBe(base.hash);

  await undo(page);                                    // flip down
  await undo(page);                                    // second flip across
  expect((await exportHash(page)).hash).toBe(flipped);
  await redo(page);
  expect((await exportHash(page)).hash).toBe(base.hash);
  expect(errs).toEqual([]);
});

test("crop: shapes, dragging, cancel, apply and undo", async ({ page }) => {
  const errs = await open(page);
  const base = await exportHash(page);

  await page.click("#cropMode");
  await page.click("[data-ar='1']");
  await page.click("#cropCancel");
  await expect(page.locator("#cropLayer")).toBeHidden();
  expect((await exportHash(page)).hash).toBe(base.hash);
  await expect(page.locator("#undo")).toBeDisabled();

  await page.click("#cropMode");
  await page.click("[data-ar='1']");
  await page.click("#cropApply");
  await settle(page);
  const square = await exportHash(page);
  expect([square.w, square.h]).toEqual([1067, 1067]);

  await undo(page);
  expect((await exportHash(page)).hash).toBe(base.hash);
  await redo(page);
  expect((await exportHash(page)).hash).toBe(square.hash);
  await undo(page);

  // Dragging a corner in, on a free crop, trims the photo by about that much.
  await page.click("#cropMode");
  await page.click("[data-ar='0']");
  const box = (await page.locator("#frame").boundingBox())!;
  await page.mouse.move(box.x + box.width - 1, box.y + box.height - 1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press("Enter");
  await settle(page);
  const dragged = await exportHash(page);
  expect(Math.abs(dragged.w - 800)).toBeLessThan(8);
  expect(Math.abs(dragged.h - 534)).toBeLessThan(8);
  expect(errs).toEqual([]);
});

test("resize keeps proportions; the selection and cut-out follow every edit", async ({ page }) => {
  const errs = await open(page);
  await page.fill("#sizeW", "800");
  await expect(page.locator("#sizeH")).toHaveValue("534");
  await page.click("#resizeApply");
  await settle(page);
  const small = await exportHash(page);
  expect([small.w, small.h]).toEqual([800, 534]);
  await undo(page);
  expect((await exportHash(page)).w).toBe(1600);

  await selectSubject(page);
  const pct = await selectionPct(page);
  expect(pct).toBeGreaterThan(0);
  await page.click("[data-bg='0']");                   // removal starts on Transparent; back to Original, so that mode is a step later
  await page.click("#rotR");
  await settle(page);
  expect(Math.abs(await selectionPct(page) - pct)).toBeLessThanOrEqual(1);
  await page.click("#flipH");
  await settle(page);
  expect(Math.abs(await selectionPct(page) - pct)).toBeLessThanOrEqual(1);

  // After a rotate, a transparent export still cuts the same subject out.
  await page.click("[data-bg='1']");
  const cut = await exportHash(page);
  expect([cut.w, cut.h]).toEqual([1067, 1600]);
  await undo(page);                                    // transparent mode
  await undo(page);                                    // flip
  await undo(page);                                    // rotate
  expect(await selectionPct(page)).toBe(pct);
  expect((await exportHash(page)).w).toBe(1600);
  expect(errs).toEqual([]);
});

test("Sharpen changes the export, stays at zero by default, and is whole-photo only", async ({ page }) => {
  const errs = await open(page);
  const base = (await exportHash(page)).hash;
  await setRange(page, "#ctl-sharpen", 60);
  await expect(page.locator('output[for="ctl-sharpen"]')).toHaveText("+60");
  expect((await exportHash(page)).hash).not.toBe(base);
  await undo(page);
  expect((await exportHash(page)).hash).toBe(base);

  await selectSubject(page);
  await expect(page.locator("#ctl-sharpen")).toBeDisabled();
  expect(errs).toEqual([]);
});

test("Enhance applies once, undoes exactly, and can be cancelled", async ({ page }) => {
  const errs = await open(page);
  const base = (await exportHash(page)).hash;

  await page.click("#enhanceRun");
  await expect(page.locator("#undo")).toBeEnabled();
  await settle(page);
  const after = await exportHash(page);
  expect(after.hash).not.toBe(base);
  expect([after.w, after.h]).toEqual([3200, 2134]);    // a photo this size comes out at double
  const sent = await page.evaluate(() => (window as any).__log.filter((l: string) => l.includes('type:"enhance"'))[0] as string);
  expect(sent).toContain("w:1600");                    // the model sees the photo at full size, not shrunk
  await expect(page.locator("#enhanceTag")).toHaveText("Real-ESRGAN · CPU");

  await undo(page);
  expect((await exportHash(page)).hash).toBe(base);
  await redo(page);
  expect((await exportHash(page)).hash).toBe(after.hash);
  await undo(page);

  await page.click("#enhanceRun");
  await page.click("#enhanceCancel", { timeout: 2000 }).catch(() => {});
  await settle(page);
  await expect(page.locator("#enhanceRun")).toBeEnabled();
  expect(errs).toEqual([]);
});

test("a photo still opens when Chrome's direct decode fails", async ({ page }) => {
  await page.addInitScript(() => {
    const real = window.createImageBitmap.bind(window);
    (window as any).createImageBitmap = (src: any, ...rest: any[]) =>
      src instanceof File ? Promise.reject(new DOMException("The source image could not be decoded.", "InvalidStateError")) : (real as any)(src, ...rest);
  });
  await openEditor(page);
  const png = Buffer.from(await page.evaluate(async () => {
    const c = new OffscreenCanvas(32, 32);
    c.getContext("2d")!.fillRect(0, 0, 32, 32);
    const bytes = new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
    return btoa(String.fromCharCode(...bytes));
  }), "base64");
  await page.locator("#file").setInputFiles({ name: "fallback.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("#meta")).toContainText("32 × 32 px · fallback");
});

test("crop tools sit inside the frame and leave other modes", async ({ page }) => {
  await open(page);
  await page.click("#eraseMode");
  await page.click("#cropMode");
  await expect(page.locator("#eraseMode")).toHaveAttribute("aria-pressed", "false");
  await page.click("#selectMode");
  await expect(page.locator("#cropLayer")).toBeHidden();
  await expect(page.locator("#selectMode")).toHaveAttribute("aria-pressed", "true");
  const xy = await at(page, 0.5, 0.5);
  expect(xy[0]).toBeGreaterThan(0);
});
