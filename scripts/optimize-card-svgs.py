"""Shrink the vendored card SVGs without changing how they look.

Usage: python3 scripts/optimize-card-svgs.py <source-dir> <output-dir>

The source is the `cards-svg` folder of
https://github.com/notpeter/Vector-Playing-Cards (public domain artwork by
Byron Knoll). The upstream files carry Inkscape/Sodipodi metadata and
coordinates with six or more decimal places, which makes the face cards
around 1 MB each. This script:

- drops the XML prolog, comments, <metadata> and editor-only elements
- drops inkscape:/sodipodi: attributes and their namespace declarations
- rounds path data (`d` and `points`) to 2 decimal places, and numbers in
  geometry attributes (transforms, gradients, positions, sizes, numeric style
  values) to 4 places so scales stay exact; ids and text are not touched
- drops `-inkscape-font-specification` and gives the corner indices a font
  stack that ends in `sans-serif` instead of a bare `Arial`
- swaps the `pt` width/height for unitless values so the SVG scales to
  whatever box it is placed in
- collapses whitespace between tags

Files are saved under the engine's `CardId` (rank then suit, ten as "T"), so
`10H.svg` becomes `TH.svg`. Jokers are skipped: cribbage does not use them.
"""

import re
import sys
from pathlib import Path

NUM = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")

# Attributes whose numbers are rounded to 4 places. Ids, text and anything else are left alone.
NUMERIC_ATTRS = (
    "transform|gradientTransform|patternTransform|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|fx|fy"
    "|width|height|viewBox|offset|style|stroke-width|font-size"
)

# Rank and suit indices are live <text>. Upstream asks only for Arial (or Bitstream Vera
# Sans); list Arial's metric-compatible stand-ins and a generic family so the corner
# "10" keeps its spacing on devices without Arial instead of dropping to a serif.
FONT_STACK = "Arial,Helvetica,Arimo,'Liberation Sans',sans-serif"


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


def round_list(text: str, places: int) -> str:
    """Rounds every number in a path/list/transform, keeping command letters.

    Numbers are re-joined with explicit separators, so compact input such as
    "1.004-.001" or "1.004.5" can never merge into one number after rounding.
    """
    out = []
    pos = 0
    for m in NUM.finditer(text):
        between = text[pos : m.start()]
        if between.strip(" ,\t\n"):
            out.append(between.strip(" ,\t\n"))
        out.append(fmt(float(m.group(0)), places))
        pos = m.end()
    tail = text[pos:].strip(" ,\t\n")
    if tail:
        out.append(tail)
    joined = " ".join(out)
    # Tidy spaces next to letters/brackets: "M 1 2 c 3 4" -> "M1 2c3 4"
    joined = re.sub(r"\s*([A-Za-z(),;:])\s*", r"\1", joined)
    # A space before a minus sign is redundant: "1 -2" -> "1-2"
    return joined.replace(" -", "-")


def round_style(text: str, places: int) -> str:
    # Only "property:number" values, so colours (#000000) and names stay intact.
    return re.sub(
        r"(:\s*)(-?(?:\d+\.?\d*|\.\d+))(?=[a-z%]*\s*(?:;|$))",
        lambda m: m.group(1) + fmt(float(m.group(2)), places),
        text,
    )


def optimize(svg: str) -> str:
    svg = re.sub(r"<\?xml[^>]*\?>", "", svg)
    svg = re.sub(r"<!--.*?-->", "", svg, flags=re.S)
    svg = re.sub(r"<metadata\b.*?</metadata>", "", svg, flags=re.S)
    svg = re.sub(r"<sodipodi:[^>]*?/>", "", svg, flags=re.S)
    svg = re.sub(r"<sodipodi:(\w+)\b.*?</sodipodi:\1>", "", svg, flags=re.S)
    svg = re.sub(r"<inkscape:[^>]*?/>", "", svg, flags=re.S)
    svg = re.sub(r'\s(?:inkscape|sodipodi):[\w-]+="[^"]*"', "", svg)
    svg = re.sub(r'\sxmlns:(?:inkscape|sodipodi|dc|cc|rdf|svg)="[^"]*"', "", svg)
    svg = re.sub(r";?-inkscape-font-specification:[^;\"]*", "", svg)
    svg = re.sub(r"font-family:(?:Arial|Bitstream Vera Sans)(?=[;\"])", "font-family:" + FONT_STACK, svg)
    svg = re.sub(r'(\s(?:width|height)="[\d.]+)pt"', r'\1"', svg)

    def attr(m: re.Match) -> str:
        name, value = m.group(1), m.group(2)
        if name in ("d", "points"):
            value = round_list(value, 2)
        elif name == "style":
            value = round_style(value, 4)
        else:
            value = round_list(value, 4)
        return f' {name}="{value}"'

    svg = re.sub(rf'\s(d|points|{NUMERIC_ATTRS})="([^"]*)"', attr, svg)
    # Whitespace between tags only; text content keeps its spaces.
    svg = re.sub(r">\s+<", "><", svg)
    svg = re.sub(r"\n\s*", " ", svg)
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
