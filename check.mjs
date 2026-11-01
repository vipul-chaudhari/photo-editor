import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, relative } from "node:path";

const files = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = d + "/" + e; statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") && files.push(p); } })("src");
files.push("vite.config.ts", "playwright.config.ts");
let fail = 0;
const bad = (m) => { console.log("  FAIL " + m); fail++; };

// 1. syntax
console.log("1. syntax (node --check, TypeScript stripping)");
const stripFlags = process.features.typescript ? [] : ["--experimental-strip-types"]; // on by default only from Node 22.18
for (const f of files) {
  try { execFileSync(process.execPath, [...stripFlags, "--check", f], { stdio: "pipe" }); }
  catch (e) { bad(f + "\n" + String(e.stderr).split("\n").slice(0, 6).join("\n")); }
}
console.log(`   ${files.length} files checked`);

// 2. exported names vs named imports
console.log("2. import/export graph");
const exportsOf = new Map();
for (const f of files) {
  const s = readFileSync(f, "utf8"), names = new Set();
  for (const m of s.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) names.add(m[1]);
  for (const m of s.matchAll(/^export\s+(?:declare\s+)?(?:const|let|var)\s+([^=;]+?)\s*(?:[:=]|$)/gm)) names.add(m[1].trim());
  for (const m of s.matchAll(/^export\s+(?:const|let|var)\s+(.+)$/gm))
    for (const part of m[1].split(/,(?![^<{(]*[>})])/)) { const n = part.trim().match(/^(\w+)/); if (n) names.add(n[1]); }
  for (const m of s.matchAll(/^export\s+type\s+(\w+)/gm)) names.add(m[1]);
  for (const m of s.matchAll(/^export\s*\{([^}]+)\}/gm))
    for (const part of m[1].split(",")) { const n = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop().trim(); if (n) names.add(n); }
  exportsOf.set(f, names);
}
for (const f of files) {
  const s = readFileSync(f, "utf8");
  for (const m of s.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
    const spec = m[2];
    if (!spec.startsWith(".")) continue;
    let target = resolve(dirname(f), spec);
    target = [target, target + ".ts", target + "/index.ts"].find(p => existsSync(p) && statSync(p).isFile());
    if (!target) { bad(`${f}: cannot resolve "${spec}"`); continue; }
    const key = relative(".", target).replace(/\\/g, "/");
    const have = exportsOf.get(key);
    if (!have) { bad(`${f}: "${spec}" not scanned (${key})`); continue; }
    for (const raw of m[1].split(",")) {
      const n = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (n && !have.has(n)) bad(`${f}: "${n}" is not exported by ${key}`);
    }
  }
}

// 3. every id the code looks up exists in the markup
console.log("3. DOM ids");
const html = readFileSync("index.html", "utf8");
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
for (const f of files) {
  const s = readFileSync(f, "utf8");
  for (const m of s.matchAll(/\$(?:<[^>]*>)?\(\s*["']([^"']+)["']\s*\)/g))
    if (!ids.has(m[1])) bad(`${f}: $("${m[1]}") has no element in index.html`);
}

// 4. worker files referenced by new URL() exist
console.log("4. workers");
for (const f of files) {
  for (const m of readFileSync(f, "utf8").matchAll(/new URL\(\s*["'](\.[^"']+)["']\s*,\s*import\.meta\.url/g)) {
    const p = resolve(dirname(f), m[1]);
    if (!existsSync(p)) bad(`${f}: worker ${m[1]} missing`);
  }
}

// 5. CSS and markup moved byte-for-byte out of the v6 file
console.log("5. verbatim CSS + markup");
const haveV6 = existsSync("legacy-index-v6.html");
if (!haveV6) console.log("   skipped (legacy-index-v6.html is gone)");
const old = haveV6 ? readFileSync("legacy-index-v6.html", "utf8").split("\n") : [];
const slice = (a, b) => old.slice(a - 1, b).join("\n").trim();
if (haveV6 && readFileSync("src/styles.css", "utf8").trim() !== slice(7, 177)) bad("styles.css differs from the v6 <style> block");
if (haveV6 && !html.includes(slice(180, 312))) bad("index.html markup differs from the v6 markup");

// 6. nothing from the old script went missing
console.log("6. functions carried over");
const oldScript = old.slice(578, 2092).join("\n");
const fnNames = !haveV6 ? new Set() : new Set([...oldScript.matchAll(/^(?:function|async function)\s+(\w+)/gm)].map(m => m[1]));
const allSrc = files.map(f => readFileSync(f, "utf8")).join("\n");
const renamed = { uploadMask: 1, uploadMatte: 1, move: 1, undoPoint: 1 };
for (const n of fnNames) if (!new RegExp(`\\b${n}\\b`).test(allSrc) && !renamed[n]) bad(`function ${n}() was not carried over`);
console.log(`   ${fnNames.size} top-level functions`);

// 7. model ids, library versions and tuning values are unchanged
console.log("7. models, versions, tuning values");
const must = [
  "onnx-community/sam2.1-hiera-tiny-ONNX", "onnx-community/ormbg-ONNX",
  "andraniksargsyan/migan", "migan_pipeline_v2.onnx",
  "@huggingface/transformers@4.3.2", "onnxruntime-web@1.22.0",
  "0.0008", "170", "0.003", "0.25", "0.05", "128", "1024", "0.75", "DISC[12]", "shader-f16",
];
for (const m of must) if (!allSrc.includes(m)) bad(`"${m}" no longer appears anywhere in src/`);

console.log(fail ? `\n${fail} problem(s)` : "\nAll checks passed");
process.exit(fail ? 1 : 0);
