/* The first-run screen, the credits page, the Enhance strength slider and cut-out edges. */
import { test, expect, type Page } from "@playwright/test";
import { FAKE_AI, exportHash, fakeWorker, openEditor, settle } from "./helpers";

const setRange = (p: Page, id: string, v: number) => p.locator(id).evaluate((el, val) => {
  (el as HTMLInputElement).value = String(val);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}, v);
const flag = (p: Page) => p.evaluate(() => localStorage.getItem("lightbox-models-v1"));

test.describe("first run", () => {
  // Signed in, but with no models saved yet.
  test.use({ storageState: { cookies: [], origins: [{ origin: "http://localhost:4173", localStorage: [{ name: "lightbox-session", value: String(Date.now() + 864e5) }] }] } });

  test("loads each model one at a time, remembers it, and doesn't ask again", async ({ page }) => {
    await page.addInitScript(FAKE_AI);
    await page.goto("/");
    await expect(page.locator("#preload")).toBeHidden();
    expect(await flag(page)).toBe("1");
    const loads = await page.evaluate(() => (window as any).__log.filter((l: string) => l.includes('type:"load"')).length);
    expect(loads).toBe(4);
    await page.reload();
    await expect(page.locator("#meta")).toContainText("Sample photo");
    expect(await page.evaluate(() => (window as any).__log.length)).toBe(0);
  });

  test("shows progress, and Skip opens the editor without marking it done", async ({ page }) => {
    await page.addInitScript(fakeWorker(`if (m.type === 'load') send({ type:'progress', file:'a', loaded:5, total:10 });`));
    await page.goto("/");
    await expect(page.locator("#preload")).toBeVisible();
    await expect(page.locator("#preloadPct")).not.toHaveText("0%");
    await expect(page.locator("#preloadClock")).toContainText("so far");
    await page.click("#preloadSkip");
    await expect(page.locator("#preload")).toHaveCount(0);
    expect(await flag(page)).toBeNull();
    await page.click("#rotR");
    await expect(page.locator("#meta")).toContainText("1067 × 1600 px");
  });

  test("a failed download never traps anyone", async ({ page }) => {
    await page.addInitScript(fakeWorker(`if (m.type === 'load') send({ type:'error', stage:'load', message:'offline' });`));
    await page.goto("/");
    await expect(page.locator("#preloadStep")).toContainText("Couldn't get");
    await page.click("#preloadSkip");
    await expect(page.locator("#preload")).toHaveCount(0);
    expect(await flag(page)).toBeNull();
  });
});

test("credits list every project, and each licence file ships in the build", async ({ page, request }) => {
  await openEditor(page);
  await page.click("#creditsOpen");
  await expect(page.locator("#creditsSheet")).toBeVisible();
  const links = await page.locator("#creditsSheet a").evaluateAll(a => a.map(x => (x as HTMLAnchorElement).href));
  expect(links.length).toBe(6);
  for (const url of new Set(links)) {
    const r = await request.get(url);
    expect(r.ok()).toBe(true);
    expect(await r.text()).toMatch(/licen[sc]e/i);
    expect(r.headers()["content-type"]).not.toContain("html");
  }
  await page.keyboard.press("Escape");
  await expect(page.locator("#creditsSheet")).toBeHidden();
});

test("Enhance strength re-blends instantly and stays one undo step", async ({ page }) => {
  await page.addInitScript(FAKE_AI);
  await openEditor(page);
  const base = (await exportHash(page)).hash;

  await page.fill("#sizeW", "3200");
  await page.click("#resizeApply");
  await settle(page);
  await exportHash(page);
  await page.evaluate(() => { (window as any).__plain = (window as any).__rgba; });
  await page.click("#undo");
  await settle(page);

  await page.click("#enhanceRun");
  await expect(page.locator("#undo")).toBeEnabled();
  await settle(page);
  const at75 = await exportHash(page);
  expect([at75.w, at75.h]).toEqual([3200, 2134]);
  const modelRuns = () => page.evaluate(() => (window as any).__log.filter((l: string) => l.includes('type:"enhance"')).length);
  expect(await modelRuns()).toBe(1);

  await setRange(page, "#enhanceStrength", 100);
  await settle(page);
  const at100 = (await exportHash(page)).hash;
  expect(at100).not.toBe(at75.hash);
  await setRange(page, "#enhanceStrength", 0);
  await settle(page);
  await exportHash(page);
  // Zero means no AI at all. Canvases can round a resample differently depending on how they're backed, so allow that.
  expect(await page.evaluate(() => {
    const a: Uint8ClampedArray = (window as any).__plain, b: Uint8ClampedArray = (window as any).__rgba;
    let max = 0; for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
    return max;
  })).toBeLessThanOrEqual(2);
  await setRange(page, "#enhanceStrength", 75);
  await settle(page);
  expect((await exportHash(page)).hash).toBe(at75.hash);
  expect(await modelRuns()).toBe(1);                              // the model never ran again

  await page.click("#undo");
  await settle(page);
  const back = await exportHash(page);
  expect([back.w, back.h, back.hash]).toEqual([1600, 1067, base]);
});

/* A white photo with a dark ellipse where the stand-in matte puts the subject, leaving a white fringe in the
   matte's soft edge: the case that shows up as a pale halo on a coloured background. */
async function fringe(page: Page, url: string) {
  await page.addInitScript(FAKE_AI);
  await page.goto(url);
  await expect(page.locator("#meta")).toContainText("Sample photo");
  const png = Buffer.from(await page.evaluate(async () => {
    const c = new OffscreenCanvas(1024, 1024), x = c.getContext("2d")!;
    x.fillStyle = "#fff"; x.fillRect(0, 0, 1024, 1024);
    x.fillStyle = "#123"; x.beginPath(); x.ellipse(512, 560, 297, 377, 0, 0, Math.PI * 2); x.fill();
    const u = new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
    let s = ""; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768));
    return btoa(s);
  }), "base64");
  await page.locator("#file").setInputFiles({ name: "edge.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("#meta")).toContainText("edge");
  await page.click("#bgRemove");
  await expect(page.locator("#bgOptions")).toBeVisible();
  await settle(page);
  await page.click("[data-bg='2']");
  await page.locator("#bgColor").evaluate(el => {                 // pure red, so white shows clearly
    (el as HTMLInputElement).value = "#ff0000";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await exportHash(page);
  // Pure red has no green. A red pixel that picked up green is red mixed with the photo's old white background.
  return page.evaluate(() => {
    const d: Uint8ClampedArray = (window as any).__rgba;
    let pale = 0;
    for (let i = 0; i < 1024 * 1024; i++) if (d[i * 4] > 200 && d[i * 4 + 1] > 15) pale++;
    return { pale };
  });
}

test("cut-out edges carry far less of the old background", async ({ page, context }) => {
  const now = await fringe(page, "/");
  const before = await fringe(await context.newPage(), "/?v6matte");
  expect(before.pale).toBeGreaterThan(1000);                      // the test does contain the problem
  expect(now.pale).toBeLessThan(before.pale * 0.5);
});
