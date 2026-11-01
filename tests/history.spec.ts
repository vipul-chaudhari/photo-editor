/* Undo and redo across the whole editor. Each step is checked by hashing the full exported image,
   so "back to the same state" means every pixel, not just a label. */
import { test, expect, type Page } from "@playwright/test";
import { FAKE_AI, at, clickAt, exportHash, openEditor, selectionPct, settle, watchErrors } from "./helpers";

const hash = async (p: Page) => (await exportHash(p)).hash;
const slider = (p: Page, key: string, v: number, release = true) => p.locator("#ctl-" + key).evaluate((el, [val, rel]) => {
  (el as HTMLInputElement).value = String(val);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  if (rel) el.dispatchEvent(new Event("change", { bubbles: true }));
}, [v, release] as const);
const out = (p: Page, key: string) => p.locator(`output[for="ctl-${key}"]`);
const undo = async (p: Page) => { await p.click("#undo"); await settle(p); };
const redo = async (p: Page) => { await p.click("#redo"); await settle(p); };
const runs = (p: Page) => p.evaluate(() => (window as any).__log.filter((l: string) => l.includes('type:"run"')).length as number);

async function openWithFakeAi(page: Page) {
  const errs = watchErrors(page);
  await page.addInitScript(FAKE_AI);
  await openEditor(page);
  await expect(page.locator("#undo")).toBeDisabled();
  await expect(page.locator("#redo")).toBeDisabled();
  return errs;
}
async function stroke(p: Page, fx: number, fy: number) {
  await p.mouse.move(...await at(p, fx, fy));
  await p.mouse.down();
  for (let k = 0; k < 10; k++) await p.mouse.move(...await at(p, fx + 0.01 * k, fy));
  await p.mouse.up();
  await settle(p);
}

test("sliders, filters, auto-adjust and reset step back and forward exactly", async ({ page }) => {
  const errs = await openWithFakeAi(page);
  const base = await hash(page);

  await slider(page, "exposure", 0.2, false);          // one drag in several moves is one step
  await slider(page, "exposure", 0.5, false);
  await slider(page, "exposure", 0.75);
  const dragged = await hash(page);
  await page.click(".filter:nth-child(4)");            // Punch
  const punch = await hash(page);
  await page.click("#auto");
  const auto = await hash(page);
  await page.click("#reset");
  expect(await hash(page)).toBe(base);

  await undo(page); expect(await hash(page)).toBe(auto);
  await undo(page); expect(await hash(page)).toBe(punch);
  await expect(page.locator(".filter:nth-child(4)")).toHaveAttribute("aria-pressed", "true");
  await undo(page); expect(await hash(page)).toBe(dragged);
  await expect(out(page, "exposure")).toHaveText("+0.75 EV");
  await undo(page); expect(await hash(page)).toBe(base);
  await expect(out(page, "exposure")).toHaveText("0.00 EV");
  await expect(page.locator("#undo")).toBeDisabled();

  await redo(page); expect(await hash(page)).toBe(dragged);
  await redo(page); expect(await hash(page)).toBe(punch);
  await undo(page);

  // A new edit replaces whatever could have been redone.
  await slider(page, "contrast", 30);
  await expect(page.locator("#redo")).toBeDisabled();

  // Keyboard, plus double-click to zero a slider counts as a step.
  const contrast = await hash(page);
  await page.dblclick('label[for="ctl-contrast"]');
  await expect(out(page, "contrast")).toHaveText("0");
  await page.keyboard.press("Control+z");
  await settle(page);
  expect(await hash(page)).toBe(contrast);
  await page.keyboard.press("Control+y");
  await settle(page);
  await expect(out(page, "contrast")).toHaveText("0");
  await page.keyboard.press("Control+Shift+z");        // nothing left to redo
  await page.keyboard.press("Control+z");
  await settle(page);
  await expect(out(page, "contrast")).toHaveText("+30");

  expect(errs).toEqual([]);
});

test("selection: clicks stay with the object, finished steps undo and redo", async ({ page }) => {
  const errs = await openWithFakeAi(page);
  const base = await hash(page);

  await page.click("#selectMode");
  await expect(page.locator("#aiTag")).not.toContainText("on device");
  await settle(page);
  await clickAt(page, 0.3, 0.6);
  await settle(page);
  const first = await selectionPct(page);
  expect(first).toBeGreaterThan(0);

  // While refining, Undo takes back the click, as Undo click does.
  await clickAt(page, 0.3 + 28 / 256 * 0.8, 0.6, "Alt");
  await settle(page);
  expect(await selectionPct(page)).toBeLessThan(first);
  await undo(page);
  expect(await selectionPct(page)).toBe(first);

  await page.click("#selectMode");                     // finishing the object records one step
  await settle(page);
  const selected = await page.textContent("#tgtLocal");
  await page.click(".filter:nth-child(7)");            // Mono, on the selection
  const mono = await hash(page);
  expect(mono).not.toBe(base);

  await page.click("#invertSel");
  await settle(page);
  const inverted = await hash(page);
  expect(inverted).not.toBe(mono);

  await page.click("#clearSel");
  await settle(page);
  await expect(page.locator("#tgtLocal")).toHaveText("Selection");
  expect(await hash(page)).toBe(base);

  await undo(page);                                    // Clear also zeroed the selection's adjustments
  expect(await hash(page)).toBe(inverted);
  await expect(page.locator("#tgtLocal")).toHaveAttribute("aria-pressed", "true");
  await undo(page);
  expect(await hash(page)).toBe(mono);
  await undo(page);                                    // Mono
  await expect(page.locator("#tgtLocal")).toHaveText(selected!);
  expect(await hash(page)).toBe(base);
  await undo(page);                                    // the selection itself
  await expect(page.locator("#tgtLocal")).toHaveText("Selection");
  await expect(page.locator("#tgtLocal")).toBeDisabled();
  await expect(page.locator("#undo")).toBeDisabled();

  await redo(page);
  await expect(page.locator("#tgtLocal")).toHaveText(selected!);
  await redo(page);
  expect(await hash(page)).toBe(mono);
  await redo(page);
  expect(await hash(page)).toBe(inverted);
  expect(errs).toEqual([]);
});

test("background: steps restore the matte without running the model again", async ({ page }) => {
  const errs = await openWithFakeAi(page);
  const base = await hash(page);

  await page.click("#bgRemove");
  await expect(page.locator("#bgOptions")).toBeVisible();
  await settle(page);
  const transparent = await hash(page);
  await page.click("[data-bg='2']");
  const white = await hash(page);
  await page.click("#swatches button:nth-child(6)");
  const red = await hash(page);
  await page.click("[data-bg='3']");
  const blur = await hash(page);
  await page.locator("#bgBlur").evaluate(el => {
    (el as HTMLInputElement).value = "80";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const blur80 = await hash(page);
  expect(new Set([base, transparent, white, red, blur, blur80]).size).toBe(6);
  const modelRuns = await runs(page);

  await undo(page); expect(await hash(page)).toBe(blur);
  await expect(page.locator("#bgBlur")).toHaveValue("40");
  await undo(page); expect(await hash(page)).toBe(red);
  await undo(page); expect(await hash(page)).toBe(white);
  await undo(page); expect(await hash(page)).toBe(transparent);
  await undo(page); expect(await hash(page)).toBe(base);
  await expect(page.locator("#bgRemove")).toBeVisible();
  await expect(page.locator("#bgOptions")).toBeHidden();

  for (const want of [transparent, white, red, blur, blur80]) { await redo(page); expect(await hash(page)).toBe(want); }
  await expect(page.locator("#bgOptions")).toBeVisible();
  expect(await runs(page)).toBe(modelRuns);
  expect(errs).toEqual([]);
});

test("eraser: pixels come back exactly, in order with other steps", async ({ page }) => {
  const errs = await openWithFakeAi(page);
  const base = await hash(page);

  await page.click("#eraseMode");
  await stroke(page, 0.25, 0.3);
  await expect(page.locator("#undoErase")).toBeEnabled();
  const erased = await hash(page);
  expect(erased).not.toBe(base);
  await page.click("#eraseMode");

  // Undo erase only acts on an erase: with a slider step on top it waits its turn.
  await slider(page, "exposure", 0.5);
  await expect(page.locator("#undoErase")).toBeDisabled();
  const both = await hash(page);
  await undo(page);
  await expect(page.locator("#undoErase")).toBeEnabled();
  expect(await hash(page)).toBe(erased);
  await page.click("#undoErase");
  await settle(page);
  expect(await hash(page)).toBe(base);

  await redo(page); expect(await hash(page)).toBe(erased);
  await redo(page); expect(await hash(page)).toBe(both);
  await undo(page); await undo(page);
  expect(await hash(page)).toBe(base);

  // Erasing with a background removed reruns the model once; stepping over it does not.
  await page.click("#bgRemove");
  await expect(page.locator("#bgOptions")).toBeVisible();
  await settle(page);
  await page.click("[data-bg='3']");
  const blurred = await hash(page);
  await page.click("#eraseMode");
  await stroke(page, 0.6, 0.2);
  await expect(page.locator("#bgOptions")).toBeVisible();
  await expect(page.locator("[data-bg='3']")).toHaveAttribute("aria-pressed", "true");
  await settle(page);
  const blurredErased = await hash(page);
  expect(blurredErased).not.toBe(blurred);
  const modelRuns = await runs(page);
  await undo(page); expect(await hash(page)).toBe(blurred);
  await redo(page); expect(await hash(page)).toBe(blurredErased);
  expect(await runs(page) - modelRuns).toBe(0);
  await page.click("#eraseMode");

  // Erase selection is one step covering both the pixels and the selection it used up.
  await page.click("[data-bg='0']");
  await page.click("#bgToSel");
  await settle(page);
  const selected = await page.textContent("#tgtLocal");
  const beforeEraseSel = await hash(page);
  await page.click("#eraseSel");
  await settle(page);
  await expect(page.locator("#tgtLocal")).toHaveText("Selection");
  const afterEraseSel = await hash(page);
  expect(afterEraseSel).not.toBe(beforeEraseSel);
  await undo(page);
  await expect(page.locator("#tgtLocal")).toHaveText(selected!);
  expect(await hash(page)).toBe(beforeEraseSel);
  await redo(page);
  await expect(page.locator("#tgtLocal")).toHaveText("Selection");
  expect(await hash(page)).toBe(afterEraseSel);
  expect(errs).toEqual([]);
});

test("opening a photo starts a fresh history", async ({ page }) => {
  await openWithFakeAi(page);
  await slider(page, "exposure", 0.5);
  await undo(page);
  await slider(page, "contrast", 20);
  await expect(page.locator("#undo")).toBeEnabled();
  const png = Buffer.from(await page.evaluate(async () => {
    const c = new OffscreenCanvas(32, 32);
    c.getContext("2d")!.fillRect(0, 0, 32, 32);
    const bytes = new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
    return btoa(String.fromCharCode(...bytes));
  }), "base64");
  await page.locator("#file").setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("#meta")).toContainText("dot");
  await expect(page.locator("#undo")).toBeDisabled();
  await expect(page.locator("#redo")).toBeDisabled();
});
