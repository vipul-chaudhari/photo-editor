/* Vertex and fragment shader source, moved from the single-file v6. Sharpen is the one addition. */

export const VS = `#version 300 es
out vec2 vUV;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0;
  vUV = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

export const FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uTex;
uniform sampler2D uMask;
// Adjustment sets: [exposure, contrast, highlights, shadows, temperature, tint, vibrance, saturation]
// [exposure, contrast, highlights, shadows, temperature, tint, vibrance, saturation, hue]
uniform float uG[9];
uniform float uL[9];
uniform float uHasMask, uVig, uAspect, uSplit, uSharpen;
uniform vec2 uTexel;
// Background: 0 original, 1 transparent, 2 colour, 3 blur. uMatte = subject alpha (1 = subject).
uniform sampler2D uMatte;
// The subject's own colour, estimated right up to and past its edge (see estimateForeground).
uniform sampler2D uFg;
uniform float uFgOn;
uniform float uBgMode, uBlurLod;
uniform vec2 uBlurUV;
uniform vec3 uBgColor;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec2 DISC[12] = vec2[12](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));

// Lens-style blur: 12 taps on a disc, read from a coarser mipmap level so it stays cheap.
// Taps that land on the subject are ignored, so the person never bleeds into the blur (no halo).
vec3 blurredBg(vec2 uv) {
  vec3 a = vec3(0.0), plain = vec3(0.0);
  float ws = 0.0;
  for (int i = 0; i < 12; i++) {
    for (int k = 0; k < 2; k++) {
      vec2 o = DISC[i] * uBlurUV;
      if (k == 1) o = vec2(-o.y, o.x) * 0.5;
      vec2 t = uv + o;
      vec3 c = textureLod(uTex, t, uBlurLod).rgb;
      float w = 1.0 - texture(uMatte, t).r;
      w = w * w * w;
      a += c * w; ws += w; plain += c;
    }
  }
  return ws > 0.05 ? a / ws : plain / 24.0;
}

// Unsharp mask on brightness only, so edges gain contrast without colour fringes.
vec3 sharpened(vec2 uv, vec3 c) {
  vec3 b = vec3(0.0);
  for (int i = 0; i < 12; i++) b += textureLod(uTex, uv + DISC[i] * uTexel, 0.0).rgb;
  return c + uSharpen * 2.5 * dot(c - b / 12.0, LUMA);
}

vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

// Rotate hue in YIQ space: luma (light and shadow) stays exactly the same, only the colour turns.
vec3 hueRotate(vec3 c, float a) {
  float Y = dot(c, vec3(0.299, 0.587, 0.114));
  float I = dot(c, vec3(0.596, -0.274, -0.322));
  float Q = dot(c, vec3(0.211, -0.523, 0.312));
  float cs = cos(a), sn = sin(a);
  float I2 = I * cs - Q * sn, Q2 = I * sn + Q * cs;
  return vec3(Y + 0.956 * I2 + 0.621 * Q2, Y - 0.272 * I2 - 0.647 * Q2, Y - 1.106 * I2 + 1.703 * Q2);
}

vec3 adjust(vec3 srgb, float P[9]) {
  // 1. White balance and exposure in linear light
  vec3 c = toLinear(clamp(srgb, 0.0, 1.0));
  vec3 wb = vec3(1.0 + 0.35 * P[4], 1.0 - 0.22 * P[5], 1.0 - 0.35 * P[4]);
  c *= wb / dot(wb, LUMA);
  c *= exp2(P[0]);

  // 2. Highlights and shadows on perceptual luminance
  vec3 p = toSrgb(c);
  float L = dot(p, LUMA);
  float wS = 1.0 - smoothstep(0.0, 0.55, L); wS *= wS;
  float wH = smoothstep(0.45, 1.0, L);       wH *= wH;
  float nL = max(L + 0.40 * P[3] * wS + 0.40 * P[2] * wH, 0.0);
  p = mix(p + (nL - L), p * (nL / max(L, 1e-4)), smoothstep(0.02, 0.12, L));

  // 3. Contrast: S-curve when positive, flatten when negative
  if (P[1] >= 0.0) { vec3 q = clamp(p, 0.0, 1.0); p = mix(p, q * q * (3.0 - 2.0 * q), P[1]); }
  else { p = (p - 0.5) * (1.0 + 0.6 * P[1]) + 0.5; }

  // 4. Vibrance (protects already-saturated colors), then saturation
  float g = dot(p, LUMA);
  float cs = clamp(max(p.r, max(p.g, p.b)) - min(p.r, min(p.g, p.b)), 0.0, 1.0);
  p = mix(vec3(g), p, 1.0 + P[6] * (1.0 - cs) * 1.2);
  g = dot(p, LUMA);
  p = mix(vec3(g), p, 1.0 + P[7]);
  if (P[8] != 0.0) p = hueRotate(p, P[8]);
  return p;
}

void main() {
  vec4 src = texture(uTex, vUV);
  if (vUV.x < uSplit) { outColor = vec4(src.rgb, 1.0); return; }

  // A half-transparent edge pixel still holds some of the old background. Using the subject's colour there removes the halo.
  vec3 s0 = src.rgb;
  if (uBgMode > 0.5 && uFgOn > 0.5) s0 = mix(texture(uFg, vUV).rgb, s0, texture(uMatte, vUV).r);
  vec3 p = adjust(uSharpen > 0.0 ? sharpened(vUV, s0) : s0, uG);
  // Selection: a second adjustment on top, blended through the soft-edged mask
  float m = texture(uMask, vUV).r * uHasMask;
  if (m > 0.0) p = mix(p, adjust(p, uL), m);

  // Background replacement through the subject matte
  float alpha = 1.0;
  if (uBgMode > 0.5) {
    float mt = texture(uMatte, vUV).r;
    if (uBgMode < 1.5) alpha = mt;
    else {
      vec3 bg = uBgMode < 2.5 ? uBgColor : adjust(blurredBg(vUV), uG);
      p = mix(bg, p, mt);
    }
  }

  // 5. Vignette, round regardless of aspect ratio
  vec2 d2 = (vUV - 0.5) * vec2(uAspect, 1.0);
  float d = length(d2) / length(vec2(uAspect, 1.0) * 0.5);
  p *= 1.0 - uVig * 0.75 * smoothstep(0.35, 1.05, d);

  outColor = vec4(clamp(p, 0.0, 1.0), alpha);
}`;
