# Colour Mapping: port notes

A port of darktable's colour mapping module (`src/iop/colormapping.c`,
release-5.6.1, Copyright (C) 2013-2026 darktable developers) and the bilateral
grid it smooths with (`src/common/bilateral.c`, 2016-2026, and `bilateral.h`,
2012-2023, darktable developers), GPL-3.0-or-later. Issue #286; design in the
core checkout at `docs/superpowers/specs/2026-11-24-colour-mapping-design.md`
(its §4 "Review outcome" is what was built).

## 1. Files

| File | What it holds |
| --- | --- |
| `src/model.ts` | darktable's CPU maths: `capture_histogram`, `invert_histogram`, `kmeans` (seeded, as a generator so it can yield), `get_cluster_mapping`, `get_clusters`; ranges and defaults |
| `src/grid.ts` | The bilateral grid's size, layout and draw schedule as the GPU pass runs it (from Local Contrast) |
| `src/glsl.ts` | The inline (Lab, the two table reads, the cluster transfer) and the bilateral pass |
| `src/stage.ts` | The stage contribution |
| `src/params.ts` | The bag contract: keys, reading, the patches each action writes |
| `src/encoding.ts` | The 2048-entry table encoding, its variant name and its texture |
| `src/textures.ts` | The two texture providers |
| `src/analysis.ts` | The analysis capture and its maths |
| `src/workflow.ts` | Use as source, Match to source, the Library batch |
| `src/store.ts` | The app-wide colour source and the busy state |
| `src/lab.ts` | Lab (D50) from linear Rec.709, and swatch colours |
| `src/Panel.tsx`, `src/index.tsx` | The panel and activation |
| `test/reference/colormapping_ref.c` | The gcc oracle: darktable's functions copied, single-threaded |
| `test/support/process-model.ts` | darktable's `process()` and `dt_bilateral_*` in TypeScript, held to the oracle bit for bit |

## 2. Storage

Every key is under the stage, `colour-mapping.lab.{key}`.

| Key | Kind | Value |
| --- | --- | --- |
| `on` | edit, uniform bool | the switch; `dormantWhen: { on: false }` |
| `clusters` | edit, uniform int | 1 to 5 |
| `dominance`, `equalization` | edit, uniform float | percent |
| `blDraws` | edit, uniform int | the bilateral pass's draw count: `BL_DRAWS` (55) while on, equalising above 0.1 % and both sides hold clusters, else 0 |
| `sMean`, `sVar`, `sWeight` | edit, uniform `vec2[5]`, `vec2[5]`, `float[5]` | the source's clusters; `sVar` holds standard deviations, as darktable's `source_var` does after kmeans |
| `sourceHist` | edit, data key | the source's inverse histogram as text (below) |
| `sihist` | edit, data key, and the texture key | the source table's variant name, a content hash of `sourceHist` |
| `tMean`, `tVar`, `tWeight` | computed, uniform arrays | this photo's clusters; never pasted or put in presets |
| photo data `thist` | per photo | this photo's cumulative histogram, as table bytes |

The app-wide colour source lives in the extension's settings under `source`:
`{ photoId, name, n, clusters: { mean, sd, weight }, hist }`, `hist` being the
inverse histogram's text.

**Table encoding.** A 2048-entry table of whole numbers 0 to 2047 that never
falls (both histograms are such tables: the inverse histogram as the entries
k of `100·k / 2048`). Its steps from 0, each an unsigned LEB128 varint, about a
byte an entry; base64 in the edit, raw bytes as photo data. Decoding refuses
anything that isn't exactly 2048 entries in range. The variant name is `s`
followed by two 32-bit FNV-1a hashes of the text in hex.

**Textures.** Both are `lut`, `r16f`, 2048 × 1, holding `(k + 1) / 2048`, which
a half float holds exactly; a texel of 0 (no data, or the 1 × 1 black a
missing variant draws with) means missing.
- `sihist` is not per photo. Its provider decodes `sourceHist` from the asking
  frame's bag (S2) when the variant matches the text's hash, else from tables
  this session already holds (the app-wide source, and any it put in a bag).
  Paste, undo and presets change only the name in the bag, so nothing is ever
  invalidated.
- `thist` is per photo (variant = photo id). Its provider reads an in-memory
  map, then `getPhotoData("thist", photoId)`. A match updates the map and
  drops that photo's variant.
- The analysis capture names the variant `analysis` for both, which has no
  data, so it never waits on a table.

**Commit paths.** Match to source on the open photo writes the photo data
(`putPhotoData`), holds both variants (`prepareStageTextureVariant`), then
`setDynParams` + `commitEdit`: one undo step. The Library batch writes each
photo's data with `putPhotoData(key, data, photoId)` (S3) and commits with
`catalog.applyBagPatch(photoId, patch, label)` (S3); the open photo goes
through Develop instead. "Use as source" writes only the extension setting, so
it adds no undo step. A cluster change writes `clustersPatch`: zeros, `""`
for both data keys, off.

## 3. The stage

`display-adjust`, priority 85 (ahead of Local Contrast's 90, as darktable's
colormapping runs before its local contrast), `reads: "current"`, space linear
Rec.709, Lab (D50) through Safelight's working matrix in the shader. Not
maskable: a mask copy reads only the mask's bag, which holds neither side.

**Inline, per pixel:**
1. Pass through unless Σ sWeight > 0 and Σ tWeight > 0 over the first n.
2. D = clamp(0.5·((L·(1 − e) + ihist[thist[bin(L)]]·e) − L) + 50, 0, 100); pass
   through if either table is missing.
3. With the pass drawn: D = max(0, D + the pass's smoothed shift).
4. L′ = clamp(2·(D − 50) + L, 0, 100).
5. a′, b′ = Σ w_c((ab − tMean_c)·ratio_c + sMean_{map c}), with `get_clusters`'s
   weights (direct hits share the pixel), and the mapping and variance ratios
   worked out in the loop (n ≤ 5). Two texel fetches a pixel.

**The bin** is HISTN·L / 100 truncated, taken against the bins' exact edges
(25·k / 512 is exact in float), so no GPU division's rounding moves a pixel a
bin. It is the floor of the exact quotient, which differs from darktable's
float-rounded quotient only for an L one float below a bin edge at a power of
two, a dozen values in all.

**The bilateral pass** is Local Contrast's (`BL_*`), with D in place of L*
where it splats (`cmSplatX`) and slices (`cmSlice`); σs is 50 pixels of the
full image scaled to the pass (50 / max(source / pass, 1)), σr 8; the slice
is `dt_bilateral_slice` with detail −1, so `norm = σr·0.04` and no ×0.01; the
inline applies max(0, ·). Draw 0 plans the grid; per quad of z bins, its
x-splat chunks (24 taps), the x-blur and its y-splat chunks; then the y-blur
and the slice. darktable blurs the whole splat along x then y: the same sums.
The schedule runs from the last draw backwards, so a frame that needs fewer
than the constant `BL_DRAWS` = 55 runs idle draws first. Intermediates are
half floats. `precision highp int` leads the pass helpers; the inline keeps
the develop program's precision and uses no int maths beyond a table index.

**Cost.** Inline: 2 fetches. Pass draws: a splat-x draw reads 24 input texels
plus 2 table texels each (over the x-splat's rows only, about W·H / 50 texels);
the others read at most 30 texels of the frame or the grid. `test/stage.test.ts`
counts them from the GLSL.

## 4. The analysis

`captureFloatFrame` (open photo) or `renderPhotoFloatFrame` (Library) at
"pre-output", linear Rec.709, 640 px on the long edge both ways, with
`{ on: false, sihist: "analysis", thist: "analysis" }` over the photo's bag
(headless: the stored edit's whole bag and params, a never-edited photo
`normalizeParams({ temperature: as-shot })`). Converted to Lab on the CPU with
the shader's constants, then `capture_histogram`, `kmeans` (n = the colour
source's n for a target, the photo's Clusters for a source), and for a source
`invert_histogram`. k-means yields to the page after each of its 40 iterations.

## 5. Deviations from darktable, and why

1. **Seeded k-means start.** darktable starts its means from
   `dt_points_get()`, which isn't reseeded per call, so the same image gives
   different clusters each time. Here a mulberry32 generator seeded with
   `0x2545F491` at each call stands in, so the same frame always gives the
   same clusters, and the oracle can reproduce them.
2. **Variance clamp.** darktable's variance (Σx²/n − mean²) can round below
   zero, and it only eliminates clusters at exactly zero, so `sqrtf` gives NaN,
   which a JSON edit can't hold. A negative variance is taken as 0; the
   cluster keeps its mean and weight. The oracle applies the same clamp.
3. **Capture point.** darktable analyses the module's own input. Here the
   analysis reads "pre-output", which includes the display tools after this
   stage (Local Contrast, effects, output stages). With those at rest it is
   the stage's input.
4. **Analysis size.** darktable analyses its preview pipe, about 1 MP. Both
   paths here analyse 640 px on the long edge, the most a headless float
   frame gives, so a Develop match and a Library match agree.
5. **Grid widening.** Where darktable's grid wouldn't fit the pass's target
   (only for frames under about 64 px), σs widens by 1.25 until it does, as in
   Local Contrast.
6. **Half-float pass input.** The bilateral pass works out the lightness shift
   from the host's half-float copy of the stage's input, where the inline reads
   the full-float input. Some pixels land in a neighbouring histogram bin in
   the pass only. Where the grid is steep, that moves the shift by up to 0.18 L*
   at 50 % equalisation and 0.31 L* at 100 %. The pass's half-float grid
   storage adds only a remainder (L* p99 3e-3). Measured against darktable-cli
   5.6.1 (rig `python run.py colourmapping`): patch ΔE00 ≤ 0.06 at 50 % and
   ≤ 0.11 at 100 %.
7. **Nothing to map.** darktable maps even when every cluster was eliminated
   (all weights 0). Here the stage passes the photo through until both sides
   hold a weight, because a pasted or preset source arrives without a target.
   For the same reason a missing table passes the photo through.
8. **No masks** in 1.0.0 (section 3).
9. **"Use as source"** keeps the analysis app-wide and leaves the reference
   photo's edit alone. darktable writes the source into that photo's params.
10. **Swatches** are drawn clipped to sRGB from Lab at L* 53.39; darktable
    converts through lcms with the perceptual intent.
11. **Lab matrix.** Like the other Lab extensions, the stage converts with the
    7-digit Rec.709 → XYZ D50 matrix, which puts white 0.025 off the neutral
    axis in b*. darktable feeds this module Lab from its Rec.709 working
    profile, Bradford-adapted to D50 in double precision, so its white is
    neutral. That accounts for the whole difference without equalisation:
    a*b* ≤ 0.04, patch ΔE00 ≤ 0.022.
12. **Moving dominance or equalisation switches the transfer on,** as darktable
    enables a module whose parameter changes.

## 6. Verification

- `npm run reference` builds `test/reference/colormapping_ref.c` with gcc
  (`-O2 -ffp-contract=off`, without bilateral.c's fast-math pragma) and writes
  `vectors.json`. The TypeScript model matches it exactly: the generator,
  4 histograms (bin edges and the floats either side of them included) and
  their inverses, 8 k-means cases (eliminated clusters, a negative variance,
  every cluster eliminated), 24 mappings (ties), 45 weight cases (two
  clusters eliminated to (0, 0)), and 7 whole-module cases with and without
  equalisation (σs 3 to 50).
- `npm run test:gpu` (SwiftShader, through the core checkout): the live view is
  bit-identical while off on versions 2 and 3; exports and thumbnails within
  1e-5 (the host's conversion into the stage's space and back rounds: worst
  9.3e-6); the stage against `process-model.ts` without equalisation |ΔL*|
  max 6.6e-5, |Δa*, b*| max 3.5e-4; with it, section 5.6; pass-through cases
  bit-identical to the idle frame; a 4096 px frame with 55 smoothing draws,
  finite everywhere.
- Not done here: the darktable-cli rig (`.claude/cycle/ext-reference/modules/colourmapping/`),
  and the in-app checks.
