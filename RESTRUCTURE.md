# Step 1: Restructure Lightbox into a Vite + TypeScript project

Hand-off brief for a fresh chat. Read this file and `PLAN.md` first; you do not need the earlier conversation.

## Where things are

- Project folder: `photo-editor/` (save all work here, no download links).
- Current app: `index.html` (one ~98 KB file: CSS + markup + main script + three worker scripts in `<script type="text/plain">` blocks).
- `start.bat` serves the folder at http://localhost:8000 (needs Python).
- `PLAN.md`: architecture, model choices and benchmark numbers. Keep every model, version and setting it lists.
- `tests/legacy/*.py`: Playwright (Python) checks used so far, with stand-in workers. Port them.

## Why

Every change currently means reading and editing one huge file. Small modules make changes cheaper, safer and testable. Behaviour must stay exactly the same.

## Target layout

```
photo-editor/
  index.html                 markup only (header, stage, panel, export sheet)
  package.json               vite, typescript, @playwright/test (exact versions)
  tsconfig.json              strict: true, noEmit, moduleResolution bundler
  vite.config.ts             base: './' (so it also works on GitHub Pages later)
  src/
    main.ts                  wires everything up; loads the sample photo
    styles.css               all CSS from index.html (keep tokens and dark mode)
    state.ts                 shared state: img, imageId, params {global, local}, target, BG, sel
    render/
      gl.ts                  WebGL2 context, program, textures (photo unit 0, mask 2, matte 3), draw(), renderPixels(), toImageData()
      shaders.ts             vertex + fragment source (adjust(), hueRotate(), blurredBg(), compositing)
    ui/
      adjustments.ts         CONTROLS, PRESETS, sliders, filter thumbnails, target switch, reset
      histogram.ts           histogram drawing
      autoAdjust.ts
      compare.ts             split view + keyboard
      exportSheet.ts         full-resolution PNG export, copy image
      toast.ts
    io/
      loadImage.ts           open / drop / paste, downscale to GPU max, base canvas
      samplePhoto.ts         generated lakeside sample
    features/
      select/
        select.ts            select mode, points, sizes (Part/Object/Whole), overlay, undo click, new object, invert, clear
        refine.ts            boxFilter, guidedFilter, components, refineMask, smoothLogits, upsample
        sam.worker.ts        SAM 2.1 tiny, Transformers.js 4.3.2
      background/
        background.ts        remove, modes (original/transparent/colour/blur), swatches, use as selection
        cleanMatte.ts
        ormbg.worker.ts      ormbg, Transformers.js 4.3.2, fp16 GPU, CPU fallback
      eraser/
        eraser.ts            brush, crop around hole, paste back, undo stack (10)
        migan.worker.ts      MI-GAN pipeline v2, onnxruntime-web 1.22.0 wasm
      models.ts              releaseSam(): one big model in GPU memory at a time
  tests/
    *.spec.ts                Playwright tests ported from tests/legacy (stand-in workers)
```

## Rules

1. Behaviour, UI text, model IDs, library versions and tuning values stay exactly as in the current `index.html`. This is a move, not a redesign.
2. Workers become real module workers: `new Worker(new URL('./sam.worker.ts', import.meta.url), { type: 'module' })`. Vite serves over http, so the opaque-origin workarounds (classic worker + dynamic import) are no longer needed. Keep CDN imports of Transformers.js / onnxruntime-web pinned (or install them from npm at the same versions).
3. Shared mutable state lives in `state.ts`; features import what they need. No globals on `window`.
4. Keep the memory rule: background worker terminates after each matte; Smart select's model is released when another AI tool starts.
5. `npm run dev` for development, `npm run build` + `npm run preview` to check the production build. Update `start.bat` to run the preview (or keep it and add `start-dev.bat`).
6. Add `.gitignore` (node_modules, dist). Tell the user to run `git init` and make a first commit, since Claude cannot run commands on the laptop.

## Steps and checks

1. Scaffold Vite + TS; move CSS and markup; app still opens with the sample photo.
2. Move the renderer and adjustments; sliders, filters, compare, histogram, export match the old version pixel-for-pixel on the sample photo (compare an exported PNG).
3. Move each AI feature with its worker, one at a time; port its legacy test and make it pass.
4. Real check in the user's Chrome on a test photo: select jacket (Object), Hue +150, Remove background → Blur, erase the caption, Export. Compare with the v6 result.
5. Update `PLAN.md` (new layout, how to run) and the project doc `claude/photo-editor-prototype-plan.md`.

## Prompt to start the new chat

> Read `RESTRUCTURE.md` and `PLAN.md` in `photo-editor/` and do step 1 (restructure into Vite + TypeScript) exactly as described. Save everything into that folder. Keep screenshots to a minimum.

## After this

2. Undo/redo for everything; hair-aware selection (use the ormbg matte for people).
3. Upscale (Swin2SR in the browser); text and stickers as layers.
4. Free hosting on GitHub Pages.
