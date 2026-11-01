/* Opening photos: picker, drag and drop, paste; and the one place a new image enters the app. */
import { $, state } from "../state";
import { MAX, base, bctx, upload, fit } from "../render/gl";
import { renderThumbs } from "../ui/adjustments";
import { scheduleHist } from "../ui/histogram";
import { toast } from "../ui/toast";
import { resetSelection, ensureEncoded } from "../features/select/select";
import { resetBackground } from "../features/background/background";
import { resetEraser } from "../features/eraser/eraser";
import { clearHistory } from "../history";

export function setImage(source: CanvasImageSource, w: number, h: number, name: string, sample: boolean, downscaled: boolean) {
  state.img = { w, h, name, sample };
  state.imageId++;
  base.width = w; base.height = h;
  bctx.clearRect(0, 0, w, h);
  bctx.drawImage(source, 0, 0, w, h);
  upload(base);
  resetSelection();
  resetBackground();
  resetEraser();
  fit();
  if (state.selecting) ensureEncoded();
  renderThumbs();
  scheduleHist();
  clearHistory();
  $("meta").textContent = `${w} × ${h} px · ${sample ? "Sample photo (generated)" : name}${downscaled ? " · scaled to fit GPU" : ""}`;
}

/* Chrome's direct decode can fail on a photo it can otherwise read, so a failure falls back to an image element. */
async function decodeFile(file: File) {
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch {
    const url = URL.createObjectURL(file), im = new Image();
    try {
      im.src = url;
      await im.decode();
      return await createImageBitmap(im);
    } finally { URL.revokeObjectURL(url); }
  }
}

export async function loadFile(file: File | undefined | null) {
  if (!file || !file.type.startsWith("image/")) { toast("That file isn't an image. Choose a JPG, PNG or WebP photo."); return; }
  try {
    let bmp = await decodeFile(file);
    let downscaled = false;
    const big = Math.max(bmp.width, bmp.height);
    if (big > MAX) {
      const s = MAX / big;
      const resized = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * s), resizeHeight: Math.round(bmp.height * s), resizeQuality: "high" });
      bmp.close(); bmp = resized; downscaled = true;
    }
    setImage(bmp, bmp.width, bmp.height, file.name.replace(/\.[^.]+$/, ""), false, downscaled);
    bmp.close();
  } catch (e) {
    console.warn("[Lightbox] couldn't open the photo", e);
    toast("This browser can't decode that photo. HEIC files from iPhones need converting to JPG first.");
  }
}

export function initImageIO() {
  $<HTMLInputElement>("file").addEventListener("change", e => {
    const input = e.target as HTMLInputElement;
    loadFile(input.files?.[0]); input.value = "";
  });
  const stage = $("stage"), drop = $("drop");
  let dragDepth = 0;
  stage.addEventListener("dragenter", e => { e.preventDefault(); dragDepth++; drop.hidden = false; });
  stage.addEventListener("dragover", e => e.preventDefault());
  stage.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; drop.hidden = true; } });
  stage.addEventListener("drop", e => {
    e.preventDefault(); dragDepth = 0; drop.hidden = true;
    loadFile(e.dataTransfer?.files[0]);
  });
  document.addEventListener("paste", e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith("image/"));
    if (item) loadFile(item.getAsFile());
  });
}
