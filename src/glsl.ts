// The GPU side of colour mapping (darktable's src/iop/colormapping.c and the
// bilateral grid of src/common/bilateral.c, release-5.6.1; GPL-3.0-or-later).
// The bilateral pass is Safelight's Local Contrast extension's, adapted: it
// smooths D, the lightness shift equalisation makes, instead of L*.
//
// Copyright (C) 2013-2026 darktable developers (colormapping.c), 2016-2026
// (bilateral.c).
//
// The inline maps each pixel: L* through the target's cumulative histogram and
// the source's inverse one (two texel fetches, as half floats (k + 1) / 2048,
// 0 meaning missing), a* and b* through the clusters. The pass splats D into
// darktable's grid (σs 50 pixels of the full image, σr 8), blurs it and
// slices it, handing the inline the smoothed shift. docs/SPEC.md has the
// layout; test/support/process-model.ts is darktable's arithmetic the GPU
// suite holds both to.
//
// D3D11 (ANGLE) shapes the pass: no arrays and no texture(), so no draw pays
// for every branch; components are picked with one-hot vectors.

import { CONSTANT_TEXELS, MAX_RES_R, MAX_RES_S, MAX_WIDEN_STEPS, SIGMA_R, SIGMA_S, SPLAT_TAPS, WIDEN } from "./grid";
import { D50, EPSILON, KAPPA, REC709_FROM_XYZ, XYZ_FROM_709 } from "./lab";
import { HISTN, MAXN } from "./model";
import { SIHIST, THIST } from "./params";

/** A GLSL float literal that always carries a decimal point. */
export function glslLiteral(v: number): string {
  const s = v.toPrecision(10);
  if (/e/i.test(s)) {
    const [mantissa, exponent] = s.split(/e/i);
    const m = mantissa.includes(".") ? mantissa : `${mantissa}.0`;
    return `${m}e${Number(exponent)}`;
  }
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, ".0") : `${s}.0`;
}

const lit = glslLiteral;

/** A row-major matrix as GLSL's column-major mat3 constructor takes it. */
const mat3 = (m: readonly (readonly number[])[]): string =>
  `mat3(${[0, 1, 2].flatMap((col) => [0, 1, 2].map((row) => lit(m[row][col]))).join(", ")})`;

const D50_VEC = `vec3(${D50.map(lit).join(", ")})`;

const LAB_F_GLSL = `
float cmCbrt(float v) {
  float r = exp2(log2(v) / 3.0);
  return r - (r * r * r - v) / (3.0 * r * r);
}
float cmLabF(float t) {
  return t > ${lit(EPSILON)} ? cmCbrt(t) : (${lit(KAPPA)} * t + 16.0) / 116.0;
}
`;

/** L* of a linear Rec.709 pixel, from Y alone. */
const LIGHTNESS_GLSL = `${LAB_F_GLSL}
float cmLightness(vec3 rgb) {
  return 116.0 * cmLabF(dot(vec3(${XYZ_FROM_709[1].map(lit).join(", ")}), rgb)) - 16.0;
}
`;

/** The bin process() reads the target histogram at, HISTN · L / 100
 *  truncated and kept to the table, taken against the bins' exact edges
 *  (25·k / 512) so no division's rounding moves a pixel a bin; then D, half
 *  the shift equalisation makes to L* plus 50, clamped to [0, 100], or -1
 *  while either table is missing. */
const SHIFT_GLSL = `
float cmBin(float L) {
  float q = floor(L * ${lit(HISTN / 100)});
  if (L < q * ${lit(100 / HISTN)}) q -= 1.0;
  else if (L >= (q + 1.0) * ${lit(100 / HISTN)}) q += 1.0;
  return min(max(q, 0.0), ${lit(HISTN - 1)});
}
float cmShift(float L) {
  float t = texelFetch(${THIST}, ivec2(int(cmBin(L)), 0), 0).r * ${lit(HISTN)} - 1.0;
  if (t < 0.0) return -1.0;
  float k = texelFetch(${SIHIST}, ivec2(int(t), 0), 0).r * ${lit(HISTN)} - 1.0;
  if (k < 0.0) return -1.0;
  float e = equalization / 100.0;
  float ih = k * 100.0 / ${lit(HISTN)};
  return min(max(0.5 * ((L * (1.0 - e) + ih * e) - L) + 50.0, 0.0), 100.0);
}
`;

// ── The inline ───────────────────────────────────────────────────────────────

export const INLINE_HELPERS = `${LAB_F_GLSL}${SHIFT_GLSL}
float cmLabFInv(float f) {
  return f > ${lit(6 / 29)} ? f * f * f : (116.0 * f - 16.0) / ${lit(KAPPA)};
}
vec3 cmToLab(vec3 rgb) {
  vec3 xyz = ${mat3(XYZ_FROM_709)} * rgb / ${D50_VEC};
  vec3 f = vec3(cmLabF(xyz.x), cmLabF(xyz.y), cmLabF(xyz.z));
  return vec3(116.0 * f.y - 16.0, 500.0 * (f.x - f.y), 200.0 * (f.y - f.z));
}
vec3 cmFromLab(vec3 lab) {
  float fy = (lab.x + 16.0) / 116.0;
  vec3 f = vec3(fy + lab.y / 500.0, fy, fy - lab.z / 200.0);
  vec3 xyz = vec3(cmLabFInv(f.x), cmLabFInv(f.y), cmLabFInv(f.z)) * ${D50_VEC};
  return ${mat3(REC709_FROM_XYZ)} * xyz;
}
// get_clusters(): the pixel's share of target cluster c, unnormalized, by
// inverse squared distance; a cluster it sits on takes it whole.
float cmShare(vec2 ab, int c, bool hit) {
  vec2 t = ab - tMean[c];
  float d2 = dot(t, t);
  if (hit) return d2 > 1.0e-6 ? 0.0 : 1.0;
  return d2 > 1.0e-6 ? 1.0 / d2 : -1.0;
}
// The pixel through the mapping: L* by the histograms, smoothed by the pass's
// shift when it ran, a* and b* by each target cluster's paired source cluster
// (get_cluster_mapping), weighted by the pixel's share of it. Passes the pixel
// through until both sides hold clusters and both tables are there.
vec3 cmTransfer(vec3 rgb, bool smoothed, float delta) {
  int n = clamp(clusters, 1, ${MAXN});
  float sourceTotal = 0.0;
  float targetTotal = 0.0;
  for (int k = 0; k < ${MAXN}; k++) {
    if (k < n) {
      sourceTotal += sWeight[k];
      targetTotal += tWeight[k];
    }
  }
  if (!(sourceTotal > 0.0) || !(targetTotal > 0.0)) return rgb;
  vec3 lab = cmToLab(rgb);
  float D = cmShift(lab.x);
  if (D < 0.0) return rgb;
  if (smoothed) D = max(0.0, D + delta);
  float L = min(max(2.0 * (D - 50.0) + lab.x, 0.0), 100.0);

  float nearest = 3.4e38;
  for (int k = 0; k < ${MAXN}; k++) {
    if (k < n) {
      vec2 t = lab.yz - tMean[k];
      nearest = min(nearest, dot(t, t));
    }
  }
  bool hit = nearest < 1.0e-6;
  float total = 0.0;
  for (int k = 0; k < ${MAXN}; k++) {
    if (k < n) total += cmShare(lab.yz, k, hit);
  }

  float d = dominance / 100.0;
  vec2 ab = vec2(0.0);
  for (int c = 0; c < ${MAXN}; c++) {
    if (c < n) {
      float w = cmShare(lab.yz, c, hit);
      if (total > 0.0) w /= total;
      float best = 3.4e38;
      vec2 pairedMean = sMean[0];
      vec2 pairedSd = sVar[0];
      for (int k = 0; k < ${MAXN}; k++) {
        if (k < n) {
          vec2 dm = sMean[k] - tMean[c];
          float dw = sWeight[k] - tWeight[c];
          float dist = dot(dm, dm) * (1.0 - d) + 10000.0 * dw * dw * d;
          if (dist < best) {
            best = dist;
            pairedMean = sMean[k];
            pairedSd = sVar[k];
          }
        }
      }
      vec2 sd = tVar[c];
      vec2 ratio = vec2(sd.x > 0.0 ? pairedSd.x / sd.x : 0.0, sd.y > 0.0 ? pairedSd.y / sd.y : 0.0);
      ab += w * ((lab.yz - tMean[c]) * ratio + pairedMean);
    }
  }
  return cmFromLab(vec3(L, ab));
}
`;

export const INLINE_GLSL = `
if (on) {
  c.rgb = cmTransfer(c.rgb, blDraws > 0, blDraws > 0 ? stageResult.x + stageResult.y : 0.0);
}
`;

// ── The bilateral grid ──────────────────────────────────────────────────────

export const BL_STEP = { idle: 0, plan: 1, splatX: 2, splatY: 3, blurX: 4, blurY: 5, slice: 6, zero: 7 } as const;

// The host's programs leave ints mediump, 16 bits on some GPUs, and the pass's
// indices and float bit casts need 32. The host's uniforms come first, so they
// keep the precision the pass's two programs agree on.
const PRECISION_GLSL = `
precision highp int;
`;

/** cmQuantize: the value with 11 significant bits, which a half float holds
 *  exactly; 0 below half's normal range. cmHalf: the half float nearest the
 *  value, so the target stores what this code chose whatever rounding its own
 *  conversion uses. */
const QUANTIZE_GLSL = `
float cmQuantize(float v) {
  if (abs(v) < ${lit(2 ** -14)}) return 0.0;
  return uintBitsToFloat((floatBitsToUint(v) + 0x1000u) & 0xFFFFE000u);
}
float cmHalf(float v) {
  if (abs(v) < ${lit(2 ** -14)}) return floor(v * ${lit(2 ** 24)} + 0.5) * ${lit(2 ** -24)};
  return cmQuantize(v);
}
vec4 cmHalf4(vec4 v) { return vec4(cmHalf(v.x), cmHalf(v.y), cmHalf(v.z), cmHalf(v.w)); }
`;

export const BL_HELPERS = `${PRECISION_GLSL}${QUANTIZE_GLSL}${LIGHTNESS_GLSL}${SHIFT_GLSL}
// 2^e for a normal result; ldexp is GLSL ES 3.10.
float cmPow2(int e) { return uintBitsToFloat(uint(e + 127) << 23); }
ivec2 cmFrame() { return ivec2(floor(1.0 / uTexel + 0.5)); }
ivec2 cmAt(highp int n, int width) {
  highp int row = n / width;
  return ivec2(n - row * width, row);
}
vec4 cmFetch(highp int n, int width) { return fetchPrev4(cmAt(n, width)); }
vec4 cmOneHot(int i) { return vec4(equal(ivec4(i), ivec4(0, 1, 2, 3))); }
// The texels [from, to) as whole rows.
ivec4 cmRows(int width, highp int from, highp int to) {
  if (to <= from) return ivec4(0);
  return ivec4(0, from / width, width, (to - 1) / width + 1);
}
// The last draw hands the inline the smoothed shift as a half float in x and
// what that leaves in y.
vec4 cmResult(float delta) {
  float hi = cmQuantize(delta);
  return vec4(hi, cmHalf(delta - hi), 0.0, 1.0);
}
// D at a texel of the stage's input, 50 (no shift) while a table is missing.
float cmGridValue(ivec2 texel) {
  float D = cmShift(cmLightness(fetchInput(texel)));
  return D < 0.0 ? 50.0 : D;
}
// a / b correctly rounded, for positive normal floats: a GPU's division
// needn't be, and the grid's sizes come out of these at whole numbers.
float cmDiv(float a, float b) {
  uint ua = floatBitsToUint(a);
  uint ub = floatBitsToUint(b);
  int e = int(ua >> 23) - int(ub >> 23);
  uint ma = (ua & 0x7FFFFFu) | 0x800000u;
  uint mb = (ub & 0x7FFFFFu) | 0x800000u;
  if (ma < mb) {
    ma <<= 1;
    e -= 1;
  }
  uint quotient = 0u;
  for (int i = 0; i < 25; i++) {
    quotient <<= 1;
    if (ma >= mb) {
      ma -= mb;
      quotient |= 1u;
    }
    ma <<= 1;
  }
  uint guard = quotient & 1u;
  quotient >>= 1;
  if (guard == 1u && (ma != 0u || (quotient & 1u) == 1u)) quotient += 1u;
  if (quotient == 0x1000000u) {
    quotient >>= 1;
    e += 1;
  }
  return float(quotient) * cmPow2(e - 23);
}
// roundf() of a non-negative value.
int cmRound(float v) {
  float whole = floor(v);
  return int(whole) + (v - whole >= 0.5 ? 1 : 0);
}
// A float32 as three 11-bit pieces of its mantissa and its exponent, all of
// which a half float holds exactly, and back.
vec4 cmPack(float v) {
  if (v == 0.0) return vec4(0.0);
  uint bits = floatBitsToUint(v);
  uint m = (bits & 0x7FFFFFu) | 0x800000u;
  return vec4(float(m >> 13), float((m >> 2) & 0x7FFu), float(m & 3u), float(int(bits >> 23) - 150));
}
float cmUnpack(vec4 s) {
  return float(uint(s.x) * 8192u + uint(s.y) * 4u + uint(s.z)) * cmPow2(int(s.w));
}
// dt_bilateral_grid_size(): sigma_s, sigma_r and their inverses.
vec4 cmGridSigmas(ivec2 frame, float sigmaS, float sigmaR) {
  float s = sigmaS < 0.5 ? 0.5 : sigmaS;
  int gx = clamp(cmRound(cmDiv(float(frame.x), s)), 4, ${MAX_RES_S});
  int gy = clamp(cmRound(cmDiv(float(frame.y), s)), 4, ${MAX_RES_S});
  int gz = clamp(cmRound(cmDiv(100.0, sigmaR)), 4, ${MAX_RES_R});
  float grid = max(cmDiv(float(frame.y), float(gy)), cmDiv(float(frame.x), float(gx)));
  float range = cmDiv(100.0, float(gz));
  return vec4(grid, cmDiv(1.0, grid), range, cmDiv(1.0, range));
}
ivec3 cmGridSize(ivec2 frame, vec4 sigmas) {
  return ivec3(int(ceil(float(frame.x) * sigmas.y)) + 1, int(ceil(float(frame.y) * sigmas.y)) + 1, int(ceil(100.0 * sigmas.w)) + 1);
}
highp int cmGridTexels(ivec2 frame, ivec3 size) {
  int quads = (size.z + 3) / 4;
  return ${CONSTANT_TEXELS} + size.x * frame.y + size.x * size.y * quads;
}
// σs of ${SIGMA_S} pixels of the full image at this pass's scale, widened while
// darktable's grid wouldn't fit the target (x of the result 0 when nothing fits).
vec4 cmPlan(ivec2 frame) {
  float longest = float(max(frame.x, frame.y));
  float source = max(uSourceSize.x, uSourceSize.y);
  float s = max(source <= longest ? ${lit(SIGMA_S)} : cmDiv(${lit(SIGMA_S)}, cmDiv(source, longest)), 0.5);
  for (int k = 0; k < ${MAX_WIDEN_STEPS}; k++) {
    vec4 sigmas = cmGridSigmas(frame, s, ${lit(SIGMA_R)});
    if (cmGridTexels(frame, cmGridSize(frame, sigmas)) <= frame.x * frame.y) return sigmas;
    s *= ${lit(WIDEN)};
  }
  return vec4(0.0);
}
vec4 cmConstants() {
  return vec4(cmUnpack(fetchPrev4(ivec2(0, 0))), cmUnpack(fetchPrev4(ivec2(1, 0))), cmUnpack(fetchPrev4(ivec2(2, 0))), cmUnpack(fetchPrev4(ivec2(3, 0))));
}
int cmSpan(float sigmaS) { return int(floor(2.0 * sigmaS)) + 4; }
int cmChunks(float sigmaS) { return (cmSpan(sigmaS) + ${SPLAT_TAPS - 1}) / ${SPLAT_TAPS}; }
int cmSteps(ivec3 size, float sigmaS) { return ((size.z + 3) / 4) * (2 * cmChunks(sigmaS) + 1) + 2; }
// The step draw k runs. Draw 0 plans the grid into the constant texels; the
// schedule ends at the last draw: for each quad of bins its x-splat, blurred
// along x in place, then its y-splat; the grid's blur along y, in place; the
// slice. darktable blurs the whole splat along x, then y: the same sums, as
// both are linear and act on one axis each.
void cmStep(int k, ivec2 frame, vec4 sigmas, out int kind, out int quad, out int chunk) {
  kind = ${BL_STEP.idle};
  quad = 0;
  chunk = 0;
  if (k == 0) {
    kind = ${BL_STEP.plan};
    return;
  }
  ivec3 size = cmGridSize(frame, sigmas);
  int steps = cmSteps(size, sigmas.x);
  if (sigmas.x == 0.0 || uPassCount < steps + 1) {
    if (k == uPassCount - 1) kind = ${BL_STEP.zero};
    return;
  }
  int s = k - (uPassCount - steps);
  if (s < 0) return;
  int chunks = cmChunks(sigmas.x);
  int perQuad = 2 * chunks + 1;
  int splats = steps - 2;
  if (s < splats) {
    quad = s / perQuad;
    int j = s - quad * perQuad;
    kind = j < chunks ? ${BL_STEP.splatX} : (j == chunks ? ${BL_STEP.blurX} : ${BL_STEP.splatY});
    chunk = j < chunks ? j : j - chunks - 1;
  } else {
    kind = s == splats ? ${BL_STEP.blurY} : ${BL_STEP.slice};
  }
}
// The texels [from, to) a step writes.
void cmStepRange(int kind, int quad, ivec2 frame, ivec3 size, out highp int from, out highp int to) {
  highp int sx = ${CONSTANT_TEXELS};
  highp int nodes = size.x * size.y;
  highp int grid = sx + size.x * frame.y;
  from = 0;
  to = 0;
  if (kind == ${BL_STEP.plan}) to = ${CONSTANT_TEXELS};
  if (kind == ${BL_STEP.splatX} || kind == ${BL_STEP.blurX}) {
    from = sx;
    to = grid;
  }
  if (kind == ${BL_STEP.splatY}) {
    from = grid + quad * nodes;
    to = from + nodes;
  }
  if (kind == ${BL_STEP.blurY}) {
    from = grid;
    to = grid + nodes * ((size.z + 3) / 4);
  }
}
ivec4 cmRegion() {
  ivec2 frame = cmFrame();
  if (uPassIndex == 0) return ivec4(0, 0, frame);
  vec4 sigmas = cmConstants();
  int kind, quad, chunk;
  cmStep(uPassIndex, frame, sigmas, kind, quad, chunk);
  if (kind == ${BL_STEP.idle}) return ivec4(0);
  if (kind == ${BL_STEP.slice} || kind == ${BL_STEP.zero}) return ivec4(0, 0, frame);
  ivec3 size = cmGridSize(frame, sigmas);
  highp int from, to, before, after;
  cmStepRange(kind, quad, frame, size, from, to);
  int prevKind, prevQuad, prevChunk;
  cmStep(uPassIndex - 1, frame, sigmas, prevKind, prevQuad, prevChunk);
  cmStepRange(prevKind, prevQuad, frame, size, before, after);
  if (after > before) {
    from = min(from, before);
    to = max(to, after);
  }
  return cmRows(frame.x, from, to);
}
// darktable's tent: a coordinate's weight to a node, the coordinate clamped
// to the grid and its whole part to size - 2 (image_to_grid()).
float cmTent(float coord, float inv, int size, int node) {
  float x = clamp(coord * inv, 0.0, float(size - 1));
  int xi = min(int(x), size - 2);
  float xf = x - float(xi);
  return xi == node ? 1.0 - xf : (xi + 1 == node ? xf : 0.0);
}
int cmFirst(int node, float sigmaS) { return max(int(floor(float(node - 1) * sigmaS)) - 1, 0); }
// One chunk of a node's x-splat of D in one row: four z bins.
vec4 cmSplatX(ivec2 frame, vec4 sigmas, ivec3 size, highp int rel, int quad, int chunk) {
  int gx = int(rel - (rel / size.x) * size.x);
  int y = int(rel / size.x);
  int first = cmFirst(gx, sigmas.x) + chunk * ${SPLAT_TAPS};
  int span = cmSpan(sigmas.x) - chunk * ${SPLAT_TAPS};
  vec4 sum = vec4(0.0);
  for (int t = 0; t < ${SPLAT_TAPS}; t++) {
    int x = first + t;
    if (t < span && x < frame.x) {
      float w = cmTent(float(x), sigmas.y, size.x, gx);
      float z = clamp(cmGridValue(ivec2(x, y)) * sigmas.w, 0.0, float(size.z - 1));
      int zi = min(int(z), size.z - 2);
      float zf = z - float(zi);
      sum += w * ((1.0 - zf) * cmOneHot(zi - 4 * quad) + zf * cmOneHot(zi + 1 - 4 * quad));
    }
  }
  return sum;
}
// One chunk of a node's y-splat of the x-splats.
vec4 cmSplatY(ivec2 frame, vec4 sigmas, ivec3 size, highp int rel, int chunk) {
  int gx = int(rel - (rel / size.x) * size.x);
  int gy = int(rel / size.x);
  int first = cmFirst(gy, sigmas.x) + chunk * ${SPLAT_TAPS};
  int span = cmSpan(sigmas.x) - chunk * ${SPLAT_TAPS};
  vec4 sum = vec4(0.0);
  for (int t = 0; t < ${SPLAT_TAPS}; t++) {
    int y = first + t;
    if (t < span && y < frame.y) {
      sum += cmTent(float(y), sigmas.y, size.y, gy) * cmFetch(${CONSTANT_TEXELS} + y * size.x + gx, frame.x);
    }
  }
  return sum;
}
float cmBlurWeight(int d) { return d == 0 ? 0.375 : (d == 1 || d == -1 ? 0.25 : 0.0625); }
// blur_line(): (1 4 6 4 1) / 16 along x (axis 0: a row of the x-splat) or y
// (a column of a quad of the grid), zero beyond the grid, read from the draw
// before and written in place.
vec4 cmBlur(ivec2 frame, ivec3 size, highp int from, highp int rel, int axis) {
  highp int nodes = size.x * size.y;
  highp int inQuad = rel - (rel / nodes) * nodes;
  int along = axis == 0 ? int(rel - (rel / size.x) * size.x) : int(inQuad / size.x);
  int count = axis == 0 ? size.x : size.y;
  highp int stride = axis == 0 ? 1 : size.x;
  vec4 sum = vec4(0.0);
  for (int d = -2; d <= 2; d++) {
    if (along + d >= 0 && along + d < count) sum += cmBlurWeight(d) * cmFetch(from + rel + d * stride, frame.x);
  }
  return sum;
}
// A grid node's six bins from zi - 2 on, as two vectors (x, y, z of the
// second unused past bin zi + 3), zero outside the grid.
void cmBins6(ivec2 frame, highp int grid, ivec3 size, int gx, int gy, int zi, out vec4 low, out vec2 high) {
  int quads = (size.z + 3) / 4;
  int q0 = (zi + 2) / 4 - 1;
  int o = zi - 2 - 4 * q0;
  highp int node = gy * size.x + gx;
  highp int nodes = size.x * size.y;
  vec4 v0 = q0 >= 0 ? cmFetch(grid + q0 * nodes + node, frame.x) : vec4(0.0);
  vec4 v1 = q0 + 1 < quads ? cmFetch(grid + (q0 + 1) * nodes + node, frame.x) : vec4(0.0);
  vec4 v2 = q0 + 2 < quads ? cmFetch(grid + (q0 + 2) * nodes + node, frame.x) : vec4(0.0);
  vec4 b = vec4(0.0);
  vec2 c2 = vec2(0.0);
  for (int d = 0; d < 6; d++) {
    int i = o + d;
    float v = dot(v0, cmOneHot(i)) + dot(v1, cmOneHot(i - 4)) + dot(v2, cmOneHot(i - 8));
    if (d < 4) b += v * cmOneHot(d);
    else c2 += v * cmOneHot(d - 4).xy;
  }
  low = b;
  high = c2;
}
// dt_bilateral_slice() with detail -1: the z derivative of the blurred grid,
// trilinear at the texel's D, scaled as darktable's splat weighs a pixel.
vec4 cmSlice(ivec2 frame, vec4 sigmas, ivec3 size, ivec2 q) {
  highp int grid = ${CONSTANT_TEXELS} + size.x * frame.y;
  float D = cmGridValue(q);
  float xs = clamp(float(q.x) * sigmas.y, 0.0, float(size.x - 1));
  float ys = clamp(float(q.y) * sigmas.y, 0.0, float(size.y - 1));
  float zs = clamp(D * sigmas.w, 0.0, float(size.z - 1));
  int xi = min(int(xs), size.x - 2);
  int yi = min(int(ys), size.y - 2);
  int zi = min(int(zs), size.z - 2);
  float xf = xs - float(xi);
  float yf = ys - float(yi);
  float zf = zs - float(zi);
  float sum = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec4 low;
      vec2 high;
      cmBins6(frame, grid, size, xi + i, yi + j, zi, low, high);
      float d0 = 0.25 * (low.w - low.y) + 0.125 * (high.x - low.x);
      float d1 = 0.25 * (high.x - low.z) + 0.125 * (high.y - low.y);
      float w = (i == 1 ? xf : 1.0 - xf) * (j == 1 ? yf : 1.0 - yf);
      sum += w * ((1.0 - zf) * d0 + zf * d1);
    }
  }
  float norm = sigmas.z * 0.04;
  return cmResult(norm * (100.0 / (sigmas.x * sigmas.x)) * sum);
}
`;

/** One call site each; a draw runs one of them. */
export const BL_STEP_CALLS = {
  plan: "c = cmPack(dot(cmPlan(frame), cmOneHot(q.x)));",
  splatX: "c = cmHalf4((chunk == 0 ? vec4(0.0) : c) + cmSplatX(frame, sigmas, size, n - from, quad, chunk));",
  splatY: "c = cmHalf4((chunk == 0 ? vec4(0.0) : c) + cmSplatY(frame, sigmas, size, n - from, chunk));",
  blurX: "c = cmHalf4(cmBlur(frame, size, from, n - from, 0));",
  blurY: "c = cmHalf4(cmBlur(frame, size, from, n - from, 1));",
  slice: "c = cmSlice(frame, sigmas, size, q);",
} as const;

export const BL_GLSL = `
ivec2 frame = cmFrame();
ivec2 q = ivec2(gl_FragCoord.xy);
if (uPassIndex == 0) {
  if (q.y == 0 && q.x < ${CONSTANT_TEXELS}) ${BL_STEP_CALLS.plan}
} else {
  vec4 sigmas = cmConstants();
  int kind, quad, chunk;
  cmStep(uPassIndex, frame, sigmas, kind, quad, chunk);
  ivec3 size = cmGridSize(frame, sigmas);
  if (kind == ${BL_STEP.zero}) {
    c = vec4(0.0, 0.0, 0.0, 1.0);
  } else if (kind == ${BL_STEP.slice}) {
    ${BL_STEP_CALLS.slice}
  } else if (kind != ${BL_STEP.idle}) {
    highp int from, to;
    cmStepRange(kind, quad, frame, size, from, to);
    highp int n = q.y * frame.x + q.x;
    if (n >= from && n < to) {
      if (kind == ${BL_STEP.splatX}) {
        ${BL_STEP_CALLS.splatX}
      } else if (kind == ${BL_STEP.splatY}) {
        ${BL_STEP_CALLS.splatY}
      } else if (kind == ${BL_STEP.blurX}) {
        ${BL_STEP_CALLS.blurX}
      } else {
        ${BL_STEP_CALLS.blurY}
      }
    }
  }
}
`;

export const REGION_GLSL = "return cmRegion();";
