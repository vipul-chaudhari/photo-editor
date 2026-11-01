/* Full-resolution PNG export sheet, plus Copy image. */
import { $, state, BG } from "../state";
import { renderPixels, toImageData } from "../render/gl";
import { toast } from "./toast";
import { setSelecting } from "../features/select/select";
import { setErasing } from "../features/eraser/eraser";

let exportBlob: Blob | null = null, exportUrl: string | null = null;

export function initExportSheet() {
  const sheet = $("sheet");
  $("export").addEventListener("click", () => {
    const { img, params } = state;
    if (!img.w) return;
    const btn = $<HTMLButtonElement>("export");
    btn.disabled = true; btn.textContent = "Rendering…";
    setTimeout(() => {
      const px = renderPixels(params, img.w, img.h);
      const c = document.createElement("canvas"); c.width = img.w; c.height = img.h;
      c.getContext("2d")!.putImageData(toImageData(px, img.w, img.h), 0, 0);
      c.toBlob(blob => {
        btn.disabled = false; btn.textContent = "Export";
        if (!blob) { toast("Export failed: the photo is too large for this browser's memory."); return; }
        exportBlob = blob;
        if (exportUrl) URL.revokeObjectURL(exportUrl);
        exportUrl = URL.createObjectURL(blob);
        $<HTMLImageElement>("exportImg").src = exportUrl;
        $("exportNote").textContent = `${img.w} × ${img.h} px PNG${BG.mode === 1 ? " with a transparent background" : ""}, ${(blob.size / 1048576).toFixed(1)} MB. To save it, right-click the image and choose “Save image as…”, or long-press it on a phone.`;
        sheet.hidden = false;
        $("closeSheet").focus();
      }, "image/png");
    }, 30);
  });
  $("closeSheet").addEventListener("click", () => { sheet.hidden = true; $("export").focus(); });
  sheet.addEventListener("click", e => { if (e.target === sheet) sheet.hidden = true; });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!sheet.hidden) sheet.hidden = true;
    else if (state.selecting) setSelecting(false);
    else if (state.erasing) setErasing(false);
  });
  $("copyImg").addEventListener("click", async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": exportBlob as Blob })]);
      toast("Copied. Paste it into any app.");
    } catch {
      toast("Copying images isn't allowed here. Right-click the image to save it instead.");
    }
  });
}
