// How a 2048-entry table (the source's inverse histogram, the target's
// cumulative histogram) is stored: as its steps, each a varint, in bytes for
// photo data and in base64 inside the edit; and the texture made of it.

import { describe, expect, it } from "vitest";
import {
  decodeTable,
  decodeTableText,
  encodeTable,
  encodeTableText,
  tableTexture,
  tableVariant,
  textureEntry,
} from "../src/encoding";
import { HISTN, captureHistogram, invertHistogram } from "../src/model";
import { VECTORS } from "./support/vectors";

const tables = (): Int32Array[] =>
  VECTORS.histograms.flatMap((c) => [Int32Array.from(c.hist), invertHistogram(c.hist)]);

const ramp = (): Int32Array => Int32Array.from({ length: HISTN }, (_, i) => i);

describe("a table's encoding", () => {
  it.each(tables().map((t, i) => [i, t] as const))("table %i survives bytes and text", (_i, table) => {
    expect(decodeTable(encodeTable(table))).toEqual(table);
    expect(decodeTableText(encodeTableText(table))).toEqual(table);
  });

  it("keeps a whole lightness histogram small", () => {
    const pixels = new Float32Array(4 * 5000);
    for (let k = 0; k < 5000; k++) pixels[4 * k] = (100 * k) / 5000;
    const text = encodeTableText(invertHistogram(captureHistogram(pixels, 5000)));
    expect(text.length).toBeLessThan(3000);
    expect(text).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("refuses a table that isn't 2048 rising entries from 0 to 2047", () => {
    expect(() => encodeTable(ramp().slice(1))).toThrow();
    const falling = ramp();
    falling[100] = 5;
    expect(() => encodeTable(falling)).toThrow();
    const over = ramp();
    over[HISTN - 1] = HISTN;
    expect(() => encodeTable(over)).toThrow();
    const negative = ramp();
    negative[0] = -1;
    expect(() => encodeTable(negative)).toThrow();
  });

  it("reads anything else as no table", () => {
    expect(decodeTableText("")).toBeNull();
    expect(decodeTableText("not base64!")).toBeNull();
    expect(decodeTableText(undefined)).toBeNull();
    expect(decodeTableText(42)).toBeNull();
    const bytes = encodeTable(ramp());
    expect(decodeTable(bytes.slice(0, -1))).toBeNull();
    expect(decodeTable(new Uint8Array([...bytes, 0]))).toBeNull();
    // A step past 2047.
    const big = new Uint8Array(bytes);
    big[1] = 0x7f;
    expect(decodeTable(big)).toBeNull();
    // A varint left open at the end.
    expect(decodeTable(new Uint8Array([...bytes.slice(0, -1), 0x80]))).toBeNull();
  });
});

describe("a table's variant name", () => {
  it("is named by its content, in the characters a variant may use", () => {
    const [a, b] = tables();
    expect(tableVariant(encodeTableText(a))).toBe(tableVariant(encodeTableText(Int32Array.from(a))));
    expect(tableVariant(encodeTableText(a))).not.toBe(tableVariant(encodeTableText(b)));
    for (const t of tables()) expect(tableVariant(encodeTableText(t))).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it("never names the analysis variant", () => {
    for (const t of tables()) expect(tableVariant(encodeTableText(t))).not.toBe("analysis");
  });
});

describe("a table's texture", () => {
  it("holds (k + 1) / 2048 per entry, exact in a half float, 0 meaning none", () => {
    const table = invertHistogram(VECTORS.histograms[0].hist);
    const tex = tableTexture(table, 7);
    expect(tex).toMatchObject({ width: HISTN, height: 1, format: "r16f", version: 7 });
    expect(tex.data).toBeInstanceOf(Float32Array);
    expect(tex.data).toHaveLength(HISTN);
    for (let i = 0; i < HISTN; i++) {
      const v = tex.data[i];
      expect(v).toBeGreaterThan(0);
      expect(textureEntry(v)).toBe(table[i]);
      // 11 significant bits at most: a half float holds it exactly.
      expect(Number.isInteger(v * HISTN) && v * HISTN <= HISTN).toBe(true);
    }
    expect(textureEntry(0)).toBe(-1);
  });
});
