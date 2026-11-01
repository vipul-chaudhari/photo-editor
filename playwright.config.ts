import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://localhost:4173",
    // Tests start as a returning visitor, past the first-run screen. startup-cutout.spec.ts covers that screen itself.
    storageState: { cookies: [], origins: [{ origin: "http://localhost:4173", localStorage: [{ name: "lightbox-models-v1", value: "1" }, { name: "lightbox-session", value: "99999999999999" }] }] },
    viewport: { width: 1280, height: 900 },
    launchOptions: {
      // Software WebGL2, so the tests run on machines without a usable GPU.
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    },
  },
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
