// The extension's own state, never stored with a photo: the app-wide colour
// source (kept in the extension's settings, so every window and every later
// session has it) and the analysis under way, if any.

import { decodeTableText } from "./encoding";
import { MAXN, type Clusters } from "./model";
import type { SourceAnalysis } from "./params";
import { api } from "./rt";
import type { AppStore } from "./safelight";

/** The settings key the colour source is kept under. */
export const SOURCE_SETTING = "source";

/** The colour source: a photo's analysis, and which photo it was. */
export interface AppSource extends SourceAnalysis {
  photoId: string;
  name: string;
}

const isNumbers = (v: unknown, length: number): v is number[] =>
  Array.isArray(v) && v.length === length && v.every((x) => typeof x === "number" && Number.isFinite(x));

/** A stored value as a colour source; anything else is none. */
export function readAppSource(value: unknown): AppSource | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Partial<Record<keyof AppSource, unknown>>;
  const n = v.n;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAXN) return null;
  if (typeof v.photoId !== "string" || typeof v.name !== "string" || typeof v.hist !== "string") return null;
  if (decodeTableText(v.hist) === null) return null;
  const c = v.clusters;
  if (typeof c !== "object" || c === null) return null;
  const { mean, sd, weight } = c as Partial<Record<keyof Clusters, unknown>>;
  if (!isNumbers(mean, 2 * n) || !isNumbers(sd, 2 * n) || !isNumbers(weight, n)) return null;
  return { photoId: v.photoId, name: v.name, n, hist: v.hist, clusters: { mean, sd, weight } };
}

export type Busy = "source" | "match" | "batch" | null;

export interface ColourMappingUi {
  source: AppSource | null;
  busy: Busy;
  setSource(source: AppSource | null): void;
  setBusy(busy: Busy): void;
}

let instance: AppStore<ColourMappingUi> | null = null;

export function initStore(): void {
  instance = api.stores.create<ColourMappingUi>()((set) => ({
    source: readAppSource(api.settings.get<unknown>(SOURCE_SETTING, null)),
    busy: null,
    setSource: (source) => set({ source }),
    setBusy: (busy) => set({ busy }),
  }));
}

export function store(): AppStore<ColourMappingUi> {
  if (!instance) throw new Error("Colour Mapping's store is used before activate()");
  return instance;
}
