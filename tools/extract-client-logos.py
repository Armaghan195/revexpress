"""Slice the client logo sheet into clean, transparent per-brand PNGs.

Usage:
    python tools/extract-client-logos.py <logo-sheet.png> [--colour]

The sheet is the Revenue Express deck slide: a grid of white cards, one brand
logo per card, on a white field. The cards have no fill of their own -- only a
hairline border -- so the grid is found by projecting *ink* (non-white pixels)
onto each axis and reading off the gutters between the bands.

For each cell the white background is keyed out to alpha, the mark is trimmed
to its ink and padded, then written to assets/clients/<slug>.png.

    (default)  white silhouette: alpha carries the ink coverage, RGB is white.
               This is what the dark logo wall needs -- every mark reads at the
               same weight, and dark wordmarks (Whyte, Stein Mart, JAXXON,
               sugar baby, PWR) stay visible instead of vanishing into the page.
    --colour   keep the original brand colours with a transparent background.

The deck's orange/blue corner wedge is avoided by projecting each axis over a
region it cannot reach, so it never bleeds into the right-hand column.
"""
import sys
import os
import re
from PIL import Image

# Grid order, left to right then top to bottom. None = extract but do not name
# (an unidentified mark, or a duplicate of one already in the wall).
NAMES = [
    "Alpha Gear", "The Health Institute", "Pudgy Penguins", "Whyte", "Diesel Patriots",
    "Snow", "Vitamin Energy", "WonderMe", "RadioShack", "Dressbarn",
    "Stein Mart", "Modell's Sporting Goods", "The Wolf of Wall Street", "Tai Lopez", "Primitive",
    "The Franklin Mint", "Cookies", "JaxxonCo", "Beauty By Earth", "FlexPro Meals",
    None, "Skyeen", "Lumen Peptides", "Sugar Baby Skincare", "Millionaire Mutt",
    "Body Candy", "PWR", "Loyal Origins", None,
]

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(HERE, "assets", "clients")

INK = 235        # below this luminance counts as ink rather than card/background
PAD = 6          # transparent padding kept around the trimmed mark
BLEED = 4        # pixels added around a detected cell before keying
# The wall renders marks at most 34px tall, so 80px covers 2x displays with
# room to spare. Anything larger is bytes the visitor downloads for nothing.
MAX_W, MAX_H = 300, 80


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def bands(profile, min_run, min_gap):
    """Collapse a boolean profile into runs, merging runs closer than min_gap.

    The merge is what holds a single logo together: the gap between two words
    of a wordmark is small, while the gutter between two cards is large.
    """
    runs, start = [], None
    for i, on in enumerate(profile):
        if on and start is None:
            start = i
        elif not on and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, len(profile)))

    merged = []
    for run in runs:
        if merged and run[0] - merged[-1][1] < min_gap:
            merged[-1] = (merged[-1][0], run[1])
        else:
            merged.append(run)
    return [b for b in merged if b[1] - b[0] >= min_run]


def detect_grid(im):
    """Find card rows and columns, working around the deck's corner wedge.

    The wedge is a saturated graphic in the top-right. Rather than clipping it
    by colour -- which cut into the right-hand column's logos -- each axis is
    projected over a region the wedge cannot reach: columns over the lower
    rows, rows over everything left of the last column.
    """
    g = im.convert("L")
    w, h = g.size
    px = g.load()

    lower = int(h * 0.52)
    cols = bands([any(px[x, y] < INK for y in range(lower, h, 2)) for x in range(w)],
                 min_run=int(w * 0.02), min_gap=int(w * 0.02))
    safe = cols[-2][1] if len(cols) >= 2 else w
    rows = bands([any(px[x, y] < INK for x in range(0, safe, 2)) for y in range(h)],
                 min_run=int(h * 0.02), min_gap=int(h * 0.02))
    return rows, cols, w


def key_out(cell, mono):
    """Turn the white card background into alpha.

    Alpha is how far the pixel sits from white, so anti-aliased edges fade
    smoothly and knockout areas inside a mark stay transparent.
    """
    cell = cell.convert("RGB")
    out = Image.new("RGBA", cell.size)
    src, dst = cell.load(), out.load()
    W, H = cell.size
    for y in range(H):
        for x in range(W):
            r, g, b = src[x, y]
            ink = 255 - max(r, g, b)              # dark marks
            chroma = max(r, g, b) - min(r, g, b)  # saturated but light marks
            a = max(ink, chroma)
            if a <= 8:                            # sheet noise / JPEG ringing
                dst[x, y] = (0, 0, 0, 0)
            else:
                a = min(255, int(a * 1.3))
                dst[x, y] = (255, 255, 255, a) if mono else (r, g, b, a)
    return out


def normalise(img):
    """Lift each mark so its densest ink reaches full opacity.

    Pale logos (Beauty By Earth's light green, Skyeen's taupe, FlexPro's lime)
    sit close to white, so raw distance-from-white leaves them ghostly. Scaling
    by the mark's own 98th percentile makes every logo carry the same weight --
    the entire point of a monochrome wall -- while marks that already contain
    solid black are left essentially untouched.
    """
    alpha = img.split()[3]
    hist = alpha.histogram()
    total = sum(hist[1:])
    if not total:
        return img
    running, peak = 0, 255
    for value in range(1, 256):
        running += hist[value]
        if running >= total * 0.90:
            peak = value
            break
    peak = max(peak, 24)
    scale = min(255.0 / peak, 4.0)
    # Gamma < 1 thickens the thin, anti-aliased strokes of hairline wordmarks
    # (Beauty By Earth, The Health Institute) so they hold their own next to
    # heavy marks like MODELL'S without turning into blobs.
    img.putalpha(alpha.point(
        lambda v: 0 if v == 0 else min(255, int(255 * ((min(1.0, v * scale / 255.0)) ** 0.75)))))
    return img


def trim(img):
    box = img.split()[3].getbbox()
    if not box:
        return None
    img = img.crop(box)
    out = Image.new("RGBA", (img.width + PAD * 2, img.height + PAD * 2), (0, 0, 0, 0))
    out.paste(img, (PAD, PAD), img)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    mono = "--colour" not in sys.argv
    if not args or not os.path.exists(args[0]):
        print(__doc__)
        return 1

    im = Image.open(args[0])
    rows, cols, right = detect_grid(im)
    print("sheet %dx%d, grid %d rows x %d cols"
          % (im.size[0], im.size[1], len(rows), len(cols)))
    if len(rows) * len(cols) < len(NAMES):
        print("!! grid too small for %d names -- check the sheet" % len(NAMES))
        return 1

    os.makedirs(OUT_DIR, exist_ok=True)
    written, skipped = 0, []
    n = 0
    for (y0, y1) in rows:
        for (x0, x1) in cols:
            if n >= len(NAMES):
                break
            name = NAMES[n]
            n += 1
            if name is None:
                continue
            cell = im.crop((max(0, x0 - BLEED), max(0, y0 - BLEED),
                            min(right, x1 + BLEED), min(im.size[1], y1 + BLEED)))
            logo = trim(normalise(key_out(cell, mono)))
            if logo is None:
                skipped.append(name)
                continue
            logo.thumbnail((MAX_W, MAX_H), Image.LANCZOS)
            path = os.path.join(OUT_DIR, slug(name) + ".png")
            # A white silhouette carries no colour information, so store it as
            # greyscale+alpha rather than RGBA: same pixels, roughly half the
            # channels, and it compresses considerably better.
            logo.convert("LA" if mono else "RGBA").save(path, optimize=True)
            written += 1
            print("  %-26s %-9s %s" % (name, "%dx%d" % logo.size, os.path.basename(path)))

    if skipped:
        print("  empty cells: " + ", ".join(skipped))
    print("\nwrote %d logos to %s" % (written, OUT_DIR))
    return 0


if __name__ == "__main__":
    sys.exit(main())
