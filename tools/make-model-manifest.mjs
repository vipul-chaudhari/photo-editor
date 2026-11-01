// Writes models.manifest.json: every model file the app can use, pinned to one version with its hash.
// Run only when changing a model version: node tools/make-model-manifest.mjs
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const MODELS = [
  { repo: "onnx-community/sam2.1-hiera-tiny-ONNX", rev: "814a066640debee5a91e70aa401fb8e17e030503",
    keep: /^(config|preprocessor_config|processor_config)\.json$|^onnx\/(vision_encoder|prompt_encoder_mask_decoder)_(fp16|quantized)\.onnx(_data)?$/ },
  { repo: "onnx-community/ormbg-ONNX", rev: "034e2d884afbab897e10e78fc5bb566b29533fd6",
    keep: /^(config|preprocessor_config)\.json$|^onnx\/model_(fp16|quantized)\.onnx$/ },
  { repo: "andraniksargsyan/migan", rev: "406830d0fa60666da0071c342ad2fbc8f30c5c64", keep: /^migan_pipeline_v2\.onnx$/ },
  { repo: "Heliosoph/realesrgan-onnx", rev: "488e5dda07333179f229a6205d92135eea4c25e9", keep: /^realesr-general-x4v3\.onnx$/ },
];

const files = [];
for (const m of MODELS) {
  const info = await (await fetch(`https://huggingface.co/api/models/${m.repo}/revision/${m.rev}?blobs=true`)).json();
  for (const s of info.siblings) {
    if (!m.keep.test(s.rfilename)) continue;
    let sha256 = s.lfs?.sha256;
    if (!sha256) {   // small files aren't in LFS, so their hash has to be worked out from the file
      const bytes = await (await fetch(`https://huggingface.co/${m.repo}/resolve/${m.rev}/${s.rfilename}`)).arrayBuffer();
      sha256 = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    }
    files.push({ repo: m.repo, rev: m.rev, file: s.rfilename, size: s.size, sha256 });
  }
}
writeFileSync("models.manifest.json", JSON.stringify(files, null, 1) + "\n");
console.log(files.length, "files,", (files.reduce((t, f) => t + f.size, 0) / 1048576).toFixed(0), "MB");
