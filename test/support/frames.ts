// Frames as a capture returns them (RGBA linear Rec.709 floats), made from
// the C reference's Lab images.

import { labToRgb } from "../../src/lab";
import type { FloatFrame } from "../../src/safelight";
import { VECTORS } from "./vectors";

export function frameFromLab(lab: ArrayLike<number>, width: number, height: number): FloatFrame {
  const data = new Float32Array(4 * width * height);
  for (let k = 0; k < width * height; k++) {
    const rgb = labToRgb([lab[4 * k], lab[4 * k + 1], lab[4 * k + 2]]);
    data.set([...rgb, 1], 4 * k);
  }
  return { data, width, height, space: { encoding: "linear", primaries: "rec709" }, point: "pre-output" };
}

/** A reference image by its k-means case name, as a frame. */
export function referenceFrame(name: string): FloatFrame {
  const c = VECTORS.kmeans.find((k) => k.name === name);
  if (!c) throw new Error(`no reference image "${name}"`);
  return frameFromLab(c.lab, c.w, c.h);
}

export const SOURCE_IMAGE = "dark blue scene, 3 clusters";
export const TARGET_IMAGE = "three blobs, 3 clusters";
