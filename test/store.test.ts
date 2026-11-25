// The colour source as the extension's settings keep it: only a whole, valid
// analysis reads back.

import { describe, expect, it } from "vitest";
import { encodeTableText } from "../src/encoding";
import { invertHistogram } from "../src/model";
import { readAppSource, type AppSource } from "../src/store";
import { VECTORS } from "./support/vectors";

const SOURCE: AppSource = {
  photoId: "photo-9",
  name: "IMG_0009.CR3",
  n: 2,
  clusters: { mean: [1, 2, 3, 4], sd: [1, 1, 2, 2], weight: [0.4, 0.6] },
  hist: encodeTableText(invertHistogram(VECTORS.histograms[0].hist)),
};

describe("a stored colour source", () => {
  it("reads back as it was stored, through JSON", () => {
    expect(readAppSource(JSON.parse(JSON.stringify(SOURCE)))).toEqual(SOURCE);
  });

  it("is none when anything is missing or out of shape", () => {
    expect(readAppSource(null)).toBeNull();
    expect(readAppSource("source")).toBeNull();
    expect(readAppSource({ ...SOURCE, n: 0 })).toBeNull();
    expect(readAppSource({ ...SOURCE, n: 6 })).toBeNull();
    expect(readAppSource({ ...SOURCE, n: 3 })).toBeNull();
    expect(readAppSource({ ...SOURCE, hist: "nonsense" })).toBeNull();
    expect(readAppSource({ ...SOURCE, name: undefined })).toBeNull();
    expect(readAppSource({ ...SOURCE, clusters: { ...SOURCE.clusters, sd: [1, 1, 2, Number.NaN] } })).toBeNull();
    expect(readAppSource({ ...SOURCE, clusters: null })).toBeNull();
  });
});
