/* Exports the sample photo from the v6 page and the Vite build under the same settings and compares
   every pixel. Exact match required. Only hashes and numbers are used; no image is ever viewed.
   One line per setting goes to .verify-logs/v6-compare*.txt. */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { FAKE_AI, at, clickAt, exportHash, settle } from "./helpers";

const LEGACY = "/legacy-v6.html";

async function open(page: Page, url: string) {
  // The AI models and web fonts stay out of it, so both pages see the same fallbacks.
  await page.route(u => !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname), r => r.abort());
  if (url === LEGACY) await page.route("**" + LEGACY, r => r.fulfill({ path: "legacy-index-v6.html", contentType: "text/html; charset=utf-8" }));
  await page.goto(url);
  await expect(page.locator("#meta")).toContainText("Sample photo (generated)");
}

/** The preview server answers unknown paths with the new page, which would then be compared to itself. */
async function expectRealPages(page: Page, legacy: Page) {
  await expect(legacy.locator('script[type="text/plain"]')).not.toHaveCount(0);
  await expect(page.locator('script[type="text/plain"]')).toHaveCount(0);
}

const rgbaOf = async (page: Page) => Buffer.from(await page.evaluate(() => {
  let s = ""; const d: Uint8ClampedArray = (window as any).__rgba;
  for (let i = 0; i < d.length; i += 32768) s += String.fromCharCode(...d.subarray(i, i + 32768));
  return btoa(s);
}), "base64");

/** Max difference between the pixels the last two exports left behind. Only runs when the hashes differ. */
async function pixelDiff(page: Page, legacy: Page, w: number, h: number) {
  const [pa, pb] = [await rgbaOf(page), await rgbaOf(legacy)];
  let max = 0, at = 0, off = 0;
  for (let i = 0; i < pa.length; i += 4) {
    const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]), Math.abs(pa[i + 3] - pb[i + 3]));
    if (d) off++;
    if (d > max) { max = d; at = i / 4; }
  }
  return `max diff ${max}/255, ${(off / (w * h) * 100).toFixed(3)}% of pixels, worst at (${at % w}, ${at / w | 0})`;
}

const outputs = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll('.ctl output[for^="ctl-"]:not([for="ctl-sharpen"])')].map(o => o.textContent).join(" "));

const hashCanvas = (p: Page, id: string) => p.evaluate(async (id) => {
  const c = document.getElementById(id) as HTMLCanvasElement;
  const h = await crypto.subtle.digest("SHA-256", c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data);
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, "0")).join("");
}, id);

const setSlider = (page: Page, key: string, v: number) => page.locator("#ctl-" + key).evaluate((el, val) => {
  (el as HTMLInputElement).value = String(val);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, v);

test("exports match v6 pixel for pixel", async ({ page, context }) => {
  test.setTimeout(900_000);
  const legacy = await context.newPage();
  const errs: string[] = [];
  for (const p of [page, legacy]) p.on("pageerror", e => errs.push(e.message));
  await open(page, "/?v6matte");
  await open(legacy, LEGACY);
  await expectRealPages(page, legacy);

  const sliders = await page.evaluate(() => [...document.querySelectorAll<HTMLInputElement>('input[id^="ctl-"]:not(#ctl-sharpen)')]
    .map(el => ({ key: el.id.slice(4), min: +el.min, max: +el.max })));
  expect(sliders.length).toBe(10);

  const both = (fn: (p: Page) => Promise<unknown>) => Promise.all([fn(page), fn(legacy)]);
  const configs: [string, (p: Page) => Promise<unknown>][] = [["all zero", async () => {}]];
  for (let n = 1; n <= 7; n++) configs.push([`preset ${n}`, p => p.click(`.filter:nth-child(${n})`)]);
  configs.push(["auto-adjust", p => p.click("#auto")]);
  for (const s of sliders) for (const v of [s.min, s.max]) configs.push([`${s.key} ${v}`, p => setSlider(p, s.key, v)]);
  configs.push(["combined", async p => {
    for (const [k, v] of [["exposure", 0.35], ["contrast", 17], ["highlights", -23], ["shadows", 31], ["temperature", 12], ["tint", -9], ["hue", 150], ["vibrance", 25], ["saturation", -14], ["vignette", 40]] as const)
      await setSlider(p, k, v);
  }]);

  const lines: string[] = [];
  const byHash = new Map<string, string[]>();
  for (const [name, apply] of configs) {
    await both(p => p.click("#reset"));
    await both(apply);
    const [a, b] = [await exportHash(page), await exportHash(legacy)];
    byHash.set(a.hash, [...(byHash.get(a.hash) || []), name]);
    const [ta, tb] = await both(outputs) as string[];
    const problems: string[] = [];
    if (ta !== tb) problems.push(`slider values: new [${ta}] v6 [${tb}]`);
    if (a.w !== b.w || a.h !== b.h) problems.push(`size ${a.w}x${a.h} vs ${b.w}x${b.h}`);
    else if (a.hash !== b.hash) problems.push(await pixelDiff(page, legacy, a.w, a.h));
    lines.push((problems.length ? "DIFF " : "same ") + name + (problems.length ? ": " + problems.join("; ") : ""));
  }

  await both(p => p.click("#reset"));
  // The histogram's backing shape takes its colour from the theme, which has moved on from v6 on purpose.
  // Giving both pages the same colour keeps this comparing what the histogram measures.
  await both(p => p.evaluate(() => document.documentElement.style.setProperty("--muted", "#5a6373")));
  await both(p => p.click(".filter:nth-child(4)"));
  await both(p => p.waitForTimeout(500));
  const [ha, hb] = await both(p => hashCanvas(p, "hist"));
  lines.push((ha === hb ? "same " : "DIFF ") + "histogram (preset 4)");
  lines.push(...errs.map(e => "DIFF page error: " + e));
  // Guards against a comparison that passes only because the settings never reached the render.
  // Only "Original" (no changes) and hue at ±180 (the same rotation) may produce the same image.
  const dupes = [...byHash.values()].filter(n => n.length > 1).map(n => n.join(" = ")).sort();
  const expected = ["all zero = preset 1", "hue -180 = hue 180"];
  lines.push(`${String(dupes) === String(expected) ? "same" : "DIFF"} settings reached the export (identical images: ${dupes.join("; ") || "none"})`);

  await both(p => p.click("#reset"));
  await both(p => p.waitForTimeout(500));
  const thumbs = (p: Page) => p.evaluate(async () => {
    const out: string[] = [];
    for (const c of document.querySelectorAll<HTMLCanvasElement>(".filter canvas")) {
      const h = await crypto.subtle.digest("SHA-256", c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data);
      out.push(Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, "0")).join(""));
    }
    return out;
  });
  const [tn, tl] = await both(thumbs) as string[][];
  lines.push(`${tn.length === 7 && String(tn) === String(tl) ? "same" : "DIFF"} filter thumbnails (${tn.length}, ${new Set(tn).size} distinct)`);

  mkdirSync(".verify-logs", { recursive: true });
  writeFileSync(".verify-logs/v6-compare.txt", lines.join("\n") + "\n");
  expect(lines.filter(l => l.startsWith("DIFF"))).toEqual([]);
});

type Step = [string, (p: Page) => Promise<unknown>, { overlay?: boolean }?];

const SELECT: Step[] = [
  ["select: analyse", async p => { await p.click("#selectMode"); await expect(p.locator("#aiTag")).not.toContainText("on device"); }],
  ["select: click object, Mono", async p => { await clickAt(p, 0.3, 0.6); await settle(p); await p.click(".filter:nth-child(7)"); }, { overlay: true }],
  ["select: Alt-click exclude", p => clickAt(p, 0.3 + 28 / 256 * 0.8, 0.6, "Alt"), { overlay: true }],
  ["select: scroll to Whole", async p => { await p.mouse.move(...await at(p, 0.3, 0.6)); await p.mouse.wheel(0, -100); }, { overlay: true }],
  ["select: Shift-click second object", p => clickAt(p, 0.7, 0.3, "Shift"), { overlay: true }],
  ["select: done", p => p.click("#selectMode")],
  ["select: Hue +150", p => setSlider(p, "hue", 150)],
  ["select: invert", p => p.click("#invertSel")],
  ["select: clear", p => p.click("#clearSel")],
];
const BACKGROUND: Step[] = [
  ["background: remove (transparent)", async p => { await p.click("#bgRemove"); await expect(p.locator("#bgOptions")).toBeVisible(); }],
  ["background: colour", async p => { await p.click("[data-bg='2']"); await p.click("#swatches button:nth-child(6)"); }],
  ["background: blur", p => p.click("[data-bg='3']")],
  ["background: blur 80", p => p.locator("#bgBlur").evaluate(el => {
    (el as HTMLInputElement).value = "80";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  })],
  ["background: blur + Punch", p => p.click(".filter:nth-child(4)")],
  ["background: original", p => p.click("[data-bg='0']")],
  ["background: subject as selection, Hue +150", async p => { await p.click("#bgToSel"); await setSlider(p, "hue", 150); }],
];
const ERASER: Step[] = [
  ["eraser: brush stroke", async p => {
    await p.click("#eraseMode");
    await p.mouse.move(...await at(p, 0.25, 0.3));
    await p.mouse.down();
    for (let k = 0; k < 10; k++) await p.mouse.move(...await at(p, 0.25 + 0.01 * k, 0.3));
    await p.mouse.up();
    await expect(p.locator("#undoErase")).toBeEnabled();
  }],
  ["eraser: second stroke", async p => {
    await p.mouse.move(...await at(p, 0.7, 0.75));
    await p.mouse.down();
    for (let k = 0; k < 10; k++) await p.mouse.move(...await at(p, 0.7, 0.75 + 0.01 * k));
    await p.mouse.up();
  }],
  ["eraser: undo", p => p.click("#undoErase")],
  ["eraser: erase selection", async p => {
    await p.click("#eraseMode");
    await p.click("#bgRemove");
    await expect(p.locator("#bgOptions")).toBeVisible();
    await p.click("[data-bg='0']");
    await p.click("#bgToSel");
    await settle(p);
    await p.click("#eraseSel");
  }],
];

test("selection, background and eraser match v6 with stand-in models", async ({ context }) => {
  test.setTimeout(900_000);
  const lines: string[] = [];
  const byHash = new Map<string, string[]>();
  for (const steps of [SELECT, BACKGROUND, ERASER]) {
    const page = await context.newPage(), legacy = await context.newPage();
    const errs: string[] = [];
    for (const p of [page, legacy]) { p.on("pageerror", e => errs.push(e.message)); await p.addInitScript(FAKE_AI); }
    await open(page, "/?v6matte");                     // clean cut-out edges are new on purpose, so this compares everything else
    await open(legacy, LEGACY);
    await expectRealPages(page, legacy);

    for (const [name, action, opts] of steps) {
      const problems: string[] = [];
      for (const p of [page, legacy]) { await p.bringToFront(); await action(p); await settle(p); }
      const [sa, sb] = [await page.textContent("#tgtLocal"), await legacy.textContent("#tgtLocal")];
      if (sa !== sb) problems.push(`selection: new [${sa}] v6 [${sb}]`);
      if (opts?.overlay && await hashCanvas(page, "overlay") !== await hashCanvas(legacy, "overlay")) problems.push("overlay differs");
      const [la, lb] = await Promise.all([page, legacy].map(p => p.evaluate(() => (window as any).__log as string[])));
      if (String(la) !== String(lb)) {
        const i = la.findIndex((l, k) => l !== lb[k]);
        problems.push(`worker messages (${la.length} vs ${lb.length}), first: new [${la[i]?.slice(0, 120)}] v6 [${lb[i]?.slice(0, 120)}]`);
      }
      const [a, b] = [await exportHash(page), await exportHash(legacy)];
      byHash.set(a.hash, [...(byHash.get(a.hash) || []), name]);
      if (a.w !== b.w || a.h !== b.h) problems.push(`size ${a.w}x${a.h} vs ${b.w}x${b.h}`);
      else if (a.hash !== b.hash) problems.push(await pixelDiff(page, legacy, a.w, a.h));
      lines.push((problems.length ? "DIFF " : "same ") + name + (problems.length ? ": " + problems.join("; ") : "") + ` [${sa}]`);
    }
    lines.push(...errs.map(e => "DIFF page error: " + e));
    await page.close(); await legacy.close();
  }
  const dupes = [...byHash.values()].filter(n => n.length > 1).map(n => n.join(" = "));
  lines.push("note identical images: " + (dupes.join("; ") || "none"));

  mkdirSync(".verify-logs", { recursive: true });
  writeFileSync(".verify-logs/v6-compare-ai.txt", lines.join("\n") + "\n");
  expect(lines.filter(l => l.startsWith("DIFF"))).toEqual([]);
});
