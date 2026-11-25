// The two tables' texture providers: the source's from the asking frame's
// bag, by a content-named variant; the target's per photo, from memory or the
// photo's data. The analysis variant has no data, so a capture never waits.

import { describe, expect, it } from "vitest";
import { encodeTable, encodeTableText, tableVariant, textureEntry } from "../src/encoding";
import { invertHistogram } from "../src/model";
import { ANALYSIS_VARIANT, SOURCE_HIST_KEY, STAGE_ID, THIST, THIST_DATA, qualified } from "../src/params";
import { Tables } from "../src/textures";
import { fakeApi } from "./support/fake-api";
import { VECTORS } from "./support/vectors";

const sourceTable = invertHistogram(VECTORS.histograms[0].hist);
const sourceText = encodeTableText(sourceTable);
const targetHist = Int32Array.from(VECTORS.histograms[1].hist);

const entries = (data: Float32Array | Uint8Array | undefined): number[] => Array.from(data ?? [], textureEntry);

describe("the source's table", () => {
  it("comes from the bag of the frame that asks for it", async () => {
    const tables = new Tables(fakeApi().api);
    const tex = await tables.source(tableVariant(sourceText), { [qualified(SOURCE_HIST_KEY)]: sourceText });
    expect(tex).toMatchObject({ width: 2048, height: 1, format: "r16f" });
    expect(entries(tex?.data)).toEqual(Array.from(sourceTable));
  });

  it("is none for a variant its bag's table isn't named by, or with no bag", async () => {
    const tables = new Tables(fakeApi().api);
    expect(await tables.source("s0000000000000000", { [qualified(SOURCE_HIST_KEY)]: sourceText })).toBeNull();
    expect(await tables.source(tableVariant(sourceText), {})).toBeNull();
    expect(await tables.source(tableVariant(sourceText))).toBeNull();
  });

  it("comes from memory once held, bag or none", async () => {
    const tables = new Tables(fakeApi().api);
    expect(tables.rememberSource(sourceText)).toBe(tableVariant(sourceText));
    expect(entries((await tables.source(tableVariant(sourceText)))?.data)).toEqual(Array.from(sourceTable));
  });

  it("is none in an analysis", async () => {
    const tables = new Tables(fakeApi().api);
    tables.rememberSource(sourceText);
    expect(await tables.source(ANALYSIS_VARIANT, { [qualified(SOURCE_HIST_KEY)]: sourceText })).toBeNull();
  });

  it("is handed over with a new version each time", async () => {
    const tables = new Tables(fakeApi().api);
    tables.rememberSource(sourceText);
    const a = await tables.source(tableVariant(sourceText));
    const b = await tables.source(tableVariant(sourceText));
    expect(b?.version).toBeGreaterThan(a?.version ?? Infinity);
  });
});

describe("the photo's own histogram", () => {
  it("comes from the photo's data, read once", async () => {
    const rig = fakeApi();
    rig.photoData.set(`photo-7/${THIST_DATA}`, encodeTable(targetHist));
    const tables = new Tables(rig.api);
    expect(entries((await tables.target("photo-7"))?.data)).toEqual(Array.from(targetHist));
    rig.photoData.clear();
    expect(entries((await tables.target("photo-7"))?.data)).toEqual(Array.from(targetHist));
  });

  it("is none for a photo never matched, or with data it can't read, and in an analysis", async () => {
    const rig = fakeApi();
    rig.photoData.set(`photo-8/${THIST_DATA}`, new Uint8Array([1, 2, 3]));
    const tables = new Tables(rig.api);
    expect(await tables.target("photo-7")).toBeNull();
    expect(await tables.target("photo-8")).toBeNull();
    tables.setTarget(ANALYSIS_VARIANT, targetHist);
    expect(await new Tables(rig.api).target(ANALYSIS_VARIANT)).toBeNull();
  });

  it("is made again after a match, the photo's frames asking for it anew", async () => {
    const rig = fakeApi();
    rig.photoData.set(`photo-7/${THIST_DATA}`, encodeTable(targetHist));
    const tables = new Tables(rig.api);
    await tables.target("photo-7");
    const next = invertHistogram(targetHist);
    tables.setTarget("photo-7", next);
    expect(rig.dropped).toEqual([[STAGE_ID, THIST, "photo-7"]]);
    expect(entries((await tables.target("photo-7"))?.data)).toEqual(Array.from(next));
  });
});

describe("registration", () => {
  it("serves both keys through the host, the source's with the asking bag", async () => {
    const rig = fakeApi();
    const tables = new Tables(rig.api);
    tables.register();
    const provide = rig.providers.get(`${STAGE_ID}/sihist`);
    const tex = await provide?.(tableVariant(sourceText), new AbortController().signal, { [qualified(SOURCE_HIST_KEY)]: sourceText });
    expect(entries(tex?.data)).toEqual(Array.from(sourceTable));
    tables.unregister();
    expect(rig.providers.get(`${STAGE_ID}/sihist`)).toBeNull();
    expect(rig.providers.get(`${STAGE_ID}/thist`)).toBeNull();
  });
});
