import io, re, sys
src = open("index.html", encoding="utf-8").read().split("\n")
def block(a, b):                      # 1-based inclusive
    return "\n".join(src[a-1:b])
def patch(text, pairs, name):
    for old, new in pairs:
        if text.count(old) != 1:
            sys.exit("PATCH FAIL in %s: %r found %d times" % (name, old, text.count(old)))
        text = text.replace(old, new)
    return text
def write(path, text):
    open(path, "w", encoding="utf-8", newline="\n").write(text.rstrip("\n") + "\n")
    print("wrote", path)

# ---------- src/styles.css ----------
write("src/styles.css", block(7, 177))

# ---------- index.html (markup only) ----------
markup = block(180, 312)
write("index.html", """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
""" + block(1, 5) + """
</head>
<body>
""" + markup + """
<script type="module" src="/src/main.ts"></script>
</body>
</html>""")

# ---------- src/render/shaders.ts ----------
sh = patch(block(635, 752), [
    ("const VS = `", "export const VS = `"),
    ("const FS = `", "export const FS = `"),
], "shaders")
write("src/render/shaders.ts",
      "/* Vertex and fragment shader source, moved unchanged from the single-file v6. */\n\n" + sh)

# ---------- src/io/samplePhoto.ts ----------
sp = patch(block(921, 976), [
    ("function samplePhoto() {", "export function samplePhoto(): HTMLCanvasElement {"),
    ('const x = c.getContext("2d");', 'const x = c.getContext("2d")!;'),
    ("const ridge = (base, amp, rough, color) => {",
     "const ridge = (base: number, amp: number, rough: number, color: string) => {"),
], "samplePhoto")
write("src/io/samplePhoto.ts", sp)

# ---------- src/features/select/refine.ts ----------
guide = patch(block(1400, 1408), [
    ("let guide = null;", "let guide: { w: number; h: number; L: Float32Array } | null = null;"),
    ("function getGuide() {", "export function getGuide(): Float32Array {\n  const { sel } = state;"),
], "guide")
smooth = patch(block(1359, 1386), [
    ("function smoothLogits(lg, gw, gh) {",
     "export function smoothLogits(lg: Float32Array, gw: number, gh: number): Float32Array {"),
    ("function upsample(lg, gw, gh, w, h) {",
     "export function upsample(lg: Float32Array, gw: number, gh: number, w: number, h: number): Uint8Array {"),
], "smooth")
maths = patch(block(1410, 1501), [
    ("function boxFilter(src, w, h, r) {",
     "export function boxFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {"),
    ("function guidedFilter(I, p, w, h, r, eps) {",
     "export function guidedFilter(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {"),
    ("function components(on, w, h) {",
     "export function components(on: Uint8Array, w: number, h: number): { lab: Int32Array; sizes: number[] } {"),
    ("function refineMask(raw, w, h, points) {",
     "export function refineMask(raw: Uint8Array, w: number, h: number, points: SelPoint[]): Uint8Array {"),
    ("const lab = new Int32Array(w * h), sizes = [0], stack = new Int32Array(w * h);",
     "const lab = new Int32Array(w * h), sizes: number[] = [0], stack = new Int32Array(w * h);"),
], "maths")
write("src/features/select/refine.ts", """/* Mask refinement: everything that turns SAM's coarse logits into a clean, photo-aligned mask.
   Moved unchanged from the single-file v6; only type annotations were added. */
import { state, type SelPoint } from "../../state";
import { originalRGB } from "../../render/gl";

// Luminance of the original photo at the selection's working size: the "guide" that edges snap to.
""" + guide + """

/* The photo's pixels changed, so the guide must be rebuilt on next use. */
export function resetGuide() { guide = null; }

""" + smooth + "\n\n" + maths)

# ---------- src/features/background/cleanMatte.ts ----------
cm = patch(block(1503, 1518), [
    ("function cleanMatte(data, w, h) {",
     "export function cleanMatte(data: Uint8Array, w: number, h: number): Uint8Array {"),
], "cleanMatte")
write("src/features/background/cleanMatte.ts",
      'import { boxFilter, components } from "../select/refine";\n\n' + cm)
