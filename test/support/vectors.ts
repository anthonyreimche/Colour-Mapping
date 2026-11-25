// The C reference's output (test/reference/vectors.json, from
// colormapping_ref.c). Read with JSON.parse rather than imported: Vite's JSON
// import turns -0 into 0. The C printed each float with nine significant
// digits, enough to name it exactly; rounding the parsed double to single
// precision recovers it.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface HistogramCase {
  L: number[];
  hist: number[];
  inv: number[];
}

export interface KmeansCase {
  name: string;
  w: number;
  h: number;
  n: number;
  lab: number[];
  rawVar: number[];
  mean: number[];
  sd: number[];
  weight: number[];
}

export interface MappingCase {
  n: number;
  dominance: number;
  mi: number[];
  wi: number[];
  mo: number[];
  wo: number[];
  mapio: number[];
}

export interface WeightsCase {
  n: number;
  mean: number[];
  ab: number[];
  weight: number[];
}

export interface ProcessCase {
  name: string;
  w: number;
  h: number;
  n: number;
  dominance: number;
  equalization: number;
  sigmaS: number;
  source: number[];
  target: number[];
  out: number[];
}

export interface Vectors {
  seed: number;
  rng: number[];
  histograms: HistogramCase[];
  kmeans: KmeansCase[];
  mapping: MappingCase[];
  weights: WeightsCase[];
  process: ProcessCase[];
}

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "reference", "vectors.json");

export const VECTORS: Vectors = JSON.parse(readFileSync(FILE, "utf8"), (key, value: unknown) =>
  typeof value === "number" && key !== "seed" ? Math.fround(value) : value,
);
