// Match to reference: while another extension (Reference View) shows a
// reference photo beside the open one, through the shared "reference.photo"
// variable, the panel offers to take that photo as the colour source and match
// the open photo to it in one press, as one undo step.

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ANALYSIS_BAG, CAPTURE, analyseFrame, asSource } from "../src/analysis";
import { encodeTable } from "../src/encoding";
import { activate, deactivate } from "../src/index";
import { DEFAULT_SETTINGS } from "../src/model";
import { ColourMappingPanel } from "../src/Panel";
import { THIST_DATA, matchPatch, qualified } from "../src/params";
import { React } from "../src/rt";
import type { CatalogPhoto, DevelopParams, EditState } from "../src/safelight";
import { SOURCE_SETTING, store, type AppSource } from "../src/store";
import { REFERENCE_LABEL, REFERENCE_VARIABLE } from "../src/workflow";
import { PARAMS, fakeApi } from "./support/fake-api";
import { SOURCE_IMAGE, TARGET_IMAGE, referenceFrame } from "./support/frames";

const sourceFrame = referenceFrame(SOURCE_IMAGE);
const targetFrame = referenceFrame(TARGET_IMAGE);

const MATCH = "Match to reference";

function setup(bag: Record<string, unknown> = {}) {
  const rig = fakeApi([
    { id: "open", filename: "OPEN.CR3", exif: {} as CatalogPhoto["exif"] },
    { id: "ref", filename: "REF.CR3", exif: {} as CatalogPhoto["exif"] },
  ]);
  rig.open("open", bag);
  activate(rig.api);
  const view = render(<ColourMappingPanel />);
  const button = () => view.queryByRole("button", { name: MATCH }) as HTMLButtonElement | null;
  return { rig, view, button };
}

afterEach(() => {
  cleanup();
  deactivate();
});

describe("the Match to reference button", () => {
  it("is absent without a reference, or when the reference is the open photo", () => {
    const { rig, button } = setup();
    expect(button()).toBeNull();
    act(() => rig.setVariable(REFERENCE_VARIABLE, null));
    expect(button()).toBeNull();
    act(() => rig.setVariable(REFERENCE_VARIABLE, { photoId: "open", name: "OPEN.CR3" }));
    expect(button()).toBeNull();
  });

  it("shows while a reference of another photo shows, naming it", () => {
    const { rig, button } = setup();
    act(() => rig.setVariable(REFERENCE_VARIABLE, { photoId: "ref", name: "REF.CR3" }));
    expect(button()?.title).toBe("Use REF.CR3 as the colour source and match this photo to it");
    act(() => rig.setVariable(REFERENCE_VARIABLE, null));
    expect(button()).toBeNull();
  });

  it("ignores a value that isn't a reference", () => {
    const { rig, button } = setup();
    act(() => rig.setVariable(REFERENCE_VARIABLE, { photoId: 3, name: "REF.CR3" }));
    expect(button()).toBeNull();
  });
});

describe("matching to the reference", () => {
  it("analyses the reference from its stored edit as the source, then matches the open photo, one step", async () => {
    const { rig, button } = setup({ [qualified("dominance")]: 40 });
    const refParams = { ...PARAMS, exposure: 1 } as unknown as DevelopParams;
    const edit: EditState = {
      photoId: "ref",
      currentIndex: 0,
      stack: [{ timestamp: 1, label: "Exposure", params: refParams, paramBag: { "other.stage.amount": 3 } }],
    };
    rig.edits.set("ref", edit);
    rig.frames.set("ref", sourceFrame);
    rig.frames.set("open", targetFrame);
    act(() => rig.setVariable(REFERENCE_VARIABLE, { photoId: "ref", name: "REF.CR3" }));

    fireEvent.click(button()!);
    await waitFor(() => expect(rig.commits).toEqual([REFERENCE_LABEL]), { timeout: 5000 });

    expect(rig.renders).toEqual([{ photoId: "ref", params: refParams, options: { ...CAPTURE, paramBag: { "other.stage.amount": 3, ...ANALYSIS_BAG } } }]);
    const source: AppSource = { ...asSource(3, await analyseFrame(sourceFrame, 3)), photoId: "ref", name: "REF.CR3" };
    expect(rig.settings.get(SOURCE_SETTING)).toEqual(source);
    expect(store().getState().source).toEqual(source);

    const target = await analyseFrame(targetFrame, 3);
    const want = matchPatch({ ...DEFAULT_SETTINGS, dominance: 40 }, source, target.clusters);
    for (const [key, value] of Object.entries(want)) expect(rig.develop().paramBag[key]).toEqual(value);
    expect(rig.photoData.get(`open/${THIST_DATA}`)).toEqual(encodeTable(target.hist));
    expect(REFERENCE_LABEL).toBe("Colour Mapping: match to reference");
  });

  it("changes nothing when the reference can't be read", async () => {
    const { rig, button } = setup();
    rig.frames.set("ref", null);
    rig.frames.set("open", targetFrame);
    act(() => rig.setVariable(REFERENCE_VARIABLE, { photoId: "ref", name: "REF.CR3" }));
    fireEvent.click(button()!);
    await waitFor(() => expect(store().getState().busy).toBeNull());
    expect(rig.renders).toHaveLength(1);
    expect(rig.settings.has(SOURCE_SETTING)).toBe(false);
    expect(rig.commits).toEqual([]);
    expect(rig.photoData.size).toBe(0);
  });
});
