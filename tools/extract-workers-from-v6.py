import re, sys
src = open("legacy-index-v6.html", encoding="utf-8").read().split("\n")
def block(a, b): return "\n".join(src[a-1:b])
def patch(text, pairs, name):
    for old, new in pairs:
        if text.count(old) != 1: sys.exit("PATCH FAIL %s: %r x%d" % (name, old, text.count(old)))
        text = text.replace(old, new)
    return text
def selfify(text):
    out, n = re.subn(r'(?<![.\w])postMessage\(', 'self.postMessage(', text)
    print("  postMessage -> self.postMessage:", n)
    out, n = re.subn(r'catch \(err\) \{', 'catch (err: any) {', out)
    print("  catch (err) typed:", n)
    return out
HEAD = """
export {};

// A dedicated worker's own globals. Declared here so this file type-checks against the DOM lib.
declare const self: {
  postMessage(message: unknown, transfer?: any[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
  navigator: any;
};
"""
def write(path, head, text):
    open(path, "w", encoding="utf-8", newline="\n").write(head + HEAD + "\n" + text.rstrip("\n") + "\n")
    print("wrote", path)

# ---------- SAM 2.1 tiny ----------
print("sam:")
w = selfify(block(316, 435))
w = patch(w, [
 ("// A classic worker with a dynamic import: module workers are blocked when index.html is opened straight from disk.\n", ""),
 ('const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/+esm";',
  'const LIB: string = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/+esm";'),
 ("let SamModel, AutoProcessor, RawImage, Tensor, env;",
  "let SamModel: any, AutoProcessor: any, RawImage: any, Tensor: any, env: any;"),
 ("let model = null, processor = null, onGpu = false, progressCb = null;",
  "let model: any = null, processor: any = null, onGpu = false, progressCb: any = null;"),
 ("let inputs = null, emb = null, embId = -1;",
  "let inputs: any = null, emb: any = null, embId = -1;"),
 ("const queue = [];", "const queue: any[] = [];"),
 ("const T = await import(LIB);", "const T = await import(/* @vite-ignore */ LIB);"),
 ("progressCb = p => {", "progressCb = (p: any) => {"),
 ("async function encode(m) {", "async function encode(m: any) {"),
 ("async function decode(m) {", "async function decode(m: any) {"),
 ("const coords = [], labels = [];", "const coords: number[] = [], labels: bigint[] = [];"),
 ("const masks = [], areas = [];", "const masks: Float32Array[] = [], areas: number[] = [];"),
 ("self.onmessage = e => {", "self.onmessage = (e: MessageEvent) => {"),
], "sam")
write("src/features/select/sam.worker.ts",
 "/* Smart select: SAM 2.1 tiny via Transformers.js 4.3.2, in its own module worker. */\n", w)

# ---------- ormbg ----------
print("ormbg:")
w = selfify(block(440, 510))
w = patch(w, [
 ('const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/+esm";',
  'const LIB: string = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/+esm";'),
 ("let T, model = null, processor = null, onGpu = false;",
  "let T: any, model: any = null, processor: any = null, onGpu = false;"),
 ("const queue = [];", "const queue: any[] = [];"),
 ("const progress_callback = p => {", "const progress_callback = (p: any) => {"),
 ("T = await import(LIB);", "T = await import(/* @vite-ignore */ LIB);"),
 ("async function infer(m) {", "async function infer(m: any) {"),
 ("async function run(m) {", "async function run(m: any) {"),
 ("  let a;", "  let a: any;"),
 ("self.onmessage = e => {", "self.onmessage = (e: MessageEvent) => {"),
], "ormbg")
write("src/features/background/ormbg.worker.ts",
 "/* Background removal: ormbg (Apache-2.0) via Transformers.js 4.3.2, in its own module worker. */\n", w)

# ---------- MI-GAN ----------
print("migan:")
w = selfify(block(516, 576))
w = patch(w, [
 ('const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";',
  'const ORT: string = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";'),
 ("let ort, session = null;", "let ort: any, session: any = null;"),
 ("const queue = [];", "const queue: any[] = [];"),
 ("  let cache = null;", "  let cache: Cache | null = null;"),
 ("const reader = res.body.getReader(), parts = [];",
  "const reader = res.body!.getReader(), parts: Uint8Array[] = [];"),
 ('ort = await import(ORT + "ort.wasm.min.mjs");',
  'ort = await import(/* @vite-ignore */ ORT + "ort.wasm.min.mjs");'),
 ("async function run(m) {", "async function run(m: any) {"),
 ("self.onmessage = e => { queue.push(e.data); pump(); };",
  "self.onmessage = (e: MessageEvent) => { queue.push(e.data); pump(); };"),
], "migan")
write("src/features/eraser/migan.worker.ts",
 "/* Magic eraser: MI-GAN (MIT) inpainting pipeline on ONNX Runtime Web 1.22.0 (CPU/wasm). */\n", w)
