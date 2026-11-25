// The stage contract the host relies on, and what a draw may cost. Unit tests
// can't run GLSL; the GPU spec (test/gpu) renders it.

import { describe, expect, it } from "vitest";
import { BL_GLSL, BL_HELPERS, BL_STEP_CALLS, INLINE_GLSL, INLINE_HELPERS, REGION_GLSL, glslLiteral } from "../src/glsl";
import { MAX_DRAWS, SPLAT_TAPS } from "../src/grid";
import { DEFAULT_SETTINGS, MAXN } from "../src/model";
import { DRAWS_KEY, LABELS, SETTING_KEYS, SIHIST, STAGE_ID, THIST } from "../src/params";
import { PRIORITY, colourMappingStage } from "../src/stage";
import { inlineFetches } from "./support/fetch-budget";

const stage = colourMappingStage();
const pass = stage.passes?.[0];
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("the stage", () => {
  it("reads the edited image in linear Rec.709 after the tone mapper", () => {
    expect(stage).toMatchObject({
      id: STAGE_ID,
      name: "Colour Mapping",
      phase: "display-adjust",
      reads: "current",
      space: { encoding: "linear", primaries: "rec709" },
    });
  });

  it("runs ahead of Local Contrast, as darktable's colour mapping comes before its local contrast", () => {
    expect(PRIORITY).toBe(85);
    expect(stage.priority).toBeLessThan(90);
  });

  it("sleeps while off, and changes nothing until then", () => {
    expect(stage.dormantWhen).toEqual({ on: false });
    expect(INLINE_GLSL.trim().startsWith("if (on) {")).toBe(true);
  });

  it("can't run inside masks: a mask's bag would hold no source or target", () => {
    expect(stage.mask).toBeUndefined();
  });

  it("declares the switch, the sliders, the draw count and both sides' clusters", () => {
    const byKey = new Map(stage.uniforms.map((u) => [u.key, u]));
    expect([...byKey.keys()]).toEqual([...SETTING_KEYS, DRAWS_KEY, "sMean", "sVar", "sWeight", "tMean", "tVar", "tWeight"]);
    for (const key of SETTING_KEYS) expect(byKey.get(key)?.default).toBe(DEFAULT_SETTINGS[key]);
    expect(byKey.get(DRAWS_KEY)?.default).toBe(0);
    for (const key of ["sMean", "sVar", "tMean", "tVar"]) {
      expect(byKey.get(key)).toMatchObject({ glslType: "vec2", length: MAXN, default: new Array(2 * MAXN).fill(0) });
    }
    for (const key of ["sWeight", "tWeight"]) {
      expect(byKey.get(key)).toMatchObject({ glslType: "float", length: MAXN, default: new Array(MAXN).fill(0) });
    }
  });

  it("works the target's clusters out per photo, and keeps the source's as an edit", () => {
    for (const u of stage.uniforms) expect(u.computed === true).toBe(u.key.startsWith("t"));
  });

  it("labels every control, each differently", () => {
    const labels = stage.uniforms.filter((u) => u.key !== DRAWS_KEY).map((u) => u.label);
    expect(labels.slice(0, 4)).toEqual(SETTING_KEYS.map((k) => LABELS[k]));
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label).not.toMatch(/darktable/i);
  });

  it("carries the source's table and its variant with the edit", () => {
    expect(stage.dataKeys).toEqual(["sourceHist", SIHIST]);
  });

  it("reads both tables from one-row half-float textures, the target's per photo", () => {
    expect(stage.textures).toEqual([
      { key: SIHIST, kind: "lut", width: 2048, height: 1, format: "r16f" },
      { key: THIST, kind: "lut", width: 2048, height: 1, format: "r16f", perPhoto: true },
    ]);
  });

  it("smooths with one four-channel pass, for as many draws as the bag says, reading only equalisation", () => {
    expect(stage.passes).toHaveLength(1);
    expect(pass).toMatchObject({ channels: 4, iterations: { key: DRAWS_KEY, max: MAX_DRAWS }, region: REGION_GLSL });
    expect(pass?.uniforms).toEqual([stage.uniforms.find((u) => u.key === "equalization")]);
  });
});

describe("a draw's cost", () => {
  // Every draw starts from its own texel, then runs one step; the pass also
  // reads the grid's constants, four texels. D at a texel of the input reads
  // two texels of the 2048 × 1 tables besides.
  const bl = (call: string) => 1 + 4 + inlineFetches(call, BL_HELPERS);
  const tableReads = (call: string) => (call === BL_STEP_CALLS.splatX ? 2 * SPLAT_TAPS : call === BL_STEP_CALLS.slice ? 2 : 0);

  it("reads two table texels for a pixel's shift, and nothing else inline", () => {
    expect(inlineFetches("cmShift(0.0);", BL_HELPERS)).toBe(2);
    expect(inlineFetches("cmGridValue(q);", BL_HELPERS)).toBe(3);
    expect(inlineFetches(INLINE_GLSL, INLINE_HELPERS)).toBe(2);
  });

  it("splats 24 input texels a draw, blurs from 5 and slices from 12 grid texels", () => {
    expect(bl(BL_STEP_CALLS.splatX)).toBe(5 + 3 * SPLAT_TAPS);
    expect(bl(BL_STEP_CALLS.splatY)).toBe(5 + SPLAT_TAPS);
    expect(bl(BL_STEP_CALLS.blurX)).toBe(5 + 5);
    expect(bl(BL_STEP_CALLS.blurY)).toBe(5 + 5);
    expect(bl(BL_STEP_CALLS.slice)).toBe(5 + 3 + 12);
    expect(bl(BL_STEP_CALLS.plan)).toBe(5);
  });

  // The table reads hit 8 KB of texture; the frame's and the grid's reads are
  // what grow with the image, and stay at Local Contrast's bound.
  it("reads at most 30 texels of the frame or the grid in any draw", () => {
    for (const call of Object.values(BL_STEP_CALLS)) expect(bl(call) - tableReads(call)).toBeLessThanOrEqual(30);
  });

  it("dispatches each step from one call site", () => {
    for (const call of Object.values(BL_STEP_CALLS)) expect(BL_GLSL.split(call).length - 1).toBe(1);
  });

  // On D3D11, ANGLE turns a const array into indexable registers that FXC
  // fills for every pixel of every draw, and a local array indexed in a loop
  // the same per call site. The pass indexes nothing.
  it("declares no arrays and indexes nothing in the pass", () => {
    for (const src of [BL_HELPERS, BL_GLSL]) expect(code(src)).not.toMatch(/\[/);
  });

  it("indexes only the uniform arrays in the inline, and declares none of its own", () => {
    const indexed = [...code(INLINE_HELPERS + INLINE_GLSL).matchAll(/(\w+)\[/g)].map((m) => m[1]);
    expect(indexed.length).toBeGreaterThan(0);
    for (const name of indexed) expect(["sMean", "sVar", "sWeight", "tMean", "tVar", "tWeight"]).toContain(name);
  });

  // A gradient sample reached from a loop makes ANGLE flatten every branch
  // around it on D3D11. Sampling is linear, so a table read must be exact.
  it("reads only through fetchPrev4, fetchInput and texelFetch, and takes no derivatives", () => {
    for (const src of [BL_HELPERS, BL_GLSL, INLINE_HELPERS, INLINE_GLSL]) {
      expect(code(src)).not.toMatch(/\b(texture|textureLod|textureGrad|textureProj|readPrev4?|readSource|dFdx|dFdy|fwidth)\s*\(/);
    }
    const fetched = [...code(BL_HELPERS + INLINE_HELPERS).matchAll(/texelFetch\((\w+)/g)].map((m) => m[1]);
    expect(new Set(fetched)).toEqual(new Set([SIHIST, THIST]));
  });

  it("uses only GLSL ES 3.00", () => {
    for (const src of [BL_HELPERS, BL_GLSL, INLINE_HELPERS, INLINE_GLSL]) {
      expect(code(src)).not.toMatch(
        /\b(findMSB|findLSB|bitCount|bitfieldExtract|bitfieldInsert|bitfieldReverse|ldexp|frexp|umulExtended|imulExtended|uaddCarry|usubBorrow|packUnorm4x8|fma)\s*\(/,
      );
    }
  });

  // The host declares only highp float, so a plain int is mediump: 16 bits on
  // Mesa's radeonsi. The pass's helpers follow the host's uniforms in both its
  // programs; the inline shares the develop program, so it keeps its ints
  // small (a table index, a cluster count) and its maths in float.
  it("computes every pass index in highp ints, and leaves the develop program's precision alone", () => {
    expect(code(BL_HELPERS).trimStart()).toMatch(/^precision highp int;/);
    expect(code(BL_HELPERS)).not.toMatch(/\b(mediump|lowp)\b/);
    expect(code(INLINE_HELPERS + INLINE_GLSL)).not.toMatch(/\bprecision\b/);
    expect(code(INLINE_HELPERS + INLINE_GLSL)).not.toMatch(/\b(uint|floatBitsTo|intBitsTo|uintBitsTo)/);
  });

  it("names no GLSL built-in, reserved word or uniform as a local", () => {
    const reserved = ["step", "smooth", "filter", "active", "input", "output", "sample", "half", "fixed", "common", "partition", "union", "long", "short"];
    const keys = [...stage.uniforms.map((u) => u.key), SIHIST, THIST];
    for (const src of [BL_HELPERS + BL_GLSL, INLINE_HELPERS + INLINE_GLSL]) {
      for (const name of [...reserved, ...keys]) {
        expect(src).not.toMatch(new RegExp(`\\b(int|float|bool|vec[234]|ivec[234]|uint)\\s+${name}\\b`));
      }
    }
  });

  it("places each draw by its region, computed in a vertex program", () => {
    expect(BL_HELPERS).toMatch(/ivec4 cmRegion\(\)/);
    expect(code(BL_HELPERS)).not.toMatch(/gl_FragCoord|discard/);
  });

  it("writes float literals GLSL ES accepts", () => {
    expect(glslLiteral(1)).toBe("1.0");
    expect(glslLiteral(2 ** -14)).toContain(".");
    for (const src of [BL_HELPERS, INLINE_HELPERS]) expect(code(src)).not.toMatch(/[^\w.]\d+e-?\d/);
  });
});
