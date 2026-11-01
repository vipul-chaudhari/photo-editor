/* First-run screen: gets every AI model saved on this device, so the tools open quickly later.
   Each model is loaded alone and then released, because several in memory at once froze the test laptop.
   It never traps anyone: Skip is always there, and a failed download just means that tool fetches its model on first use. */
import { MODEL_BASE } from "../modelHost";

const DONE_KEY = "lightbox-models-v1";
type Step = { label: string; mb: number; start: () => Worker };
const STEPS: Step[] = [
  { label: "Smart select", mb: 72, start: () => new Worker(new URL("../features/select/sam.worker.ts", import.meta.url), { type: "module" }) },
  { label: "Remove background", mb: 84, start: () => new Worker(new URL("../features/background/ormbg.worker.ts", import.meta.url), { type: "module" }) },
  { label: "Magic eraser", mb: 27, start: () => new Worker(new URL("../features/eraser/migan.worker.ts", import.meta.url), { type: "module" }) },
  { label: "Enhance", mb: 5, start: () => new Worker(new URL("../features/enhance/esrgan.worker.ts", import.meta.url), { type: "module" }) },
];
const TOTAL = STEPS.reduce((t, s) => t + s.mb, 0);

const stored = (set?: string) => {
  try {
    if (set) localStorage.setItem(DONE_KEY, set);
    return localStorage.getItem(DONE_KEY);
  } catch { return null; }
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function initPreload() {
  const data = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  if (stored() || data) return;
  navigator.storage?.persist?.().catch(() => {});

  const screen = document.createElement("div");
  screen.className = "preload"; screen.id = "preload";
  screen.setAttribute("role", "dialog"); screen.setAttribute("aria-modal", "true"); screen.setAttribute("aria-label", "Getting the AI tools ready");
  screen.innerHTML = `<div class="preload-card">
    <h2>Getting your AI tools ready</h2>
    <p class="note">This happens once, and about ${TOTAL} MB is saved in this browser. Your photos stay on this computer.</p>
    <p class="preload-step" id="preloadStep" aria-live="polite"></p>
    <div class="meter"><i id="preloadBar"></i></div>
    <p class="preload-time"><span id="preloadPct">0%</span><span id="preloadClock"></span></p>
    <button id="preloadSkip" class="btn wide" type="button">Skip for now</button>
  </div>`;
  document.body.append(screen);
  const q = (id: string) => screen.querySelector("#" + id) as HTMLElement;

  const began = performance.now();
  let fraction = 0, worker: Worker | null = null, stopped = false;
  const show = () => {
    const pct = Math.round(fraction * 100), s = (performance.now() - began) / 1000;
    q("preloadBar").style.width = pct + "%";
    q("preloadPct").textContent = pct + "%";
    // The estimate needs a little progress behind it to mean anything.
    q("preloadClock").textContent = `${clock(s)} so far` + (fraction > 0.03 && fraction < 1 ? ` · about ${clock(s * (1 - fraction) / fraction)} left` : "");
  };
  const ticker = setInterval(show, 500);
  const close = () => {
    stopped = true;
    clearInterval(ticker);
    if (worker) { worker.terminate(); worker = null; }
    screen.remove();
  };
  q("preloadSkip").addEventListener("click", close);

  const runStep = (step: Step, doneBefore: number) => new Promise<boolean>(resolve => {
    const files: Record<string, { loaded?: number; total?: number }> = {};
    const finish = (ok: boolean) => { if (worker) { worker.terminate(); worker = null; } resolve(ok); };
    q("preloadStep").textContent = `${step.label}…`;
    try { worker = step.start(); } catch { resolve(false); return; }
    worker.onmessage = e => {
      const m = e.data;
      if (m.type === "progress") {
        files[m.file || step.label] = m;
        let L = 0, T = 0;
        for (const f of Object.values(files)) { L += f.loaded || 0; T += f.total || 0; }
        // The last bit of a step is the model starting up, so the bar waits a little for it.
        if (T) { fraction = (doneBefore + step.mb * 0.97 * Math.min(1, L / T)) / TOTAL; show(); }
      } else if (m.type === "ready") finish(true);
      else if (m.type === "error") finish(false);
    };
    worker.onerror = e => { e.preventDefault(); finish(false); };
    worker.postMessage({ type: "load", modelBase: MODEL_BASE });
  });

  (async () => {
    let doneMb = 0;
    const failed: string[] = [];
    for (const step of STEPS) {
      if (stopped) return;
      if (!await runStep(step, doneMb)) failed.push(step.label);
      doneMb += step.mb;
      fraction = doneMb / TOTAL;
      show();
    }
    if (stopped) return;
    if (!failed.length) { stored("1"); close(); return; }
    clearInterval(ticker);
    q("preloadStep").textContent = `Couldn't get ${failed.join(", ")} ready. The editor still works, and ${failed.length > 1 ? "those tools" : "that tool"} will try again when you use ${failed.length > 1 ? "them" : "it"}.`;
    q("preloadSkip").textContent = "Continue to the editor";
  })();
}
