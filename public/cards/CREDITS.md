# Card art credits

## Card faces (`AC.svg` … `KS.svg`)

Artwork by [Byron Knoll](http://www.byronknoll.com/), released into the public
domain as [vector-playing-cards](https://code.google.com/archive/p/vector-playing-cards/).
Taken from the SVG collection maintained at
[notpeter/Vector-Playing-Cards](https://github.com/notpeter/Vector-Playing-Cards)
(commit `861b338`), which states:

> These images, scripts and their output (for example, custom-sized PNGs) are
> released into the public domain, or optionally licensed under the WTFPL in
> jurisdictions where the public domain is not a recognized legal concept.

Changes made here, by `scripts/optimize-card-svgs.py`: editor metadata removed,
path coordinates rounded to 2 decimal places and other geometry to 4, a
`sans-serif` fallback added to the corner-index fonts, files renamed to the
engine's card ids (`10H.svg` → `TH.svg`), and the jokers left out. The script's
docstring lists every change.

## Card back (`back.svg`)

Original artwork made for this project.
