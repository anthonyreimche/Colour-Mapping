// The processing stage. darktable runs colour mapping on display-referred Lab,
// early among its colour tools: L* is clamped to 0 to 100, so the stage sits
// after the tone mapper, in the display phase, ahead of Local Contrast (90) as
// darktable's colormapping comes before its local contrast. It reads and
// writes linear Rec.709 and converts to Lab (D50) and back itself.

import { BL_GLSL, BL_HELPERS, INLINE_GLSL, INLINE_HELPERS, REGION_GLSL } from "./glsl";
import { MAX_DRAWS } from "./grid";
import { DEFAULT_SETTINGS, HISTN, MAXN, RANGES } from "./model";
import { DATA_KEYS, DRAWS_KEY, LABELS, SIHIST, SOURCE_KEYS, STAGE_ID, TARGET_KEYS, THIST } from "./params";
import type { ProcessingStageContribution, TextureRequirement, UniformDeclaration } from "./safelight";

/** Ahead of Local Contrast's 90 and the display phase's colour tools at 100. */
export const PRIORITY = 85;

const equalization: UniformDeclaration = {
  key: "equalization",
  glslType: "float",
  default: DEFAULT_SETTINGS.equalization,
  range: { ...RANGES.equalization },
  label: LABELS.equalization,
};

const clusterArrays = (keys: typeof SOURCE_KEYS | typeof TARGET_KEYS, side: string, computed: boolean): UniformDeclaration[] => [
  { key: keys.mean, glslType: "vec2", length: MAXN, default: new Array<number>(2 * MAXN).fill(0), label: `${side} cluster colours`, computed },
  { key: keys.sd, glslType: "vec2", length: MAXN, default: new Array<number>(2 * MAXN).fill(0), label: `${side} cluster spreads`, computed },
  { key: keys.weight, glslType: "float", length: MAXN, default: new Array<number>(MAXN).fill(0), label: `${side} cluster sizes`, computed },
];

export const UNIFORMS: UniformDeclaration[] = [
  { key: "on", glslType: "bool", default: DEFAULT_SETTINGS.on, label: LABELS.on },
  { key: "clusters", glslType: "int", default: DEFAULT_SETTINGS.clusters, range: { ...RANGES.clusters }, label: LABELS.clusters },
  { key: "dominance", glslType: "float", default: DEFAULT_SETTINGS.dominance, range: { ...RANGES.dominance }, label: LABELS.dominance },
  equalization,
  { key: DRAWS_KEY, glslType: "int", default: 0 },
  ...clusterArrays(SOURCE_KEYS, "Source", false),
  ...clusterArrays(TARGET_KEYS, "Target", true),
];

/** The source's inverse histogram (its variant named in the bag, by content)
 *  and the photo's own cumulative histogram (its variant the photo's id). */
export const TEXTURES: TextureRequirement[] = [
  { key: SIHIST, kind: "lut", width: HISTN, height: 1, format: "r16f" },
  { key: THIST, kind: "lut", width: HISTN, height: 1, format: "r16f", perPhoto: true },
];

export function colourMappingStage(): ProcessingStageContribution {
  return {
    id: STAGE_ID,
    name: "Colour Mapping",
    phase: "display-adjust",
    priority: PRIORITY,
    reads: "current",
    space: { encoding: "linear", primaries: "rec709" },
    glsl: INLINE_GLSL,
    helpers: INLINE_HELPERS,
    uniforms: UNIFORMS,
    textures: TEXTURES,
    passes: [
      {
        channels: 4,
        glsl: BL_GLSL,
        helpers: BL_HELPERS,
        region: REGION_GLSL,
        iterations: { key: DRAWS_KEY, max: MAX_DRAWS },
        uniforms: [equalization],
      },
    ],
    dormantWhen: { on: false },
    dataKeys: [...DATA_KEYS],
  };
}
