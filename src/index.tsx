// Colour Mapping, a Safelight extension (GPL-3.0-or-later).
//
// A port of darktable's colour mapping module (src/iop/colormapping.c, with
// the bilateral grid of src/common/bilateral.c; Copyright (C) 2013-2026 and
// 2016-2026 darktable developers): it moves one photo's colour palette and its
// spread of tones onto another, after Reinhard et al., "Color transfer between
// images" (2001). Registers the display stage (stage.ts) and its two table
// textures (textures.ts), the Develop panel (Panel.tsx) and the Library's
// "Match to colour source" (workflow.ts).

import { ColourMappingPanel, resetColourMapping } from "./Panel";
import { EXT_ID, MENU_ID, PANEL_ID, STAGE_ID, TITLE, rederivePatch } from "./params";
import { initRuntime } from "./rt";
import type { DevelopState, SafelightAPI } from "./safelight";
import { colourMappingStage } from "./stage";
import { SOURCE_SETTING, initStore, readAppSource, readReference, store } from "./store";
import { Tables } from "./textures";
import { REFERENCE_VARIABLE, initWorkflow, matchPhotos } from "./workflow";

export { EXT_ID, PANEL_ID };

let host: SafelightAPI | null = null;
let tables: Tables | null = null;
let stops: (() => void)[] = [];

export function activate(api: SafelightAPI): void {
  initRuntime(api);
  initStore();
  host = api;
  tables = new Tables(api);
  initWorkflow(tables);

  // Off, the stage is dormant: the live view leaves it out, and every other
  // render runs it as an exact no-op.
  api.registerProcessingStage(colourMappingStage());
  tables.register();
  api.registerPanel({
    id: PANEL_ID,
    title: TITLE,
    component: ColourMappingPanel,
    defaultDock: { module: "develop", direction: "right", width: 268 },
    modules: ["develop"],
    onReset: resetColourMapping,
    ownsBag: [`${STAGE_ID}.`],
  });
  api.registerGridMenuItem({
    id: MENU_ID,
    label: (ids) => (ids.length > 1 ? `Match to colour source (${ids.length})` : "Match to colour source"),
    enabled: () => store().getState().source !== null && store().getState().busy === null,
    onClick: (ids) => void matchPhotos(ids),
  });

  stops = [
    // The colour source as another window sets it.
    api.settings.onChange((key, value) => {
      if (key === SOURCE_SETTING) store().getState().setSource(readAppSource(value));
    }),
    // The reference photo Reference View shows, for Match to reference.
    api.variables.subscribe<unknown>(REFERENCE_VARIABLE, (snapshot) => store().getState().setReference(readReference(snapshot.value))),
    // A bag whose draw count disagrees with its edit (a paste or a preset
    // that carried the switch without a target) is put right live.
    api.stores.useDevelopStore.subscribe((state: DevelopState, prev: DevelopState) => {
      if (state.paramBag === prev.paramBag) return;
      const patch = rederivePatch(state.paramBag);
      if (patch) state.setDynParams(patch);
    }),
  ];
}

export function deactivate(): void {
  const api = host;
  if (!api) return;
  host = null;
  // A throw here would skip the host's sweep of this extension's
  // registrations, so a failure is logged instead.
  try {
    for (const stop of stops) stop();
    stops = [];
    tables?.unregister();
    tables = null;
    api.unregisterProcessingStage(STAGE_ID);
  } catch (err) {
    console.warn("[colour-mapping] deactivate failed:", err);
  }
}
