/* The phone layout, measured on a phone-sized touch screen. Whether it looks right still needs a person and a real phone. */
import { test, expect, type Page } from "@playwright/test";
import { FAKE_AI, exportHash, openEditor, settle } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const box = async (p: Page, sel: string) => (await p.locator(sel).boundingBox())!;
const TABS = ["adjust", "filters", "edit", "enhance", "select", "cutout", "erase"];
/* Tapping an open tab closes it, so only tap one that isn't open. */
async function openTab(p: Page, tab: string) {
  const b = p.locator(`#mobileTabs [data-tab="${tab}"]`);
  if (await b.getAttribute("aria-pressed") !== "true") await p.tap(`#mobileTabs [data-tab="${tab}"]`);
  await expect(b).toHaveAttribute("aria-pressed", "true");
}

/* Touch events the way a browser sends them, since the test tool can only tap with one finger. */
const touch = (p: Page, type: string, id: number, x: number, y: number) => p.evaluate(({ type, id, x, y }) => {
  const el = document.elementFromPoint(x, y) || document.getElementById("viewport")!;
  el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 1 }));
}, { type, id, x, y });
async function pinch(p: Page, cx: number, cy: number, from: number, to: number) {
  await touch(p, "pointerdown", 1, cx - from, cy);
  await touch(p, "pointerdown", 2, cx + from, cy);
  await touch(p, "pointermove", 1, cx - to, cy);
  await touch(p, "pointermove", 2, cx + to, cy);
  await touch(p, "pointerup", 1, cx - to, cy);
  await touch(p, "pointerup", 2, cx + to, cy);
}

test("the app fits one screen and the photo gets real space", async ({ page }) => {
  await openEditor(page);
  const size = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth }));
  expect(size.w).toBeLessThanOrEqual(size.iw);
  expect(size.h).toBeLessThanOrEqual(size.ih);

  const frame = await box(page, "#frame"), stage = await box(page, "#viewport");
  expect(stage.height).toBeGreaterThan(size.ih * 0.38);
  expect(Math.max(frame.width / stage.width, frame.height / stage.height)).toBeGreaterThan(0.9);
  expect(frame.y).toBeGreaterThanOrEqual(0);
  expect(frame.y + frame.height).toBeLessThanOrEqual(size.ih);

  for (const id of ["#export", "#compare", "#undo", "#redo", 'label[for="file"]']) {
    const b = await box(page, id);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(size.iw);
    expect(b.height).toBeGreaterThanOrEqual(40);
  }
});

test("the photo stays put while tools change and scroll", async ({ page }) => {
  await openEditor(page);
  await openTab(page, "adjust");
  const before = await box(page, "#viewport");
  await page.locator(".panel").evaluate(el => { el.scrollTop = 400; });
  const after = await box(page, "#viewport");
  expect(after.y).toBe(before.y);
  expect(after.height).toBe(before.height);
  await expect(page.locator(".panel")).toHaveJSProperty("scrollTop", 400);

  for (const tab of TABS) {
    await openTab(page, tab);
    const stage = await box(page, "#viewport");
    expect(stage.height).toBeGreaterThan(300);
    const tabBar = await box(page, "#mobileTabs");
    expect(tabBar.y + tabBar.height).toBeLessThanOrEqual(844);
  }
});

test("each tab shows its own tools, and tapping it again gives the photo the whole screen", async ({ page }) => {
  await openEditor(page);
  await expect(page.locator("#ctl-exposure")).toBeVisible();
  await expect(page.locator("#rotR")).toBeHidden();
  await page.tap('#mobileTabs [data-tab="edit"]');
  await expect(page.locator("#rotR")).toBeVisible();
  await expect(page.locator("#ctl-exposure")).toBeHidden();
  await page.tap('#mobileTabs [data-tab="enhance"]');
  await expect(page.locator("#enhanceRun")).toBeVisible();
  await page.tap('#mobileTabs [data-tab="cutout"]');
  await expect(page.locator("#bgRemove")).toBeVisible();
  await page.tap('#mobileTabs [data-tab="erase"]');
  await expect(page.locator("#eraseMode")).toBeVisible();
  await page.tap('#mobileTabs [data-tab="select"]');
  await expect(page.locator("#selectMode")).toBeVisible();
  await page.tap('#mobileTabs [data-tab="filters"]');
  await expect(page.locator(".filter").first()).toBeVisible();

  const open = await box(page, "#viewport");
  await page.tap('#mobileTabs [data-tab="filters"]');
  await expect(page.locator(".panel")).toBeHidden();
  await expect.poll(async () => (await box(page, "#viewport")).height).toBeGreaterThan(open.height + 100);
  await expect(page.locator("#mobileTabs")).toBeVisible();
});

test("touch controls are big enough, and typing won't zoom the page on iPhones", async ({ page }) => {
  await openEditor(page);
  const small = async () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".panel .btn, .panel .seg button, .panel input[type=range], #mobileTabs button")]
    .filter(el => el.offsetParent && !(el as HTMLButtonElement).disabled)
    .map(el => [el.id || el.textContent?.trim(), Math.round(el.getBoundingClientRect().height)] as const)
    .filter(([, h]) => h < 40));
  for (const tab of TABS) {
    await openTab(page, tab);
    expect(await small()).toEqual([]);
  }
  await page.tap('#mobileTabs [data-tab="edit"]');
  expect(await page.locator("#sizeW").evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
});

test("editing works by touch: tools apply and the export is unaffected by the layout", async ({ page }) => {
  await page.addInitScript(FAKE_AI);
  await openEditor(page);
  const base = (await exportHash(page)).hash;
  await page.tap('#mobileTabs [data-tab="edit"]');
  await page.tap("#rotR");
  await settle(page);
  expect((await exportHash(page)).w).toBe(1067);
  await page.tap("#undo");
  await settle(page);
  expect((await exportHash(page)).hash).toBe(base);

  await page.tap("#cropMode");
  await page.tap("[data-ar='1']");
  await page.tap("#cropApply");
  await settle(page);
  expect((await exportHash(page)).w).toBe(1067);
  await page.tap("#undo");
  await settle(page);

  await page.tap('#mobileTabs [data-tab="enhance"]');
  await page.tap("#enhanceRun");
  await expect(page.locator("#undo")).toBeEnabled();
  await settle(page);
  expect((await exportHash(page)).w).toBe(3200);
});

test("pinch zooms in and back out, and the export never changes", async ({ page }) => {
  await openEditor(page);
  const base = (await exportHash(page)).hash;
  const f = await box(page, "#frame"), cx = f.x + f.width / 2, cy = f.y + f.height / 2;
  const scale = () => page.evaluate(() => document.getElementById("frame")!.style.transform);

  await pinch(page, cx, cy, 40, 120);
  expect(await scale()).toContain("scale(3)");
  expect((await box(page, "#frame")).width).toBeGreaterThan(f.width * 2.5);
  // The display sharpens for a close look, up to the photo's real pixels.
  await expect.poll(() => page.locator("#view").evaluate(c => (c as HTMLCanvasElement).width)).toBeGreaterThan(f.width * 2.5);
  expect((await exportHash(page)).hash).toBe(base);

  // One finger drags the zoomed photo, but no further than its edge.
  await touch(page, "pointerdown", 1, cx, cy);
  await touch(page, "pointermove", 1, cx + 30, cy);
  await touch(page, "pointerup", 1, cx + 30, cy);
  expect(await scale()).toContain("translate(30px");

  await pinch(page, cx, cy, 120, 20);
  expect(await scale()).toBe("");
});

test("a second finger while erasing zooms instead of painting", async ({ page }) => {
  await page.addInitScript(FAKE_AI);
  await openEditor(page);
  await page.tap('#mobileTabs [data-tab="erase"]');
  await page.tap("#eraseMode");
  await settle(page);
  const f = await box(page, "#frame"), cx = f.x + f.width / 2, cy = f.y + f.height / 2;
  await pinch(page, cx, cy, 40, 80);
  await settle(page);
  await expect(page.locator("#undoErase")).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__log.filter((l: string) => l.includes('type:"run"')).length)).toBe(0);
});

test("the login and first-run screens fit a phone", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true, baseURL: "http://localhost:4173", storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.locator("#login")).toBeVisible();
  const card = await box(page, "#login form");
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(360);
  expect(await page.locator("#loginPass").evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await ctx.close();
});
