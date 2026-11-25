// CIELAB (D50) as darktable takes it (dt_XYZ_to_Lab / dt_Lab_to_XYZ) from the
// linear Rec.709 values the stage and the analysis capture see, through
// Safelight's working matrix to XYZ (D50, Bradford). glsl.ts does the same in
// float on the GPU.

/** Linear Rec.709 to XYZ (D50, Bradford): the working profile's matrix. */
export const XYZ_FROM_709: readonly (readonly number[])[] = [
  [0.4360747, 0.3850649, 0.1430804],
  [0.2225045, 0.7168786, 0.0606169],
  [0.0139322, 0.0971045, 0.7141733],
];

export function invert3(m: readonly (readonly number[])[]): number[][] {
  const [a, b, c] = m;
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  return [
    [(b[1] * c[2] - b[2] * c[1]) / det, (a[2] * c[1] - a[1] * c[2]) / det, (a[1] * b[2] - a[2] * b[1]) / det],
    [(b[2] * c[0] - b[0] * c[2]) / det, (a[0] * c[2] - a[2] * c[0]) / det, (a[2] * b[0] - a[0] * b[2]) / det],
    [(b[0] * c[1] - b[1] * c[0]) / det, (a[1] * c[0] - a[0] * c[1]) / det, (a[0] * b[1] - a[1] * b[0]) / det],
  ];
}

export const REC709_FROM_XYZ = invert3(XYZ_FROM_709);

export const KAPPA = 24389 / 27;
export const EPSILON = 216 / 24389;
export const D50: readonly [number, number, number] = [0.9642, 1, 0.8249];

export type Vec3 = [number, number, number];

const labF = (t: number): number => (t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
const labFInv = (v: number): number => (v > 6 / 29 ? v * v * v : (116 * v - 16) / KAPPA);

const mul = (m: readonly (readonly number[])[], v: readonly number[]): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

export function rgbToLab(rgb: readonly number[]): Vec3 {
  const xyz = mul(XYZ_FROM_709, rgb);
  const fx = labF(xyz[0] / D50[0]);
  const fy = labF(xyz[1]);
  const fz = labF(xyz[2] / D50[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb(lab: readonly number[]): Vec3 {
  const fy = (lab[0] + 16) / 116;
  const fx = fy + lab[1] / 500;
  const fz = fy - lab[2] / 200;
  return mul(REC709_FROM_XYZ, [labFInv(fx) * D50[0], labFInv(fy), labFInv(fz) * D50[2]]);
}

/** A frame's RGBA linear Rec.709 floats as RGBA Lab floats. */
export function frameToLab(rgba: Float32Array): Float32Array {
  const out = new Float32Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const [L, a, b] = rgbToLab([rgba[i], rgba[i + 1], rgba[i + 2]]);
    out[i] = L;
    out[i + 1] = a;
    out[i + 2] = b;
    out[i + 3] = 1;
  }
  return out;
}

const encode = (v: number): number => {
  const c = Math.min(Math.max(v, 0), 1);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
};

/** A Lab colour as a CSS colour, sRGB, clipped. */
export function labToCss(lab: readonly number[]): string {
  const rgb = labToRgb(lab).map((v) => Math.round(255 * encode(v)));
  return `rgb(${rgb.join(", ")})`;
}
