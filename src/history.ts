/* One undo/redo history for the whole editor. Each entry stores only what its step changed.
   Features push entries and register hooks here, so this file imports none of them. */
import { $ } from "./state";
import { toast } from "./ui/toast";

export type HistoryEntry = {
  label: string;
  bytes: number;
  kind?: "erase";
  undo: () => void;
  redo: () => void;
};

const MAX_ENTRIES = 50, MAX_BYTES = 256 * 1048576;   // full-resolution erase patches are large, and memory is shared with the GPU

let done: HistoryEntry[] = [], undone: HistoryEntry[] = [];
const busy: (() => boolean)[] = [], flushes: (() => void)[] = [], listeners: (() => void)[] = [];
let intercept: { active: () => boolean; run: () => void } | null = null;
let undoBtn: HTMLButtonElement, redoBtn: HTMLButtonElement;

/* A job is running: its result is based on the current pixels, so stepping now would apply it to the wrong ones. */
export const onBusyCheck = (fn: () => boolean) => { busy.push(fn); };
/* Commit edits still in progress, such as a slider moved but not released, before stepping. */
export const onFlush = (fn: () => void) => { flushes.push(fn); };
export const onHistoryChange = (fn: () => void) => { listeners.push(fn); };
/* Lets Smart select take Undo while an object is still being refined click by click. */
export const setUndoIntercept = (i: typeof intercept) => { intercept = i; };

export const topEntry = () => done[done.length - 1] || null;
export const isBusy = () => busy.some(fn => fn());
export const flushHistory = () => flushes.forEach(fn => fn());

export function notifyHistory() {
  const held = !!intercept?.active();
  if (undoBtn) { undoBtn.disabled = !done.length && !held; redoBtn.disabled = !undone.length || held; }
  listeners.forEach(fn => fn());
}

export function pushEntry(entry: HistoryEntry) {
  done.push(entry);
  undone = [];
  let total = done.reduce((t, e) => t + e.bytes, 0);
  while (done.length > 1 && (done.length > MAX_ENTRIES || total > MAX_BYTES)) total -= done.shift()!.bytes;
  notifyHistory();
}

export function clearHistory() {
  done = []; undone = [];
  notifyHistory();
}

function blocked() {
  if (!isBusy()) return false;
  toast("Still working. Try again in a moment.");
  return true;
}

export function undo(quiet = false) {
  if (blocked()) return;
  if (intercept?.active()) { intercept.run(); notifyHistory(); return; }
  flushes.forEach(fn => fn());
  const e = done.pop();
  if (!e) return;
  undone.push(e);
  e.undo();
  notifyHistory();
  if (!quiet) toast(e.label + " undone.");
}

export function redo() {
  if (blocked() || intercept?.active()) return;
  flushes.forEach(fn => fn());
  const e = undone.pop();
  if (!e) return;
  done.push(e);
  e.redo();
  notifyHistory();
  toast(e.label + " redone.");
}

function makeButton(id: string, text: string, title: string, run: () => void) {
  const b = document.createElement("button");
  b.id = id; b.className = "btn"; b.type = "button"; b.textContent = text; b.title = title; b.disabled = true;
  b.addEventListener("click", run);
  $("compare").before(b);
  return b;
}

export function initHistory() {
  undoBtn = makeButton("undo", "Undo", "Undo the last step (Ctrl+Z)", () => undo());
  redoBtn = makeButton("redo", "Redo", "Redo the step you undid (Ctrl+Y)", redo);
  document.addEventListener("keydown", e => {
    if (!(e.ctrlKey || e.metaKey) || !$("sheet").hidden) return;
    if ((e.target as HTMLElement | null)?.id === "bgColor") return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
  });
}
