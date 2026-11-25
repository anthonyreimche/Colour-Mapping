// A photo's analysis, as darktable's acquire takes it from its preview pipe:
// the frame as the stage would receive it (captured at the end of the display
// phase with the stage off, so its own output never feeds back), converted to
// Lab, its cumulative lightness histogram and its k-means clusters. Frames are
// read at 640 px on the long edge, live and headless alike, so both give the
// same answer. k-means yields between its iterations so the page keeps
// drawing.

import { encodeTableText } from "./encoding";
import { frameToLab } from "./lab";
import { captureHistogram, invertHistogram, kmeansSteps, type Clusters } from "./model";
import { ANALYSIS_VARIANT, SIHIST, THIST, qualified, type SourceAnalysis } from "./params";
import type { FloatCaptureOptions, FloatFrame } from "./safelight";

/** The long edge of an analysed frame, in pixels. */
export const ANALYSIS_EDGE = 640;

/** The stage off, and both tables a variant with no data, so an analysis
 *  never waits on, or reads, a table of its own. */
export const ANALYSIS_BAG: Readonly<Record<string, unknown>> = {
  [qualified("on")]: false,
  [qualified(SIHIST)]: ANALYSIS_VARIANT,
  [qualified(THIST)]: ANALYSIS_VARIANT,
};

/** Where the frame is read: the signed colour the display phase hands on, in
 *  the stage's own linear Rec.709. */
export const CAPTURE: FloatCaptureOptions = { point: "pre-output", space: { encoding: "linear", primaries: "rec709" } };

export interface FrameAnalysis {
  /** The cumulative histogram of L*. */
  hist: Int32Array;
  clusters: Clusters;
}

const breathe = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export async function analyseFrame(frame: FloatFrame, n: number): Promise<FrameAnalysis> {
  const pixels = frame.width * frame.height;
  const lab = frameToLab(frame.data);
  const hist = captureHistogram(lab, pixels);
  const steps = kmeansSteps(lab, pixels, n);
  for (;;) {
    const step = steps.next();
    if (step.done) return { hist, clusters: step.value };
    await breathe();
  }
}

/** A frame's analysis as a source: its inverse histogram, as text. */
export const asSource = (n: number, a: FrameAnalysis): SourceAnalysis => ({
  n,
  clusters: a.clusters,
  hist: encodeTableText(invertHistogram(a.hist)),
});
