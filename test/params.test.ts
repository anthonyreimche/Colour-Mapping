// The param-bag contract: what the panel and the match write, and how any bag
// (pasted, from a preset, hand-edited) reads back.

import { describe, expect, it } from "vitest";
import { encodeTableText, tableVariant } from "../src/encoding";
import { BL_DRAWS } from "../src/grid";
import { DEFAULT_SETTINGS, MAXN, invertHistogram, type Clusters } from "../src/model";
import {
  STAGE_ID,
  clustersPatch,
  drawsFor,
  matchPatch,
  qualified,
  readEdit,
  rederivePatch,
  resetPatch,
  settingsPatch,
  type SourceAnalysis,
} from "../src/params";
import { VECTORS } from "./support/vectors";

const clusters = (n: number, base: number): Clusters => ({
  mean: Array.from({ length: 2 * n }, (_, i) => base + i),
  sd: Array.from({ length: 2 * n }, (_, i) => 1 + i / 10),
  weight: Array.from({ length: n }, () => 1 / n),
});

const table = invertHistogram(VECTORS.histograms[0].hist);
const source: SourceAnalysis = { n: 3, clusters: clusters(3, 10), hist: encodeTableText(table) };

describe("reading a bag", () => {
  it("reads an empty bag as the defaults, with no clusters and no table", () => {
    const e = readEdit({});
    expect(e).toMatchObject(DEFAULT_SETTINGS);
    expect(e.source.weight).toEqual(new Array(MAXN).fill(0));
    expect(e.target.mean).toEqual(new Array(2 * MAXN).fill(0));
    expect(e.sourceHist).toBe("");
  });

  it("keeps values in range and whole clusters", () => {
    const e = readEdit({
      [qualified("clusters")]: 9.4,
      [qualified("dominance")]: -5,
      [qualified("equalization")]: 250,
      [qualified("on")]: 1,
    });
    expect(e).toMatchObject({ clusters: 5, dominance: 0, equalization: 100, on: true });
    expect(readEdit({ [qualified("clusters")]: 2.6 }).clusters).toBe(3);
    expect(readEdit({ [qualified("clusters")]: Number.NaN }).clusters).toBe(3);
  });

  it("pads short arrays and drops ones of the wrong type", () => {
    const e = readEdit({ [qualified("sMean")]: [1, 2], [qualified("tWeight")]: "x", [qualified("sVar")]: [1, Number.NaN, 3] });
    expect(e.source.mean).toEqual([1, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(e.source.sd.slice(0, 3)).toEqual([1, 0, 3]);
    expect(e.target.weight).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("a match", () => {
  const target = clusters(3, -20);
  const patch = matchPatch({ ...DEFAULT_SETTINGS, dominance: 40, equalization: 70 }, source, target);

  it("switches the transfer on with the source's clusters and table, and the photo's own", () => {
    expect(patch[qualified("on")]).toBe(true);
    expect(patch[qualified("clusters")]).toBe(3);
    expect(patch[qualified("sMean")]).toEqual([10, 11, 12, 13, 14, 15, 0, 0, 0, 0]);
    expect(patch[qualified("sWeight")]).toEqual([1 / 3, 1 / 3, 1 / 3, 0, 0]);
    expect(patch[qualified("tMean")]).toEqual([-20, -19, -18, -17, -16, -15, 0, 0, 0, 0]);
    expect(patch[qualified("sourceHist")]).toBe(source.hist);
    expect(patch[qualified("sihist")]).toBe(tableVariant(source.hist));
  });

  it("keeps the photo's dominance and equalisation, and runs the smoothing", () => {
    expect(patch[qualified("dominance")]).toBeUndefined();
    expect(patch[qualified("equalization")]).toBeUndefined();
    expect(patch[qualified("blDraws")]).toBe(BL_DRAWS);
  });

  it("writes only keys of the stage", () => {
    for (const key of Object.keys(patch)) expect(key.startsWith(`${STAGE_ID}.`)).toBe(true);
  });

  it("reads back as it was written", () => {
    const e = readEdit(patch);
    expect(e.on).toBe(true);
    expect(e.source.mean.slice(0, 6)).toEqual(source.clusters.mean);
    expect(e.target.sd.slice(0, 6)).toEqual(target.sd);
    expect(e.sourceHist).toBe(source.hist);
  });
});

describe("the smoothing's draws", () => {
  const matched = readEdit(matchPatch(DEFAULT_SETTINGS, source, clusters(3, -20)));

  it("run while the transfer is on, equalises and has both sides", () => {
    expect(drawsFor(matched)).toBe(BL_DRAWS);
    expect(drawsFor({ ...matched, on: false })).toBe(0);
    expect(drawsFor({ ...matched, target: { ...matched.target, weight: [0, 0, 0, 0, 0] } })).toBe(0);
  });

  // darktable runs the bilateral grid only for equalisation above 0.1 %.
  it("stop at an equalisation of 0.1 % or less", () => {
    expect(drawsFor({ ...matched, equalization: 0.1 })).toBe(0);
    expect(drawsFor({ ...matched, equalization: 0.11 })).toBe(BL_DRAWS);
    expect(drawsFor({ ...matched, equalization: 0 })).toBe(0);
  });

  it("follow each setting a slider writes", () => {
    const p = settingsPatch({ ...matched, equalization: 0 }, ["equalization"]);
    expect(p).toEqual({ [qualified("equalization")]: 0, [qualified("blDraws")]: 0 });
  });

  it("are put right in a bag that disagrees, and left alone in one that agrees or isn't ours", () => {
    const bag = { ...matchPatch(DEFAULT_SETTINGS, source, clusters(3, -20)), [qualified("blDraws")]: 0 };
    expect(rederivePatch(bag)).toEqual({ [qualified("blDraws")]: BL_DRAWS });
    expect(rederivePatch({ ...bag, [qualified("blDraws")]: BL_DRAWS })).toBeNull();
    expect(rederivePatch({ "other.stage.on": true })).toBeNull();
    // A pasted switch without a target: nothing to smooth.
    expect(rederivePatch({ [qualified("on")]: true, [qualified("blDraws")]: BL_DRAWS })).toEqual({ [qualified("blDraws")]: 0 });
  });
});

describe("changing the number of clusters", () => {
  it("clears the source and the target and switches the transfer off, as in darktable", () => {
    const p = clustersPatch(4);
    expect(p[qualified("clusters")]).toBe(4);
    expect(p[qualified("on")]).toBe(false);
    for (const key of ["sMean", "sVar", "tMean", "tVar"]) expect(p[qualified(key)]).toEqual(new Array(2 * MAXN).fill(0));
    for (const key of ["sWeight", "tWeight"]) expect(p[qualified(key)]).toEqual(new Array(MAXN).fill(0));
    expect(p[qualified("sourceHist")]).toBe("");
    expect(p[qualified("sihist")]).toBe("");
    expect(p[qualified("blDraws")]).toBe(0);
  });
});

describe("reset", () => {
  it("puts back the defaults with nothing analysed", () => {
    const e = readEdit(resetPatch());
    expect(e).toMatchObject(DEFAULT_SETTINGS);
    expect(e.sourceHist).toBe("");
    expect(drawsFor(e)).toBe(0);
  });
});
