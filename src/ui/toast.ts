import { $ } from "../state";

let toastTimer = 0;
export function toast(msg: string) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => t.hidden = true, 3200);
}
