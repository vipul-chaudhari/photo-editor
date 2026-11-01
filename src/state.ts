/* Shared mutable state and the adjustment model.
   Features import what they need from here; nothing is hung on window. */

export type ControlKey =
  | "exposure" | "contrast" | "highlights" | "shadows"
  | "temperature" | "tint" | "hue" | "vibrance" | "saturation"
  | "vignette" | "sharpen";

export type ParamSet = Record<ControlKey, number>;
export type Target = "global" | "local";
export type Params = Record<Target, ParamSet>;
export type SelPoint = { x: number; y: number; label: number };
export type Selection = { w: number; h: number; data: Uint8Array; has: boolean; area: number };
export type ImageInfo = { w: number; h: number; name: string; sample: boolean };
export type ControlItem = {
  key: ControlKey; label: string; min: number; max: number; step: number; unit?: string; cls?: string;
};

/* ---------- Adjustment model ---------- */
export const CONTROLS: { group: string; items: ControlItem[] }[] = [
  { group: "Light", items: [
    { key: "exposure",   label: "Exposure",   min: -2,   max: 2,   step: 0.05, unit: "EV" },
    { key: "contrast",   label: "Contrast",   min: -100, max: 100, step: 1 },
    { key: "highlights", label: "Highlights", min: -100, max: 100, step: 1 },
    { key: "shadows",    label: "Shadows",    min: -100, max: 100, step: 1 },
  ]},
  { group: "Color", items: [
    { key: "temperature", label: "Temperature", min: -100, max: 100, step: 1, cls: "temp" },
    { key: "tint",        label: "Tint",        min: -100, max: 100, step: 1, cls: "tint" },
    { key: "hue",         label: "Hue",         min: -180, max: 180, step: 1, cls: "hue", unit: "°" },
    { key: "vibrance",    label: "Vibrance",    min: -100, max: 100, step: 1 },
    { key: "saturation",  label: "Saturation",  min: -100, max: 100, step: 1 },
  ]},
  { group: "Effects", items: [
    { key: "vignette", label: "Vignette", min: -100, max: 100, step: 1 },
    { key: "sharpen",  label: "Sharpen",  min: 0,    max: 100, step: 1 },
  ]},
];
export const KEYS: ControlKey[] = CONTROLS.flatMap(g => g.items.map(i => i.key));
export const zero = (): ParamSet => Object.fromEntries(KEYS.map(k => [k, 0])) as ParamSet;
export const ORIGINAL: Params = { global: zero(), local: zero() };

export const PRESETS: { name: string; p: Partial<ParamSet> }[] = [
  { name: "Original",    p: {} },
  { name: "Warm film",   p: { temperature: 28, contrast: -12, shadows: 22, highlights: -10, saturation: -12, vignette: 22 } },
  { name: "Golden hour", p: { exposure: 0.15, temperature: 40, tint: 10, highlights: -20, vibrance: 22 } },
  { name: "Punch",       p: { contrast: 28, vibrance: 40, saturation: 8, vignette: 14 } },
  { name: "Cool fade",   p: { temperature: -22, tint: -4, contrast: -28, shadows: 30, highlights: -18, saturation: -22 } },
  { name: "Matte",       p: { contrast: -35, shadows: 35, highlights: -25, saturation: -8 } },
  { name: "Mono",        p: { saturation: -100, contrast: 24, shadows: -6, vignette: 18 } },
];

/* The order the shader's uG[9] / uL[9] arrays expect. */
export const ORDER: ControlKey[] =
  ["exposure", "contrast", "highlights", "shadows", "temperature", "tint", "vibrance", "saturation", "hue"];

/* ---------- Mutable state ---------- */
export const state = {
  img: { w: 0, h: 0, name: "photo", sample: true } as ImageInfo,
  imageId: 0,
  // Two adjustment sets: one for the whole photo, one for the selected objects.
  params: { global: zero(), local: zero() } as Params,
  target: "global" as Target,
  // Selection mask at the AI's working resolution (longest side 1024), 0-255 with soft edges.
  sel: { w: 1, h: 1, data: new Uint8Array(1), has: false, area: 0 } as Selection,
  compare: false,
  split: 0.5,
  selecting: false,
  erasing: false,
};

export const activePreset: Record<Target, number> = { global: 0, local: 0 };

// Background state: mode 0 original, 1 transparent, 2 colour, 3 blur.
export const BG = { mode: 0, color: [1, 1, 1] as number[], blur: 40, pendingMode: 0, cleanEdges: true };

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
