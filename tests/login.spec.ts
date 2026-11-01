/* The startup login. These use a throwaway password stored the way a changed password is, so the real one
   never appears in the repo. */
import { test, expect, type Page } from "@playwright/test";
import { pbkdf2Sync } from "node:crypto";

const SALT = "00112233445566778899aabbccddeeff", PASS = "throwaway-test-pass";
const seeded = JSON.stringify({ salt: SALT, hash: pbkdf2Sync(PASS, Buffer.from(SALT, "hex"), 200000, 32, "sha256").toString("hex") });

test.use({ storageState: { cookies: [], origins: [{ origin: "http://localhost:4173", localStorage: [
  { name: "lightbox-models-v1", value: "1" }, { name: "lightbox-password", value: seeded },
] }] } });

const signIn = async (p: Page, user: string, pass: string) => {
  await p.fill("#loginUser", user);
  await p.fill("#loginPass", pass);
  await p.click("#loginSubmit");
};

test("nothing is reachable until the right username and password are given", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#login")).toBeVisible();

  await signIn(page, "admin", "wrong-password");
  await expect(page.locator("#loginError")).toContainText("isn't right");
  await expect(page.locator("#login")).toBeVisible();

  await signIn(page, "someone", PASS);
  await expect(page.locator("#loginError")).toContainText("isn't right");
  await expect(page.locator("#login")).toBeVisible();

  await signIn(page, "admin", PASS);
  await expect(page.locator("#login")).toHaveCount(0);
  await expect(page.locator("#meta")).toContainText("Sample photo");

  // Stays signed in across a reload, and Sign out asks again.
  await page.reload();
  await expect(page.locator("#meta")).toContainText("Sample photo");
  await expect(page.locator("#login")).toHaveCount(0);
  await page.click("#signOut");
  await expect(page.locator("#login")).toBeVisible();
});

test("the first-run download only starts after signing in", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("lightbox-models-v1"));
  await page.addInitScript(`window.__loads = 0; window.Worker = class { postMessage(m) { if (m.type === 'load') window.__loads++; } terminate() {} };`);
  await page.goto("/");
  await expect(page.locator("#login")).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).__loads)).toBe(0);
  await signIn(page, "admin", PASS);
  await expect(page.locator("#preload")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__loads)).toBe(1);
});

test("changing the password works, and the old one stops working", async ({ page }) => {
  await page.goto("/");
  await signIn(page, "admin", PASS);
  await page.click("#changePass");

  await page.fill("#oldPass", "wrong");
  await page.fill("#newPass", "brand-new-pass");
  await page.fill("#newPass2", "brand-new-pass");
  await page.click("#loginSubmit");
  await expect(page.locator("#loginError")).toContainText("current password");

  await page.fill("#oldPass", PASS);
  await page.fill("#newPass2", "does-not-match");
  await page.click("#loginSubmit");
  await expect(page.locator("#loginError")).toContainText("don't match");

  await page.fill("#newPass2", "brand-new-pass");
  await page.click("#loginSubmit");
  await expect(page.locator("#login")).toHaveCount(0);

  await page.click("#signOut");
  await signIn(page, "admin", PASS);
  await expect(page.locator("#loginError")).toContainText("isn't right");
  await signIn(page, "admin", "brand-new-pass");
  await expect(page.locator("#login")).toHaveCount(0);
});

test("the shipped build holds no readable password", async ({ page, request }) => {
  await page.goto("/");
  const src = await page.locator('script[type="module"]').first().getAttribute("src");
  const code = await (await request.get(new URL(src!, "http://localhost:4173/").href)).text();
  expect(code).toContain("PBKDF2");
  expect(code).not.toMatch(/password["']?\s*[:=]\s*["'][^"']+["']/i);
});
