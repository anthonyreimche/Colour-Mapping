// The bilateral grid the lightness shift is smoothed with (darktable's
// src/common/bilateral.c, release-5.6.1; GPL-3.0-or-later), as the GPU pass lays it out and
// schedules it: the CPU side of glsl.ts, adapted from Safelight's Local
// Contrast extension. colormapping.c sets σs to 50 pixels of the full image
// and σr to 8.
//
// Copyright (C) 2016-2026 darktable developers (bilateral.c).

const f = Math.fround;

/** σs in pixels of the full image, and σr in lightness. */
export const SIGMA_S = 50;
export const SIGMA_R = 8;

/** DT_COMMON_BILATERAL_MAX_RES_S / _R. */
export const MAX_RES_S = 3000;
export const MAX_RES_R = 50;
/** Input or x-splat texels a draw of a splat reads per pixel. */
export const SPLAT_TAPS = 24;
/** The memory clamp's step and its most steps. */
export const WIDEN = 1.25;
export const MAX_WIDEN_STEPS = 16;
/** Texels at the start of the target that hold the grid's float32 constants. */
export const CONSTANT_TEXELS = 4;
/** The most draws a pass may take. */
export const MAX_DRAWS = 1024;

export interface Grid {
  sigmaS: number;
  sigmaR: number;
  invS: number;
  invR: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  /** Texels per grid node: four z bins each. */
  quads: number;
}

const roundf = (v: number): number => Math.floor(v + 0.5);
const clampi = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** dt_bilateral_grid_size() in float32, L_range 100. */
export function gridSize(width: number, height: number, sigmaSIn: number, sigmaRIn: number): Grid {
  const sigmaS0 = f(sigmaSIn) < 0.5 ? 0.5 : f(sigmaSIn);
  const gx = clampi(roundf(f(width / sigmaS0)), 4, MAX_RES_S);
  const gy = clampi(roundf(f(height / sigmaS0)), 4, MAX_RES_S);
  const gz = clampi(roundf(f(100 / f(sigmaRIn))), 4, MAX_RES_R);
  const sigmaS = Math.max(f(height / gy), f(width / gx));
  const sigmaR = f(100 / gz);
  const invS = f(1 / sigmaS);
  const invR = f(1 / sigmaR);
  const sizeX = Math.ceil(f(width * invS)) + 1;
  const sizeY = Math.ceil(f(height * invS)) + 1;
  const sizeZ = Math.ceil(f(100 * invR)) + 1;
  return { sigmaS, sigmaR, invS, invR, sizeX, sizeY, sizeZ, quads: Math.ceil(sizeZ / 4) };
}

/** Texels the pass keeps: the constants, one quad's x-splat (blurred in place
 *  along x) and the grid (blurred in place along y). */
export const gridTexels = (g: Grid, height: number): number => CONSTANT_TEXELS + g.sizeX * height + g.sizeX * g.sizeY * g.quads;

/** Pixels a node's tent can reach along an axis, with a pixel of slack each side. */
export const splatSpan = (sigmaS: number): number => Math.floor(2 * sigmaS) + 4;
export const splatChunks = (sigmaS: number): number => Math.ceil(splatSpan(sigmaS) / SPLAT_TAPS);

/** The plan draw; for each quad its x-splat chunks, the x-blur and its
 *  y-splat chunks; then the y-blur and the slice. */
export const bilateralSteps = (quads: number, chunks: number): number => 1 + quads * (2 * chunks + 1) + 2;

/** σs for a pass `passLongEdge` pixels long over a source `sourceLongEdge`
 *  long: 50 / max(source / pass, 1), as darktable's 50 / scale. */
export function passSigmaS(sourceLongEdge: number, passLongEdge: number): number {
  if (sourceLongEdge <= passLongEdge) return SIGMA_S;
  return f(SIGMA_S / f(sourceLongEdge / passLongEdge));
}

export interface BilateralPlan {
  grid: Grid;
  /** Times the memory clamp widened σs (0: darktable's grid as it is). */
  widened: number;
  chunks: number;
  draws: number;
}

/** The grid and draws a pass of `width` × `height` runs at σs `sigmaS`,
 *  widening σs where darktable's grid wouldn't fit the target; null when
 *  nothing fits. */
export function bilateralPlan(width: number, height: number, sigmaS: number): BilateralPlan | null {
  let sigma = Math.max(f(sigmaS), 0.5);
  for (let k = 0; k < MAX_WIDEN_STEPS; k++) {
    const grid = gridSize(width, height, sigma, SIGMA_R);
    if (gridTexels(grid, height) <= width * height) {
      const chunks = splatChunks(grid.sigmaS);
      return { grid, widened: k, chunks, draws: bilateralSteps(grid.quads, chunks) };
    }
    sigma = f(sigma * WIDEN);
  }
  return null;
}

/** The z bins' quads, which depend only on σr. */
export const GRID_QUADS = gridSize(4096, 4096, SIGMA_S, SIGMA_R).quads;

/** The σs no pass's grid exceeds: rounding the grid to whole cells adds up to
 *  an eighth, and the memory clamp at most a few pixels on frames of 64 px and up. */
export const SIGMA_BOUND = 1.25 * SIGMA_S;

/** The pass's draw count while it runs: enough for any frame of 64 px and up.
 *  A frame that needs fewer runs idle draws first. */
export const BL_DRAWS = Math.min(bilateralSteps(GRID_QUADS, splatChunks(SIGMA_BOUND)), MAX_DRAWS);
