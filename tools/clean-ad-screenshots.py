"""Clean the ad-creative screenshots: trim baked-in background, crisp the edges.

Usage:
    python tools/clean-ad-screenshots.py [--dry-run]

The captures in assets/source/ were cropped from a dark page, so each one
carries a strip of that navy background down one side -- 4px on ad4, 11px on
ad3. On a light card that strip reads as a dirty, mis-cropped edge, and it
throws the creative off-centre inside its frame.

For each image this:
  1. trims whole rows/columns that are page background rather than creative,
  2. shaves the 1px anti-aliased fringe left where the crop cut through a pixel,
  3. applies a light unsharp mask, because the browser downscales these to
     ~270px and a touch of sharpening keeps the ad's own text legible,

then writes the result to assets/. Nothing inside the creative is cropped: only
background that was never part of the ad is removed.
"""
import sys
import os
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(HERE, "assets", "source")
OUT_DIR = os.path.join(HERE, "assets")
NAMES = ["ad1.png", "ad2.png", "ad3.png", "ad4.png"]

# The hero photo is a 953px-wide, 1 MB capture rendered at ~270px. Letting the
# browser downscale that far softens it, and the photo already has out-of-focus
# edges. Resampling once, properly, to 2x its display size is sharper on screen
# and a fraction of the bytes.
PHOTOS = {"hero-phone.png": 640}

# The page background these were captured on: very dark, blue-leaning.
def is_background(pixel):
    r, g, b = pixel
    return max(r, g, b) < 55 and b >= r and b >= g


def trim_background(im):
    """Drop edge rows/columns that are overwhelmingly page background."""
    px = im.load()
    w, h = im.size

    def col_bg(x):
        ys = range(0, h, 2)
        return sum(1 for y in ys if is_background(px[x, y])) / len(list(ys))

    def row_bg(y):
        xs = range(0, w, 2)
        return sum(1 for x in xs if is_background(px[x, y])) / len(list(xs))

    left = right = top = bottom = 0
    while left < w and col_bg(left) > 0.7:
        left += 1
    while right < w - left and col_bg(w - 1 - right) > 0.7:
        right += 1
    while top < h and row_bg(top) > 0.7:
        top += 1
    while bottom < h - top and row_bg(h - 1 - bottom) > 0.7:
        bottom += 1

    # Shave one more pixel per trimmed edge: the crop that produced these cut
    # through a pixel, leaving a half-dark anti-aliased line behind the strip.
    left += 1 if left else 0
    right += 1 if right else 0
    top += 1 if top else 0
    bottom += 1 if bottom else 0

    box = (left, top, w - right, h - bottom)
    return im.crop(box), (left, right, top, bottom)


def main():
    dry = "--dry-run" in sys.argv
    if not os.path.isdir(SRC_DIR):
        print("No assets/source/ -- put the raw captures there first.")
        return 1

    for name in NAMES:
        src = os.path.join(SRC_DIR, name)
        if not os.path.exists(src):
            print("  missing " + name)
            continue
        im = Image.open(src).convert("RGB")
        before = im.size
        im, (l, r, t, b) = trim_background(im)
        # Light unsharp: these render at roughly 0.75x, and downscaling softens
        # the ad's small type. Kept gentle -- enough to define edges, not enough
        # to ring them.
        im = im.filter(ImageFilter.UnsharpMask(radius=0.8, percent=55, threshold=3))
        print("  %-8s %dx%d -> %dx%d   trimmed L%d R%d T%d B%d"
              % (name, before[0], before[1], im.size[0], im.size[1], l, r, t, b))
        if not dry:
            im.save(os.path.join(OUT_DIR, name), optimize=True)

    for name, target in PHOTOS.items():
        src = os.path.join(SRC_DIR, name)
        if not os.path.exists(src):
            print("  missing " + name)
            continue
        im = Image.open(src).convert("RGB")
        before, before_kb = im.size, os.path.getsize(src) / 1024
        if im.width > target:
            im = im.resize((target, round(im.height * target / im.width)), Image.LANCZOS)
        im = im.filter(ImageFilter.UnsharpMask(radius=1.0, percent=70, threshold=2))
        out = os.path.join(OUT_DIR, name)
        after_kb = before_kb
        if not dry:
            im.save(out, optimize=True)
            after_kb = os.path.getsize(out) / 1024
        print("  %-8s %dx%d -> %dx%d   %.0f KB -> %.0f KB"
              % (name, before[0], before[1], im.size[0], im.size[1], before_kb, after_kb))

    print("\ndry run, nothing written" if dry else "\nwrote cleaned creatives to assets/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
