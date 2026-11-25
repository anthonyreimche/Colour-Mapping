// The analysis and the per-pixel transfer against darktable's own C
// (test/reference/vectors.json, written by `npm run reference` from
// colormapping_ref.c compiled with gcc). Both run in single precision and in
// the same order, so every number agrees exactly.

import { describe, expect, it } from "vitest";
import {
  HISTN,
  captureHistogram,
  clusterMapping,
  clusterWeights,
  inverseValue,
  invertHistogram,
  kmeans,
  seededPoints,
} from "../src/model";
import { processLab } from "./support/process-model";
import { VECTORS } from "./support/vectors";

const lab = (values: number[]): Float32Array => Float32Array.from(values);

describe("the seeded generator standing in for dt_points_get()", () => {
  it("gives the C reference's numbers, from the same seed each time", () => {
    const next = seededPoints();
    expect(VECTORS.rng.map(() => next())).toEqual(VECTORS.rng);
    const again = seededPoints();
    expect(again()).toBe(VECTORS.rng[0]);
  });

  it("stays in [0, 1)", () => {
    const next = seededPoints();
    for (let i = 0; i < 10000; i++) {
      const v = next();
      expect(v >= 0 && v < 1).toBe(true);
    }
  });
});

describe("capture_histogram", () => {
  it.each(VECTORS.histograms.map((c, i) => [i, c] as const))("case %i: the cumulative histogram, scaled to 0 … 2047", (_i, c) => {
    const pixels = new Float32Array(4 * c.L.length);
    c.L.forEach((L, k) => (pixels[4 * k] = L));
    expect(Array.from(captureHistogram(pixels, c.L.length))).toEqual(c.hist);
  });

  // The bin is taken in double (HISTN * L / 100.0): at a bin's edge, and the
  // floats either side of it, a float division would put some pixels a bin off.
  it("bins in double precision, as upstream does", () => {
    const edges = VECTORS.histograms[3];
    expect(edges.L.length).toBe(2 * HISTN);
    const pixels = new Float32Array(4 * edges.L.length);
    edges.L.forEach((L, k) => (pixels[4 * k] = L));
    expect(Array.from(captureHistogram(pixels, edges.L.length))).toEqual(edges.hist);
  });

  it("always ends at 2047", () => {
    for (const c of VECTORS.histograms) expect(c.hist[HISTN - 1]).toBe(HISTN - 1);
  });
});

describe("invert_histogram", () => {
  it.each(VECTORS.histograms.map((c, i) => [i, c] as const))("case %i: the table, as k and as 100·k / 2048", (_i, c) => {
    const table = invertHistogram(c.hist);
    expect(Array.from(table, inverseValue)).toEqual(c.inv);
  });

  it("is the identity up to 31, and never decreases", () => {
    for (const c of VECTORS.histograms) {
      const table = invertHistogram(c.hist);
      for (let i = 0; i <= 31; i++) expect(table[i]).toBe(i);
      for (let i = 1; i < HISTN; i++) expect(table[i]).toBeGreaterThanOrEqual(table[i - 1]);
    }
  });
});

describe("kmeans", () => {
  it.each(VECTORS.kmeans.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const got = kmeans(lab(c.lab), c.w * c.h, c.n);
    expect(got.mean).toEqual(c.mean);
    expect(got.sd).toEqual(c.sd);
    expect(got.weight).toEqual(c.weight);
  });

  it("takes a variance below zero as zero, where upstream's square root gives NaN", () => {
    const c = VECTORS.kmeans.find((k) => k.rawVar.some((v) => v < 0));
    if (!c) throw new Error("no reference case has a negative variance");
    const got = kmeans(lab(c.lab), c.w * c.h, c.n);
    const negative = c.rawVar.findIndex((v) => v < 0);
    expect(got.sd[negative]).toBe(0);
    expect(got.sd.every(Number.isFinite)).toBe(true);
    // The cluster stays: only an exact zero eliminates one.
    expect(got.weight[negative >> 1]).toBeGreaterThan(0);
  });

  it("eliminates clusters whose variance is exactly zero to (0, 0), weight 0, first in order", () => {
    const c = VECTORS.kmeans.find((k) => k.name === "two flat patches, 5 clusters");
    if (!c) throw new Error("missing case");
    const got = kmeans(lab(c.lab), c.w * c.h, c.n);
    expect(got.weight.slice(0, 2)).toEqual([0, 0]);
    expect(got.mean.slice(0, 4)).toEqual([0, 0, 0, 0]);
    for (let k = 1; k < c.n; k++) expect(got.weight[k]).toBeGreaterThanOrEqual(got.weight[k - 1]);
  });

  it("gives the same clusters for the same frame every time", () => {
    const c = VECTORS.kmeans[0];
    expect(kmeans(lab(c.lab), c.w * c.h, c.n)).toEqual(kmeans(lab(c.lab), c.w * c.h, c.n));
  });
});

describe("get_cluster_mapping", () => {
  it.each(VECTORS.mapping.map((c, i) => [i, c] as const))("case %i", (_i, c) => {
    expect(clusterMapping(c.n, c.mi, c.wi, c.mo, c.wo, c.dominance)).toEqual(c.mapio);
  });

  it("keeps the first of equally near clusters", () => {
    const ties = VECTORS.mapping.filter((c) => c.wi.every((w) => w === c.wi[0]) && c.n === 5);
    expect(ties.length).toBeGreaterThan(0);
    for (const c of ties) expect(clusterMapping(c.n, c.mi, c.wi, c.mo, c.wo, c.dominance)).toEqual(c.mapio);
    expect(ties.find((c) => c.dominance === 1)?.mapio).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("get_clusters", () => {
  it.each(VECTORS.weights.map((c, i) => [i, c] as const))("case %i", (_i, c) => {
    expect(clusterWeights(c.ab[0], c.ab[1], c.n, c.mean)).toEqual(c.weight);
  });

  it("shares a direct hit between two clusters eliminated to (0, 0)", () => {
    const c = VECTORS.weights.find((w) => w.n === 5 && w.ab[0] === 0 && w.ab[1] === 0);
    expect(c?.weight).toEqual([0.5, 0.5, 0, 0, 0]);
    expect(clusterWeights(0, 0, 5, c?.mean ?? [])).toEqual([0.5, 0.5, 0, 0, 0]);
  });
});

describe("process", () => {
  it.each(VECTORS.process.map((c) => [c.name, c] as const))("%s: every pixel", (_name, c) => {
    const pixels = c.w * c.h;
    const source = lab(c.source);
    const target = lab(c.target);
    const out = processLab(
      {
        n: c.n,
        dominance: c.dominance,
        equalization: c.equalization,
        sourceTable: invertHistogram(captureHistogram(source, pixels)),
        source: kmeans(source, pixels, c.n),
        targetHist: captureHistogram(target, pixels),
        target: kmeans(target, pixels, c.n),
      },
      target,
      c.w,
      c.h,
      c.sigmaS,
    );
    expect(Array.from(out)).toEqual(c.out);
  });
});
