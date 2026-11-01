import { defineConfig } from "vite";

export default defineConfig({
  appType: "mpa",             // a missing file is a 404, not the app's page: workers rely on that for model files
  base: "./",                 // relative paths, so a build also works on GitHub Pages
  build: { target: "esnext" },
  worker: { format: "es" },   // the three AI workers are real module workers
});
