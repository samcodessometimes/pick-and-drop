# Images

Every picture here is an **original illustration** drawn for this project by `tools/make_illustrations.py`. They are not photographs and do not show any real business, dish from a real menu, or premises. Customer pages label them "Illustration".

Why not photographs: no licensed photo source could be reached while building this, and copying photos from the web or from a business without permission is not allowed. No photo is included.

## Folders
- `meals/` one image per demo dish (4:3).
- `groceries/` one image per demo product (square-ish card).
- `covers/` shop covers (restaurant kitchen, grill, fast food, market, supermarket).
- `fallback/` shown automatically when a picture is missing or fails to load (`meal.svg`, `product.svg`, `store.svg`).

## Replacing an illustration with a real photograph
1. Only use a photo you own, have bought, or that is licensed for commercial use (keep the licence text).
2. Save it as JPG or WebP, about 800 px wide, under 150 KB, in the same folder. Keep the same aspect ratio (4:3 for meals and covers).
3. In Supabase Table editor, change `products.image_url` or `merchants.cover_url` to the new path (for example `images/meals/jollof-rice-chicken.jpg`). Set `merchants.image_credit` to the credit text, for example `Photo: Name, CC BY 4.0`. Any credit that does not contain the word "illustration" hides the Illustration badge.
4. Photos of a real shop's food must come from that shop with permission. Never imply a shop is a partner because its photo is shown.

## Credits
All SVG files: original artwork by the Pick & Drop project, no third-party assets.

## Photographs
No photographs are installed yet. See docs/PHOTOS.md and tools/ingest_photos.py. Photographs go to `images/photos/` and must have a row in `images/photos/LICENSES.csv`.
