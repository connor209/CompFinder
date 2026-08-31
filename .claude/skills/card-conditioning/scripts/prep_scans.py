#!/usr/bin/env python3
"""
Comp Finder — prepare CardUploader scans for conditioning.

Conditioning a batch by eye is slow because the pixel work happens inside the
model's loop: fetch two images, straighten them, crop four corners, look at all
of it, move to the next card. A hundred cards is four hundred images and a
hundred round trips, and almost all of it is spent confirming that a clean card
is clean.

This script does the pixel work locally, in seconds, and hands back a TRIAGE:
every card gets its scans straightened, cropped and written to disk, plus a
numeric wear score read off the back border. Only the cards the score can't
settle need looking at.

Two things it encodes that cost an afternoon to find:

**Scans are not square.** Cards sit 0.3-0.6 degrees off in the sheet feeder.
Crop the bounding box and take its corners and you do not get the card's
corners — you get interior artwork, and it looks plausible enough to grade
from. Everything here runs after a deskew.

**Contrast enhancement manufactures wear.** Auto-contrast on the navy back
border turns JPEG noise into speckle indistinguishable from whitening. The
crops written here are straightened and magnified but NOT enhanced, and the
score is computed against each card's own border median rather than a fixed
level, so a darker scan doesn't read as a cleaner card.

The score is BACK-ONLY and it is deliberately not a grade. A Pokemon back is
the one surface where wear is measurable without knowing the card: the border
is a known colour in a known place, so whitening is bright pixels on dark
ground. Fronts vary by card, and nothing here tries to read them.

Usage:
    python3 scripts/conditioning/prep_scans.py <carduploader.csv> --out DIR
    python3 scripts/conditioning/prep_scans.py <csv> --out DIR --limit 10
    python3 scripts/conditioning/prep_scans.py <csv> --out DIR --refresh

Needs pillow and numpy — a local pre-processor, never imported by either app
and never on a request path, which is why a Python dependency is acceptable
here and would not be in packages/core.
"""

import argparse
import csv
import io
import math
import os
import sys
import urllib.request
from collections import defaultdict

try:
    import numpy as np
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("Needs pillow and numpy:  pip install pillow numpy")

# ---------------------------------------------------------------- constants

SKU_COL = "CustomLabel"
TITLE_COL = "*Title"
PIC_COL = "PicURL"

#: Card-vs-background is decided on the VALUE channel — max(R,G,B) — never on
#: luminance. A Pokemon back's navy border measures R0 G0 B47: luminance 5,
#: because blue carries 11% of it, against a scanner bed of 0. By brightness
#: the border and the bed are the same thing, so a luminance mask finds the
#: card's bright INTERIOR and reports the artwork as the border. Value
#: separates them cleanly (0 against 47) and works on a yellow front too.
INK_THRESHOLD = 20

#: Every card is resampled to this before scoring, so one set of thresholds
#: holds across scans that framed the card slightly differently.
CARD_W, CARD_H = 700, 980

#: The outermost pixels catch scanner light on EVERY card, worn or not, so the
#: measured band starts inside them. Beyond ~18px in you are off the border and
#: onto the artwork.
BAND_INNER, BAND_OUTER = 4, 18

#: A pixel counts as whitening if its value exceeds the card's own border
#: median by this much. Relative, so a darker scan does not read as a cleaner
#: card. The border is a tight distribution — median 50, 99th percentile 59 —
#: so +30 is already well clear of clean navy.
BRIGHT_DELTA = 30

#: Corner squares are measured separately from edges: the rubric counts corner
#: nicks, and a corner is where a card is handled.
CORNER_BOX = 90

#: How deep an edge strip is cut for the edge sheet. A little thicker than the
#: measured band so there is some card either side of the whitening to judge it
#: against — a strip cropped exactly to the band gives nothing to compare with.
EDGE_STRIP = 26

#: WotC-era sets, where a modern swirl back means the scanner paired the wrong
#: two images. Not a wear check — a "look at this pair before listing" flag.
VINTAGE_SETS = {
    "base set", "base set 2", "jungle", "fossil", "team rocket",
    "gym heroes", "gym challenge", "neo genesis", "neo discovery",
    "neo revelation", "neo destiny", "legendary collection",
    "expedition", "aquapolis", "skyridge",
}

# ---------------------------------------------------------------- geometry


def _value(im):
    """max(R,G,B) per pixel — see INK_THRESHOLD for why not luminance."""
    return np.asarray(im.convert("RGB")).astype(int).max(axis=2)


def _mask(im):
    return _value(im) > INK_THRESHOLD


def _card_box(m):
    """
    The card's extent, found from how MUCH of each row and column is lit rather
    than from any single lit pixel. JPEG noise in the black margin clears the
    ink threshold on its own, so an any-pixel bounding box reaches well past
    the card — and then every measurement below is taken against background
    instead of the border. This was the bug that made a worn card score clean.
    """
    lit_cols = m.mean(axis=0) > 0.4
    lit_rows = m.mean(axis=1) > 0.4
    xs = np.where(lit_cols)[0]
    ys = np.where(lit_rows)[0]
    if not len(xs) or not len(ys):
        return None
    return int(xs[0]), int(ys[0]), int(xs[-1]), int(ys[-1])


def _left_edge(m, y, run=5):
    """First x where the card actually starts: a run of lit pixels, not one."""
    lit = m[y]
    idx = np.where(lit)[0]
    for x in idx:
        if x + run < len(lit) and lit[x:x + run].all():
            return int(x)
    return None


def _skew_degrees(m):
    """
    Angle of the card's left edge, from a line fit over the straight middle of
    it. The rounded corners are excluded (the top and bottom 18%) or they drag
    the fit toward zero — which is exactly the failure that makes a deskew look
    like it ran while leaving the corners unusable.
    """
    box = _card_box(m)
    if box is None:
        return 0.0
    _, y0, _, y1 = box
    height = y1 - y0
    if height < 100:
        return 0.0
    ys, xs = [], []
    for y in range(y0 + int(height * 0.18), y1 - int(height * 0.18)):
        x = _left_edge(m, y)
        if x is not None:
            ys.append(y)
            xs.append(x)
    if len(ys) < 20:
        return 0.0
    slope = np.polyfit(ys, xs, 1)[0]
    return math.degrees(math.atan(slope))


def straighten(im):
    """Deskew, crop to the card, and normalise the size. Returns (image, angle)."""
    angle = _skew_degrees(_mask(im))
    rotated = im.rotate(-angle, resample=Image.BICUBIC, expand=True, fillcolor=(0, 0, 0))
    box = _card_box(_mask(rotated))
    if box is None:
        return rotated.resize((CARD_W, CARD_H), Image.LANCZOS), angle
    x0, y0, x1, y1 = box
    card = rotated.crop((x0, y0, x1 + 1, y1 + 1))
    return card.resize((CARD_W, CARD_H), Image.LANCZOS), angle


# ---------------------------------------------------------------- scoring


def _band_mask():
    """A ring inside the card outline: the border, minus the lit outer edge."""
    ring = np.zeros((CARD_H, CARD_W), dtype=bool)
    ring[BAND_INNER:CARD_H - BAND_INNER, BAND_INNER:CARD_W - BAND_INNER] = True
    ring[BAND_OUTER:CARD_H - BAND_OUTER, BAND_OUTER:CARD_W - BAND_OUTER] = False
    return ring


BAND = _band_mask()


def score_back(card):
    """
    Bright-pixel fractions over the back border, as percentages.

    Measured against the card's OWN border median, so a dark scan and a light
    scan of the same card score the same. Returns edges, corners, and a total.
    """
    val = _value(card)
    base = float(np.median(val[BAND]))
    bright = (val > base + BRIGHT_DELTA) & BAND

    def pct(region):
        sel = BAND & region
        n = int(sel.sum())
        return round(100.0 * float((bright & region).sum()) / n, 2) if n else 0.0

    def rect(x0, y0, x1, y1):
        r = np.zeros_like(BAND)
        r[y0:y1, x0:x1] = True
        return r

    C = CORNER_BOX
    corners = {
        "tl": pct(rect(0, 0, C, C)),
        "tr": pct(rect(CARD_W - C, 0, CARD_W, C)),
        "bl": pct(rect(0, CARD_H - C, C, CARD_H)),
        "br": pct(rect(CARD_W - C, CARD_H - C, CARD_W, CARD_H)),
    }
    edges = {
        "top": pct(rect(C, 0, CARD_W - C, BAND_OUTER)),
        "bottom": pct(rect(C, CARD_H - BAND_OUTER, CARD_W - C, CARD_H)),
        "left": pct(rect(0, C, BAND_OUTER, CARD_H - C)),
        "right": pct(rect(CARD_W - BAND_OUTER, C, CARD_W, CARD_H - C)),
    }
    return {
        "base": round(base, 1),
        "corners": corners,
        "edges": edges,
        "total": round(pct(np.ones_like(BAND)), 2),
    }


#: Triage thresholds. These sort the batch; they do not grade it. Anything the
#: score cannot settle lands in "review" on purpose — the cost of a needless
#: look is seconds, and the cost of a wrong unattended NM is a return.
#:
#: **PROVISIONAL: six hand-graded cards, which is a sanity check, not a
#: measurement.** Those six are the conditioning guide's own calibration cards,
#: and on them the WORST CORNER orders the grades cleanly where the whole-card
#: total does not:
#:
#:     NM  002  worst corner 0.05   total 0.00
#:     LP  001               0.41         0.04
#:     LP  004               0.63         0.05
#:     LP  003               2.49         0.41
#:     MP  038               2.85         0.52
#:     MP  057               9.76         1.73
#:
#: That the corner reads better than the total is not a surprise — it is what
#: the rubric counts. But LP 003 at 2.49 and MP 038 at 2.85 sit next to each
#: other, so the upper edge is soft and the bands below are deliberately wide:
#: a card is only called clean when BOTH measures are near zero, and only
#: called worse when one is far out. Everything else is "review", which is the
#: right default when a wrong unattended NM costs a return and a needless look
#: costs seconds. Run --calibrate against a real spread of grades before
#: tightening either edge.
CLEAN_CORNER = 0.20
CLEAN_TOTAL = 0.02
WORSE_CORNER = 3.0
WORSE_TOTAL = 1.0


def triage(score):
    """
    Sort a card into clean / worse / needs-a-look. NOT a grade — see the
    thresholds above for how little evidence stands behind the edges.
    """
    worst_corner = max(score["corners"].values())
    if worst_corner > WORSE_CORNER or score["total"] > WORSE_TOTAL:
        return "likely-worse"
    if worst_corner < CLEAN_CORNER and score["total"] < CLEAN_TOTAL:
        return "likely-nm"
    return "review"


# ---------------------------------------------------------------- output


def corner_sheet(card, path, box=110, scale=6):
    """Four corner tips, magnified, unenhanced, labelled, in one image."""
    w, h = card.size
    spots = [("TL", 0, 0), ("TR", w - box, 0), ("BL", 0, h - box), ("BR", w - box, h - box)]
    side = box * scale
    sheet = Image.new("RGB", (side * 4 + 30, side), (255, 255, 255))
    for i, (name, x, y) in enumerate(spots):
        tile = card.crop((x, y, x + box, y + box)).resize((side, side), Image.LANCZOS)
        ImageDraw.Draw(tile).text((10, 10), name, fill=(255, 0, 0))
        sheet.paste(tile, (i * (side + 10), 0))
    sheet.save(path, quality=94)


def edge_sheet(card, path, along=1.9, across=6):
    """
    All four edges as flattened strips, outer edge of the card along the top of
    each.

    An edge cannot be shown the way a corner can. A corner is compact, so it
    magnifies whole; an edge is 700px long and 20px deep, and at any uniform
    magnification that fits on screen the whitening is a hairline. So the
    strips are stretched UNEVENLY — a little along their length, a lot across
    it. Nothing is lost by that: along the edge the information is positional
    (where the wear runs), across it there is only how far in the wear reaches.

    This is the view the guide's MP line actually needs. "Consistent
    full-perimeter back edge wear" is a judgement about the whole run of an
    edge at once, which no corner crop can show and no single number can
    settle.

    Every strip is oriented the same way — card edge at the top, interior
    below — and every strip is drawn to the same width, so the four read as one
    comparable set rather than four rotations at four scales that the eye has
    to correct for. The short edges are therefore at slightly more
    magnification than the long ones, which costs nothing: the question being
    asked of this sheet is whether wear runs the length of an edge, not how
    long the edge is.

    What it makes separable, which no number does: a continuous hairline along
    the very edge is the scanner catching the card, and appears on clean cards
    too. Wear is DISCRETE — distinct blobs with dark border between them. The
    guide's "do not describe scanner streaks as scratches" is checkable here
    rather than a matter of faith.
    """
    w, h = card.size
    C, T = CORNER_BOX, EDGE_STRIP
    strips = [
        ("TOP", card.crop((C, 0, w - C, T))),
        ("BOTTOM", card.crop((C, h - T, w - C, h)).transpose(Image.FLIP_TOP_BOTTOM)),
        ("LEFT", card.crop((0, C, T, h - C)).transpose(Image.ROTATE_270)),
        ("RIGHT", card.crop((w - T, C, w, h - C)).transpose(Image.ROTATE_90)),
    ]
    out_w = int(max(st.size[0] for _, st in strips) * along)
    out_h = int(T * across)
    sheet = Image.new("RGB", (out_w + 60, (out_h + 12) * 4), (255, 255, 255))
    for i, (name, strip) in enumerate(strips):
        tile = strip.resize((out_w, out_h), Image.LANCZOS)
        y = i * (out_h + 12)
        sheet.paste(tile, (60, y))
        ImageDraw.Draw(sheet).text((6, y + out_h // 2 - 4), name, fill=(200, 0, 0))
    sheet.save(path, quality=94)


def fetch(url, path, refresh=False):
    """Cached download. A scan that is already on disk is never re-fetched."""
    if os.path.exists(path) and not refresh:
        return open(path, "rb").read()
    data = urllib.request.urlopen(
        urllib.request.Request(url, headers={"User-Agent": "compfinder-prep"}),
        timeout=30,
    ).read()
    with open(path, "wb") as fh:
        fh.write(data)
    return data


# ---------------------------------------------------------------- main


def read_rows(csv_path):
    with open(csv_path, encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def duplicate_groups(rows):
    """
    Same title, same condition => interchangeable copies of one card. Grouped
    on the title because that is what a buyer sees and what the listing is;
    a copy joining an existing listing does not need a price of its own.
    """
    groups = defaultdict(list)
    for r in rows:
        groups[r.get(TITLE_COL, "").strip()].append(r.get(SKU_COL, ""))
    return {t: skus for t, skus in groups.items() if len(skus) > 1}


def report_calibration(rows, grades_path):
    """
    Print the measured score for each hand-graded card, grouped by grade.

    This is the whole point of --calibrate: the thresholds above are fitted to
    two cards and should not be trusted until a real spread of grades has been
    run through. What comes out here is the evidence for where the boundaries
    actually belong — and, just as usefully, whether the score separates the
    grades at all on a bigger sample than the one that suggested it.
    """
    with open(grades_path, encoding="utf-8-sig", newline="") as fh:
        graded = {r["sku"]: r["grade"].strip().upper()
                  for r in csv.DictReader(fh) if r.get("sku")}
    by_grade = defaultdict(list)
    for r in rows:
        g = graded.get(r["sku"])
        if g and isinstance(r.get("wear_total_pct"), float):
            by_grade[g].append((r["wear_total_pct"], max(
                r["corner_tl"], r["corner_tr"], r["corner_bl"], r["corner_br"]), r["sku"]))
    if not by_grade:
        print("\nno graded SKUs matched this run", file=sys.stderr)
        return
    print("\ncalibration — measured score by hand-assigned grade")
    for g in ("NM", "LP", "MP", "HP", "DMG"):
        vals = sorted(by_grade.get(g, []))
        if not vals:
            continue
        totals = [v[0] for v in vals]
        corners = [v[1] for v in vals]
        print(f"  {g:<4} n={len(vals):<4} total min {min(totals):.3f}  "
              f"median {totals[len(totals) // 2]:.3f}  max {max(totals):.3f}   "
              f"worst-corner median {sorted(corners)[len(corners) // 2]:.3f}")
    unknown = set(by_grade) - {"NM", "LP", "MP", "HP", "DMG"}
    for g in sorted(unknown):
        print(f"  {g:<4} n={len(by_grade[g])}  (not one of NM/LP/MP/HP/DMG)")


def main():
    ap = argparse.ArgumentParser(description="Prepare CardUploader scans for conditioning.")
    ap.add_argument("csv", help="CardUploader export")
    ap.add_argument("--out", required=True, help="output directory (a Drive folder works)")
    ap.add_argument("--limit", type=int, help="only the first N rows")
    ap.add_argument("--refresh", action="store_true", help="re-download cached scans")
    ap.add_argument("--no-crops", action="store_true", help="score only, write no images")
    ap.add_argument("--calibrate", metavar="GRADES_CSV",
                    help="a CSV of sku,grade — report the score distribution per grade "
                         "instead of triaging, so the thresholds can be set from data")
    args = ap.parse_args()

    rows = read_rows(args.csv)
    if args.limit:
        rows = rows[: args.limit]
    dupes = duplicate_groups(read_rows(args.csv))
    dup_of = {sku: t for t, skus in dupes.items() for sku in skus}

    raw_dir = os.path.join(args.out, "raw")
    card_dir = os.path.join(args.out, "cards")
    os.makedirs(raw_dir, exist_ok=True)
    os.makedirs(card_dir, exist_ok=True)

    out_rows = []
    for i, r in enumerate(rows, 1):
        sku = r.get(SKU_COL, "")
        title = r.get(TITLE_COL, "")
        urls = [u for u in (r.get(PIC_COL) or "").split("|") if u]
        rec = {
            "sku": sku,
            "title": title,
            "set": r.get("*C:Set", ""),
            "number": r.get("*C:Card Number", ""),
            "duplicate_of": dup_of.get(sku, ""),
            "copies": len(dupes.get(dup_of.get(sku, ""), [])) or 1,
            "check_back_era": "yes" if r.get("*C:Set", "").strip().lower() in VINTAGE_SETS else "",
        }

        if len(urls) < 2:
            rec.update({"triage": "no-scan", "note": f"{len(urls)} image(s) in {PIC_COL}"})
            out_rows.append(rec)
            print(f"[{i}/{len(rows)}] {sku}  no-scan")
            continue

        dest = os.path.join(card_dir, sku)
        os.makedirs(dest, exist_ok=True)
        try:
            faces = {}
            for name, url in (("front", urls[0]), ("back", urls[1])):
                blob = fetch(url, os.path.join(raw_dir, f"{sku}_{name}.jpg"), args.refresh)
                card, angle = straighten(Image.open(io.BytesIO(blob)))
                faces[name] = (card, angle)
                if not args.no_crops:
                    card.save(os.path.join(dest, f"{name}.jpg"), quality=93)
        except Exception as exc:                       # noqa: BLE001
            rec.update({"triage": "error", "note": str(exc)[:120]})
            out_rows.append(rec)
            print(f"[{i}/{len(rows)}] {sku}  ERROR {exc}")
            continue

        back, angle = faces["back"]
        score = score_back(back)
        if not args.no_crops:
            corner_sheet(back, os.path.join(dest, "corners-back.jpg"))
            edge_sheet(back, os.path.join(dest, "edges-back.jpg"))

        rec.update({
            "triage": triage(score),
            "wear_total_pct": score["total"],
            "worst_corner_pct": max(score["corners"].values()),
            "corner_tl": score["corners"]["tl"],
            "corner_tr": score["corners"]["tr"],
            "corner_bl": score["corners"]["bl"],
            "corner_br": score["corners"]["br"],
            "edge_top": score["edges"]["top"],
            "edge_bottom": score["edges"]["bottom"],
            "edge_left": score["edges"]["left"],
            "edge_right": score["edges"]["right"],
            "border_base": score["base"],
            "deskew_deg": round(angle, 2),
            "note": "",
        })
        out_rows.append(rec)
        print(f"[{i}/{len(rows)}] {sku}  {rec['triage']:<12} "
              f"corner={rec['worst_corner_pct']:>5}%  wear={score['total']:>5}%  {title[:44]}")

    fields = ["sku", "title", "set", "number", "triage", "worst_corner_pct", "wear_total_pct",
              "corner_tl", "corner_tr", "corner_bl", "corner_br",
              "edge_top", "edge_bottom", "edge_left", "edge_right",
              "border_base", "deskew_deg", "duplicate_of", "copies",
              "check_back_era", "note"]
    path = os.path.join(args.out, "triage.csv")
    with open(path, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in sorted(out_rows, key=lambda r: -(r.get("worst_corner_pct") or 0)):
            w.writerow(r)

    if args.calibrate:
        report_calibration(out_rows, args.calibrate)

    counts = defaultdict(int)
    for r in out_rows:
        counts[r.get("triage", "?")] += 1
    print(f"\n{len(out_rows)} cards -> {path}")
    for k in ("likely-nm", "review", "likely-worse", "no-scan", "error"):
        if counts[k]:
            print(f"  {k:<12} {counts[k]}")
    if dupes:
        surplus = sum(len(v) - 1 for v in dupes.values())
        print(f"\n{len(dupes)} duplicate group(s), {surplus} surplus copies "
              f"-> {len(read_rows(args.csv)) - surplus} listings")
        for t, skus in dupes.items():
            print(f"  {','.join(s.split('-')[-1] for s in skus)}  {t[:60]}")


if __name__ == "__main__":
    main()
