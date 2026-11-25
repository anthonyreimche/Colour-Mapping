// darktable's colour mapping (src/iop/colormapping.c, release-5.6.1;
// GPL-3.0-or-later), the parts the CPU runs: the edit's ranges and defaults,
// the analysis of a frame (the cumulative lightness histogram, its inverse and
// the k-means clusters of a* and b*) and the mapping between clusters that the
// stage repeats per pixel. Single precision and upstream's order throughout,
// so test/reference.test.ts holds every number to darktable's C exactly.
//
// Copyright (C) 2013-2026 darktable developers.
//
// One intended difference from upstream: k-means starts from a seeded
// generator, so the same frame always gives the same clusters, and a variance
// that rounds below zero counts as zero rather than giving NaN (docs/SPEC.md).

/** Bins of the lightness histogram (HISTN). */
export const HISTN = 2048;
/** The most clusters (MAXN). */
export const MAXN = 5;

export interface Range {
  min: number;
  max: number;
  step: number;
}

export interface Settings {
  on: boolean;
  /** Clusters to find in a photo, 1 to 5. */
  clusters: number;
  /** Percent: how clusters pair up, by colour proximity (0) or by how much of
   *  the photo each covers (100). */
  dominance: number;
  /** Percent of the source's spread of tones taken on. */
  equalization: number;
}

export type NumericSetting = Exclude<keyof Settings, "on">;

export const DEFAULT_SETTINGS: Readonly<Settings> = { on: false, clusters: 3, dominance: 100, equalization: 50 };

/** The sliders' limits, as the params' introspection gives them. */
export const RANGES: Readonly<Record<NumericSetting, Range>> = {
  clusters: { min: 1, max: MAXN, step: 1 },
  dominance: { min: 0, max: 100, step: 1 },
  equalization: { min: 0, max: 100, step: 1 },
};

/** n clusters of a* and b*: `mean` and `sd` as (a, b) pairs, `weight` the
 *  share of pixels each holds, in ascending order of weight. */
export interface Clusters {
  mean: number[];
  sd: number[];
  weight: number[];
}

const f = Math.fround;
const FLT_MAX = 3.4028234663852886e38;

/** glib's CLAMP: x > hi ? hi : (x < lo ? lo : x). */
export const glibClamp = (x: number, lo: number, hi: number): number => (x > hi ? hi : x < lo ? lo : x);

/** The seed every analysis starts from. */
export const KMEANS_SEED = 0x2545f491;

/** A generator of floats in [0, 1) (mulberry32), standing in for
 *  dt_points_get(): each call starts again from KMEANS_SEED. */
export function seededPoints(): () => number {
  let state = KMEANS_SEED;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    t = (t ^ (t >>> 14)) >>> 0;
    return (t >>> 8) * 2 ** -24;
  };
}

/** capture_histogram(): channel 0 (L*) of `pixels` pixels `stride` floats
 *  apart, binned in double as upstream does, accumulated and scaled so the
 *  last entry is 2047. */
export function captureHistogram(lab: ArrayLike<number>, pixels: number, stride = 4): Int32Array {
  const hist = new Int32Array(HISTN);
  for (let k = 0; k < pixels; k++) {
    const bin = Math.trunc(glibClamp((HISTN * f(lab[k * stride])) / 100, 0, HISTN - 1));
    hist[bin]++;
  }
  for (let k = 1; k < HISTN; k++) hist[k] += hist[k - 1];
  const scale = f(HISTN / f(hist[HISTN - 1]));
  for (let k = 0; k < HISTN; k++) hist[k] = Math.trunc(glibClamp(f(f(hist[k]) * scale), 0, HISTN - 1));
  return hist;
}

/** invert_histogram(), as the table entries k: the inverse histogram's value
 *  at i is 100·k / 2048 (inverseValue). */
export function invertHistogram(hist: ArrayLike<number>): Int32Array {
  const table = new Int32Array(HISTN);
  let last = 31;
  for (let i = 0; i <= last; i++) table[i] = i;
  for (let i = last + 1; i < HISTN; i++) {
    for (let k = last; k < HISTN; k++) {
      if (hist[k] >= i) {
        last = k;
        table[i] = k;
        break;
      }
    }
  }
  return table;
}

/** An inverse histogram entry as upstream stores it: 100.0f * k / HISTN. */
export const inverseValue = (k: number): number => f(f(100 * k) / HISTN);

/** kmeans() over `pixels` Lab pixels `stride` floats apart, one iteration per
 *  step, so a caller can let the page breathe between them. */
export function* kmeansSteps(lab: ArrayLike<number>, pixels: number, n: number, stride = 4): Generator<void, Clusters> {
  const nit = 40;
  const meanOut = new Float32Array(2 * n);
  const varOut = new Float32Array(2 * n);
  const weightOut = new Float32Array(n);
  const sum = new Float32Array(2 * n);
  const sumSq = new Float32Array(2 * n);
  const cnt = new Int32Array(n);

  let aMin = FLT_MAX;
  let bMin = FLT_MAX;
  let aMax = -FLT_MAX;
  let bMax = -FLT_MAX;
  for (let k = 0; k < pixels; k++) {
    const a = lab[k * stride + 1];
    const b = lab[k * stride + 2];
    if (a < aMin) aMin = a;
    if (a > aMax) aMax = a;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
  }

  const points = seededPoints();
  for (let k = 0; k < n; k++) {
    meanOut[2 * k] = f(f(0.9) * f(aMin + f(f(aMax - aMin) * points())));
    meanOut[2 * k + 1] = f(f(0.9) * f(bMin + f(f(bMax - bMin) * points())));
  }

  for (let it = 0; it < nit; it++) {
    sum.fill(0);
    sumSq.fill(0);
    cnt.fill(0);
    for (let k = 0; k < pixels; k++) {
      const a = lab[k * stride + 1];
      const b = lab[k * stride + 2];
      let mdist = FLT_MAX;
      let c = 0;
      for (let m = 0; m < n; m++) {
        const da = f(a - meanOut[2 * m]);
        const db = f(b - meanOut[2 * m + 1]);
        const dist = f(f(da * da) + f(db * db));
        if (dist < mdist) {
          mdist = dist;
          c = m;
        }
      }
      cnt[c]++;
      sumSq[2 * c] = f(sumSq[2 * c] + f(a * a));
      sumSq[2 * c + 1] = f(sumSq[2 * c + 1] + f(b * b));
      sum[2 * c] = f(sum[2 * c] + a);
      sum[2 * c + 1] = f(sum[2 * c + 1] + b);
    }
    for (let k = 0; k < n; k++) {
      if (cnt[k] === 0) continue;
      for (let ch = 0; ch < 2; ch++) {
        const mean = f(sum[2 * k + ch] / cnt[k]);
        meanOut[2 * k + ch] = mean;
        varOut[2 * k + ch] = f(f(sumSq[2 * k + ch] / cnt[k]) - f(mean * mean));
      }
    }
    let count = 0;
    for (let k = 0; k < n; k++) count += cnt[k];
    for (let k = 0; k < n; k++) weightOut[k] = count > 0 ? f(cnt[k] / count) : 0;
    yield;
  }

  const clusters: { mean: [number, number]; sd: [number, number]; weight: number }[] = [];
  for (let k = 0; k < n; k++) {
    let mean: [number, number] = [meanOut[2 * k], meanOut[2 * k + 1]];
    let variance: [number, number] = [varOut[2 * k], varOut[2 * k + 1]];
    let weight = weightOut[k];
    if (variance[0] === 0 || variance[1] === 0) {
      mean = [0, 0];
      variance = [0, 0];
      weight = 0;
    }
    const sd = variance.map((v) => f(Math.sqrt(v > 0 ? v : 0))) as [number, number];
    clusters.push({ mean, sd, weight });
  }

  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1 - i; j++) {
      if (clusters[j].weight > clusters[j + 1].weight) [clusters[j], clusters[j + 1]] = [clusters[j + 1], clusters[j]];
    }
  }

  return {
    mean: clusters.flatMap((c) => c.mean),
    sd: clusters.flatMap((c) => c.sd),
    weight: clusters.map((c) => c.weight),
  };
}

/** kmeans() in one go. */
export function kmeans(lab: ArrayLike<number>, pixels: number, n: number, stride = 4): Clusters {
  const steps = kmeansSteps(lab, pixels, n, stride);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** get_cluster_mapping(): for each of the target's clusters `mi`, the
 *  source's cluster `mo` nearest by colour and weight, `dominance` 0 to 1
 *  weighing the two. The first of equally near clusters wins. */
export function clusterMapping(
  n: number,
  mi: ArrayLike<number>,
  wi: ArrayLike<number>,
  mo: ArrayLike<number>,
  wo: ArrayLike<number>,
  dominance: number,
): number[] {
  const weightscale = 10000;
  const d = f(dominance);
  const mapio: number[] = new Array<number>(n).fill(0);
  for (let ki = 0; ki < n; ki++) {
    let mdist = FLT_MAX;
    for (let ko = 0; ko < n; ko++) {
      const da = f(mo[2 * ko] - mi[2 * ki]);
      const db = f(mo[2 * ko + 1] - mi[2 * ki + 1]);
      const colordist = f(f(da * da) + f(db * db));
      const dw = f(wo[ko] - wi[ki]);
      const weightdist = f(f(weightscale * dw) * dw);
      const dist = f(f(colordist * f(1 - d)) + f(weightdist * d));
      if (dist < mdist) {
        mdist = dist;
        mapio[ki] = ko;
      }
    }
  }
  return mapio;
}

/** get_clusters(): a pixel's (a, b) share of each cluster, by inverse squared
 *  distance (Shepard's method). A cluster it sits on takes it whole, shared
 *  among every cluster it sits on. */
export function clusterWeights(a: number, b: number, n: number, mean: ArrayLike<number>): number[] {
  const weight: number[] = [];
  let mdist = FLT_MAX;
  for (let k = 0; k < n; k++) {
    const da = f(a - mean[2 * k]);
    const db = f(b - mean[2 * k + 1]);
    const dist2 = f(f(da * da) + f(db * db));
    weight.push(dist2 > f(1e-6) ? f(1 / dist2) : -1);
    if (dist2 < mdist) mdist = dist2;
  }
  if (mdist < f(1e-6)) for (let k = 0; k < n; k++) weight[k] = weight[k] < 0 ? 1 : 0;
  let sum = 0;
  for (let k = 0; k < n; k++) sum = f(sum + weight[k]);
  if (sum > 0) for (let k = 0; k < n; k++) weight[k] = f(weight[k] / sum);
  return weight;
}

/** Clusters as an empty edit holds them: all zero. */
export const noClusters = (): Clusters => ({
  mean: new Array<number>(2 * MAXN).fill(0),
  sd: new Array<number>(2 * MAXN).fill(0),
  weight: new Array<number>(MAXN).fill(0),
});

/** Whether any cluster holds pixels: the stage passes the photo through until
 *  both the source's and the target's do. */
export const hasClusters = (c: Clusters): boolean => c.weight.some((w) => w > 0);
