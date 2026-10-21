# Adding real photographs (Part 1)

## Status
No photographs are installed. The sandbox this was built in cannot reach any photo library (Wikimedia Commons, Unsplash, Pexels, Pixabay and Openverse all returned 403), and I will not use images whose licence I cannot verify. The app still shows the 30 original illustrations. Everything needed to switch to photographs is ready.

## The 30 photos needed
`tools/photo_slots.csv` lists every slot: the file name, the demo products and shops that use it, and what the photo should show (11 dishes, 14 grocery items, 5 shop covers). One photo per slot, no reuse across unrelated items. Avoid readable brand names and logos.

## Where to get photos you may use commercially
- Unsplash, Pexels or Pixabay: free for commercial use under their own licences. Record the photographer and the photo page link.
- Wikimedia Commons: only CC0, public domain or CC BY / CC BY-SA files. Record author and licence.
- Your own photos, or purchased or commissioned ones. Keep the receipt or agreement.
Photos of Sierra Leonean dishes (jollof, cassava leaves, fufu with groundnut soup) are harder to find in libraries. Shooting them yourself is the most reliable option.

## Steps
1. Put the photos in a folder, each named after its slot (for example `jollof-rice-chicken.jpg`). At least 1000 px on the long side.
2. In the same folder create `licences.csv` with the header `slot,author,source_url,licence,licence_url` and one row per photo.
3. Run `python3 tools/ingest_photos.py YOUR_FOLDER` (needs Python and Pillow). It refuses any photo with a missing or unlisted licence, a too-small file, or an unknown name, and says why. For accepted photos it writes three sizes (400, 800, 1200 px wide) to `images/photos/`, updates `images/photos/LICENSES.csv`, builds `credits.html`, and writes `db/dev/photo_mapping.sql`.
4. Commit and push so the files are on Vercel. Then run `db/dev/photo_mapping.sql` in the Supabase SQL editor. It only updates DEMO shops (`demo-%`) and their products, and is safe to run twice.
5. Hard refresh the site. Photos appear with a "Stock photo" badge and a Photo credits link on the shop page. Slots without a photo keep their illustration.

You can send me the folder and licences.csv and I will run these steps and test them.

## Behaviour already in the app
- Responsive sources (400, 800, 1200 px) and lazy loading, fixed sizes so the page does not jump.
- A missing or failed picture is replaced by a fallback image, and the page never shows a broken image icon.
- Alt text on every picture. A stock photo is described as an "illustrative photo" and labelled "Stock photo" with "does not show the real premises".
- Demo and not-partnered labels are unchanged.
