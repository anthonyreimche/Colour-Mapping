// The stage on the real renderer. Run via `npm run test:gpu` (run.cjs copies
// this file into a SafeLight checkout and runs it under its headless Chromium
// + SwiftShader rig). What the CPU suite cannot check:
//  - installing Colour Mapping changes no photo: while it is off, every frame
//    is bit-identical with and without it, on process versions 1, 2 and 3;
//  - switched on without a target (a pasted edit), it passes the photo through;
//  - the inline and the bilateral pass compile with the host's namespacing,
//    read their tables from half-float variants, and land on darktable's
//    process() (test/support/process-model.ts, which reference.test.ts holds
//    to darktable's C) with and without equalisation;
//  - its cost on a 4096 px frame.
//
// Frames are read at "pre-output" in linear Rec.709, which with identity
// params and the open probe is the stage's own output; the model starts from
// the idle frame's Lab, so the half-float source upload doesn't count.

import { describe, expect, it } from "vitest";
import { asSource } from "@cm/analysis";
import { encodeTableText, tableTexture, tableVariant } from "@cm/encoding";
import { BL_DRAWS, bilateralPlan } from "@cm/grid";
import { frameToLab, labToRgb, rgbToLab } from "@cm/lab";
import { DEFAULT_SETTINGS, captureHistogram, invertHistogram, kmeans, type Clusters } from "@cm/model";
import { SIHIST, STAGE_ID, THIST, matchPatch, qualified, resetPatch } from "@cm/params";
import { colourMappingStage } from "@cm/stage";
import { processLab } from "@cm-test/support/process-model";
import { CURRENT_PROCESS_VERSION } from "@/catalog/process-version";
import type { DevelopParams } from "@/catalog/types";
import type { ProcessingStageContribution } from "@/extensions/types";
import type { StageTextureData } from "@/extensions/api/contributions";
import { OPEN_PROBE, LINEAR_PROBE_PIPELINE, builtinStages, floatImage, identityParams, withRenderer } from "@/rendering/webgl/webgl.test-support";
import type { ResolvedPipeline } from "@/rendering/webgl/renderer";

const W = 400;
const H = 300;
const LINEAR = { encoding: "linear", primaries: "rec709" } as const;
const PHOTO = "photo-1";

type Bag = Record<string, unknown>;

/** A Lab scene: lightness rising across, three colour regions with a gentle
 *  spread, a flat grey patch. */
function sceneLab(x: number, y: number, w: number, h: number, shift: number): [number, number, number] {
  const u = x / (w - 1);
  const v = y / (h - 1);
  const L = 6 + 86 * (0.65 * u + 0.35 * v) + 3 * Math.sin(x * 0.37 + y * 0.11);
  const region = Math.floor((3 * x) / w);
  const centres = [
    [26 + shift, 14],
    [-20, 28 - shift],
    [8, -30 + shift],
  ];
  const [a0, b0] = centres[region];
  if (x > 0.45 * w && x < 0.55 * w && y > 0.4 * h && y < 0.6 * h) return [L, 0, 0];
  return [L, a0 + 9 * Math.sin(y * 0.05) + 6 * v, b0 + 7 * Math.cos(x * 0.04) - 5 * u];
}

const sceneOf = (w: number, h: number, shift: number) => floatImage(w, h, (x, y) => labToRgb(sceneLab(x, y, w, h, shift)));

interface Side {
  hist: Int32Array;
  clusters: Clusters;
}

function analyse(rgba: Float32Array, pixels: number, n: number): Side {
  const lab = frameToLab(rgba);
  return { hist: captureHistogram(lab, pixels), clusters: kmeans(lab, pixels, n) };
}

/** The source: a shifted, darker copy of the scene, analysed in TypeScript. */
function sourceFor(n: number): { analysis: ReturnType<typeof asSource>; table: Int32Array } {
  const image = floatImage(W, H, (x, y) => {
    const [L, a, b] = sceneLab(x, y, W, H, 18);
    return labToRgb([0.8 * L + 4, a * 1.2, b - 10]);
  });
  const side = analyse(image.data, W * H, n);
  const table = invertHistogram(side.hist);
  return { analysis: asSource(n, { hist: side.hist, clusters: side.clusters }), table };
}

interface RenderOptions {
  stages?: ProcessingStageContribution[];
  params?: Partial<DevelopParams>;
  pipeline?: ResolvedPipeline;
  textures?: Record<string, StageTextureData>;
  image?: ReturnType<typeof floatImage>;
  /** The live view's renderer, which leaves a dormant stage out of the program. */
  live?: boolean;
}

function frames(bags: Record<string, Bag>, o: RenderOptions = {}): Record<string, Float32Array> {
  const { stages = [colourMappingStage()], pipeline = OPEN_PROBE, image = sceneOf(W, H, 0) } = o;
  const out: Record<string, Float32Array> = {};
  const opts = { stages: [...builtinStages(), ...stages], pipeline, processVersionCap: 3 as const, skipDormantStages: o.live === true };
  withRenderer(opts, (renderer) => {
    renderer.setImage(image);
    renderer.setParams(identityParams({ processVersion: CURRENT_PROCESS_VERSION, ...o.params }));
    renderer.setStageTextures(o.textures ?? {});
    for (const [name, bag] of Object.entries(bags)) {
      renderer.setContributedParams(bag);
      const frame = renderer.readFloatFrame("pre-output", Infinity, LINEAR);
      if (!frame) throw new Error(`no frame for ${name}`);
      out[name] = frame.data;
    }
  });
  return out;
}

const differing = (a: Float32Array, b: Float32Array) => a.reduce((n, v, i) => (v === b[i] ? n : n + 1), 0);

interface Stats {
  p50: number;
  p99: number;
  max: number;
}

function stats(e: number[]): Stats {
  e.sort((a, b) => a - b);
  return { p50: e[Math.floor(0.5 * (e.length - 1))], p99: e[Math.floor(0.99 * (e.length - 1))], max: e[e.length - 1] };
}

const fmt = (s: Stats) => `p50 ${s.p50.toExponential(2)} p99 ${s.p99.toExponential(2)} max ${s.max.toExponential(2)}`;

const IDLE_BAGS: Record<string, Bag> = {
  empty: {},
  defaults: resetPatch(),
  settings: { [qualified("dominance")]: 20, [qualified("equalization")]: 90, [qualified("clusters")]: 5 },
};

const worst = (a: Float32Array, b: Float32Array) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

// While off the stage is dormant. The live view leaves it out of a version 2
// or later photo's program; every other render keeps it in, where the host's
// conversion into its linear Rec.709 and back rounds in the last bits, as for
// any display stage that declares a space.
describe("existing photos are unchanged by installing Colour Mapping", () => {
  it.each([2, 3])("version %i, live view: bit-identical while off", (processVersion) => {
    for (const pipeline of [OPEN_PROBE, LINEAR_PROBE_PIPELINE]) {
      const o = { params: { processVersion }, pipeline, live: true };
      const without = frames({ without: {} }, { ...o, stages: [] }).without;
      const installed = frames(IDLE_BAGS, o);
      for (const name of Object.keys(IDLE_BAGS)) expect(differing(installed[name], without), name).toBe(0);
    }
  });

  it.each([1, 2, 3])("version %i, exports and thumbnails: unchanged to float rounding while off", (processVersion) => {
    for (const pipeline of [OPEN_PROBE, LINEAR_PROBE_PIPELINE]) {
      const o = { params: { processVersion }, pipeline };
      const without = frames({ without: {} }, { ...o, stages: [] }).without;
      const installed = frames(IDLE_BAGS, o);
      for (const name of Object.keys(IDLE_BAGS)) {
        console.log(`[cm-gpu] idle, version ${processVersion}, ${name}: worst ${worst(installed[name], without).toExponential(2)}`);
        expect(worst(installed[name], without), name).toBeLessThan(1e-5);
      }
    }
  });
});

describe("Colour Mapping on the GPU", () => {
  const n = 3;
  const source = sourceFor(n);
  const idle = frames({ idle: {} }).idle;
  const target = analyse(idle, W * H, n);
  const sihistKey = `${qualified(SIHIST)}#${tableVariant(source.analysis.hist)}`;
  const thistKey = `${qualified(THIST)}#${PHOTO}`;
  const textures = { [sihistKey]: tableTexture(source.table, 1), [thistKey]: tableTexture(target.hist, 1) };
  const names = { [qualified(THIST)]: PHOTO };
  const matched = (over: Partial<typeof DEFAULT_SETTINGS>): Bag => {
    const settings = { ...DEFAULT_SETTINGS, ...over };
    return {
      ...matchPatch(settings, source.analysis, target.clusters),
      [qualified("dominance")]: settings.dominance,
      [qualified("equalization")]: settings.equalization,
      ...names,
    };
  };
  const inputLab = frameToLab(idle);

  /** The GPU's frame against process() on the idle frame's Lab, per channel. */
  function compare(name: string, got: Float32Array, settings: Partial<typeof DEFAULT_SETTINGS>) {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    const want = processLab(
      { n, dominance: s.dominance, equalization: s.equalization, sourceTable: source.table, source: source.analysis.clusters, targetHist: target.hist, target: target.clusters },
      inputLab,
      W,
      H,
      50,
    );
    const dL: number[] = [];
    const dab: number[] = [];
    const moved: number[] = [];
    for (let k = 0; k < W * H; k++) {
      const lab = rgbToLab([got[4 * k], got[4 * k + 1], got[4 * k + 2]]);
      dL.push(Math.abs(lab[0] - want[4 * k]));
      dab.push(Math.max(Math.abs(lab[1] - want[4 * k + 1]), Math.abs(lab[2] - want[4 * k + 2])));
      moved.push(Math.abs(want[4 * k] - inputLab[4 * k]) + Math.abs(want[4 * k + 1] - inputLab[4 * k + 1]));
    }
    const eL = stats(dL);
    const eab = stats(dab);
    console.log(`[cm-gpu] ${name}: |ΔL*| ${fmt(eL)}; |Δa*,b*| ${fmt(eab)}`);
    expect(stats(moved).p50, "the case changes the image").toBeGreaterThan(1);
    return { eL, eab };
  }

  const cases: [string, Partial<typeof DEFAULT_SETTINGS>][] = [
    ["no equalisation, dominance 100 %", { equalization: 0 }],
    ["no equalisation, dominance 30 %", { equalization: 0, dominance: 30 }],
    ["equalisation 50 % (the default)", { equalization: 50 }],
    ["equalisation 100 %, dominance 0", { equalization: 100, dominance: 0 }],
  ];
  const bags = Object.fromEntries(cases.map(([name, over]) => [name, matched(over)]));
  const out = frames(bags, { textures });

  it("runs the smoothing only while equalising", () => {
    expect(bags[cases[0][0]][qualified("blDraws")]).toBe(0);
    expect(bags[cases[2][0]][qualified("blDraws")]).toBe(BL_DRAWS);
  });

  it.each(cases.slice(0, 2))("matches darktable's process(): %s", (name, over) => {
    const { eL, eab } = compare(name, out[name], over);
    expect(eL.max).toBeLessThan(0.02);
    expect(eab.max).toBeLessThan(0.02);
  });

  it.each(cases.slice(2))("matches darktable's process() through the bilateral grid: %s", (name, over) => {
    const { eL, eab } = compare(name, out[name], over);
    expect(eL.p50).toBeLessThan(0.02);
    expect(eL.p99).toBeLessThan(0.1);
    expect(eL.max).toBeLessThan(0.25);
    expect(eab.max).toBeLessThan(0.02);
  });

  it("smooths the same however many idle draws come first", () => {
    const name = cases[2][0];
    const exact = bilateralPlan(W, H, 50)?.draws ?? 0;
    expect(exact).toBeGreaterThan(0);
    expect(exact).toBeLessThan(BL_DRAWS);
    const fewer = frames({ fewer: { ...bags[name], [qualified("blDraws")]: exact } }, { textures }).fewer;
    expect(worst(fewer, out[name])).toBeLessThan(1e-6);
  });

  it("passes the photo through while it has no target, or its tables are missing", () => {
    const pasted = { ...matched({}), [qualified("tWeight")]: [0, 0, 0, 0, 0] };
    const noTables = matched({});
    const got = frames({ pasted, noTables }, { textures: { [sihistKey]: tableTexture(source.table, 1) } });
    console.log(`[cm-gpu] pass-through: pasted ${worst(got.pasted, idle).toExponential(2)}, no target table ${worst(got.noTables, idle).toExponential(2)}`);
    expect(worst(got.pasted, idle)).toBeLessThan(1e-5);
    expect(worst(got.noTables, idle)).toBeLessThan(1e-5);
  });

  it("draws a missing source table's variant as no transfer", () => {
    const named = { ...matched({}), [qualified(SIHIST)]: "s0000000000000000" };
    const got = frames({ named }, { textures }).named;
    expect(worst(got, idle)).toBeLessThan(1e-5);
  });

  it("names the source's variant by its content", () => {
    expect(matched({})[qualified(SIHIST)]).toBe(tableVariant(encodeTableText(source.table)));
    expect(STAGE_ID).toBe("colour-mapping.lab");
  });
});

describe("cost", () => {
  it("draws a 4096 px frame with equalisation on, finite everywhere", () => {
    const w = 4096;
    const h = 2731;
    const big = sceneOf(w, h, 0);
    const n = 3;
    const source = sourceFor(n);
    const side = analyse(big.data.subarray(0, 4 * w * 400), w * 400, n);
    const bag: Bag = { ...matchPatch(DEFAULT_SETTINGS, source.analysis, side.clusters), [qualified(THIST)]: PHOTO };
    const textures = {
      [`${qualified(SIHIST)}#${tableVariant(source.analysis.hist)}`]: tableTexture(source.table, 1),
      [`${qualified(THIST)}#${PHOTO}`]: tableTexture(side.hist, 1),
    };
    const started = performance.now();
    const f = frames({ f: bag }, { image: big, textures }).f;
    expect(f.every(Number.isFinite)).toBe(true);
    console.log(`[cm-gpu] 4096 px frame, ${BL_DRAWS} smoothing draws and the readback`, Math.round(performance.now() - started), "ms (SwiftShader)");
  });
});
