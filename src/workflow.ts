// The two steps of a colour transfer. "Use as source" analyses the open photo
// and keeps that analysis as the app-wide colour source. "Match to source"
// analyses a photo as the target and writes the source and the target into
// its edit, the transfer switched on, as one undo step: the open photo from
// Develop, any photos from the Library's grid menu. The target's histogram
// goes into the photo's data, for its per-photo texture.

import { ANALYSIS_BAG, ANALYSIS_EDGE, CAPTURE, analyseFrame, asSource, type FrameAnalysis } from "./analysis";
import { encodeTable } from "./encoding";
import { SIHIST, STAGE_ID, THIST, THIST_DATA, TITLE, matchPatch, readEdit } from "./params";
import { api } from "./rt";
import type { DevelopParams, FloatFrame } from "./safelight";
import { SOURCE_SETTING, store, type AppSource } from "./store";
import type { Tables } from "./textures";

export const MATCH_LABEL = `${TITLE}: match to source`;
export const REFERENCE_LABEL = `${TITLE}: match to reference`;

/** The shared variable Reference View names its reference photo in. */
export const REFERENCE_VARIABLE = "reference.photo";

let tables: Tables | null = null;

export function initWorkflow(t: Tables): void {
  tables = t;
  const source = store().getState().source;
  if (source) t.rememberSource(source.hist);
}

function held(): Tables {
  if (!tables) throw new Error("Colour Mapping's workflow is used before activate()");
  return tables;
}

const develop = () => api.stores.useDevelopStore.getState();

const photoName = (photoId: string): string =>
  api.stores.useCatalogStore.getState().photos.find((p) => p.id === photoId)?.filename ?? "the source photo";

/** The open photo's frame as the stage receives it, or null when it can't be
 *  read or another photo opened meanwhile. */
async function captureOpen(photoId: string): Promise<FloatFrame | null> {
  const frame = await api.develop.captureFloatFrame(develop().params, {
    ...CAPTURE,
    paramBag: { ...ANALYSIS_BAG },
    maxEdge: ANALYSIS_EDGE,
  });
  return frame && develop().photoId === photoId ? frame : null;
}

async function busyWith<T>(busy: "source" | "match" | "batch", run: () => Promise<T>): Promise<T | undefined> {
  if (store().getState().busy) return undefined;
  store().getState().setBusy(busy);
  try {
    return await run();
  } catch (err) {
    console.warn("[colour-mapping]", err);
    api.ui.notify({ message: `${TITLE} couldn't analyse the photo.`, tone: "error" });
    return undefined;
  } finally {
    store().getState().setBusy(null);
  }
}

/** Analyses the open photo at its own cluster count and keeps it as the colour source. */
export function setAsSource(): Promise<void> {
  return busyWith("source", async () => {
    const photoId = develop().photoId;
    if (!photoId) return;
    const n = readEdit(develop().paramBag).clusters;
    const frame = await captureOpen(photoId);
    if (!frame) return;
    const source: AppSource = { ...asSource(n, await analyseFrame(frame, n)), photoId, name: photoName(photoId) };
    held().rememberSource(source.hist);
    api.settings.set(SOURCE_SETTING, source);
    store().getState().setSource(source);
  });
}

/** The target's histogram as the photo's data and its texture, and the
 *  source's table held, before either name reaches a bag. */
async function storeTarget(photoId: string, source: AppSource, target: FrameAnalysis, open: boolean): Promise<void> {
  const t = held();
  t.setTarget(photoId, target.hist);
  api.develop.putPhotoData(THIST_DATA, encodeTable(target.hist), open ? undefined : photoId);
  const variant = t.rememberSource(source.hist);
  if (!open) return;
  // The live view then never draws the match without its tables.
  await Promise.all([
    api.prepareStageTextureVariant(STAGE_ID, SIHIST, variant).catch(() => undefined),
    api.prepareStageTextureVariant(STAGE_ID, THIST, photoId).catch(() => undefined),
  ]);
}

/** Analyses the open photo as the target and matches it to `source`, as one
 *  undo step labelled `label`. */
async function matchOpen(photoId: string, source: AppSource, label: string): Promise<void> {
  const frame = await captureOpen(photoId);
  if (!frame) return;
  const target = await analyseFrame(frame, source.n);
  if (develop().photoId !== photoId) return;
  await storeTarget(photoId, source, target, true);
  if (develop().photoId !== photoId) return;
  develop().setDynParams(matchPatch(readEdit(develop().paramBag), source, target.clusters));
  await develop().commitEdit(label);
}

/** Analyses the open photo as the target and matches it to the colour source. */
export function matchToSource(): Promise<void> {
  return busyWith("match", async () => {
    const source = store().getState().source;
    const photoId = develop().photoId;
    if (!source || !photoId) return;
    await matchOpen(photoId, source, MATCH_LABEL);
  });
}

/** Takes the reference photo, as its stored edit draws it, as the colour
 *  source at the open photo's cluster count, then matches the open photo to
 *  it. Nothing changes when the reference can't be read. */
export function matchToReference(): Promise<void> {
  return busyWith("match", async () => {
    const reference = store().getState().reference;
    const photoId = develop().photoId;
    if (!reference || !photoId || reference.photoId === photoId) return;
    const n = readEdit(develop().paramBag).clusters;
    const { params, bag } = await storedEdit(reference.photoId);
    const frame = await api.develop.renderPhotoFloatFrame(reference.photoId, params, { ...CAPTURE, paramBag: { ...bag, ...ANALYSIS_BAG } });
    if (!frame || develop().photoId !== photoId) return;
    const source: AppSource = { ...asSource(n, await analyseFrame(frame, n)), photoId: reference.photoId, name: reference.name };
    held().rememberSource(source.hist);
    api.settings.set(SOURCE_SETTING, source);
    store().getState().setSource(source);
    await matchOpen(photoId, source, REFERENCE_LABEL);
  });
}

/** A photo's edit as stored: the step its history stands on, or a fresh edit. */
async function storedEdit(photoId: string): Promise<{ params: DevelopParams; bag: Record<string, unknown> }> {
  const state = await api.catalog.getEditState(photoId);
  const step = state && state.stack.length > 0 ? state.stack[Math.min(Math.max(state.currentIndex, 0), state.stack.length - 1)] : null;
  if (step) return { params: step.params, bag: step.paramBag ?? {} };
  const photo = api.stores.useCatalogStore.getState().photos.find((p) => p.id === photoId);
  return { params: api.develop.normalizeParams({ temperature: photo?.exif.colorTemperature }), bag: {} };
}

/** Matches one photo, open or not, headlessly; whether it could be read. */
async function matchPhoto(photoId: string, source: AppSource): Promise<boolean> {
  const open = develop().photoId === photoId;
  const { params, bag } = open ? { params: develop().params, bag: develop().paramBag } : await storedEdit(photoId);
  const frame = await api.develop.renderPhotoFloatFrame(photoId, params, { ...CAPTURE, paramBag: { ...bag, ...ANALYSIS_BAG } });
  if (!frame) return false;
  const target = await analyseFrame(frame, source.n);
  const stillOpen = develop().photoId === photoId;
  await storeTarget(photoId, source, target, stillOpen);
  if (stillOpen && develop().photoId === photoId) {
    develop().setDynParams(matchPatch(readEdit(develop().paramBag), source, target.clusters));
    await develop().commitEdit(MATCH_LABEL);
  } else {
    await api.catalog.applyBagPatch(photoId, matchPatch(readEdit(bag), source, target.clusters), MATCH_LABEL);
  }
  return true;
}

const photos = (count: number): string => (count === 1 ? "1 photo" : `${count} photos`);

/** The Library's "Match to colour source" over the chosen photos. */
export function matchPhotos(ids: readonly string[]): Promise<void> {
  return busyWith("batch", async () => {
    const source = store().getState().source;
    if (!source || ids.length === 0) return;
    const notice = api.ui.notify({ message: `Matching ${photos(ids.length)} to ${source.name}`, progress: 0 });
    let failed = 0;
    for (const [i, id] of ids.entries()) {
      try {
        if (!(await matchPhoto(id, source))) failed++;
      } catch (err) {
        console.warn(`[colour-mapping] ${id}:`, err);
        failed++;
      }
      notice.update({ progress: (i + 1) / ids.length });
    }
    const matched = ids.length - failed;
    notice.update({
      message: failed === 0 ? `Matched ${photos(matched)} to ${source.name}` : `Matched ${photos(matched)}; ${photos(failed)} couldn't be read`,
      tone: failed === 0 ? "success" : "warning",
      progress: null,
    });
  });
}
