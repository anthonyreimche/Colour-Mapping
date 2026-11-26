// The panel, in the order of the module it ports: the switch, the source's
// and the target's clusters as darktable draws them, the two buttons, then
// Clusters, Colour dominance and Histogram equalisation. A drag writes live and
// commits on release, so one gesture is one undo step; the switch commits at
// once. Moving dominance or equalisation switches the transfer on, as darktable
// does when a module's parameter changes; a new cluster count clears both
// sides and switches it off, as darktable's does.

import { labToCss } from "./lab";
import { DEFAULT_SETTINGS, RANGES, type Clusters, type NumericSetting } from "./model";
import { LABELS, TITLE, clustersPatch, readEdit, resetPatch, settingsPatch, type Edit } from "./params";
import { React, api } from "./rt";
import { store } from "./store";
import { matchToReference, matchToSource, setAsSource } from "./workflow";

const TIPS: Readonly<Record<"on" | NumericSetting, string>> = {
  on: "Switch the colour transfer on or off",
  clusters: "Number of clusters to find in the photo. Changing it resets all clusters",
  dominance: "How clusters are mapped, in percent. Low values: based on colour proximity, high values: based on colour dominance",
  equalization: "Level of histogram equalisation, in percent",
};

const SOURCE_TIP = "The colour source's clusters: each block is one cluster, its average colour in the centre and its spread around it";
const TARGET_TIP = "This photo's clusters, as the last match found them";

/** The lightness darktable draws the clusters at. */
const SWATCH_L = 53.390011;

/** A cluster strip as darktable draws it: a 3 × 3 block per cluster, the
 *  mean in the centre and one standard deviation of a* across, of b* down. */
export function Swatches({ clusters, n, title }: { clusters: Clusters; n: number; title: string }) {
  const { tokens } = api.ui;
  const blocks = [];
  for (let k = 0; k < n; k++) {
    const cells = [];
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const a = clusters.mean[2 * k] + i * clusters.sd[2 * k];
        const b = clusters.mean[2 * k + 1] + j * clusters.sd[2 * k + 1];
        cells.push(<div key={`${i},${j}`} data-swatch="" style={{ background: labToCss([SWATCH_L, a, b]) }} />);
      }
    }
    blocks.push(
      <div key={k} style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(3, 1fr)", gap: 1 }}>
        {cells}
      </div>,
    );
  }
  return (
    <div title={title} style={{ display: "flex", gap: 2, padding: 4, aspectRatio: "3 / 1", background: tokens.surface2, borderRadius: 4 }}>
      {blocks}
    </div>
  );
}

const develop = () => api.stores.useDevelopStore.getState();

function write(next: Edit, keys: readonly ("on" | NumericSetting)[]): void {
  develop().setDynParams(settingsPatch(next, keys));
}

const commit = (what: string) => void develop().commitEdit(`${TITLE}: ${what}`);

export function ColourMappingPanel() {
  const { Slider } = api.components;
  const { Button, Field, Row, Stack, Toggle } = api.ui;
  const bag = api.stores.useDevelopStore((s) => s.paramBag);
  const photoId = api.stores.useDevelopStore((s) => s.photoId);
  const source = store()((s) => s.source);
  const busy = store()((s) => s.busy);
  const reference = store()((s) => s.reference);
  const e = readEdit(bag);
  const matched = e.source.weight.some((w) => w > 0);

  const slider = (key: NumericSetting, onChange: (v: number) => void) => {
    const range = RANGES[key];
    return (
      <div key={key} title={TIPS[key]}>
        <Slider
          label={LABELS[key]}
          value={e[key]}
          min={range.min}
          max={range.max}
          step={range.step}
          defaultValue={DEFAULT_SETTINGS[key]}
          onChange={onChange}
          onCommit={() => commit(LABELS[key].toLowerCase())}
        />
      </div>
    );
  };

  const setting = (key: "dominance" | "equalization") => (v: number) => {
    const now = readEdit(develop().paramBag);
    write({ ...now, [key]: Math.min(Math.max(v, RANGES[key].min), RANGES[key].max), on: true }, [key, "on"]);
  };

  const setClusters = (v: number) => {
    const n = Math.min(Math.max(Math.round(v), RANGES.clusters.min), RANGES.clusters.max);
    if (n !== readEdit(develop().paramBag).clusters) develop().setDynParams(clustersPatch(n));
  };

  const matchTip = source ? `Analyse this photo and match its colours to ${source.name}` : "Use a photo as the colour source first";

  return (
    <Stack gap={6} style={{ padding: 8 }}>
      <div title={TIPS.on}>
        <Toggle
          checked={e.on}
          label={LABELS.on}
          onChange={(checked) => {
            write({ ...readEdit(develop().paramBag), on: checked }, ["on"]);
            commit(checked ? "on" : "off");
          }}
        />
      </div>
      <Field label="Source clusters">
        <Swatches clusters={matched || !source ? e.source : source.clusters} n={matched || !source ? e.clusters : source.n} title={SOURCE_TIP} />
      </Field>
      <Field label="Target clusters">
        <Swatches clusters={e.target} n={e.clusters} title={TARGET_TIP} />
      </Field>
      <Row gap={6}>
        <Button
          size="sm"
          full
          disabled={!photoId || busy !== null}
          title="Analyse this photo as the colour source"
          onClick={() => void setAsSource()}
        >
          {busy === "source" ? "Analysing…" : "Use as source"}
        </Button>
        <Button size="sm" full disabled={!photoId || !source || busy !== null} title={matchTip} onClick={() => void matchToSource()}>
          {busy === "match" ? "Analysing…" : "Match to source"}
        </Button>
      </Row>
      {reference && photoId && reference.photoId !== photoId && (
        <Button
          size="sm"
          full
          disabled={busy !== null}
          title={`Use ${reference.name} as the colour source and match this photo to it`}
          onClick={() => void matchToReference()}
        >
          Match to reference
        </Button>
      )}
      {slider("clusters", setClusters)}
      {slider("dominance", setting("dominance"))}
      {slider("equalization", setting("equalization"))}
    </Stack>
  );
}

/** The panel header's reset: the defaults, nothing analysed, off. */
export function resetColourMapping(): void {
  develop().setDynParams(resetPatch());
  commit("reset");
}
