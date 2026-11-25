// The Library's "Match to colour source": each chosen photo analysed headless
// from its stored edit, its histogram written to its data and the match
// committed to its edit, the open photo's through Develop.

import { afterEach, describe, expect, it } from "vitest";
import { ANALYSIS_BAG, CAPTURE, analyseFrame, asSource } from "../src/analysis";
import { encodeTable } from "../src/encoding";
import { activate, deactivate } from "../src/index";
import { DEFAULT_SETTINGS } from "../src/model";
import { THIST_DATA, matchPatch, qualified } from "../src/params";
import type { CatalogPhoto, DevelopParams, EditState } from "../src/safelight";
import { SOURCE_SETTING, store, type AppSource } from "../src/store";
import { MATCH_LABEL, matchPhotos } from "../src/workflow";
import { PARAMS, fakeApi } from "./support/fake-api";
import { SOURCE_IMAGE, TARGET_IMAGE, referenceFrame } from "./support/frames";

const sourceFrame = referenceFrame(SOURCE_IMAGE);
const targetFrame = referenceFrame(TARGET_IMAGE);
const otherFrame = referenceFrame("two flat patches, 3 clusters");

async function setup() {
  const rig = fakeApi([
    { id: "open", filename: "OPEN.CR3" },
    { id: "edited", filename: "EDITED.CR3" },
    { id: "fresh", filename: "FRESH.CR3", exif: { colorTemperature: 4300 } as CatalogPhoto["exif"] },
    { id: "broken", filename: "BROKEN.CR3" },
  ]);
  rig.open("open", { [qualified("dominance")]: 25 });
  activate(rig.api);
  const source: AppSource = { ...asSource(3, await analyseFrame(sourceFrame, 3)), photoId: "elsewhere", name: "SOURCE.CR3" };
  rig.setSetting(SOURCE_SETTING, source);
  const editedParams = { ...PARAMS, exposure: 1 } as unknown as DevelopParams;
  const edit: EditState = {
    photoId: "edited",
    currentIndex: 1,
    stack: [
      { timestamp: 1, label: "Original", params: PARAMS, paramBag: {} },
      { timestamp: 2, label: "Exposure", params: editedParams, paramBag: { "other.stage.amount": 3, [qualified("equalization")]: 80 } },
    ],
  };
  rig.edits.set("edited", edit);
  rig.frames.set("open", targetFrame);
  rig.frames.set("edited", otherFrame);
  rig.frames.set("fresh", targetFrame);
  rig.frames.set("broken", null);
  return { rig, source, editedParams };
}

afterEach(() => deactivate());

describe("matching photos from the Library", () => {
  it("analyses each photo from its stored edit, with the stage off", async () => {
    const { rig, editedParams } = await setup();
    await matchPhotos(["edited", "fresh"]);
    expect(rig.renders.map((r) => r.photoId)).toEqual(["edited", "fresh"]);
    expect(rig.renders[0].params).toBe(editedParams);
    expect(rig.renders[0].options).toEqual({ ...CAPTURE, paramBag: { "other.stage.amount": 3, [qualified("equalization")]: 80, ...ANALYSIS_BAG } });
    // A photo never edited renders fresh, at its own as-shot white balance.
    expect(rig.renders[1].params).toMatchObject({ temperature: 4300 });
    expect(rig.renders[1].options.paramBag).toEqual(ANALYSIS_BAG);
  });

  it("writes each photo's histogram to its data and the match to its edit, one step each", async () => {
    const { rig, source } = await setup();
    await matchPhotos(["edited", "fresh"]);
    const edited = await analyseFrame(otherFrame, 3);
    const fresh = await analyseFrame(targetFrame, 3);
    expect(rig.photoData.get(`edited/${THIST_DATA}`)).toEqual(encodeTable(edited.hist));
    expect(rig.photoData.get(`fresh/${THIST_DATA}`)).toEqual(encodeTable(fresh.hist));
    expect(rig.applied).toEqual([
      { photoId: "edited", patch: matchPatch({ ...DEFAULT_SETTINGS, equalization: 80 }, source, edited.clusters), label: MATCH_LABEL },
      { photoId: "fresh", patch: matchPatch(DEFAULT_SETTINGS, source, fresh.clusters), label: MATCH_LABEL },
    ]);
    expect(rig.commits).toEqual([]);
  });

  it("matches the open photo through Develop, from its live edit", async () => {
    const { rig, source } = await setup();
    await matchPhotos(["open"]);
    expect(rig.renders[0].params).toBe(rig.develop().params);
    expect(rig.applied).toEqual([]);
    expect(rig.commits).toEqual([MATCH_LABEL]);
    const target = await analyseFrame(targetFrame, 3);
    const want = matchPatch({ ...DEFAULT_SETTINGS, dominance: 25 }, source, target.clusters);
    for (const [key, value] of Object.entries(want)) expect(rig.develop().paramBag[key]).toEqual(value);
    expect(rig.photoData.get(`open/${THIST_DATA}`)).toEqual(encodeTable(target.hist));
  });

  it("goes on past a photo it can't read, and says how many it matched", async () => {
    const { rig } = await setup();
    await matchPhotos(["broken", "fresh"]);
    expect(rig.applied.map((a) => a.photoId)).toEqual(["fresh"]);
    expect(rig.notices).toHaveLength(1);
    expect(rig.notices[0]).toMatchObject({ message: "Matched 1 photo; 1 photo couldn't be read", tone: "warning", progress: null });
  });

  it("reports its progress, then the result", async () => {
    const { rig } = await setup();
    await matchPhotos(["edited", "fresh"]);
    expect(rig.notices[0]).toMatchObject({ message: "Matched 2 photos to SOURCE.CR3", tone: "success", progress: null });
  });

  it("does nothing without a colour source, or while another analysis runs", async () => {
    const { rig } = await setup();
    store().getState().setBusy("source");
    await matchPhotos(["fresh"]);
    store().getState().setBusy(null);
    rig.setSetting(SOURCE_SETTING, null);
    await matchPhotos(["fresh"]);
    expect(rig.renders).toEqual([]);
    expect(rig.notices).toEqual([]);
  });

  it("is what the grid menu item runs", async () => {
    const { rig } = await setup();
    rig.menuItems[0].onClick(["fresh"]);
    await new Promise((r) => setTimeout(r, 0));
    await expect.poll(() => rig.applied.length).toBe(1);
  });
});
