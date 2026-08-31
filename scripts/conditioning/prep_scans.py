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
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
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

#: How deep an edge strip is cut for the edge sheet. Comfortably thicker than
#: the measured band so there is card either side of the whitening to judge it
#: against — a strip cropped tight to the band gives nothing to compare with.
EDGE_STRIP = 30

#: How much of a corner is cut for the corner sheet, in card pixels.
#:
#: **Magnification comes from cropping tighter, not from drawing bigger.** An
#: image is downscaled to 1568px on its longest edge before a model ever sees
#: it, so a sheet built wider than that is shrunk on arrival: you pay for 1568
#: either way and the extra pixels are discarded. The first version of this
#: sheet cut 110px and drew it 660px wide, which arrived downscaled 1.7x — the
#: same 110 pixels at 3.5x, having gone through two resamples to get there.
#:
#: So the sheet is built to land at 1568 exactly. Within that, the crop size is
#: a trade rather than a maximum: at 285 DPI a corner is only about 70 real
#: pixels, so cutting tight and blowing it up past native buys apparent size
#: and pays for it in mush — every pixel interpolated from its neighbours,
#: which is the opposite of what a judgement about a small hard-edged chip
#: needs. Cutting 72px at 5.3x was measurably softer to read than 140px at
#: 2.7x, and no more informative: the chipping that decides the grade is
#: obvious at both, and only the second one looks like a card.
#:
#: 140px covers the corner tip, the full border either side of it, and enough
#: interior to judge the border against.
CORNER_CROP = 140

#: Sheet width, chosen to arrive without being downscaled. Four columns.
SHEET_W = 1544

#: How much background to keep OUTSIDE the card in a crop, in normalised px.
#:
#: Cropping flush to the card's bounding box seemed obviously right and is not:
#: it puts the corner's arc hard against the tile edge, so the one thing a
#: corner crop should show — the SILHOUETTE, the outline of the card against
#: the scanner's black — is the one thing cut off. A corner that has been
#: rounded off or crushed is read from its profile as much as from whitening
#: on its face. The margin also stops the tile looking severed, which is worth
#: something on its own when a person has a hundred of these to look through.
CROP_MARGIN = 22

#: Sheet palette. Dark, because the subject is a near-black navy border and a
#: white surround drags the eye's adaptation the wrong way — the same crop
#: reads lighter and worn against white than it does against black.
SHEET_BG = (18, 18, 18)
TILE_BG = (32, 32, 32)
LABEL = (255, 224, 66)
TITLE = (245, 245, 245)


def _font(size, bold=False):
    for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf"
                 % ("-Bold" if bold else ""),
                 "/usr/share/fonts/truetype/liberation/LiberationSans-%s.ttf"
                 % ("Bold" if bold else "Regular")):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()

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
    """
    Deskew and crop to the card, at the scan's OWN resolution. Returns
    (exact, padded, angle) — the card cropped flush for SCORING, and the same
    card with CROP_MARGIN of background kept around it for LOOKING at.

    It used to normalise to CARD_W x CARD_H here, which put a resample between
    the scan and every crop taken from it for no reason: the fixed size is
    needed by the SCORE, so that one set of thresholds holds across scans that
    framed the card differently, and by nothing else. Crops were paying for it
    — rotate, resize, then upscale, three interpolations deep before anything
    reached an eye, each one costing a little edge definition on exactly the
    fine detail the crop exists to show. Scoring now normalises for itself and
    crops come straight off this.
    """
    angle = _skew_degrees(_mask(im))
    rotated = im.rotate(-angle, resample=Image.BICUBIC, expand=True, fillcolor=(0, 0, 0))
    box = _card_box(_mask(rotated))
    if box is None:
        return rotated, rotated, angle
    x0, y0, x1, y1 = box
    exact = rotated.crop((x0, y0, x1 + 1, y1 + 1))
    m = round(CROP_MARGIN * exact.size[0] / CARD_W)
    padded = rotated.crop((x0 - m, y0 - m, x1 + 1 + m, y1 + 1 + m))
    return exact, padded, angle


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
    if card.size != (CARD_W, CARD_H):
        card = card.resize((CARD_W, CARD_H), Image.LANCZOS)
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


def _crisp(im):
    """
    A light unsharp mask after upscaling.

    Interpolation is a weighted average, so it necessarily softens the edge
    between a white chip and navy card — the boundary this whole exercise is
    trying to read. This restores the acutance that enlarging removed; it is
    not adding detail that was not there, and the radius is kept small and the
    threshold non-zero so flat navy (where JPEG noise lives) is left alone
    rather than being crunched into speckle that looks like whitening.
    """
    return im.filter(ImageFilter.UnsharpMask(radius=1.4, percent=85, threshold=3))


def _tile(img, w, h, label, font, fill=False):
    """
    One crop on its own dark ground, captioned beneath in the sheet's yellow.

    `fill` stretches to the whole tile rather than fitting proportionally. That
    is right for an EDGE, where the strip is long and shallow and the extra
    height is free magnification across the only axis that carries wear depth;
    a corner keeps its proportions, since its shape is part of what is being
    read.

    Note the resize rather than Image.thumbnail: thumbnail only ever shrinks,
    so the first version of this sheet drew every crop at its source size
    inside a tile built to hold it magnified — a page of small pictures
    surrounded by dead grey, which looked like a layout choice and was a bug.
    """
    tile = Image.new("RGB", (w, h), TILE_BG)
    iw, ih = w - 10, h - 26
    if fill:
        size = (iw, ih)
    else:
        k = min(iw / img.size[0], ih / img.size[1])
        size = (max(1, round(img.size[0] * k)), max(1, round(img.size[1] * k)))
    fit = _crisp(img.resize(size, Image.LANCZOS))
    tile.paste(fit, ((w - size[0]) // 2, (h - 26 - size[1]) // 2 + 4))
    d = ImageDraw.Draw(tile)
    d.text(((w - d.textlength(label, font=font)) / 2, h - 21), label, fill=LABEL, font=font)
    return tile


def contact_sheet(padded, path, face="BACK"):
    """
    Every crop for one face of one card, on a single titled sheet.

    One image per face rather than two files, because a grader opens these a
    hundred at a time and a sheet you can take in at a glance is worth more
    than two you have to hold in your head together. The layout is four
    corners across the top, then each edge in halves — an edge split in two is
    drawn at twice the length it would get whole, and the half is still long
    enough to judge whether wear runs continuously.

    Everything is cut from the PADDED card, so each crop carries the card's
    outline against the scanner's black. See CROP_MARGIN.
    """
    w, h = padded.size
    m = round(CROP_MARGIN * w / (CARD_W + 2 * CROP_MARGIN))
    cut = round(CORNER_CROP * w / (CARD_W + 2 * CROP_MARGIN)) + m
    # An edge strip is shallow, so the full corner margin would make it mostly
    # background; a third of it is enough to show the card's outline.
    T = round(EDGE_STRIP * w / (CARD_W + 2 * CROP_MARGIN)) + m // 3

    corners = [("TOP-LEFT", padded.crop((0, 0, cut, cut))),
               ("TOP-RIGHT", padded.crop((w - cut, 0, w, cut))),
               ("BOTTOM-LEFT", padded.crop((0, h - cut, cut, h))),
               ("BOTTOM-RIGHT", padded.crop((w - cut, h - cut, w, h)))]

    def strip(name, img):
        half = img.size[0] // 2
        return [(f"{name} 1/2", img.crop((0, 0, half, img.size[1]))),
                (f"{name} 2/2", img.crop((half, 0, img.size[0], img.size[1])))]

    off = m - m // 3          # skip the margin the strips do not use
    edges = (strip("TOP", padded.crop((cut, off, w - cut, off + T)))
             + strip("BOTTOM", padded.crop((cut, h - off - T, w - cut, h - off))
                     .transpose(Image.FLIP_TOP_BOTTOM))
             + strip("LEFT", padded.crop((off, cut, off + T, h - cut))
                     .transpose(Image.ROTATE_270))
             + strip("RIGHT", padded.crop((w - off - T, cut, w - off, h - cut))
                     .transpose(Image.ROTATE_90)))

    col = SHEET_W // 4
    title_h, corner_h, edge_h = 52, 412, 168
    sheet = Image.new("RGB", (SHEET_W, title_h + corner_h + edge_h * 2), SHEET_BG)
    d = ImageDraw.Draw(sheet)
    d.text((14, 13), f"{face} — corner & edge crops", fill=TITLE, font=_font(26, True))

    small = _font(15, True)
    for i, (name, img) in enumerate(corners):
        sheet.paste(_tile(img, col, corner_h, name, small), (i * col, title_h))
    for i, (name, img) in enumerate(edges):
        x, y = (i % 4) * col, title_h + corner_h + (i // 4) * edge_h
        sheet.paste(_tile(img, col, edge_h, name, small, fill=True), (x, y))
    sheet.save(path, quality=96, subsampling=0)


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
                card, padded, angle = straighten(Image.open(io.BytesIO(blob)))
                faces[name] = (card, padded, angle)
                if not args.no_crops:
                    card.save(os.path.join(dest, f"{name}.jpg"), quality=95, subsampling=0)
        except Exception as exc:                       # noqa: BLE001
            rec.update({"triage": "error", "note": str(exc)[:120]})
            out_rows.append(rec)
            print(f"[{i}/{len(rows)}] {sku}  ERROR {exc}")
            continue

        back, back_padded, angle = faces["back"]
        score = score_back(back)
        if not args.no_crops:
            contact_sheet(back_padded, os.path.join(dest, "crops-back.jpg"), "BACK")
            contact_sheet(faces["front"][1], os.path.join(dest, "crops-front.jpg"), "FRONT")

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
