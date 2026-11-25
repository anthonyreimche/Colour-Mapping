// The param-bag contract, under the stage's qualified keys.
//
// Edit values (history, Copy Settings, Paste, presets): the switch, the three
// sliders, the smoothing's draw count, the source's clusters (sMean, sVar as
// standard deviations, sWeight; MAXN of each, zero past the photo's count),
// the source's inverse histogram as text (sourceHist, a data key) and the name
// of its texture variant (sihist, named by that text).
//
// Computed values (worked out from the photo, left out of Paste and presets):
// the target's clusters (tMean, tVar, tWeight). The target's cumulative
// histogram is photo data, under THIST_DATA, and feeds the per-photo texture.

import { tableVariant } from "./encoding";
import { BL_DRAWS } from "./grid";
import { DEFAULT_SETTINGS, MAXN, RANGES, hasClusters, type Clusters, type NumericSetting, type Settings } from "./model";

export const EXT_ID = "colour-mapping";
export const STAGE_ID = `${EXT_ID}.lab`;
export const PANEL_ID = `${EXT_ID}.panel`;
export const MENU_ID = `${EXT_ID}.match`;
export const TITLE = "Colour Mapping";

export const SETTING_KEYS: readonly (keyof Settings)[] = ["on", "clusters", "dominance", "equalization"];
export const NUMERIC_KEYS: readonly NumericSetting[] = ["clusters", "dominance", "equalization"];
export const DRAWS_KEY = "blDraws";
export const SOURCE_KEYS = { mean: "sMean", sd: "sVar", weight: "sWeight" } as const;
export const TARGET_KEYS = { mean: "tMean", sd: "tVar", weight: "tWeight" } as const;
/** The source's inverse histogram, as encodeTableText writes it. */
export const SOURCE_HIST_KEY = "sourceHist";
/** Texture keys: the source's table (its bag value names the variant), and the
 *  photo's own cumulative histogram (a per-photo texture). */
export const SIHIST = "sihist";
export const THIST = "thist";
export const DATA_KEYS: readonly string[] = [SOURCE_HIST_KEY, SIHIST];
/** The photo data key of the target's cumulative histogram. */
export const THIST_DATA = "thist";
/** The variant both textures name in an analysis capture: no table, so the
 *  capture never waits on one. */
export const ANALYSIS_VARIANT = "analysis";

/** The panel's labels, which the stage's uniforms share. */
export const LABELS: Readonly<Record<keyof Settings, string>> = {
  on: "Enabled",
  clusters: "Clusters",
  dominance: "Colour dominance",
  equalization: "Histogram equalisation",
};

export const qualified = (key: string): string => `${STAGE_ID}.${key}`;

export interface Edit extends Settings {
  source: Clusters;
  target: Clusters;
  /** The source's table as text, "" for none. */
  sourceHist: string;
}

/** What a source analysis hands a match: its cluster count, clusters and table text. */
export interface SourceAnalysis {
  n: number;
  clusters: Clusters;
  hist: string;
}

type Bag = Readonly<Record<string, unknown>>;
export type Patch = Record<string, unknown>;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function numbers(v: unknown, length: number): number[] {
  const out = new Array<number>(length).fill(0);
  if (!Array.isArray(v)) return out;
  for (let i = 0; i < length && i < v.length; i++) {
    const x: unknown = v[i];
    if (finite(x)) out[i] = x;
  }
  return out;
}

const clustersIn = (bag: Bag, keys: typeof SOURCE_KEYS | typeof TARGET_KEYS): Clusters => ({
  mean: numbers(bag[qualified(keys.mean)], 2 * MAXN),
  sd: numbers(bag[qualified(keys.sd)], 2 * MAXN),
  weight: numbers(bag[qualified(keys.weight)], MAXN),
});

/** `bag` is the host's untyped param bag; a missing or invalid value reads as
 *  its default, and a number out of range as the nearest end of it. */
export function readEdit(bag: Bag): Edit {
  const out: Settings = { ...DEFAULT_SETTINGS };
  const on = bag[qualified("on")];
  if (typeof on === "boolean") out.on = on;
  else if (finite(on)) out.on = on >= 0.5;
  for (const key of NUMERIC_KEYS) {
    const v = bag[qualified(key)];
    if (finite(v)) out[key] = Math.min(Math.max(v, RANGES[key].min), RANGES[key].max);
  }
  out.clusters = Math.round(out.clusters);
  const hist = bag[qualified(SOURCE_HIST_KEY)];
  return {
    ...out,
    source: clustersIn(bag, SOURCE_KEYS),
    target: clustersIn(bag, TARGET_KEYS),
    sourceHist: typeof hist === "string" ? hist : "",
  };
}

/** darktable runs the bilateral grid for equalization / 100 > 0.001f. */
const equalizes = (equalization: number): boolean => Math.fround(equalization / 100) > Math.fround(0.001);

/** The smoothing pass's draw count: 0 unless it has something to smooth. */
export const drawsFor = (e: Edit): number =>
  e.on && equalizes(e.equalization) && hasClusters(e.source) && hasClusters(e.target) ? BL_DRAWS : 0;

const padded = (values: readonly number[], length: number): number[] =>
  Array.from({ length }, (_, i) => (i < values.length ? values[i] : 0));

function clustersPatchOf(c: Clusters, keys: typeof SOURCE_KEYS | typeof TARGET_KEYS): Patch {
  return {
    [qualified(keys.mean)]: padded(c.mean, 2 * MAXN),
    [qualified(keys.sd)]: padded(c.sd, 2 * MAXN),
    [qualified(keys.weight)]: padded(c.weight, MAXN),
  };
}

/** `keys` of `e` and the draw count `e` needs: what a control writes. */
export function settingsPatch(e: Edit, keys: readonly (keyof Settings)[]): Patch {
  const out: Patch = {};
  for (const key of keys) out[qualified(key)] = e[key];
  out[qualified(DRAWS_KEY)] = drawsFor(e);
  return out;
}

/** The source and this photo's target, switched on: what "Match to source"
 *  writes over the photo's edit, which keeps its own dominance and equalisation. */
export function matchPatch(settings: Settings, source: SourceAnalysis, target: Clusters): Patch {
  const edit: Edit = { ...settings, on: true, clusters: source.n, source: source.clusters, target, sourceHist: source.hist };
  return {
    [qualified("on")]: true,
    [qualified("clusters")]: source.n,
    ...clustersPatchOf(source.clusters, SOURCE_KEYS),
    [qualified(SOURCE_HIST_KEY)]: source.hist,
    [qualified(SIHIST)]: tableVariant(source.hist),
    ...clustersPatchOf(target, TARGET_KEYS),
    [qualified(DRAWS_KEY)]: drawsFor(edit),
  };
}

const empty: Clusters = { mean: [], sd: [], weight: [] };

/** A new cluster count: the source and the target go and the transfer stops,
 *  as darktable resets both when the count changes. */
export function clustersPatch(clusters: number): Patch {
  return {
    [qualified("clusters")]: clusters,
    [qualified("on")]: false,
    ...clustersPatchOf(empty, SOURCE_KEYS),
    ...clustersPatchOf(empty, TARGET_KEYS),
    [qualified(SOURCE_HIST_KEY)]: "",
    [qualified(SIHIST)]: "",
    [qualified(DRAWS_KEY)]: 0,
  };
}

export const resetPatch = (): Patch => ({
  ...clustersPatch(DEFAULT_SETTINGS.clusters),
  [qualified("dominance")]: DEFAULT_SETTINGS.dominance,
  [qualified("equalization")]: DEFAULT_SETTINGS.equalization,
});

const OWN_KEYS: readonly string[] = [...SETTING_KEYS, DRAWS_KEY, ...Object.values(SOURCE_KEYS), ...Object.values(TARGET_KEYS)];

/** The draw count the bag's edit needs, when the bag holds another (a paste
 *  or a preset that carried the switch without a target). */
export function rederivePatch(bag: Bag): Patch | null {
  if (!OWN_KEYS.some((key) => qualified(key) in bag)) return null;
  const want = drawsFor(readEdit(bag));
  const have = bag[qualified(DRAWS_KEY)];
  return (finite(have) ? have : 0) === want ? null : { [qualified(DRAWS_KEY)]: want };
}
