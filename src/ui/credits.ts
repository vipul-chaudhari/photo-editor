/* Credits: the models and libraries the app uses, with their licences. The licence files themselves
   ship in the build, because these licences require their text to travel with the software. */
import { $ } from "../state";

const ROWS: [string, string, string, string, string][] = [
  ["SAM 2.1", "Smart select", "Meta", "Apache-2.0", "sam2-apache-2.0.txt"],
  ["ormbg", "Remove background", "schirrmacher", "Apache-2.0", "sam2-apache-2.0.txt"],
  ["MI-GAN", "Magic eraser", "Picsart AI Research", "MIT", "mi-gan-mit.txt"],
  ["Real-ESRGAN", "Enhance", "Xintao Wang", "BSD-3-Clause", "real-esrgan-bsd-3-clause.txt"],
  ["Transformers.js", "Runs the models", "Hugging Face", "Apache-2.0", "transformers-js-apache-2.0.txt"],
  ["ONNX Runtime", "Runs the models", "Microsoft", "MIT", "onnxruntime-mit.txt"],
];

export function initCredits() {
  const open = document.createElement("button");
  open.id = "creditsOpen"; open.className = "link-btn"; open.type = "button"; open.textContent = "Credits";
  $("meta").after(open);

  const sheet = document.createElement("div");
  sheet.className = "sheet"; sheet.id = "creditsSheet"; sheet.hidden = true;
  sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", "Credits");
  sheet.innerHTML = `<div class="sheet-card credits">
    <h2>Credits</h2>
    <p class="note">Lightbox is built on these open-source projects. All of them allow free use, including commercial use, as long as their licence notices are kept.</p>
    <table><thead><tr><th>Project</th><th>Used for</th><th>By</th><th>Licence</th></tr></thead><tbody>
      ${ROWS.map(([name, use, by, lic, file]) => `<tr><td>${name}</td><td>${use}</td><td>${by}</td><td><a href="licenses/${file}" target="_blank" rel="noopener">${lic}</a></td></tr>`).join("")}
    </tbody></table>
    <p class="note">The Real-ESRGAN model file is a converted copy from Heliosoph/realesrgan-onnx. Fonts are Instrument Sans and JetBrains Mono from Google Fonts.</p>
    <div class="sheet-row"><button id="creditsClose" class="btn" type="button">Close</button></div>
  </div>`;
  document.body.append(sheet);
  const closeBtn = sheet.querySelector("#creditsClose") as HTMLElement;
  const close = () => { sheet.hidden = true; open.focus(); };
  open.addEventListener("click", () => { sheet.hidden = false; closeBtn.focus(); });
  closeBtn.addEventListener("click", close);
  sheet.addEventListener("click", e => { if (e.target === sheet) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !sheet.hidden) close(); });
}
