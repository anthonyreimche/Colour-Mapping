// The GPU pass's grid and schedule (src/grid.ts) against darktable's own
// dt_bilateral_init() (the transcription the C reference holds exactly).

import { describe, expect, it } from "vitest";
import { BL_DRAWS, GRID_QUADS, SIGMA_R, SIGMA_S, bilateralPlan, gridSize, passSigmaS } from "../src/grid";
import { bilateralInit } from "./support/process-model";

const FRAMES: [number, number][] = [
  [48, 32],
  [64, 64],
  [320, 200],
  [640, 427],
  [1280, 853],
  [4096, 2731],
  [6000, 4000],
  [8192, 5461],
];

describe("the grid", () => {
  it.each(FRAMES)("is darktable's for a %i × %i frame at any scale", (w, h) => {
    for (const sigma of [0.3, 3, 8, 12.5, 25, 50]) {
      const g = gridSize(w, h, sigma, SIGMA_R);
      const b = bilateralInit(w, h, sigma, SIGMA_R);
      expect([g.sizeX, g.sizeY, g.sizeZ, g.sigmaS, g.sigmaR, g.invS, g.invR]).toEqual([b.sizeX, b.sizeY, b.sizeZ, b.sigmaS, b.sigmaR, b.invS, b.invR]);
    }
  });

  it("has σr 8 cut into four quads of bins", () => {
    expect(SIGMA_R).toBe(8);
    expect(GRID_QUADS).toBe(Math.ceil(gridSize(100, 100, SIGMA_S, SIGMA_R).sizeZ / 4));
    expect(GRID_QUADS).toBe(4);
  });

  it("takes σs as 50 pixels of the full image", () => {
    expect(passSigmaS(6000, 6000)).toBe(50);
    expect(passSigmaS(6000, 1500)).toBe(12.5);
    expect(passSigmaS(1000, 2000)).toBe(50);
  });
});

describe("the draw count", () => {
  it.each(FRAMES)("covers a %i × %i frame of any source", (w, h) => {
    for (const source of [w, 2 * w, 6000, 12000]) {
      const plan = bilateralPlan(w, h, passSigmaS(Math.max(source, w), Math.max(w, h)));
      expect(plan).not.toBeNull();
      expect(plan?.draws).toBeLessThanOrEqual(BL_DRAWS);
    }
  });

  it("fits darktable's grid without widening it on photo-sized frames", () => {
    for (const [w, h] of FRAMES.slice(2)) expect(bilateralPlan(w, h, SIGMA_S)?.widened).toBe(0);
  });

  it("stays well under the pass limit", () => {
    expect(BL_DRAWS).toBeLessThan(100);
  });
});
