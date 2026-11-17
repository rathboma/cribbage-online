"""Shrink the vendored card SVGs without changing how they look.

Usage: python3 scripts/optimize-card-svgs.py <source-dir> <output-dir>

The source is the `cards-svg` folder of
https://github.com/notpeter/Vector-Playing-Cards (public domain artwork by
Byron Knoll). The upstream files carry Inkscape/Sodipodi metadata and
coordinates with six or more decimal places, which makes the face cards
around 1 MB each. This script:

- drops the XML prolog, comments, <metadata> and editor-only elements
- drops inkscape:/sodipodi: attributes and their namespace declarations
- rounds path data (`d` and `points`) to 2 decimal places, and every other
  number (transforms, gradients, sizes) to 4 places so scales stay exact
- swaps the `pt` width/height for unitless values so the SVG scales to
  whatever box it is placed in
- collapses whitespace

Files are saved under the engine's `CardId` (rank then suit, ten as "T"), so
`10H.svg` becomes `TH.svg`. Jokers are skipped: cribbage does not use them.
"""

import re
import sys
from pathlib import Path

NUM = re.compile(r"-?\d*\.\d+(?:[eE][-+]?\d+)?")


def rounder(places: int):
    def round_num(match: re.Match) -> str:
        return fmt(float(match.group(0)), places)

    return round_num


def fmt(value: float, places: int) -> str:
    value = round(value, places)
    if value == 0:
        return "0"
    out = f"{value:.{places}f}".rstrip("0").rstrip(".")
    # "0.5" -> ".5", "-0.5" -> "-.5": valid in SVG and shorter
    if out.startswith("0."):
        out = out[1:]
    elif out.startswith("-0."):
        out = "-" + out[2:]
    return out


def optimize(svg: str) -> str:
    svg = re.sub(r"<\?xml[^>]*\?>", "", svg)
    svg = re.sub(r"<!--.*?-->", "", svg, flags=re.S)
    svg = re.sub(r"<metadata\b.*?</metadata>", "", svg, flags=re.S)
    svg = re.sub(r"<sodipodi:[^>]*?/>", "", svg, flags=re.S)
    svg = re.sub(r"<sodipodi:(\w+)\b.*?</sodipodi:\1>", "", svg, flags=re.S)
    svg = re.sub(r"<inkscape:[^>]*?/>", "", svg, flags=re.S)
    svg = re.sub(r'\s(?:inkscape|sodipodi):[\w-]+="[^"]*"', "", svg)
    svg = re.sub(r'\sxmlns:(?:inkscape|sodipodi|dc|cc|rdf|svg)="[^"]*"', "", svg)
    svg = re.sub(r'\sxml:space="[^"]*"', "", svg)
    svg = re.sub(r'(\s(?:width|height)="[\d.]+)pt"', r'\1"', svg)
    svg = re.sub(
        r'(\s(?:d|points)=")([^"]*)"',
        lambda m: m.group(1) + NUM.sub(rounder(2), m.group(2)) + '"',
        svg,
    )
    svg = NUM.sub(rounder(4), svg)
    svg = re.sub(r"\s+", " ", svg)
    svg = re.sub(r">\s+<", "><", svg)
    return svg.strip() + "\n"


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    dst.mkdir(parents=True, exist_ok=True)
    before = after = 0
    for path in sorted(src.glob("*.svg")):
        if path.name.startswith("Joker"):
            continue
        raw = path.read_text(encoding="utf-8")
        out = optimize(raw)
        name = "T" + path.name[2:] if path.name.startswith("10") else path.name
        (dst / name).write_text(out, encoding="utf-8")
        before += len(raw.encode())
        after += len(out.encode())
    print(f"{before / 1e6:.2f} MB -> {after / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
