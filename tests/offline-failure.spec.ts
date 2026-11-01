/* Ported from tests/legacy/test_offline_failure.py.
   No fake worker here: the real SAM worker runs and its CDN request is blocked, so the page
   must fall back to a readable error and leave the rest of the editor working. */
import { test, expect } from "@playwright/test";
import { openEditor } from "./helpers";

test("the editor still works when the AI model cannot be downloaded", async ({ page }) => {
  // Everything except the local dev server is unreachable.
  await page.route(url => !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname), r => r.abort());
  await openEditor(page);

  // Whole-photo presets do not need the AI at all.
  await page.click(".filter:nth-child(4)");            // Punch
  await expect(page.locator('output[for="ctl-contrast"]')).toHaveText("+28");
  await expect(page.locator('output[for="ctl-vibrance"]')).toHaveText("+40");
  await expect(page.locator("#tgtLocal")).toBeDisabled();

  await page.click("#selectMode");
  await expect(page.locator("#aiText")).toContainText("Couldn't load the AI model", { timeout: 60_000 });
  await expect(page.locator("#aiStatus")).toHaveClass(/err/);
  await expect(page.locator("#selectMode")).toHaveAttribute("aria-pressed", "false");

  // Adjustments still render after the failure.
  await page.click("#reset");
  await expect(page.locator('output[for="ctl-contrast"]')).toHaveText("0");
});
