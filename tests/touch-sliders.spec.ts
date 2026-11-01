/* Scrolling the tools on a phone must not change the photo. These send real touch input through the browser. */
import { test, expect, type CDPSession, type Page } from "@playwright/test";
import { exportHash, openEditor } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const values = (p: Page) => p.evaluate(() => [...document.querySelectorAll<HTMLInputElement>('.panel input[type="range"]')].map(el => el.id + "=" + el.value).join(" "));
const centre = async (p: Page, sel: string) => { const b = (await p.locator(sel).boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width }; };

/* Centres a slider in the panel, and confirms a finger at its centre really lands on its row. */
async function aimAt(page: Page, sel: string) {
  await page.locator(sel).evaluate(el => el.scrollIntoView({ block: "center" }));
  const { x, y } = await centre(page, sel);
  const hit = await page.evaluate(({ x, y, sel }) => document.elementFromPoint(x, y)?.closest(".ctl")?.querySelector(sel) !== null && !!document.elementFromPoint(x, y)?.closest(".ctl")?.querySelector(sel), { x, y, sel });
  expect(hit).toBe(true);
}
async function setup(page: Page) {
  await openEditor(page);
  await aimAt(page, "#ctl-contrast");
  return page.context().newCDPSession(page);
}
/* At finger speed, stopping before lifting. An instant swipe reads as a fling, and browsers swallow the next tap after one. */
const swipe = async (p: Page, cdp: CDPSession, x: number, y: number, dx: number, dy: number) => {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 15; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * i / 15, y: y + dy * i / 15 }] });
    await p.waitForTimeout(16);
  }
  await p.waitForTimeout(150);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx, y: y + dy }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await p.waitForTimeout(600);
};

test("the sliders aren't touched directly on a touch screen", async ({ page }) => {
  await openEditor(page);
  expect(await page.locator("#ctl-contrast").evaluate(el => getComputedStyle(el).pointerEvents)).toBe("none");
});

test("scrolling with a finger starting on a slider changes nothing, and does scroll", async ({ page }) => {
  const cdp = await setup(page);
  const before = await values(page), hash = (await exportHash(page)).hash;
  const start = await page.locator(".panel").evaluate(el => el.scrollTop);
  const { x, y } = await centre(page, "#ctl-contrast");
  await swipe(page, cdp, x, y, 0, -70);
  expect(await page.locator(".panel").evaluate(el => el.scrollTop)).toBeGreaterThan(start + 40);
  expect(await values(page)).toBe(before);
  expect((await exportHash(page)).hash).toBe(hash);
  await expect(page.locator("#undo")).toBeDisabled();
});
const settle2 = (p: Page) => p.waitForTimeout(250);

test("a slightly diagonal scroll changes nothing either", async ({ page }) => {
  const cdp = await setup(page);
  const before = await values(page);
  const { x, y } = await centre(page, "#ctl-contrast");
  await swipe(page, cdp, x, y, 14, -90);
  expect(await values(page)).toBe(before);
});

test("a tap on a slider changes nothing", async ({ page }) => {
  await setup(page);
  const before = await values(page);
  const b = (await page.locator("#ctl-contrast").boundingBox())!;
  await page.touchscreen.tap(b.x + b.width * 0.9, b.y + b.height / 2);
  await settle2(page);
  expect(await values(page)).toBe(before);
  await expect(page.locator("#undo")).toBeDisabled();
});

test("a sideways drag moves the value from where it was, as one undo step", async ({ page }) => {
  const cdp = await setup(page);
  const hash = (await exportHash(page)).hash;
  const { x, y, w } = await centre(page, "#ctl-contrast");
  // Starts near the middle and moves by about a quarter of the track, so roughly +50 on a -100 to +100 slider.
  await swipe(page, cdp, x, y, w / 4, 0);
  const v = +(await page.locator("#ctl-contrast").inputValue());
  expect(v).toBeGreaterThan(30);
  expect(v).toBeLessThan(60);
  await expect(page.locator("#undo")).toBeEnabled();
  await expect(page.locator(".ctl.dragging")).toHaveCount(0);
  expect((await exportHash(page)).hash).not.toBe(hash);

  await page.tap("#undo");
  await settle2(page);
  await expect(page.locator("#ctl-contrast")).toHaveValue("0");
  await expect(page.locator("#undo")).toBeDisabled();
  expect((await exportHash(page)).hash).toBe(hash);
});

test("a disabled slider stays put", async ({ page }) => {
  const cdp = await setup(page);
  await page.locator("#ctl-sharpen").evaluate(el => { (el as HTMLInputElement).disabled = true; });
  await aimAt(page, "#ctl-sharpen");
  const { x, y, w } = await centre(page, "#ctl-sharpen");
  await swipe(page, cdp, x - w / 4, y, w / 2, 0);
  await expect(page.locator("#ctl-sharpen")).toHaveValue("0");
});
