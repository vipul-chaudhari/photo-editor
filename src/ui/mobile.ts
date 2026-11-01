/* Phone layout: the photo stays on screen and the tools live behind a bottom tab bar, one group at a time.
   Tapping the open tab closes the panel, which gives the photo the whole screen. The tab bar and its hiding
   rules only apply at phone sizes (see theme.css), so the desktop layout is untouched.
   Also pinch and double-tap zoom, for touch only: mouse wheels and clicks keep their existing jobs. */
import { $, state } from "../state";
import { frame, setDetail, viewport } from "../render/gl";
import { cancelStroke } from "../features/eraser/eraser";
import { onHistoryChange } from "../history";

const TABS: [string, string, () => HTMLElement[]][] = [
  ["adjust", "Adjust", () => {
    const panel = document.querySelector(".panel")!;
    const blocks = [...panel.children] as HTMLElement[];
    const seg = $("tgtGlobal").closest(".block") as HTMLElement;
    return [blocks[0], seg, $("controls"), $("reset"), ...blocks.filter(b => b.classList.contains("note"))];
  }],
  ["filters", "Filters", () => [$("filters").closest(".block") as HTMLElement]],
  ["edit", "Edit", () => [document.getElementById("editBlock")!]],
  ["enhance", "Enhance", () => [document.getElementById("enhanceBlock")!]],
  ["select", "Select", () => [$("selectBlock")]],
  ["cutout", "Cut out", () => [$("bgBlock")]],
  ["erase", "Erase", () => [$("eraseBlock")]],
];

function initTabs() {
  const panel = document.querySelector(".panel") as HTMLElement;
  const groups = TABS.map(([, , els]) => els());
  const bar = document.createElement("nav");
  bar.className = "mobile-tabs"; bar.id = "mobileTabs"; bar.setAttribute("aria-label", "Tools");
  bar.innerHTML = TABS.map(([id, label]) => `<button type="button" data-tab="${id}" aria-pressed="false">${label}</button>`).join("");
  panel.after(bar);
  const buttons = [...bar.querySelectorAll("button")];
  let open: number | null = null;
  const show = (i: number | null) => {
    open = i;
    panel.classList.toggle("m-closed", i === null);
    buttons.forEach((b, k) => b.setAttribute("aria-pressed", String(k === i)));
    groups.forEach((els, k) => els.forEach(el => el.classList.toggle("m-hidden", k !== i)));
    panel.scrollTop = 0;
  };
  buttons.forEach((b, i) => b.addEventListener("click", () => show(open === i ? null : i)));
  show(0);
}

/* ---------- Touch sliders ---------- */
/* A finger scrolling the panel often lands on a slider, and a native slider jumps as soon as it's touched.
   So on touch screens the native slider ignores fingers (theme.css), and its whole row listens instead:
   up and down scroll the panel, and only a clear sideways drag moves the value, from where it already was. */
const DRAG_START = 10;   // px of movement before a drag counts as deliberate

function initTouchSliders() {
  const panel = document.querySelector(".panel") as HTMLElement;
  let drag: { el: HTMLInputElement; row: HTMLElement; id: number; x: number; y: number; value: number; on: boolean } | null = null;

  panel.addEventListener("pointerdown", e => {
    if (e.pointerType !== "touch" || drag) return;
    const row = (e.target as HTMLElement).closest<HTMLElement>(".ctl");
    const el = row?.querySelector<HTMLInputElement>('input[type="range"]');
    if (!row || !el || el.disabled) return;
    drag = { el, row, id: e.pointerId, x: e.clientX, y: e.clientY, value: +el.value, on: false };
  });
  panel.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dx) < DRAG_START || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      drag.on = true;
      drag.x = e.clientX;   // counted from here, so the value doesn't jump when the drag is recognised
      drag.row.classList.add("dragging");
      drag.row.setPointerCapture(e.pointerId);
      return;
    }
    const { el } = drag, min = +el.min, max = +el.max, step = +el.step || 1;
    const raw = drag.value + (e.clientX - drag.x) / el.getBoundingClientRect().width * (max - min);
    const next = Math.max(min, Math.min(max, Math.round(raw / step) * step));
    if (next === +el.value) return;
    el.value = String(next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { el, row, on } = drag;
    drag = null;
    if (!on) return;
    row.classList.remove("dragging");
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  panel.addEventListener("pointerup", end);
  panel.addEventListener("pointercancel", end);
}

/* ---------- Zoom ---------- */
let zoom = 1, panX = 0, panY = 0;
const MAX_ZOOM = 6;
const touches = new Map<number, { x: number; y: number }>();
let pinch: { dist: number; zoom: number; midX: number; midY: number; panX: number; panY: number } | null = null;
let lastTap = 0, tapStart: { x: number; y: number; t: number } | null = null;

function applyZoom() {
  // The photo can't be dragged further than its own edge.
  const maxX = frame.offsetWidth * (zoom - 1) / 2, maxY = frame.offsetHeight * (zoom - 1) / 2;
  panX = Math.max(-maxX, Math.min(maxX, panX));
  panY = Math.max(-maxY, Math.min(maxY, panY));
  frame.style.transform = zoom > 1 ? `translate(${panX}px, ${panY}px) scale(${zoom})` : "";
}
function resetZoom() { zoom = 1; panX = panY = 0; applyZoom(); setDetail(1); }
/* A finger on the photo means something else while selecting, erasing, cropping or comparing. */
const toolActive = () => state.selecting || state.erasing || state.compare || !!frame.querySelector("#cropLayer:not([hidden])");
const between = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function initZoom() {
  viewport.addEventListener("pointerdown", e => {
    if (e.pointerType !== "touch") return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 1) tapStart = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    if (touches.size === 2) {
      tapStart = null;
      cancelStroke();
      const [a, b] = [...touches.values()], m = between(a, b);
      pinch = { dist: m.dist, zoom, midX: m.x, midY: m.y, panX, panY };
      e.stopPropagation();
    }
  }, true);

  viewport.addEventListener("pointermove", e => {
    const t = touches.get(e.pointerId);
    if (!t) return;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    t.x = e.clientX; t.y = e.clientY;
    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()], m = between(a, b);
      zoom = Math.max(1, Math.min(MAX_ZOOM, pinch.zoom * m.dist / pinch.dist));
      panX = pinch.panX + m.x - pinch.midX;
      panY = pinch.panY + m.y - pinch.midY;
      applyZoom();
      e.stopPropagation();
    } else if (zoom > 1 && !toolActive()) {
      panX += dx; panY += dy;
      applyZoom();
    }
  }, true);

  const lift = (e: PointerEvent) => {
    if (!touches.delete(e.pointerId)) return;
    if (pinch && touches.size < 2) {
      pinch = null;
      if (zoom < 1.05) resetZoom(); else setDetail(zoom);   // sharpen the display once the fingers stop
      return;
    }
    // Two quick taps switch between fitting the screen and a closer look.
    if (e.type === "pointerup" && tapStart && !toolActive() && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) < 12 && e.timeStamp - tapStart.t < 300) {
      if (e.timeStamp - lastTap < 320) {
        lastTap = 0;
        if (zoom > 1) resetZoom();
        else { zoom = 2.5; panX = panY = 0; applyZoom(); setDetail(zoom); }
      } else lastTap = e.timeStamp;
    }
  };
  viewport.addEventListener("pointerup", lift, true);
  viewport.addEventListener("pointercancel", lift, true);

  // A new photo, or one with a new size, starts fitted to the screen.
  let size = "";
  onHistoryChange(() => {
    const now = state.img.w + "x" + state.img.h;
    if (now !== size) { size = now; resetZoom(); }
  });
}

export function initMobile() {
  initTabs();
  initTouchSliders();
  initZoom();
}
