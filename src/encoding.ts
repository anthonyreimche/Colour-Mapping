// A 2048-entry table of whole numbers from 0 to 2047 that never falls (the
// source's inverse histogram, the target's cumulative histogram), stored as
// its steps from 0, each an unsigned varint: about a byte an entry. Photo data
// keeps the bytes; the edit keeps them as base64 text. The stage reads a table
// from a one-row half-float texture holding (k + 1) / 2048 per entry, so a
// texel of 0 means the table is missing.

import { HISTN } from "./model";
import type { StageTextureData } from "./safelight";

export function encodeTable(table: ArrayLike<number>): Uint8Array {
  if (table.length !== HISTN) throw new Error(`a table has ${HISTN} entries, not ${table.length}`);
  const bytes: number[] = [];
  let previous = 0;
  for (let i = 0; i < HISTN; i++) {
    const k = table[i];
    if (!Number.isInteger(k) || k < previous || k >= HISTN) throw new Error(`entry ${i} (${k}) is out of order or range`);
    let step = k - previous;
    previous = k;
    while (step >= 0x80) {
      bytes.push((step & 0x7f) | 0x80);
      step >>>= 7;
    }
    bytes.push(step);
  }
  return Uint8Array.from(bytes);
}

export function decodeTable(bytes: Uint8Array): Int32Array | null {
  const table = new Int32Array(HISTN);
  let at = 0;
  let k = 0;
  for (let i = 0; i < HISTN; i++) {
    let step = 0;
    let shift = 0;
    for (;;) {
      if (at >= bytes.length || shift > 14) return null;
      const byte = bytes[at++];
      step |= (byte & 0x7f) << shift;
      shift += 7;
      if (byte < 0x80) break;
    }
    k += step;
    if (k >= HISTN) return null;
    table[i] = k;
  }
  return at === bytes.length ? table : null;
}

export function encodeTableText(table: ArrayLike<number>): string {
  let binary = "";
  for (const byte of encodeTable(table)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** `text` is a bag value of any type; anything but a table's text reads as null. */
export function decodeTableText(text: unknown): Int32Array | null {
  if (typeof text !== "string" || text.length === 0) return null;
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return null;
  }
  return decodeTable(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)));
}

function fnv1a(text: string, basis: number): number {
  let h = basis;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** The variant a table's texture is filed under: named by the text it is
 *  stored as, so the same table always has the same name. */
export function tableVariant(text: string): string {
  const hex = (v: number) => v.toString(16).padStart(8, "0");
  return `s${hex(fnv1a(text, 0x811c9dc5))}${hex(fnv1a(text, 0x050c5d1f))}`;
}

export function tableTexture(table: ArrayLike<number>, version: number): StageTextureData {
  const data = new Float32Array(HISTN);
  for (let i = 0; i < HISTN; i++) data[i] = (table[i] + 1) / HISTN;
  return { data, width: HISTN, height: 1, format: "r16f", version };
}

/** The entry k a texel holds, or -1 for none. */
export const textureEntry = (texel: number): number => Math.round(texel * HISTN) - 1;
