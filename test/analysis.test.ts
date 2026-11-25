// A frame's analysis: Lab from the frame's linear Rec.709 floats, then the
// reference-tested histogram and k-means, without holding the page.

import { describe, expect, it } from "vitest";
import { ANALYSIS_BAG, ANALYSIS_EDGE, CAPTURE, analyseFrame, asSource } from "../src/analysis";
import { decodeTableText } from "../src/encoding";
import { frameToLab, labToCss, labToRgb, rgbToLab } from "../src/lab";
import { captureHistogram, invertHistogram, kmeans } from "../src/model";
import { ANALYSIS_VARIANT, qualified } from "../src/params";
import { referenceFrame } from "./support/frames";

describe("Lab", () => {
  it("round-trips through linear Rec.709", () => {
    for (const lab of [
      [50, 0, 0],
      [5, 20, -30],
      [95, -10, 60],
      [53.39, 40, 40],
    ]) {
      const back = rgbToLab(labToRgb(lab));
      for (let c = 0; c < 3; c++) expect(back[c]).toBeCloseTo(lab[c], 9);
    }
  });

  // darktable's matrix and its D50 white differ in the fifth place, which
  // leaves white 0.025 off the axis in b*, there as here.
  it("puts white at L* 100 and greys next to the neutral axis", () => {
    const white = rgbToLab([1, 1, 1]);
    expect(white[0]).toBeCloseTo(100, 4);
    expect(Math.abs(white[1])).toBeLessThan(0.01);
    expect(Math.abs(white[2])).toBeLessThan(0.03);
    expect(rgbToLab([0.18, 0.18, 0.18])[0]).toBeCloseTo(49.5, 0);
  });

  it("draws a swatch in sRGB, clipped", () => {
    expect(labToCss([100, 0, 0])).toBe("rgb(255, 255, 255)");
    expect(labToCss([0, 0, 0])).toBe("rgb(0, 0, 0)");
    const grey = (/^rgb\((\d+), (\d+), (\d+)\)$/.exec(labToCss([53.39, 0, 0])) ?? []).slice(1).map(Number);
    expect(grey).toHaveLength(3);
    expect(Math.max(...grey) - Math.min(...grey)).toBeLessThanOrEqual(1);
  });
});

describe("analysing a frame", () => {
  const frame = referenceFrame("three blobs, 3 clusters");

  it("is the histogram and clusters of the frame's Lab", async () => {
    const lab = frameToLab(frame.data);
    const pixels = frame.width * frame.height;
    const got = await analyseFrame(frame, 3);
    expect(got.hist).toEqual(captureHistogram(lab, pixels));
    expect(got.clusters).toEqual(kmeans(lab, pixels, 3));
  });

  it("lets the page draw between iterations", async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    await analyseFrame(frame, 5);
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(0);
  });

  it("keeps a source's inverse histogram as text", async () => {
    const a = await analyseFrame(frame, 3);
    const s = asSource(3, a);
    expect(s.n).toBe(3);
    expect(decodeTableText(s.hist)).toEqual(invertHistogram(a.hist));
  });
});

describe("the analysis capture", () => {
  it("reads the frame the stage would receive, without the stage and its tables, at 640 px", () => {
    expect(ANALYSIS_EDGE).toBe(640);
    expect(CAPTURE).toEqual({ point: "pre-output", space: { encoding: "linear", primaries: "rec709" } });
    expect(ANALYSIS_BAG).toEqual({
      [qualified("on")]: false,
      [qualified("sihist")]: ANALYSIS_VARIANT,
      [qualified("thist")]: ANALYSIS_VARIANT,
    });
  });
});
