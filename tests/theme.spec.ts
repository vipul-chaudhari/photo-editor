/* The colourful theme, measured instead of viewed: text contrast in both colour modes, and that the
   chrome really is colourful rather than grey. */
import { test, expect } from "@playwright/test";
import { openEditor } from "./helpers";

// Text that matters, and the WCAG AA ratio it needs. Large or bold labels are held to the same 4.5 here.
const TEXT = [
  ".brand-name", ".brand-tag", "#export", "#compare", 'label[for="file"]', "#undo",
  ".status", ".section-title", ".hist-head span", "#auto", "#reset", ".ctl-head label", ".ctl-head output", ".filter span",
];

const measure = (selectors: string[]) => {
  const parse = (c: string) => (c.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]: number[]) => {
    const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  // Every colour behind the element: a gradient counts as all of its stops.
  const backs = (el: Element | null): number[][] => {
    for (; el; el = el.parentElement) {
      const s = getComputedStyle(el);
      const stops = s.backgroundImage.match(/rgba?\([^)]+\)/g);
      if (stops && s.backgroundImage.includes("gradient")) return stops.map(parse);
      const c = parse(s.backgroundColor);
      if (c.length === 3 || c[3] === 1) return [c];
    }
    return [[255, 255, 255]];
  };
  return selectors.map(sel => {
    const el = document.querySelector(sel)!;
    const fg = parse(getComputedStyle(el).color);
    return { sel, worst: +Math.min(...backs(el).map(b => ratio(fg, b))).toFixed(2) };
  });
};

for (const colorScheme of ["light", "dark"] as const) {
  test(`text is readable in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await openEditor(page);
    const rows = await page.evaluate(measure, TEXT);
    expect(rows.filter(r => r.worst < 4.5)).toEqual([]);
  });

  test(`the chrome is colourful in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await openEditor(page);
    const saturation = (c: string) => {
      const [r, g, b] = (c.match(/[\d.]+/g) || []).map(Number);
      return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    };
    const look = await page.evaluate(() => ({
      band: getComputedStyle(document.querySelector(".bar")!).backgroundImage,
      accent: getComputedStyle(document.querySelector(".section-title")!).color,
      exportBg: getComputedStyle(document.getElementById("export")!).backgroundColor,
    }));
    expect(look.band).toContain("gradient");
    expect(saturation(look.accent)).toBeGreaterThan(0.4);
    expect(saturation(look.exportBg)).toBeGreaterThan(0.4);
  });
}

test("nothing overflows sideways on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
