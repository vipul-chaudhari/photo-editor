/* Before / after split view. */
import { $, state } from "../state";
import { draw, frame } from "../render/gl";
import { setSelecting } from "../features/select/select";
import { setErasing } from "../features/eraser/eraser";

const splitEl = $("split"), compareBtn = $("compare");

export function setCompare(on: boolean) {
  if (on && state.selecting) setSelecting(false);
  if (on && state.erasing) setErasing(false);
  state.compare = on;
  compareBtn.setAttribute("aria-pressed", String(on));
  splitEl.hidden = !on;
  draw();
}
export function setSplit(v: number) {
  state.split = Math.max(0, Math.min(1, v));
  splitEl.style.setProperty("--x", state.split * 100 + "%");
  draw();
}

export function initCompare() {
  compareBtn.addEventListener("click", () => setCompare(!state.compare));
  let dragging = false;
  const move = (e: PointerEvent) => { const r = frame.getBoundingClientRect(); setSplit((e.clientX - r.left) / r.width); };
  splitEl.addEventListener("pointerdown", e => { dragging = true; splitEl.setPointerCapture(e.pointerId); move(e); });
  splitEl.addEventListener("pointermove", e => { if (dragging) move(e); });
  splitEl.addEventListener("pointerup", () => dragging = false);
  $("splitHandle").addEventListener("keydown", e => {
    if (e.key === "ArrowLeft") { setSplit(state.split - 0.05); e.preventDefault(); }
    if (e.key === "ArrowRight") { setSplit(state.split + 0.05); e.preventDefault(); }
  });
  document.addEventListener("keydown", e => { if (e.key === "\\" && !e.ctrlKey && !e.metaKey) setCompare(!state.compare); });
}
