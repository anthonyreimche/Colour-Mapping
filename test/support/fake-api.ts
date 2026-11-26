// A stand-in Safelight API for unit tests, over real React and zustand. It has
// only what this extension uses: reading any other member throws, naming it,
// so a test shows what to add here when the extension starts using more.
//
// The develop and catalogue stores are real zustand stores. Core's Slider is a
// stub that keeps the props it was last drawn with, so a test can drive a drag
// and its release. Frames for captures and headless renders come from the
// rig, and every write the extension makes to the host is recorded.

import * as React from "react";
import { create } from "zustand";
import type {
  ButtonProps,
  CatalogPhoto,
  DevelopParams,
  EditState,
  FieldProps,
  FloatFrame,
  GridMenuItemContribution,
  LiveFloatCaptureOptions,
  FloatCaptureOptions,
  NoticeOptions,
  PanelContribution,
  ProcessingStageContribution,
  RowProps,
  SafelightAPI,
  SliderProps,
  StackProps,
  StageTextureData,
  ToggleProps,
} from "../../src/safelight";
import { EXT_ID } from "../../src/params";

type Bag = Record<string, unknown>;
type Provider = (variant: string, signal: AbortSignal, bag: Readonly<Bag>) => Promise<StageTextureData | null>;

export interface FakeDevelop {
  photoId: string | null;
  params: DevelopParams;
  paramBag: Bag;
  setDynParams(patch: Bag): void;
  commitEdit(label: string): Promise<void>;
}

export interface Notice extends NoticeOptions {
  closed: boolean;
}

export interface Rig {
  api: SafelightAPI;
  panels: PanelContribution[];
  stages: ProcessingStageContribution[];
  menuItems: GridMenuItemContribution[];
  unregistered: string[];
  providers: Map<string, Provider | null>;
  dropped: [string, string, string | undefined][];
  prepared: [string, string, string][];
  /** Undo steps of the open photo, in order. */
  commits: string[];
  settings: Map<string, unknown>;
  photoData: Map<string, Uint8Array>;
  edits: Map<string, EditState>;
  applied: { photoId: string; patch: Bag; label: string }[];
  captures: LiveFloatCaptureOptions[];
  renders: { photoId: string; params: DevelopParams; options: FloatCaptureOptions }[];
  notices: Notice[];
  /** The frame a live capture returns, by open photo; headless renders, by id. */
  frames: Map<string, FloatFrame | null>;
  develop(): FakeDevelop;
  open(photoId: string | null, bag?: Bag): void;
  replace(bag: Bag): void;
  sliders(root: ParentNode): SliderProps[];
  /** Runs before a capture or render answers, as a photo switch during one would. */
  beforeAnswer: (() => void) | null;
  setSetting(key: string, value: unknown): void;
  /** Another extension's write to a shared variable (registering it if new). */
  setVariable(name: string, value: unknown): void;
}

export const PARAMS = { exposure: 0 } as unknown as DevelopParams;

export function fakeApi(photos: Partial<CatalogPhoto>[] = [{ id: "photo-1", filename: "IMG_0001.CR3" }]): Rig {
  const panels: PanelContribution[] = [];
  const stages: ProcessingStageContribution[] = [];
  const menuItems: GridMenuItemContribution[] = [];
  const unregistered: string[] = [];
  const providers = new Map<string, Provider | null>();
  const dropped: [string, string, string | undefined][] = [];
  const prepared: [string, string, string][] = [];
  const commits: string[] = [];
  const settings = new Map<string, unknown>();
  const settingWatchers = new Set<(key: string, value: unknown) => void>();
  const photoData = new Map<string, Uint8Array>();
  const edits = new Map<string, EditState>();
  const applied: Rig["applied"] = [];
  const captures: LiveFloatCaptureOptions[] = [];
  const renders: Rig["renders"] = [];
  const notices: Notice[] = [];
  const frames = new Map<string, FloatFrame | null>();
  const sliderProps = new Map<number, SliderProps>();
  const variables = new Map<string, unknown>();
  const variableWatchers = new Map<string, Set<(snapshot: { name: string; value: unknown }) => void>>();
  let nextSlider = 0;

  const develop = create<FakeDevelop>()((set) => ({
    photoId: photos[0]?.id ?? null,
    params: PARAMS,
    paramBag: {},
    setDynParams: (patch) => set((s) => ({ paramBag: { ...s.paramBag, ...patch } })),
    commitEdit: async (label) => void commits.push(label),
  }));
  const catalog = create<{ photos: Partial<CatalogPhoto>[] }>()(() => ({ photos }));

  function Slider(props: SliderProps) {
    const id = React.useRef(nextSlider++).current;
    sliderProps.set(id, props);
    return React.createElement("div", { "data-slider": id }, `${props.label} ${props.value}`);
  }

  const e = React.createElement;
  const tokens = new Proxy({}, { get: (_t, k) => `var(--${String(k)})` });
  const ui = {
    Button: ({ active, variant: _variant, size: _size, full: _full, ...rest }: ButtonProps) =>
      e("button", { type: "button", "aria-pressed": active === true, ...rest }),
    Field: ({ label, children }: FieldProps) => e("div", { "data-field": "" }, e("span", null, label), children),
    Row: ({ children, style }: RowProps) => e("div", { style }, children),
    Stack: ({ children, style }: StackProps) => e("div", { style }, children),
    Toggle: (props: ToggleProps) =>
      e(
        "label",
        null,
        props.label,
        e("input", { type: "checkbox", checked: props.checked, onChange: (ev: React.ChangeEvent<HTMLInputElement>) => props.onChange(ev.target.checked) }),
      ),
    notify: (notice: string | NoticeOptions) => {
      const n: Notice = { ...(typeof notice === "string" ? { message: notice } : notice), closed: false };
      notices.push(n);
      return { update: (next: Partial<NoticeOptions>) => Object.assign(n, next), close: () => void (n.closed = true) };
    },
    tokens,
  };

  const rig: Rig = {
    api: undefined as unknown as SafelightAPI,
    panels,
    stages,
    menuItems,
    unregistered,
    providers,
    dropped,
    prepared,
    commits,
    settings,
    photoData,
    edits,
    applied,
    captures,
    renders,
    notices,
    frames,
    beforeAnswer: null,
    develop: () => develop.getState(),
    open: (photoId, bag = {}) => develop.setState({ photoId, paramBag: { ...bag } }),
    replace: (bag) => develop.setState({ paramBag: { ...bag } }),
    sliders: (root) =>
      [...root.querySelectorAll("[data-slider]")].map((el) => {
        const props = sliderProps.get(Number(el.getAttribute("data-slider")));
        if (!props) throw new Error("a slider without props");
        return props;
      }),
    setVariable: (name, value) => {
      variables.set(name, value);
      for (const watch of variableWatchers.get(name) ?? []) watch({ name, value });
    },
    setSetting: (key, value) => {
      settings.set(key, value);
      for (const watch of settingWatchers) watch(key, value);
    },
  };

  const answer = async (frame: FloatFrame | null | undefined): Promise<FloatFrame | null> => {
    await Promise.resolve();
    rig.beforeAnswer?.();
    return frame ?? null;
  };

  const members = {
    version: 1,
    extensionId: EXT_ID,
    react: React,
    registerPanel: (c: PanelContribution) => void panels.push(c),
    registerProcessingStage: (c: ProcessingStageContribution) => void stages.push(c),
    unregisterProcessingStage: (id: string) => void unregistered.push(id),
    registerGridMenuItem: (c: GridMenuItemContribution) => void menuItems.push(c),
    setStageTextureProvider: (stageId: string, key: string, provide: Provider | null) => void providers.set(`${stageId}/${key}`, provide),
    dropStageTextureVariants: (stageId: string, key: string, variant?: string) => void dropped.push([stageId, key, variant]),
    prepareStageTextureVariant: async (stageId: string, key: string, variant: string) => void prepared.push([stageId, key, variant]),
    components: { Slider },
    settings: {
      get: <T>(key: string, fallback: T): T => (settings.has(key) ? (settings.get(key) as T) : fallback),
      set: (key: string, value: unknown) => rig.setSetting(key, value),
      onChange: (watch: (key: string, value: unknown) => void) => {
        settingWatchers.add(watch);
        return () => void settingWatchers.delete(watch);
      },
    },
    develop: {
      captureFloatFrame: (_params: DevelopParams, options: LiveFloatCaptureOptions) => {
        captures.push(options);
        return answer(frames.get(develop.getState().photoId ?? ""));
      },
      renderPhotoFloatFrame: (photoId: string, params: DevelopParams, options: FloatCaptureOptions) => {
        renders.push({ photoId, params, options });
        return answer(frames.get(photoId));
      },
      putPhotoData: (key: string, data: Uint8Array | null, photoId?: string) => {
        const id = photoId ?? develop.getState().photoId;
        if (data) photoData.set(`${id}/${key}`, data);
        else photoData.delete(`${id}/${key}`);
      },
      getPhotoData: async (key: string, photoId?: string) => photoData.get(`${photoId ?? develop.getState().photoId}/${key}`) ?? null,
      normalizeParams: (p: Partial<DevelopParams> | undefined) => ({ ...PARAMS, ...p }) as DevelopParams,
    },
    catalog: {
      getEditState: async (photoId: string) => edits.get(photoId) ?? null,
      applyBagPatch: async (photoId: string, patch: Bag, label: string) => {
        applied.push({ photoId, patch, label });
        return true;
      },
    },
    ui,
    variables: {
      subscribe: (name: string, watch: (snapshot: { name: string; value: unknown }) => void) => {
        const held = variableWatchers.get(name) ?? new Set();
        held.add(watch);
        variableWatchers.set(name, held);
        if (variables.has(name)) watch({ name, value: variables.get(name) });
        return () => void held.delete(watch);
      },
    },
    stores: { create, useDevelopStore: develop, useCatalogStore: catalog },
  };

  // The fake implements only what the extension reads; the strict proxy
  // throws, naming the member, on anything else.
  rig.api = strict(members, "api") as unknown as SafelightAPI;
  return rig;
}

/** Wraps a plain object so reading a member it lacks throws, naming the member. */
function strict<T extends object>(target: T, path: string): T {
  return new Proxy(target, {
    get(obj, key, receiver) {
      if (typeof key === "symbol" || key === "then" || key === "toJSON") return Reflect.get(obj, key, receiver);
      if (!(key in obj)) throw new Error(`The fake API has no ${path}.${key}. Add it to test/support/fake-api.ts.`);
      const value: unknown = Reflect.get(obj, key, receiver);
      const isPlainObject = typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
      return isPlainObject && key !== "react" && key !== "tokens" ? strict(value, `${path}.${key}`) : value;
    },
  });
}
