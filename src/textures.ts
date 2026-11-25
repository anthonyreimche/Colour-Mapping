// The stage's two tables as textures, made on demand. The source's inverse
// histogram is filed under a variant named by its content: a frame's bag names
// it, and the table comes from that bag's sourceHist (or from a table this
// session already holds). The target's cumulative histogram is per photo: in
// memory once analysed or read, else from the photo's data. Nothing is ever
// stale: a different source is a different name, and only a new match changes
// a photo's target, which drops its variant.

import { decodeTable, decodeTableText, tableTexture, tableVariant } from "./encoding";
import { ANALYSIS_VARIANT, SIHIST, SOURCE_HIST_KEY, STAGE_ID, THIST, THIST_DATA, qualified } from "./params";
import type { SafelightAPI, StageTextureData } from "./safelight";

type TextureHost = Pick<SafelightAPI, "setStageTextureProvider" | "dropStageTextureVariants"> & {
  develop: Pick<SafelightAPI["develop"], "getPhotoData">;
};

export class Tables {
  private readonly sources = new Map<string, Int32Array>();
  private readonly targets = new Map<string, Int32Array>();
  private version = 1;

  constructor(private readonly host: TextureHost) {}

  register(): void {
    this.host.setStageTextureProvider(STAGE_ID, SIHIST, (variant, _signal, bag) => this.source(variant, bag));
    this.host.setStageTextureProvider(STAGE_ID, THIST, (variant) => this.target(variant));
  }

  unregister(): void {
    this.host.setStageTextureProvider(STAGE_ID, SIHIST, null);
    this.host.setStageTextureProvider(STAGE_ID, THIST, null);
  }

  /** Holds a source table by its text; its variant name. */
  rememberSource(text: string): string {
    const variant = tableVariant(text);
    const table = decodeTableText(text);
    if (table) this.sources.set(variant, table);
    return variant;
  }

  /** A photo's new target histogram: frames of it ask for it again. */
  setTarget(photoId: string, hist: Int32Array): void {
    this.targets.set(photoId, hist);
    this.host.dropStageTextureVariants(STAGE_ID, THIST, photoId);
  }

  private texture(table: Int32Array): StageTextureData {
    return tableTexture(table, this.version++);
  }

  async source(variant: string, bag?: Readonly<Record<string, unknown>>): Promise<StageTextureData | null> {
    if (variant === ANALYSIS_VARIANT) return null;
    let table = this.sources.get(variant);
    if (!table) {
      const text = bag?.[qualified(SOURCE_HIST_KEY)];
      if (typeof text !== "string" || tableVariant(text) !== variant) return null;
      table = decodeTableText(text) ?? undefined;
      if (!table) return null;
      this.sources.set(variant, table);
    }
    return this.texture(table);
  }

  async target(photoId: string): Promise<StageTextureData | null> {
    if (photoId === ANALYSIS_VARIANT) return null;
    const held = this.targets.get(photoId);
    if (held) return this.texture(held);
    const bytes = await this.host.develop.getPhotoData(THIST_DATA, photoId);
    // A match while the read was out wins over what was stored before it.
    const table = this.targets.get(photoId) ?? (bytes ? decodeTable(bytes) : null);
    if (!table) return null;
    this.targets.set(photoId, table);
    return this.texture(table);
  }
}
