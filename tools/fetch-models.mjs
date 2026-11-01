// Downloads the model files into public/models, so the app serves them itself. Run: npm run fetch-models
// Files already there with the right hash are skipped, and every download is checked against the manifest.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const manifest = JSON.parse(readFileSync("models.manifest.json", "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const complete = new Set(manifest.map(f => f.repo));
let got = 0, skipped = 0;

for (const f of manifest) {
  const dest = join("public", "models", f.repo, f.file);
  if (existsSync(dest) && sha(readFileSync(dest)) === f.sha256) { skipped++; continue; }
  process.stdout.write(`${f.repo}/${f.file} (${(f.size / 1048576).toFixed(1)} MB)... `);
  try {
    const res = await fetch(`https://huggingface.co/${f.repo}/resolve/${f.rev}/${f.file}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (sha(bytes) !== f.sha256) throw new Error("hash did not match the manifest");
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
    got++;
    console.log("done");
  } catch (e) {
    complete.delete(f.repo);
    console.log("FAILED: " + e.message);
  }
}
// The app only looks here for a model when all of its files arrived.
mkdirSync(join("public", "models"), { recursive: true });
writeFileSync(join("public", "models", "local.json"), JSON.stringify([...complete]) + "\n");
console.log(`${got} downloaded, ${skipped} already here, ${complete.size} of ${new Set(manifest.map(f => f.repo)).size} models complete.`);
if (complete.size < new Set(manifest.map(f => f.repo)).size) process.exit(1);
