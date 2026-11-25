# Colour Mapping for Safelight

A [Safelight](https://github.com/anthonyreimche/SafeLight) extension that ports
[**darktable**](https://www.darktable.org/)'s *color mapping* module. It moves
one photo's colour palette and its spread of tones onto another: pick a photo
whose colours you like as the colour source, then match other photos to it. The
method follows Reinhard et al., "Color transfer between images" (2001).

Needs Safelight 3.2.8 or later.

## How to use it

1. Open the photo whose colours you want in Develop and press **Use as
   source**. Safelight remembers it as the colour source for every photo, in
   every window, until you set another.
2. Open a photo you want to change and press **Match to source**. The photo is
   analysed and the transfer switches on, as one undo step.
3. To match many photos at once, select them in the Library, right-click and
   choose **Match to colour source**.

The source travels with each matched photo's edit, so Copy and Paste
Settings, presets and exports carry it. A pasted or preset source has no
effect on a photo until that photo is matched, since the photo's own colours
have to be analysed first.

## The controls

- **Enabled**: the transfer's switch. Match to source switches it on.
- **Source clusters** and **Target clusters**: each cluster of colours the
  analysis found, drawn as a 3 × 3 block: the cluster's average colour in the
  centre, and its spread in each direction around it. Before a photo is
  matched, the source strip shows the colour source.
- **Use as source**: analyse this photo as the colour source.
- **Match to source**: analyse this photo and match it to the colour source.
  Hover it to see which photo that is.
- **Clusters** (1 to 5, default 3): how many clusters of colour to find.
  Changing it clears this photo's source and target and switches the transfer
  off; use it before Use as source.
- **Colour dominance** (0 % to 100 %, default 100 %): how clusters pair up.
  Low values pair the nearest colours, high values pair clusters that cover a
  similar share of their photo.
- **Histogram equalisation** (0 % to 100 %, default 50 %): how much of the
  source's spread of tones the photo takes on.

Colour Mapping works after the tone mapping, on the image as it looks, so set
the tone of both photos first. It can't be used inside masks.

## Licence and credit

GPL-3.0-or-later. The maths is a port of darktable's color mapping module
(colormapping.c, Copyright (C) 2013-2026 darktable developers) and its
bilateral grid (bilateral.c, Copyright (C) 2016-2026, and bilateral.h,
Copyright (C) 2012-2023, darktable developers), GPL-3.0-or-later. The
bilateral pass is adapted from Safelight's Local Contrast extension.
docs/SPEC.md has the port notes.

## Development

```
npm run check       # typecheck, build, unit tests
npm run test:gpu    # the stage on the real renderer, in a SafeLight checkout
npm run reference   # rebuild test/reference/vectors.json (needs gcc)
npm run update-types
```
