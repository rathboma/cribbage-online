# Card art credits

## Card faces (`AC.svg` … `TS.svg`, `JC.png` … `KS.png`)

Artwork by [Byron Knoll](http://www.byronknoll.com/), released into the public
domain as [vector-playing-cards](https://code.google.com/archive/p/vector-playing-cards/).
Taken from the SVG collection maintained at
[notpeter/Vector-Playing-Cards](https://github.com/notpeter/Vector-Playing-Cards)
(commit `861b338`), which states:

> These images, scripts and their output (for example, custom-sized PNGs) are
> released into the public domain, or optionally licensed under the WTFPL in
> jurisdictions where the public domain is not a recognized legal concept.

Changes made here, all by `yarn cards:optimize` (`scripts/optimize-cards.ts`,
whose header lists them too):

- Files renamed to the engine's card ids (`10H.svg` → `TH.svg`); the jokers are
  left out.
- The corner indices (rank letters and numbers), live text in Arial or
  Bitstream Vera Sans upstream, are replaced by the same characters drawn as
  outlines in Arimo, which has Arial's metrics, so they look the same on every
  device. The size is unitless instead of in `pt`.
- Aces and number cards: optimised with [svgo](https://github.com/svg/svgo)
  (editor metadata, comments and unused ids removed, coordinates rounded to 3
  decimal places, paths and transforms rewritten more compactly). They look the
  same.
- Court cards (J, Q, K): drawn at 500 × 726 px and saved as 256-colour PNGs
  (dithered), because the traced artwork is too large to download as SVG.

## Corner index font

The corner outlines come from [Arimo](https://github.com/googlefonts/arimo) by
Steve Matteson, licensed under the
[SIL Open Font License 1.1](https://openfontlicense.org) (taken from the
`@fontsource/arimo` package). Only the outlines of a few glyphs are used, as
artwork; no font file is shipped.

## Card back (`back.svg`)

Original artwork made for this project.
