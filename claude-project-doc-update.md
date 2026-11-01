# Prototype plan: a browser photo editor with no paid compute

Online editors commonly split work into instant in-browser parts (live preview) and heavy
server-side AI (segmentation, background removal, inpainting). This prototype keeps the live
preview in the browser and also runs the AI on the user's own device, so it costs nothing to run.

## Constraints

- No paid GPU or cloud CPU. Everything runs in the browser on the user's own device (the
  originally planned local Python server for the eraser turned out to be unnecessary).
- Must work on a machine with only built-in (integrated) graphics.
- Windows development environment.

## Architecture

```
Browser (Vite + TypeScript build, each AI model in its own module worker)
─────────────────────────────────────────────────────────────────────────
WebGL2 shader ............ live adjustments, selection blend, background composite
Transformers.js 4 ........ Smart select, SAM 2.1 tiny (Phases 2–3)
Transformers.js 4 ........ background removal, ormbg (Phase 4)
ONNX Runtime Web (CPU) ... Magic eraser, MI-GAN (Phase 5)
```

- Models load from the Hugging Face CDN on first use and the browser caches them.
- Transformers.js and ONNX Runtime Web stay pinned CDN imports inside the workers, so `npm install`
  only ever pulls the build tools.
- Transformers.js uses WebGPU where available and falls back to WebAssembly on the CPU.
- AI models work at about 1024 px; masks are scaled back up to the full image.

## Project layout

Restructured from one 98 KB `index.html` into Vite + TypeScript on 1 Nov 2026. Behaviour, UI text,
model IDs, library versions and tuning values are unchanged; the v6 page is kept beside it as
`legacy-index-v6.html` for pixel-for-pixel comparison.

```
index.html             markup only; loads /src/main.ts as a module
package.json           vite, typescript, @playwright/test
tsconfig.json          strict, noEmit, moduleResolution bundler
vite.config.ts         base './' (works on GitHub Pages), worker format 'es'
playwright.config.ts   previews the build on :4173, software WebGL2
check.mjs              guard: syntax, import graph, DOM ids, model IDs and tuning values
src/
  main.ts              init order, then the sample photo
  styles.css           all CSS, tokens and dark mode
  state.ts             adjustment model + shared mutable state (img, params, target, sel, BG)
  render/gl.ts         WebGL2 context, textures, draw(), renderPixels(), toImageData(), fit()
  render/shaders.ts    vertex + fragment source
  ui/                  adjustments, histogram, autoAdjust, compare, exportSheet, toast
  io/                  loadImage (open/drop/paste), samplePhoto
  features/
    select/            select.ts, refine.ts, sam.worker.ts
    background/        background.ts, cleanMatte.ts, ormbg.worker.ts
    eraser/            eraser.ts, migan.worker.ts
    models.ts          releaseSam(): one big model in GPU memory at a time
tests/*.spec.ts        Playwright, with stand-in workers (ported from tests/legacy/*.py)
tools/                 the one-shot scripts that sliced v6 into modules
```

Shared mutable state lives in `state.ts` as a single `state` object; nothing is hung on `window`.
Each feature exposes an `initX()` that `main.ts` calls in the same order the old script ran in.

## Running it

Needs Node.js (18+; 22.6+ for `npm run check`). First run installs dependencies by itself.

- `start.bat` — builds and serves the production build at http://localhost:8000.
- `start-dev.bat` — dev server with instant reload at http://localhost:5173.
- Or by hand: `npm install`, then `npm run dev` / `npm run build` + `npm run preview`.
- `npm run typecheck` type-checks, `npm run check` runs the guard script, `npm test` runs Playwright
  (first time: `npx playwright install chromium`).
- `npm run verify` (Git Bash) runs all of those and prints one PASS/FAIL line per step, with logs in `.verify-logs/`. It includes the pixel comparison with v6 (`tests/v6-parity.spec.ts`, one line per setting in `.verify-logs/v6-compare*.txt`): adjustments, plus selection, background and eraser with stand-in models.

Opening `index.html` straight from disk no longer works, because the page is now built rather than
self-contained. That also retires the old opaque-origin problem: served over http, WebGPU and the
model cache are always available, so the AI runs on the GPU at about 5 s per photo.

## Phases

| Phase | What | Runs where | Status |
|---|---|---|---|
| 0 | Editor shell: open or drop an image, canvas view, export | Browser | Built |
| 1 | Live adjustments: exposure, contrast, highlights, shadows, temperature, tint, saturation, vibrance, vignette; before/after; reset | Browser (WebGL2) | Built |
| 2 | Image encoding with SAM 2.1 tiny once per image, in a background thread (was SlimSAM-77) | Browser (Transformers.js 4.3.2) | Built |
| 3 | Click-to-select: hover highlight, click adds an object, Alt-click removes, invert/clear; a second adjustment set applies only inside the soft-edged mask | Browser | Built |
| 4 | Background removal: original, transparent, solid colour or blurred background; subject can become the selection | Browser (Transformers.js 4.3.2, ormbg) | Built |
| 5 | Magic eraser: brush over anything (or erase the Smart select selection); the area is filled in; Undo erase | Browser (ONNX Runtime Web 1.22, MI-GAN) | Built |
| 6 | Undo and redo across adjustments, selection, background and eraser (Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z, header buttons) | Browser | Built |
| 7 | Edit tools: crop, rotate, flip, resize, Sharpen slider | Browser | Built |
| 8 | Enhance: sharpen photos with AI and restore their texture | Browser (ONNX Runtime Web 1.22, Real-ESRGAN) | Built |
| 9 | First-run download screen, models served by the app itself, credits page, Enhance strength, clean cut-out edges | Browser | Built |
| 10 | Phone layout: photo always on screen, bottom tool tabs, pinch and double-tap zoom | Browser | Built |

Next ideas: text and stickers as layers, sharper selection edges (larger SAM), touch testing on phones, text-prompt selection with SAM 3 (needs a server).

## Quality pass (v6, 31 Oct 2026)

Feedback: the final image looked poor (blocky selection edges, stray patches, flat recolour, halo in the blur). Changes:

- Model: Smart select moved from SlimSAM-77 to SAM 2.1 tiny (`onnx-community/sam2.1-hiera-tiny-ONNX`, Apache-2.0) on Transformers.js 4.3.2. On the dev laptop: encoder on WebGPU fp16 about 6.6 s per photo, decoder (CPU, 8-bit) about 0.2 s per click. It traces hair strands and lapels that SlimSAM missed. Falls back to the CPU if the GPU fails mid-run.
- Edge refinement: every committed mask is cleaned and snapped to the photo. (1) Keep only the connected pieces that were clicked (plus pieces at least 1/4 the size); (2) fill small enclosed holes (< 0.3% of the photo); (3) guided filter (He et al.; radius ≈ size/170, eps 0.0008) on the photo's luminance so the edge follows real edges instead of the model's 256 px grid; (4) gentle smoothstep for a crisp, non-jagged edge. The hover preview stays unrefined so it stays fast.
- Background matte cleanup: detached specks (< 5% of the subject) and faint haze more than ~8 px from the subject are removed.
- Recolour: new Hue slider (±180°) rotates hue in YIQ space so luma (folds, shadows, texture) is untouched. Works on the whole photo or a selection.
- Halo-free blur: 24 taps on two rings; taps that land on the subject are weighted out, so the person never bleeds into the blurred background.
- Memory: Chrome on the laptop (integrated GPU, shared memory) froze or crashed when SAM 2.1, ormbg and MI-GAN were all loaded. Now the background model is released right after each run, and Smart select's model is released when another AI tool starts; each reloads from the browser cache when needed.

## Smart select: how it works (Phases 2–3)

- Model: originally `Xenova/slimsam-77-uniform` (SlimSAM); replaced by SAM 2.1 tiny in v6 (see Quality pass). Loaded with Transformers.js in a module worker (`src/features/select/sam.worker.ts`).
- Image encoder runs on the GPU via WebGPU (fp16 when the chip supports it); the small prompt decoder runs on the CPU (8-bit), which measured faster for single clicks. Falls back to CPU for both when WebGPU is missing.
- The photo is sent once at 1024 px (longest side). Each click or hover sends one point; the worker returns SAM's low-res 256 px logits for the best of its three masks.
- Clicks refine one object at a time: click = include point, Alt-click = exclude point, both sent to SAM together so it redraws the object (Undo click / Ctrl+Z removes the last point). Shift-click or New object starts another object; finished objects are unioned.
- SAM's three proposals come back sorted smallest to largest; scrolling over the photo switches between Part / Object / Whole (default = the model's most confident one).
- The page smooths the low-res logits (3x3 blur), upsamples them to a soft 0–255 mask, and uploads it as a WebGL texture.
- Edges: fixed in v6 with SAM 2.1 plus guided-filter refinement (see Quality pass).
- The shader applies the whole-photo adjustment, then blends a second adjustment set through the mask. Vignette stays whole-photo only.

Measured on the dev laptop (Intel Iris Xe, 16 GB): model load 1 s when cached, photo analysis 5.4 s once per photo, each click 0.12 s. On test shapes, selected areas were within 0.6% of the true area.

How to run it: see Running it, above.

## Background removal: how it works (Phase 4)

Model choice, benchmarked on the dev laptop (Intel Iris Xe) on 31 Oct 2026:

| Model | Licence | Download | Result |
|---|---|---|---|
| `onnx-community/ormbg-ONNX` (chosen) | Apache-2.0 | 84 MB (fp16) | GPU via Transformers.js 4.3.2: 1.4 s per photo. Clean hair edges on the test portrait and the sample photo. |
| `Xenova/modnet` | Apache-2.0 | 25 MB | Portraits only. GPU fp32 0.5 s, but on the sample photo it cut off the hair and legs. |
| `onnx-community/BiRefNet_lite-ONNX` | MIT | 109–214 MB | Crashed on WebGPU (fp16 and fp32). |
| `briaai/RMBG-1.4` | Non-commercial | 42–168 MB | Excluded: licence. |

- ormbg needs Transformers.js 4.x for WebGPU (3.7.6 lacks a MaxPool feature it uses). It runs in its own module worker, on the same 4.3.2 build as Smart select (which also moved to 4.3.2 in the v6 quality pass).
- Falls back to the CPU (8-bit, 42 MB, about 7.5 s) when WebGPU is missing or fails mid-run.
- The model stretches the photo to 1024×1024, so its matte maps straight onto the image's texture coordinates. It is uploaded as a texture and the shader composites: transparent (alpha = matte), colour, or blur (12-tap disc over a coarser mipmap level, with the whole-photo adjustments applied).
- Export keeps the alpha channel, so Transparent exports a PNG cut-out.
- "Use subject as selection" copies the matte into the Smart select mask; Invert then targets the background.
- Known limit: thin background objects touching the subject (gate bars) can leave faint wisps.

## Magic eraser: how it works (Phase 5)

- Model: MI-GAN (`andraniksargsyan/migan`, `migan_pipeline_v2.onnx`, MIT, 27 MB). Built for mobile and web inpainting; the "pipeline" export takes the image (uint8, 1×3×H×W) and a mask (uint8, 0 = fill, 255 = keep), crops and resizes internally, and returns the full image with the hole filled.
- Chosen over LaMa (Apache-2.0, 198 MB) because it is 7× smaller and fast enough on the CPU: 1.5 s on a 360×450 test with two holes, no red left and mean error 5/255 against the clean original.
- Runs with ONNX Runtime Web 1.22.0 (wasm build, single thread) in a module worker; the model file is cached with the Cache API where available.
- The page keeps a full-resolution copy of the photo. Each erase crops a box around the painted area (plus a margin of 0.75× its size for context), runs the model, keeps untouched pixels exactly, and pastes the result back. The old pixels go on an undo stack (10 steps).
- After an erase, Smart select re-analyses the photo and background removal re-runs, since both depend on the pixels.
- Brush: `[` and `]` change size; Ctrl+Z undoes the last erase; Erase selection grows the Smart select mask by 4 px first.
- Tested on the sample photo: the printed caption over the trouser leg was removed and the fabric filled in cleanly.

## Undo and redo: how it works (Phase 6)

- `src/history.ts` holds one list of steps. Each step stores only what it changed and knows how to undo and redo itself, and features push steps and register hooks, so the history imports none of them.
- A slider drag is one step, recorded on release. Filters, Auto-adjust, Reset all, background changes, selection commands and erases are one step each.
- Smart select: clicks on the object being refined stay as they were (Undo click and Ctrl+Z take them back, with no redo), and the object joins the history as one step when it is finished.
- Eraser: a step keeps the before and after pixels of the crop plus the background matte, so stepping over it never reruns a model. Erase selection is one step covering the pixels and the selection it used up. Undo erase acts only when an erase is the latest step.
- Undo and redo wait while an AI job is running, because its result belongs to the current pixels. Opening a photo clears the history.
- Limits: 50 steps or 256 MB, oldest dropped first. The eraser used to keep 10 steps.

## Edit tools and Enhance (Phases 7–8)

- Crop, rotate, flip and resize change the photo's pixels and carry the selection and background matte along, so they stay lined up. Each is one undo step holding the whole photo before and after, so the 256 MB history limit is reached sooner on large photos.
- Sharpen is an instant unsharp mask on brightness in the shader, whole photo only like Vignette. At zero the pixels are unchanged.
- Enhance runs Real-ESRGAN general x4 v3 (BSD-3-Clause, 5 MB, a pinned third-party copy at `Heliosoph/realesrgan-onnx`, checked by hash) on the CPU in overlapping 128 px tiles, then adds 80% of the original's fine texture back. Photos up to 2048 px on the long side come out at double the size. It goes through the same path as crop, so the selection and matte follow and it is one undo step. The worker ends after each run to free memory.

Enhancement benchmark, on a 256 px crop of the test photo with a known blur, scored against the sharp original:

| Method | 1.5 px blur | 3 px blur | Per crop, CPU |
|---|---|---|---|
| Blurred, untouched | 32.05 dB | 27.85 dB | |
| Plain unsharp mask | 34.67 dB | 29.12 dB | instant |
| Swin2SR real-world x4, direct | 35.93 dB | 29.32 dB | 61–81 s |
| Swin2SR real-world x4, shrink first (chosen) | 33.26 dB | 32.20 dB | 3.5 s |
| Real-ESRGAN general x4, direct | 34.78 dB | 27.80 dB | 4–10 s |
| Real-ESRGAN general x4, shrink first | 31.62 dB | 29.90 dB | 0.2 s |
| Swin2SR x2 models | about 32 dB | about 28 dB | 2–84 s |

That table misled us: dB rewards smooth results, and shrinking first left faces waxy and painted. So the choice was made again on the face of the unblurred test photo, at the original size. `sharp` is edge energy, `texture` the median fine detail, and `match` how well the result agrees with the original.

| Method | sharp | texture | match | Time |
|---|---|---|---|---|
| Original | 550 | 7.34 | | |
| Swin2SR, shrink to a quarter (first attempt) | 36 | 1.30 | 28.7 dB | 33 s |
| Swin2SR, shrink to half | 129 | 2.10 | 32.6 dB | 50 s |
| Real-ESRGAN, full size | 667 | 3.73 | 33.7 dB | 23 s |
| Real-ESRGAN, full size, plus texture (chosen) | 1189 | 7.07 | 31.6 dB | 23 s |
| Real-ESRGAN, plus texture, plus extra sharpening | 2470 | 10.07 | 27.6 dB | 23 s |
| Plain sharpening only | 1215 | 11.46 | 32.3 dB | instant |

Numbers can't show whether a face looks right, so a person should judge the result. Real-ESRGAN fails on WebGPU here (a Clip kernel error), so it runs on the CPU. CodeFormer's licence is non-commercial, and GFPGAN is 160 MB or more with unclear licensing, so neither is used.

## Model hosting, first-run screen and cut-out edges (Phase 9)

- `models.manifest.json` lists every model file, pinned to one version with its hash. `npm run fetch-models` downloads them into `public/models`, checks the hashes and writes `local.json`. Only the 5 MB Real-ESRGAN file is committed, because it is a third-party copy that could disappear. `start.bat` runs the command once. Workers use the app's own copy first and Hugging Face otherwise.
- The first-run screen loads each model alone and then releases it, so they are saved without all being in memory at once. It shows progress and time left, Skip is always there, and a failed download only means that tool fetches its model on first use. Transformers.js and ONNX Runtime still come from the jsDelivr CDN, so full offline use isn't guaranteed.
- Enhance Strength mixes the AI result with a plain enlargement, from the kept model output, so moving it never reruns the model. Zero means no AI at all.
- Cut-out edges: the matte's soft edge is pulled in slightly, and half-transparent pixels use the subject's estimated colour instead of their own, which still holds some of the old background. `?v6matte` turns this off for the v6 comparison test only.
- Licence texts ship in `public/licenses`, and the Credits button in the status bar lists them.
- Login: a startup screen checks a salted PBKDF2 hash in the browser, and a sign-in lasts 8 hours. There is no server, so this keeps casual visitors out but is not real protection: anyone reading the code can get past it. Real protection needs a login on the hosting side. A changed password applies to that browser only.

## Phone layout (Phase 10)

- At phone sizes the app fills one screen and never scrolls as a page: a compact header, the photo, one group of tools, then a bottom tab bar. Tapping the open tab closes the panel and gives the photo the whole screen. All of it is CSS in a media query plus `src/ui/mobile.ts`, so the desktop layout is unchanged.
- Pinch zooms up to 6x, one finger pans when zoomed and no tool is active, and a double tap switches between fitted and 2.5x. A second finger during an eraser stroke cancels the stroke and zooms instead. Zooming never affects the exported image.
- Known gap: Smart select's exclude and new-object shortcuts use Alt and Shift, which a phone doesn't have. New object has a button; exclude has no touch equivalent yet.

## Trade-offs

- First use of each AI feature downloads model files (tens to a couple of hundred MB), then they are cached.
- On machines without WebGPU, each AI step takes a few seconds.
- Licences: check each model before commercial use. Some background-removal models (e.g. BRIA RMBG) restrict commercial use.

## Decisions

- Vite + TypeScript since 1 Nov 2026. The single page had outgrown itself: every change meant
  editing one 98 KB file. Small modules make changes cheaper, safer and testable.
- The two AI libraries stay as pinned CDN imports rather than npm packages, so the worker code and
  the ONNX wasm paths behave exactly as they did in v6.
- All image maths happens in linear light in the shader for natural-looking results.
