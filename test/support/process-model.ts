// darktable's process() for colour mapping, and the bilateral grid it smooths
// the lightness shift with (src/iop/colormapping.c, src/common/bilateral.c,
// release-5.6.1), in TypeScript for the tests: single precision, one thread,
// every operation in upstream's order. reference.test.ts holds it to the C;
// the GPU suite holds the stage to it.
//
// Copyright (C) 2013-2026 darktable developers (colormapping.c), 2016-2026
// (bilateral.c), 2012-2023 (bilateral.h). GPL-3.0-or-later.

import { HISTN, MAXN, clusterMapping, clusterWeights, glibClamp, inverseValue, type Clusters } from "../../src/model";

const f = Math.fround;

export interface ProcessParams {
  n: number;
  /** Percent, as the params hold them. */
  dominance: number;
  equalization: number;
  /** The source's inverse histogram, as table entries k. */
  sourceTable: ArrayLike<number>;
  source: Clusters;
  /** The target's cumulative histogram. */
  targetHist: ArrayLike<number>;
  target: Clusters;
}

const MAX_RES_S = 3000;
const MAX_RES_R = 50;

/** darktable's CLAMPS: (A) > (L) ? ((A) < (H) ? (A) : (H)) : (L). */
const clamps = (a: number, lo: number, hi: number): number => (a > lo ? (a < hi ? a : hi) : lo);
const roundf = (v: number): number => Math.sign(v) * Math.floor(Math.abs(v) + 0.5);

export interface Grid {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  width: number;
  height: number;
  sigmaS: number;
  sigmaR: number;
  invS: number;
  invR: number;
  buf: Float32Array;
}

/** dt_bilateral_init(): dt_bilateral_grid_size() over L_range 100. */
export function bilateralInit(width: number, height: number, sigmaSIn: number, sigmaRIn: number): Grid {
  const s = f(sigmaSIn) < 0.5 ? 0.5 : f(sigmaSIn);
  const x = clamps(roundf(f(width / s)), 4, MAX_RES_S);
  const y = clamps(roundf(f(height / s)), 4, MAX_RES_S);
  const z = clamps(roundf(f(100 / f(sigmaRIn))), 4, MAX_RES_R);
  const sigmaS = Math.max(f(height / y), f(width / x));
  const sigmaR = f(100 / z);
  const invS = f(1 / sigmaS);
  const invR = f(1 / sigmaR);
  const sizeX = Math.ceil(f(width * invS)) + 1;
  const sizeY = Math.ceil(f(height * invS)) + 1;
  const sizeZ = Math.ceil(f(100 * invR)) + 1;
  // One slice: slicerows = size_y + 2.
  const buf = new Float32Array(sizeX * sizeZ * (sizeY + 2));
  return { sizeX, sizeY, sizeZ, width, height, sigmaS, sigmaR, invS, invR, buf };
}

function relGrid(b: Grid, i: number, L: number): { index: number; xf: number; zf: number } {
  const x = clamps(f(i * b.invS), 0, b.sizeX - 1);
  const z = clamps(f(L * b.invR), 0, b.sizeZ - 1);
  const xi = Math.min(Math.trunc(x), b.sizeX - 2);
  const zi = Math.min(Math.trunc(z), b.sizeZ - 2);
  return { index: xi * b.sizeZ + zi, xf: f(x - xi), zf: f(z - zi) };
}

/** dt_bilateral_splat() of channel 0 of RGBA `data`. */
export function bilateralSplat(b: Grid, data: Float32Array): void {
  const ox = b.sizeZ;
  const oy = b.sizeX * b.sizeZ;
  const sigma2 = f(b.sigmaS * b.sigmaS);
  const offsets = [0, ox, oy, ox + oy, 1, 1 + ox, 1 + oy, 1 + oy + ox];
  const buf = b.buf;
  for (let j = 0; j < b.height; j++) {
    const y = clamps(f(j * b.invS), 0, b.sizeY - 1);
    const yi = Math.min(Math.trunc(y), b.sizeY - 2);
    const yf = f(y - yi);
    const base = yi * oy;
    for (let i = 0; i < b.width; i++) {
      const L = data[4 * (j * b.width + i)];
      const { index, xf, zf } = relGrid(b, i, L);
      const g = base + index;
      const contrib = [
        f(f(f(f(1 - xf) * f(1 - yf)) * 100) / sigma2),
        f(f(f(xf * f(1 - yf)) * 100) / sigma2),
        f(f(f(f(1 - xf) * yf) * 100) / sigma2),
        f(f(f(xf * yf) * 100) / sigma2),
      ];
      for (let k = 0; k < 4; k++) {
        buf[g + offsets[k]] = f(buf[g + offsets[k]] + f(contrib[k] * f(1 - zf)));
        buf[g + offsets[k + 4]] = f(buf[g + offsets[k + 4]] + f(contrib[k] * zf));
      }
    }
  }
}

function blurLine(buf: Float32Array, offset1: number, offset2: number, offset3: number, size1: number, size2: number, size3: number): void {
  const w0 = 6 / 16;
  const w1 = 4 / 16;
  const w2 = 1 / 16;
  for (let k = 0; k < size1; k++) {
    let index = k * offset1;
    for (let j = 0; j < size2; j++) {
      let tmp1 = buf[index];
      buf[index] = f(f(f(buf[index] * w0) + f(w1 * buf[index + offset3])) + f(w2 * buf[index + 2 * offset3]));
      index += offset3;
      let tmp2 = buf[index];
      buf[index] = f(f(f(buf[index] * w0) + f(w1 * f(buf[index + offset3] + tmp1))) + f(w2 * buf[index + 2 * offset3]));
      index += offset3;
      for (let i = 2; i < size3 - 2; i++) {
        const tmp3 = buf[index];
        buf[index] = f(f(f(buf[index] * w0) + f(w1 * f(buf[index + offset3] + tmp2))) + f(w2 * f(buf[index + 2 * offset3] + tmp1)));
        index += offset3;
        tmp1 = tmp2;
        tmp2 = tmp3;
      }
      const tmp3 = buf[index];
      buf[index] = f(f(f(buf[index] * w0) + f(w1 * f(buf[index + offset3] + tmp2))) + f(w2 * tmp1));
      index += offset3;
      buf[index] = f(f(f(buf[index] * w0) + f(w1 * tmp3)) + f(w2 * tmp2));
      index += offset3;
      index += offset2 - offset3 * size3;
    }
  }
}

function blurLineZ(buf: Float32Array, offset1: number, offset2: number, offset3: number, size1: number, size2: number, size3: number): void {
  const w1 = 4 / 16;
  const w2 = 2 / 16;
  for (let k = 0; k < size1; k++) {
    let index = k * offset1;
    for (let j = 0; j < size2; j++) {
      let tmp1 = buf[index];
      buf[index] = f(f(w1 * buf[index + offset3]) + f(w2 * buf[index + 2 * offset3]));
      index += offset3;
      let tmp2 = buf[index];
      buf[index] = f(f(w1 * f(buf[index + offset3] - tmp1)) + f(w2 * buf[index + 2 * offset3]));
      index += offset3;
      for (let i = 2; i < size3 - 2; i++) {
        const tmp3 = buf[index];
        buf[index] = f(f(w1 * f(buf[index + offset3] - tmp2)) + f(w2 * f(buf[index + 2 * offset3] - tmp1)));
        index += offset3;
        tmp1 = tmp2;
        tmp2 = tmp3;
      }
      const tmp3 = buf[index];
      buf[index] = f(f(w1 * f(buf[index + offset3] - tmp2)) - f(w2 * tmp1));
      index += offset3;
      buf[index] = f(f(-w1 * tmp3) - f(w2 * tmp2));
      index += offset3;
      index += offset2 - offset3 * size3;
    }
  }
}

/** dt_bilateral_blur(). */
export function bilateralBlur(b: Grid): void {
  const ox = b.sizeZ;
  const oy = b.sizeX * b.sizeZ;
  blurLine(b.buf, 1, oy, ox, b.sizeZ, b.sizeY, b.sizeX);
  blurLine(b.buf, 1, ox, oy, b.sizeZ, b.sizeX, b.sizeY);
  blurLineZ(b.buf, ox, oy, 1, b.sizeX, b.sizeY, b.sizeZ);
}

/** dt_bilateral_slice() of channel 0, in place. */
export function bilateralSlice(b: Grid, data: Float32Array, detail: number): void {
  const norm = f(f(-detail * b.sigmaR) * f(0.04));
  const ox = b.sizeZ;
  const oy = b.sizeX * b.sizeZ;
  const buf = b.buf;
  for (let j = 0; j < b.height; j++) {
    for (let i = 0; i < b.width; i++) {
      const at = 4 * (j * b.width + i);
      const L = data[at];
      const x = clamps(f(i * b.invS), 0, b.sizeX - 1);
      const y = clamps(f(j * b.invS), 0, b.sizeY - 1);
      const z = clamps(f(L * b.invR), 0, b.sizeZ - 1);
      const xi = Math.min(Math.trunc(x), b.sizeX - 2);
      const yi = Math.min(Math.trunc(y), b.sizeY - 2);
      const zi = Math.min(Math.trunc(z), b.sizeZ - 2);
      const xf = f(x - xi);
      const yf = f(y - yi);
      const zf = f(z - zi);
      const gi = (xi + yi * b.sizeX) * b.sizeZ + zi;
      const term = (v: number, wx: number, wy: number, wz: number) => f(f(f(v * wx) * wy) * wz);
      let sum = term(buf[gi], f(1 - xf), f(1 - yf), f(1 - zf));
      sum = f(sum + term(buf[gi + ox], xf, f(1 - yf), f(1 - zf)));
      sum = f(sum + term(buf[gi + oy], f(1 - xf), yf, f(1 - zf)));
      sum = f(sum + term(buf[gi + ox + oy], xf, yf, f(1 - zf)));
      sum = f(sum + term(buf[gi + 1], f(1 - xf), f(1 - yf), zf));
      sum = f(sum + term(buf[gi + ox + 1], xf, f(1 - yf), zf));
      sum = f(sum + term(buf[gi + oy + 1], f(1 - xf), yf, zf));
      sum = f(sum + term(buf[gi + ox + oy + 1], xf, yf, zf));
      const Lout = f(L + f(norm * sum));
      data[at] = Lout > 0 ? Lout : 0;
    }
  }
}

/** The bin process() reads the target histogram at: HISTN * L / 100.0f in float. */
export const processBin = (L: number): number => Math.trunc(glibClamp(f(f(HISTN * L) / 100), 0, HISTN - 1));

/** process() over RGBA Lab `input`, `sigmaS` being 50 / scale. */
export function processLab(p: ProcessParams, input: Float32Array, width: number, height: number, sigmaS: number): Float32Array {
  const n = Math.min(Math.max(p.n, 1), MAXN);
  const dominance = f(p.dominance / 100);
  const equalization = f(p.equalization / 100);
  const mapio = clusterMapping(n, p.target.mean, p.target.weight, p.source.mean, p.source.weight, dominance);
  const ratio: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < 2; ch++) {
      const tv = p.target.sd[2 * i + ch];
      ratio.push(tv > 0 ? f(p.source.sd[2 * mapio[i] + ch] / tv) : 0);
    }
  }

  const pixels = width * height;
  const out = new Float32Array(4 * pixels);
  for (let k = 0; k < 4 * pixels; k += 4) {
    const L = input[k];
    const ih = inverseValue(p.sourceTable[p.targetHist[processBin(L)]]);
    const D = f(f(0.5 * f(f(f(L * f(1 - equalization)) + f(ih * equalization)) - L)) + 50);
    out[k] = glibClamp(D, 0, 100);
  }

  if (equalization > f(0.001)) {
    const b = bilateralInit(width, height, sigmaS, 8);
    bilateralSplat(b, out);
    bilateralBlur(b);
    bilateralSlice(b, out, -1);
  }

  for (let j = 0; j < 4 * pixels; j += 4) {
    const L = input[j];
    const a = input[j + 1];
    const bb = input[j + 2];
    out[j] = glibClamp(f(f(2 * f(out[j] - 50)) + L), 0, 100);
    const w = clusterWeights(a, bb, n, p.target.mean);
    let oa = 0;
    let ob = 0;
    for (let c = 0; c < n; c++) {
      const sm = 2 * mapio[c];
      oa = f(oa + f(w[c] * f(f(f(a - p.target.mean[2 * c]) * ratio[2 * c]) + p.source.mean[sm])));
      ob = f(ob + f(w[c] * f(f(f(bb - p.target.mean[2 * c + 1]) * ratio[2 * c + 1]) + p.source.mean[sm + 1])));
    }
    out[j + 1] = oa;
    out[j + 2] = ob;
    out[j + 3] = input[j + 3];
  }
  return out;
}
