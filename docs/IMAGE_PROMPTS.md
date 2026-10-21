# Prompts for generating the demo pictures yourself

I cannot create photorealistic images here (my tools only draw vector art) and I cannot download pictures from the web, so these prompts are for an image generator you already use (ChatGPT images, Gemini, Midjourney, Adobe Firefly, Canva and similar). Check that your plan allows commercial use of what you generate.

Use these pictures for the client demo only, and say so: they are AI-generated and are not photographs of any real business. The app labels them "AI image".

## Steps
1. Generate one image per line below. Save each as `<slot>.jpg` (for example `jollof-rice-chicken.jpg`), at least 1200 px wide.
2. Create `licences.csv` next to them: `slot,author,source_url,licence,licence_url`, and for every row use your tool name as author, `https://example.com` style tool page as source_url, and `ai-generated` as licence.
3. Send me the folder, or run `python3 tools/ingest_photos.py FOLDER`. Then commit, push, and run `db/dev/photo_mapping.sql` in Supabase.

Real stock photos from Pexels or Unsplash (free for commercial use) also work, with their real licence names. Download them yourself, name them by slot, and list them in licences.csv.

## Prompts

- **jollof-rice-chicken** (4:3 landscape): Plate of red jollof rice with one fried or grilled chicken piece and fried plantain. Top-down or 45 degrees, no brand logos. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **fried-fish-rice** (4:3 landscape): White rice with whole or pieces of fried fish and a pepper sauce. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **cassava-leaves-rice** (4:3 landscape): Rice served with green cassava leaf stew (palm oil stew, may contain meat or fish). Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **soft-drink** (4:3 landscape): Glass or bottle of a plain soft drink with ice. No visible brand labels. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **fufu-groundnut-soup** (4:3 landscape): Ball of fufu with groundnut (peanut) soup in a bowl. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **burger-chips** (4:3 landscape): Beef burger with a carton or plate of chips (fries). No brand packaging. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **chicken-burger-chips** (4:3 landscape): Crispy chicken burger with chips. No brand packaging. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **pizza-margherita** (4:3 landscape): Whole margherita pizza (tomato, mozzarella, basil). Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **pizza-pepperoni** (4:3 landscape): Whole pepperoni pizza. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **chips** (4:3 landscape): Carton or bowl of chips (french fries), plain. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **grilled-chicken-chips** (4:3 landscape): Two grilled chicken pieces with chips on a plate. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **fresh-tomatoes** (4:3 landscape): Pile of fresh red tomatoes. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **onions** (4:3 landscape): Pile of onions. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **bananas** (4:3 landscape): Bunch of bananas. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **oranges** (4:3 landscape): Pile of oranges. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **cabbage** (4:3 landscape): A green cabbage head. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **hot-peppers** (4:3 landscape): Hot peppers (scotch bonnet style) in a pile or basket. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **rice-5kg** (4:3 landscape): Bag of plain rice or rice grains in a bag. No readable brand. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **cooking-oil** (4:3 landscape): Bottle of cooking oil, plain or unreadable label. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **bottled-water** (4:3 landscape): Plain bottled water. No readable brand. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **juice-carton** (4:3 landscape): Plain juice carton or bottle. No readable brand. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **soap-bars** (4:3 landscape): Pack of plain bar soap. No readable brand. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **toothpaste** (4:3 landscape): Tube of toothpaste. No readable brand. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **laundry-liquid** (4:3 landscape): Bottle of laundry liquid. No readable brand. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **toilet-tissue** (4:3 landscape): Pack of toilet rolls. No readable brand. Photorealistic food photography, natural daylight, shallow depth of field, 4:3 landscape, no text, no logos, no brand names, no people. 
- **restaurant-kitchen** (3:2 landscape): Warm restaurant kitchen or dining room interior or a plated-food scene. No signage or logos. Photorealistic food photography, natural daylight, shallow depth of field, 3:2 landscape, no text, no logos, no brand names, no people. 
- **restaurant-grill** (3:2 landscape): Charcoal or open grill with chicken, or casual grill restaurant. No signage or logos. Photorealistic food photography, natural daylight, shallow depth of field, 3:2 landscape, no text, no logos, no brand names, no people. 
- **restaurant-fastfood** (3:2 landscape): Fast-food style burgers and chips spread. No brand packaging. Photorealistic food photography, natural daylight, shallow depth of field, 3:2 landscape, no text, no logos, no brand names, no people. 
- **grocery-market** (3:2 landscape): Fresh produce market stall with vegetables and fruit. No signage. Photorealistic food photography, natural daylight, shallow depth of field, 3:2 landscape, no text, no logos, no brand names, no people. 
- **grocery-supermarket** (3:2 landscape): Supermarket aisle or shelves with groceries. No readable brands. Photorealistic food photography, natural daylight, shallow depth of field, 3:2 landscape, no text, no logos, no brand names, no people. 
