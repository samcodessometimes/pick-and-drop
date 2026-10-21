#!/usr/bin/env python3
"""Turn licensed photographs into the optimised files the app uses.

Usage:  python3 tools/ingest_photos.py INPUT_DIR

INPUT_DIR holds one photo per slot, named <slot>.jpg / .jpeg / .png / .webp (slots are listed in tools/photo_slots.csv),
and a licences.csv with the header:  slot,author,source_url,licence,licence_url[,focus_x,focus_y]
Optional focus_x and focus_y (0 to 1, default 0.5) choose which part of a photo survives the crop, for example focus_y=0.7 keeps the lower part.
A photo with no complete licence row, or with a licence not on the allowed list, is REFUSED. Nothing is guessed.

Output (in the project, safe to commit):
  images/photos/<slot>-400.jpg, -800.jpg, -1200.jpg   cropped to the slot aspect, EXIF removed, progressive JPEG
  images/photos/LICENSES.csv                          the licence register (merged with earlier runs)
  credits.html                                        visible credits page
  db/dev/photo_mapping.sql                            idempotent SQL that points DEMO products and covers at the photos
Nothing is uploaded, pushed or run against the database by this script.
"""
import csv, html, os, re, sys
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
ALLOWED = {  # licences that allow commercial use; attribution text is still recorded and shown
    'cc0', 'public domain', 'unsplash license', 'pexels license', 'pixabay license', 'cc by 4.0', 'cc by 3.0', 'cc by-sa 4.0',
    'cc by-sa 3.0', 'own work', 'purchased', 'commissioned', 'ai-generated'}   # ai-generated: made by you in an image tool whose terms allow commercial use
WIDTHS = (400, 800, 1200)
ASPECT = {'4:3': (4, 3), '3:2': (3, 2)}
MIN_LONG_SIDE = 1000

def sq(s): return str(s).replace("'", "''")

def main(src):
    src = Path(src)
    slots = {r['slot']: r for r in csv.DictReader(open(ROOT / 'tools/photo_slots.csv', newline=''))}
    lic_file = src / 'licences.csv'
    if not lic_file.exists(): sys.exit('licences.csv not found in ' + str(src))
    lic = {r['slot'].strip(): {k: (v or '').strip() for k, v in r.items()} for r in csv.DictReader(open(lic_file, newline=''))}
    out = ROOT / 'images/photos'; out.mkdir(parents=True, exist_ok=True)
    reg_path = out / 'LICENSES.csv'
    register = {r['slot']: r for r in csv.DictReader(open(reg_path, newline=''))} if reg_path.exists() else {}
    done, refused = [], []
    for f in sorted(src.iterdir()):
        if f.suffix.lower() not in ('.jpg', '.jpeg', '.png', '.webp'): continue
        slot = f.stem
        if slot not in slots: refused.append((f.name, 'not a known slot (see tools/photo_slots.csv)')); continue
        l = lic.get(slot)
        if not l or not all(l.get(k) for k in ('author', 'source_url', 'licence')): refused.append((f.name, 'licences.csv row missing or incomplete (author, source_url, licence)')); continue
        if l['licence'].lower() not in ALLOWED: refused.append((f.name, f"licence '{l['licence']}' is not on the allowed list")); continue
        if not re.match(r'^https://', l['source_url']) and l['licence'].lower() not in ('own work', 'purchased', 'commissioned', 'ai-generated'): refused.append((f.name, 'source_url must be an https link')); continue
        im = ImageOps.exif_transpose(Image.open(f)).convert('RGB')
        if max(im.size) < MIN_LONG_SIDE: refused.append((f.name, f'too small ({im.size[0]}x{im.size[1]}); need at least {MIN_LONG_SIDE}px on the long side')); continue
        aw, ah = ASPECT[slots[slot]['aspect']]
        try: fx, fy = float(l.get('focus_x') or 0.5), float(l.get('focus_y') or 0.5)
        except ValueError: fx = fy = 0.5
        for w in WIDTHS:
            h = round(w * ah / aw)
            if im.size[0] < w: continue                      # never upscale
            ImageOps.fit(im, (w, h), Image.LANCZOS, centering=(fx, fy)).save(out / f'{slot}-{w}.jpg', 'JPEG', quality=80, optimize=True, progressive=True)
        if not (out / f'{slot}-800.jpg').exists(): refused.append((f.name, 'less than 800px wide after crop; need a larger photo')); continue
        register[slot] = {'slot': slot, 'author': l['author'], 'source_url': l['source_url'], 'licence': l['licence'], 'licence_url': l.get('licence_url', '')}
        done.append(slot)
    with open(reg_path, 'w', newline='') as fh:
        w = csv.DictWriter(fh, ['slot', 'author', 'source_url', 'licence', 'licence_url']); w.writeheader(); w.writerows(register[s] for s in sorted(register))

    # credits page (only slots that really have a photo and a licence)
    rows = ''.join(f"<tr><td>{html.escape(slots[s]['products_in_demo_menus'] or s.replace('-', ' ') + ' (cover)')}</td><td>{html.escape(r['author'])}</td>"
                   f"<td><a href=\"{html.escape(r['source_url'])}\" rel=\"noopener\">Source</a></td><td>{html.escape(r['licence'])}</td></tr>"
                   for s, r in sorted(register.items()) if s in slots)
    (ROOT / 'credits.html').write_text(f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Photo credits | Pick &amp; Drop</title><link rel="stylesheet" href="css/styles.css"></head>
<body><div class="top"><a href="index.html">Home</a><h1>Photo credits</h1></div><main>
<p class="note">Pictures are stock photographs shown to illustrate the dish or product. They are not photographs of any listed business or its food. All listings are demo examples and are not partners of Pick &amp; Drop.</p>
<table class="lines"><thead><tr><th>Picture</th><th>Photographer</th><th>Source</th><th>Licence</th></tr></thead><tbody>{rows}</tbody></table></main></body></html>''')

    # idempotent mapping SQL. Only DEMO merchants and their products are touched. Real merchant records are never changed.
    sql = ['-- Generated by tools/ingest_photos.py. Safe to run twice. Touches DEMO shops named demo-% only.',
           '-- Run in the Supabase SQL editor AFTER the photo files are deployed to the site (otherwise the app shows the illustration fallback).', 'begin;']
    for s in sorted(x for x in register if x in slots and (out / f'{x}-800.jpg').exists()):   # every installed photo, not only this run's
        r, sl = register[s], slots[s]; base = f'images/photos/{s}-800.jpg'
        credit = (f"AI-generated image ({r['author']}). Not a photograph of the business or its premises." if r['licence'].lower() == 'ai-generated'
                  else f"Stock photo: {r['author']}, {r['licence']}. Not a photograph of the business or its premises.")
        if sl['kind'] == 'cover':
            sql.append(f"update merchants set cover_url = '{base}', image_credit = '{sq(credit)}' where status = 'DEMO' and slug in ({', '.join(repr(m) for m in sl['demo_merchants'].split(' | '))});")
        else:
            names = ', '.join("'" + sq(n) + "'" for n in sl['products_in_demo_menus'].split(' | '))
            sql.append(f"update products set image_url = '{base}' where name in ({names}) and merchant_id in (select id from merchants where slug like 'demo-%' and status = 'DEMO');")
    # Dishes with no photo of their own reuse the closest installed photo (decided with the owner, flagged in the Part 1 report).
    REUSE = {'fried-fish-rice': 'jollof-rice-chicken', 'cassava-leaves-rice': 'fufu-groundnut-soup', 'chicken-burger-chips': 'burger-chips', 'chips': 'burger-chips'}
    for dst, src in REUSE.items():
        if dst in slots and src in register and (out / f'{src}-800.jpg').exists() and not (out / f'{dst}-800.jpg').exists():
            names = ', '.join("'" + sq(n) + "'" for n in slots[dst]['products_in_demo_menus'].split(' | '))
            sql.append(f"update products set image_url = 'images/photos/{src}-800.jpg' where name in ({names}) and merchant_id in (select id from merchants where slug like 'demo-%' and status = 'DEMO');")
    sql.append('commit;')
    (ROOT / 'db/dev/photo_mapping.sql').write_text('\n'.join(sql) + '\n')

    print(f'Processed {len(done)} photo(s): {", ".join(sorted(done)) or "none"}')
    for n, why in refused: print(f'REFUSED {n}: {why}')
    missing = [s for s in slots if not (out / f'{s}-800.jpg').exists()]
    print(f'{len(slots) - len(missing)} of {len(slots)} slots have a photo. Still missing: {", ".join(missing) or "none"}')

if __name__ == '__main__':
    if len(sys.argv) != 2: sys.exit(__doc__)
    main(sys.argv[1])
