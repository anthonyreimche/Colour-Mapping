// What activate() registers, under the manifest's id, and what deactivate()
// takes down again; and what it keeps in step while it runs.

import { describe, expect, it } from "vitest";
import manifest from "../safelight.json";
import pkg from "../package.json";
import { encodeTableText } from "../src/encoding";
import { BL_DRAWS } from "../src/grid";
import { activate, deactivate } from "../src/index";
import { invertHistogram, kmeans } from "../src/model";
import { ColourMappingPanel } from "../src/Panel";
import { EXT_ID, MENU_ID, PANEL_ID, SIHIST, STAGE_ID, THIST, matchPatch, qualified } from "../src/params";
import { DEFAULT_SETTINGS } from "../src/model";
import { SOURCE_SETTING, store, type AppSource } from "../src/store";
import { fakeApi } from "./support/fake-api";
import { VECTORS } from "./support/vectors";

const ref = VECTORS.kmeans[0];
const lab = Float32Array.from(ref.lab);
const SOURCE: AppSource = {
  photoId: "photo-9",
  name: "IMG_0009.CR3",
  n: 3,
  clusters: kmeans(lab, ref.w * ref.h, 3),
  hist: encodeTableText(invertHistogram(VECTORS.histograms[0].hist)),
};

describe("activate", () => {
  it("registers the stage, both tables' providers, the panel and the grid menu item", () => {
    const rig = fakeApi();
    activate(rig.api);
    expect(rig.stages.map((s) => s.id)).toEqual([STAGE_ID]);
    expect([...rig.providers.keys()]).toEqual([`${STAGE_ID}/${SIHIST}`, `${STAGE_ID}/${THIST}`]);
    expect(rig.panels).toMatchObject([
      { id: PANEL_ID, title: "Colour Mapping", component: ColourMappingPanel, defaultDock: { module: "develop" }, ownsBag: [`${STAGE_ID}.`] },
    ]);
    expect(rig.panels[0].mask).toBeUndefined();
    expect(rig.menuItems.map((m) => m.id)).toEqual([MENU_ID]);
    deactivate();
    expect(rig.unregistered).toEqual([STAGE_ID]);
    expect([...rig.providers.values()]).toEqual([null, null]);
  });

  it("offers the grid's match only once there is a colour source, and counts a selection", () => {
    const rig = fakeApi();
    activate(rig.api);
    const item = rig.menuItems[0];
    const label = item.label as (ids: string[]) => string;
    expect(label(["a"])).toBe("Match to colour source");
    expect(label(["a", "b", "c"])).toBe("Match to colour source (3)");
    expect(item.enabled?.(["a"])).toBe(false);
    rig.setSetting(SOURCE_SETTING, SOURCE);
    expect(item.enabled?.(["a"])).toBe(true);
    deactivate();
  });

  it("reads the colour source a window stored, and follows another window's", () => {
    const rig = fakeApi();
    rig.settings.set(SOURCE_SETTING, SOURCE);
    activate(rig.api);
    expect(store().getState().source).toEqual(SOURCE);
    rig.setSetting(SOURCE_SETTING, null);
    expect(store().getState().source).toBeNull();
    deactivate();
    rig.setSetting(SOURCE_SETTING, SOURCE);
    expect(store().getState().source).toBeNull();
  });

  it("puts a pasted edit's smoothing right: none without a target", () => {
    const rig = fakeApi();
    activate(rig.api);
    rig.replace({ [qualified("on")]: true, [qualified("blDraws")]: BL_DRAWS, [qualified("sWeight")]: [0.5, 0.5, 0, 0, 0] });
    expect(rig.develop().paramBag[qualified("blDraws")]).toBe(0);
    const matched = matchPatch(DEFAULT_SETTINGS, SOURCE, SOURCE.clusters);
    rig.replace({ ...matched, [qualified("blDraws")]: 0 });
    expect(rig.develop().paramBag[qualified("blDraws")]).toBe(BL_DRAWS);
    expect(rig.commits).toEqual([]);
    deactivate();
    rig.replace({ [qualified("on")]: true, [qualified("blDraws")]: BL_DRAWS });
    expect(rig.develop().paramBag[qualified("blDraws")]).toBe(BL_DRAWS);
  });

  it("names everything under the manifest's id", () => {
    expect(EXT_ID).toBe(manifest.id);
    for (const id of [STAGE_ID, PANEL_ID, MENU_ID]) expect(id.startsWith(`${manifest.id}.`)).toBe(true);
  });

  // dataKeys, the provider's bag, putPhotoData for another photo,
  // catalog.applyBagPatch and r16f textures came in 3.2.8.
  it("keeps the manifest and package versions in step, and needs the core its API calls came in", () => {
    expect(pkg.version).toBe(manifest.version);
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.minAppVersion).toBe("3.2.8");
    expect(manifest.license).toBe("GPL-3.0-or-later");
    expect(pkg.keywords).toContain("safelight-extension");
  });

  it("names no other program in what the user reads", () => {
    const text = JSON.stringify([manifest.name, manifest.description, manifest.categories]).toLowerCase();
    for (const name of ["darktable", "ansel", "lightroom", "rawtherapee"]) expect(text).not.toContain(name);
  });
});
