/* Models can be served by this app itself (npm run fetch-models). Workers ask here first, and use
   Hugging Face for anything that isn't available locally. */

/* Is every file of this model on our own server? */
export async function hasLocalModel(base: string | undefined, repo: string) {
  if (!base) return false;
  try {
    const r = await fetch(base + "local.json");
    return r.ok && ((await r.json()) as string[]).includes(repo);
  } catch { return false; }
}

/* A single model file from our own server, or null if it isn't there. */
export async function localFile(base: string | undefined, path: string) {
  if (!base) return null;
  try {
    const r = await fetch(base + path);
    if (!r.ok || (r.headers.get("content-type") || "").includes("text/html")) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch { return null; }
}
