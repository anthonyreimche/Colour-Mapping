// The panel: darktable's controls in its order, the two buttons and when they
// can be pressed, what each writes and the undo steps each makes.

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { analyseFrame, asSource } from "../src/analysis";
import { encodeTable } from "../src/encoding";
import { BL_DRAWS } from "../src/grid";
import { activate, deactivate } from "../src/index";
import { labToCss } from "../src/lab";
import { DEFAULT_SETTINGS, MAXN } from "../src/model";
import { ColourMappingPanel } from "../src/Panel";
import { SIHIST, STAGE_ID, THIST, THIST_DATA, clustersPatch, matchPatch, qualified, readEdit } from "../src/params";
import { React } from "../src/rt";
import { SOURCE_SETTING, store, type AppSource } from "../src/store";
import { fakeApi } from "./support/fake-api";
import { SOURCE_IMAGE, TARGET_IMAGE, referenceFrame } from "./support/frames";

const sourceFrame = referenceFrame(SOURCE_IMAGE);
const targetFrame = referenceFrame(TARGET_IMAGE);

async function sourceOf(photoId: string, name: string, n = 3): Promise<AppSource> {
  return { ...asSource(n, await analyseFrame(sourceFrame, n)), photoId, name };
}

function setup(bag: Record<string, unknown> = {}) {
  const rig = fakeApi([
    { id: "photo-1", filename: "IMG_0001.CR3" },
    { id: "photo-2", filename: "IMG_0002.CR3" },
  ]);
  rig.open("photo-1", bag);
  activate(rig.api);
  const view = render(<ColourMappingPanel />);
  const slider = (label: string) => {
    const s = rig.sliders(view.container).find((x) => x.label === label);
    if (!s) throw new Error(`no slider ${label}`);
    return s;
  };
  const button = (name: string) => view.getByRole("button", { name }) as HTMLButtonElement;
  return { rig, view, slider, button, edit: () => readEdit(rig.develop().paramBag) };
}

afterEach(() => {
  cleanup();
  deactivate();
});

describe("ColourMappingPanel", () => {
  it("shows darktable's controls in its order, at the defaults", () => {
    const { rig, view } = setup();
    expect(view.getByLabelText("Enabled")).not.toBeNull();
    expect([...view.container.querySelectorAll("[data-field] > span")].map((el) => el.textContent)).toEqual(["Source clusters", "Target clusters"]);
    expect(view.getAllByRole("button").map((b) => b.textContent)).toEqual(["Use as source", "Match to source"]);
    expect(rig.sliders(view.container).map((s) => [s.label, s.value, s.min, s.max, s.step, s.defaultValue])).toEqual([
      ["Clusters", 3, 1, 5, 1, 3],
      ["Colour dominance", 100, 0, 100, 1, 100],
      ["Histogram equalisation", 50, 0, 100, 1, 50],
    ]);
  });

  it("explains every control in a tooltip, in Canadian spelling, naming no other program", () => {
    const { view } = setup();
    const tips = [...view.container.querySelectorAll("[title]")].map((el) => el.getAttribute("title") ?? "");
    expect(tips.length).toBeGreaterThanOrEqual(8);
    for (const tip of tips) {
      expect(tip.length).toBeGreaterThan(10);
      expect(tip).not.toMatch(/darktable|color|analyze|equaliz/i);
    }
    expect(view.container.textContent).not.toMatch(/darktable|color\b|equaliz/i);
    expect(view.getByRole("button", { name: "Use as source" }).title).toBe("Analyse this photo as the colour source");
  });

  it("draws each cluster as darktable does: a 3 × 3 block, the mean at its centre", () => {
    const target = { mean: [10, -20, 0, 0, 0, 0], sd: [5, 4, 0, 0, 0, 0], weight: [1, 0, 0] };
    const { view } = setup({ [qualified("tMean")]: [...target.mean, 0, 0, 0, 0], [qualified("tVar")]: [...target.sd, 0, 0, 0, 0] });
    const strips = view.container.querySelectorAll("[data-field]");
    const cells = [...strips[1].querySelectorAll<HTMLElement>("[data-swatch]")];
    expect(cells).toHaveLength(9 * DEFAULT_SETTINGS.clusters);
    const css = (lab: number[]) => {
      const probe = document.createElement("div");
      probe.style.background = labToCss(lab);
      return probe.style.background;
    };
    expect(cells[4].style.background).toBe(css([53.390011, 10, -20]));
    expect(cells[0].style.background).toBe(css([53.390011, 5, -24]));
    expect(cells[8].style.background).toBe(css([53.390011, 15, -16]));
  });

  it("can't match before a colour source is set, and names the source once one is", async () => {
    const { rig, button } = setup();
    expect(button("Match to source").disabled).toBe(true);
    expect(button("Use as source").disabled).toBe(false);
    const source = await sourceOf("photo-2", "IMG_0002.CR3");
    act(() => rig.setSetting(SOURCE_SETTING, source));
    expect(button("Match to source").disabled).toBe(false);
    expect(button("Match to source").title).toContain("IMG_0002.CR3");
  });

  it("shows the colour source's clusters until the photo is matched", async () => {
    const { rig, view } = setup();
    const source = await sourceOf("photo-2", "IMG_0002.CR3", 2);
    act(() => rig.setSetting(SOURCE_SETTING, source));
    const strips = view.container.querySelectorAll("[data-field]");
    expect(strips[0].querySelectorAll("[data-swatch]")).toHaveLength(18);
  });

  it("uses the photo as the colour source at its cluster count, without an undo step", async () => {
    const { rig, button } = setup({ [qualified("clusters")]: 4 });
    rig.frames.set("photo-1", sourceFrame);
    fireEvent.click(button("Use as source"));
    await waitFor(() => expect(store().getState().source).not.toBeNull());
    const want = await sourceOf("photo-1", "IMG_0001.CR3", 4);
    expect(store().getState().source).toEqual(want);
    expect(rig.settings.get(SOURCE_SETTING)).toEqual(want);
    expect(rig.commits).toEqual([]);
    expect(rig.captures).toEqual([
      {
        point: "pre-output",
        space: { encoding: "linear", primaries: "rec709" },
        paramBag: { [qualified("on")]: false, [qualified(SIHIST)]: "analysis", [qualified(THIST)]: "analysis" },
        maxEdge: 640,
      },
    ]);
  });

  it("holds both buttons while it analyses", async () => {
    const { rig, button } = setup();
    rig.frames.set("photo-1", sourceFrame);
    fireEvent.click(button("Use as source"));
    expect(button("Analysing…").disabled).toBe(true);
    expect(button("Match to source").disabled).toBe(true);
    await waitFor(() => expect(store().getState().busy).toBeNull());
  });

  it("drops an analysis of a photo left while it was captured", async () => {
    const { rig, button } = setup();
    rig.frames.set("photo-1", sourceFrame);
    rig.beforeAnswer = () => rig.open("photo-2");
    fireEvent.click(button("Use as source"));
    await waitFor(() => expect(store().getState().busy).toBeNull());
    expect(store().getState().source).toBeNull();
  });

  it("matches the photo to the source as one undo step, its histogram in the photo's data", async () => {
    const { rig, button, edit } = setup({ [qualified("dominance")]: 40 });
    const source = await sourceOf("photo-2", "IMG_0002.CR3");
    act(() => rig.setSetting(SOURCE_SETTING, source));
    rig.frames.set("photo-1", targetFrame);
    fireEvent.click(button("Match to source"));
    await waitFor(() => expect(rig.commits).toEqual(["Colour Mapping: match to source"]));
    const target = await analyseFrame(targetFrame, 3);
    const want = matchPatch({ ...DEFAULT_SETTINGS, dominance: 40 }, source, target.clusters);
    for (const [key, value] of Object.entries(want)) expect(rig.develop().paramBag[key]).toEqual(value);
    expect(edit()).toMatchObject({ on: true, dominance: 40, equalization: 50 });
    expect(rig.develop().paramBag[qualified("blDraws")]).toBe(BL_DRAWS);
    expect(rig.photoData.get(`photo-1/${THIST_DATA}`)).toEqual(encodeTable(target.hist));
    expect(rig.dropped).toContainEqual([STAGE_ID, THIST, "photo-1"]);
    expect(rig.prepared).toEqual(
      expect.arrayContaining([
        [STAGE_ID, SIHIST, rig.develop().paramBag[qualified(SIHIST)]],
        [STAGE_ID, THIST, "photo-1"],
      ]),
    );
  });

  it("writes nothing when the photo can't be read", async () => {
    const { rig, button } = setup();
    act(() => rig.setSetting(SOURCE_SETTING, { photoId: "x", name: "x", n: 1, clusters: { mean: [0, 0], sd: [1, 1], weight: [1] }, hist: "" }));
    expect(store().getState().source).toBeNull();
    const source = await sourceOf("photo-2", "IMG_0002.CR3");
    act(() => rig.setSetting(SOURCE_SETTING, source));
    rig.frames.set("photo-1", null);
    fireEvent.click(button("Match to source"));
    await waitFor(() => expect(store().getState().busy).toBeNull());
    expect(rig.commits).toEqual([]);
    expect(rig.photoData.size).toBe(0);
  });

  it("resets the source and the target and switches off when the cluster count changes", () => {
    const { rig, slider } = setup({ [qualified("on")]: true, [qualified("sWeight")]: [0.5, 0.5, 0, 0, 0] });
    act(() => slider("Clusters").onChange(5));
    expect(rig.develop().paramBag).toMatchObject(clustersPatch(5));
    act(() => slider("Clusters").onChange(5.2));
    act(() => slider("Clusters").onCommit?.());
    expect(rig.commits).toEqual(["Colour Mapping: clusters"]);
    expect(readEdit(rig.develop().paramBag).source.weight).toEqual(new Array(MAXN).fill(0));
  });

  it("switches the transfer on with dominance or equalisation, one undo step a drag", () => {
    const { rig, slider, edit } = setup();
    act(() => slider("Colour dominance").onChange(30));
    act(() => slider("Colour dominance").onChange(35));
    act(() => slider("Colour dominance").onCommit?.());
    expect(edit()).toMatchObject({ on: true, dominance: 35 });
    act(() => slider("Histogram equalisation").onChange(0));
    act(() => slider("Histogram equalisation").onCommit?.());
    expect(edit().equalization).toBe(0);
    expect(rig.commits).toEqual(["Colour Mapping: colour dominance", "Colour Mapping: histogram equalisation"]);
  });

  it("smooths only while equalising", async () => {
    const source = await sourceOf("photo-2", "IMG_0002.CR3");
    const target = await analyseFrame(targetFrame, 3);
    const { rig, slider } = setup(matchPatch(DEFAULT_SETTINGS, source, target.clusters));
    act(() => slider("Histogram equalisation").onChange(0));
    expect(rig.develop().paramBag[qualified("blDraws")]).toBe(0);
    act(() => slider("Histogram equalisation").onChange(20));
    expect(rig.develop().paramBag[qualified("blDraws")]).toBe(BL_DRAWS);
  });

  it("switches the transfer on and off as one undo step each", () => {
    const { rig, view, edit } = setup();
    fireEvent.click(view.getByLabelText("Enabled"));
    expect(edit().on).toBe(true);
    fireEvent.click(view.getByLabelText("Enabled"));
    expect(edit().on).toBe(false);
    expect(rig.commits).toEqual(["Colour Mapping: on", "Colour Mapping: off"]);
  });

  it("resets to the defaults with nothing analysed, from the panel's header", async () => {
    const source = await sourceOf("photo-2", "IMG_0002.CR3");
    const { rig, edit } = setup({ ...matchPatch({ ...DEFAULT_SETTINGS, dominance: 10 }, source, source.clusters) });
    act(() => rig.panels[0].onReset?.());
    expect(edit()).toMatchObject(DEFAULT_SETTINGS);
    expect(edit().sourceHist).toBe("");
    expect(rig.commits).toEqual(["Colour Mapping: reset"]);
  });
});
