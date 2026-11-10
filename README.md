# Tortuga Scan

**Clean eating scanner · prototype**

A personal, phone-first barcode scanner for the grocery aisle. Scan a packaged food (or type its barcode, or paste its ingredients) and get:

1. **Seed Oil Safe-style check** — PASS / FAIL against the guidelines Seed Oil Scout publishes at <https://www.seedoilscout.com/seedoilsafe>.
2. **GMO status** — a separate Tortuga Scan check: *GMO / bioengineered*, *Not GMO* (organic / Non-GMO), *Possible GMO — not confirmed*, or *No GMO indicators*.
3. **Tortuga Scan clean score (0–100)** — our own score, inspired by the categories Olive publicly describes (seed oils, additives, processing, sugar), with the math shown.

Every flag lists the rule that hit and the matched ingredient snippet.

> **Disclaimer.** Tortuga Scan is not affiliated with, endorsed by, or certified by Olive or Seed Oil Scout. The pass/fail is our implementation of Seed Oil Scout's *published* list, not their certification or badge. The clean score is ours, not an official Olive score, and is not based on lab tests. Grades use the ingredient list from Open Food Facts (which can be incomplete or out of date) or what you paste. We can't verify manufacturing processes, cross-contact, or lab contaminants. Always read the package.

## Files

```
index.html             App shell (PWA meta, header, views, bottom nav, dialog)
styles.css             Natural green / cream design, mobile-first
app.js                 Camera, catalog-first lookup, catalog / lab / news screens
rules.js               Rules engine and ingredient colors (browser + Node)
sw.js                  Service worker: caches the app shell and the JSON data
manifest.webmanifest   PWA manifest (Add to Home Screen)
data/catalog.json      Our food catalog (static JSON)
data/household.json    Household / non-food catalog (static JSON)
data/lab-tests.json    Public lab tests we cite
data/news.json         Daily news reports
scripts/seed-catalog.js  Optional: rebuild the catalog from Open Food Facts
icons/                 tortuga-logo.png (header), icon-192/512.png, apple-touch-icon.png, tortoise-mark.svg (fallback)
vendor/                html5-qrcode 2.3.8 (Apache-2.0), vendored
tests/rules.test.js    Rules engine and ingredient colors
tests/data.test.js     Catalog, lab tests, and news files
.nojekyll              Serve files as-is on GitHub Pages
```

## Run / deploy

No build step.

- **Local:** `python3 -m http.server 8000` in this folder, then open <http://localhost:8000>. (Camera works on `localhost`; on a phone you need HTTPS.)
- **GitHub Pages:** push this folder as the repo root, then Settings → Pages → *Deploy from a branch* → `main` / `(root)`. Open the `https://<user>.github.io/<repo>/` link on the iPhone.
- **Add to Home Screen (iPhone):** open the link in Safari → Share → *Add to Home Screen*.
- **Tests:** `node tests/rules.test.js` and `node tests/data.test.js` (Node 18+; uses only `node:assert`).
- Deep link to a product: `?code=041570054161`. Deep link to a section: `?tab=catalog`, `?tab=household`, `?tab=labs`, or `?tab=news`.

## How it works

1. **Scan.** Tapping *Scan barcode* calls `Html5Qrcode.start({ facingMode: "environment" })` directly from the tap (required on iOS). The video is `playsinline` + `muted`. Formats: EAN-13, EAN-8, UPC-A, UPC-E. A code must pass the GTIN checksum and read the same twice in a row before we accept it. *Stop scanning* releases the camera; it's also released when the app goes to the background.
2. **Look up.** The barcode is checked against `data/catalog.json` first (including the UPC-A ⇄ EAN-13 form), then `data/household.json`, then products you saved on this phone. A food hit is labeled **In the Tortuga catalog**. A household hit is labeled **In the Tortuga household catalog**. A phone-only hit is labeled **Saved on this phone**. If it isn’t in any of those, we ask Open Food Facts and label it **Not in our catalog · live Open Food Facts**. Live request: `GET https://world.openfoodfacts.org/api/v2/product/{code}.json?fields=code,product_name,product_name_en,brands,image_front_url,image_front_small_url,ingredients_text,ingredients_text_en,ingredients_text_fr,nova_group,nutriments,labels,labels_tags,quantity` with `User-Agent: TortugaScan/0.1 (personal clean-eating scanner prototype)`. (Browsers usually drop a custom `User-Agent` from `fetch`; OFF's CORS allows it, so it is sent where the browser permits.) We try the code as scanned, then the UPC-A ⇄ EAN-13 variant (add / remove a leading `0`), and UPC-E expanded to UPC-A.
3. **Missing data and hand grading.** If the product isn't on Open Food Facts, or has no ingredient list, you get a paste-in box. **Grade a label by hand** on the home screen is the same kind of form. Both ask for the ingredient list, and for a product name, brand, and barcode when you know them. Both have certification switches: Organic, Non-GMO, Grass-fed, and Pasture-raised. You don't have to hide those words in the product name. A word that is already in the name or brand still counts. **Add a product** saves a food or household item on this phone and grades it with the same switches.
4. **Grade.** `rules.js` normalizes the text (lowercase, accents, OFF's `_allergen_` markup), drops cross-contact lines (“may contain…”, “made in a facility…”), and runs the rules below. Certification switches are saved as `labels` and `labelsTags`, the same fields as `data/catalog.json`, and the existing rules read them from there. Ingredient language preference: English, then the main list, then French (with a warning).

## Certifications you can attach

These are claims printed on the package. They are not lab results, and Tortuga Scan does not issue an Organic, Non-GMO Project, Olive, Seed Oil Scout, or Bobby Approved badge.

| Switch | What it stores | What changes |
|---|---|---|
| Organic | `Certified organic`, tags `en:organic` and `en:certified-organic` | Glyphosate-prone crops turn green and that check passes in full. Dairy, eggs, and meat can clear. GMO status can be Not GMO. |
| Non-GMO | `Non-GMO`, tag `en:no-gmos` | Glyphosate-prone crops turn yellow and cost 12 points. Not a full pass. Dairy and meat can clear. Eggs do not. |
| Grass-fed | `Grass-fed`, tag `en:grass-fed` | Dairy and meat can clear. |
| Pasture-raised | `Pasture-raised`, tag `en:pasture-raised` | Eggs and meat can clear. |

Organic on the product does not turn a seed oil green, does not clear Dirty Dozen produce by itself, and does not waive corn starch or the mainstream-brand penalty. If the package is both organic and non-GMO, organic wins on glyphosate-prone crops.

Household products can record **Fragrance-free** or **Unscented**. Those words are not a Bobby Approved certification. If the ingredient list still says fragrance, parfum, or perfume, the household grade still fails.

The chosen claims show on the result, next to the product name, so you can see why the score and the colors moved.

## The rules

### 1. Seed Oil Safe-style check (fail if any match)

| Category | What we match | What we deliberately don't |
|---|---|---|
| Seed oils | canola / rapeseed, soybean / soya, corn / maize, sunflower (incl. high-oleic), safflower, grapeseed, cottonseed; also generic “vegetable oil(s)”, “vegetable shortening”, and rice bran oil (an industrial oil commonly grouped with these) | olive, avocado, coconut, MCT, butter, ghee, tallow, lard, palm, sesame, flax / linseed, walnut, almond, peanut, macadamia; corn, corn starch, corn syrup, sunflower seeds, sunflower lecithin |
| Soy | soy, soya, soybean, soy protein, soy lecithin, soy sauce, tamari, shoyu, miso, edamame, tofu, tempeh, natto, hydrolyzed / textured soy, TVP | soybean *oil* (counted under seed oils, not twice) |
| Artificial sweeteners | aspartame, sucralose, acesulfame K / Ace-K, saccharin, neotame, advantame, cyclamate, E950–E969 | stevia, monk fruit, erythritol, xylitol, allulose |
| Gums | xanthan, guar, gellan, locust bean / carob bean, gum arabic / acacia, cellulose gum / CMC, tara, karaya, tragacanth; **carrageenan** grouped here as a common avoid | carob powder, acacia honey |
| Plant lecithins | soy, sunflower, rapeseed / canola lecithin; bare “lecithin” / E322 flagged as *likely* plant lecithin (with a note) | egg lecithin |
| Natural flavors | natural flavor(s) / flavour(s) / flavoring(s), incl. “natural vanilla flavor” | — |
| Dyes | FD&C, Red 40, Red 3, Yellow 5, Yellow 6, Blue 1, Blue 2, Green 3, Allura Red, Tartrazine, Sunset Yellow, Brilliant Blue, Erythrosine, Indigo Carmine, E102/E110/E129/E133 etc., “artificial color” | paprika, turmeric, annatto, beet juice, red bell pepper |

**Seed-oil matching** walks backward from each “oil” / “shortening” over oil names, modifiers (organic, expeller-pressed, high-oleic, hydrogenated…), and “and / or” lists, so “olive and/or canola oil” flags canola only and “ground corn, olive oil” does not flag corn oil. It also reads parentheticals like “vegetable oil (canola, sunflower)”. Canola, rapeseed, cottonseed, and grapeseed are flagged even without the word “oil” (except as lecithin).

**Skipped:** Seed Oil Scout also lists “toxic manufacturing processes”. There's no label-checkable list, so we don't claim to check it.

### 2. GMO status (Tortuga Scan check — not on the SOS list, doesn't change pass/fail)

- **GMO / bioengineered** (confirmed): ingredients, product name, or OFF labels/tags say GMO, genetically modified / engineered, “bioengineered” (US disclosure), “derived from bioengineering”, or “produced with genetic engineering”. Negations (“non-GMO”, “not bioengineered”, “GMO-free”) are removed first.
- **Not GMO:** certified / USDA organic (from the product name or labels), Non-GMO Project, or a clear non-GMO claim.
- **Possible GMO — not confirmed** (caution): no organic / non-GMO claim and the ingredients include conventional US crops usually grown GMO: soy, corn (and dextrose / maltodextrin), canola / rapeseed, cottonseed, sugar beet, plain “sugar” not listed as cane (or coconut, maple, date…), generic vegetable oil, papaya, alfalfa. Ingredients written as “organic …” or “non-GMO …” don't count.
- **No GMO indicators:** none of the above.

### 3. Tortuga Scan clean score

Start at 100, subtract, floor at 0:

| Rule | Points |
|---|---|
| Seed oil present | −35 |
| Each other Seed Oil Safe category hit (soy, sweeteners, gums, lecithins, natural flavors, dyes) | −12 each |
| GMO / bioengineered confirmed | −12 |
| Possible GMO caution | −6 |
| Other additives (BHA, BHT, TBHQ, benzoates, sorbates, nitrites/nitrates, polysorbates, mono- & diglycerides, DATEM, propylene glycol, titanium dioxide, potassium bromate, azodicarbonamide, artificial flavor, MSG) | −8 each, max −24 |
| Added sugar in ingredients (unnamed sugar, cane sugar, agave, syrups, HFCS, dextrose, maltodextrin). Honey, maple syrup, and coconut sugar are not deducted | −8 |
| …plus, only if added sugar is listed: sugars ≥ 15 g/100 g | −7 more |
| …or sugars ≥ 25 g/100 g (instead) | −12 more |
| NOVA group 4 / group 3 (from OFF) | −22 / −5 |
| Glyphosate-prone crop, conventional (not organic or non-GMO), once | −35 |
| Glyphosate-prone crop, non-GMO but not organic (yellow, not a full pass) | −12 |
| Refined starch (corn starch, or modified food starch that isn’t a named potato, tapioca, rice, arrowroot, or cassava starch) | −8 each, max −16 |
| Mainstream brand | −4 |

Bands: **80–100 Cleaner**, **50–79 Mixed**, **0–49 Poor**.

**Mainstream brand (−4).** Flat deduction, once per product, when the brand or the product name matches a well-known mass-market packaged-food brand. The list includes General Mills, Cheerios, Kellogg’s, Nestlé, Coca-Cola, Pepsi, Kraft, Heinz, Post, and the same kind of grocery name (Oreo, Quaker, Campbell’s, and so on). −4 is the middle of a 3-to-5 range: a simple mainstream food such as milk or sparkling water stays Cleaner, and a processed one does not. This is not a map of which company owns which brand.

**Glyphosate-prone crops.** Tortuga’s own check. It does not change the Seed Oil Safe-style pass/fail, and it is not a lab test of that barcode. The crops are wheat (including wheat flour when the flour isn’t another grain), oats, barley, rye, sorghum, millet, corn, dry beans, chickpeas, lentils, peas (not snap or snow peas), soy foods, sunflower, flax, canola, cottonseed, and sugar beet. Organic on the ingredient or the product is green and a full pass. Non-GMO only is yellow, not a full pass, and costs 12 points. Conventional or unlabeled is red and costs 35 points once. Rice, quinoa, buckwheat, potatoes, green beans, and snap peas are not on the list. Lecithin keeps its own color. Olive, avocado, and coconut oil are not treated as these crops.

The crop list follows public surveys and registered uses, not numbers we measured: [CFIA, glyphosate testing in 2015–2016](https://open-science.canada.ca/handle/123456789/3743) (grains, beans, peas, lentils, chickpeas, soy; wheat and barley are named), [EWG’s 2018 oat-cereal tests](https://www.ewg.org/news-insights/news/2018/10/new-round-ewg-testing-finds-glyphosate-kids-breakfast-foods-quaker-oats), and the [EPA glyphosate page](https://www.epa.gov/ingredients-used-pesticide-products/glyphosate). We do not attach those labs’ figures to a Tortuga barcode.

**NOVA 4 is −22** (it was −15). A food with no other deductions scores 78, Mixed, so ultra-processed no longer sits in Cleaner on the processing group alone. NOVA 3 stays −5.

**Milk and eggs** do not change the score. See ingredient colors.

## iOS notes

- The camera only works over **HTTPS** (GitHub Pages is fine) or `localhost`.
- Permission is requested on the first tap of *Scan barcode*. If it was denied: Safari `aA` → Website Settings → Camera → Allow (or Settings → Safari → Camera). Home Screen apps keep their own permission and may ask again.
- iPhone Safari has no `BarcodeDetector`, so decoding uses html5-qrcode's built-in ZXing decoder. Hold the barcode flat, fill the frame, and use good light; manual entry is always available.
- Open Food Facts coverage of US products is good but not complete; ingredient lists can be stale.

## Ingredient colors

Each ingredient line is **green (OK)**, **yellow (limit)**, or **red (avoid)**. This is separate from the Seed Oil Safe-style pass/fail. A gum fails that check and is still yellow. Corn starch can pass that check and still be red.

- **Red:** seed oils (even if the line says organic); artificial sweeteners, dyes, and flavors; confirmed GMO wording; conventional corn starch, corn syrup, dextrose, and maltodextrin; modified food starch when the source isn’t named; soy protein, soy flour, soy lecithin, and TVP; conventional glyphosate-prone crops; eggs that are not organic or pasture-raised (non-GMO alone does not clear eggs); meat that is not organic, non-GMO, or grass-fed / pasture-raised; dairy from a mainstream brand that is not organic, non-GMO, or grass-fed; and the clean-score additives (BHA, BHT, TBHQ, benzoates, sorbates, nitrites, polysorbates, mono- and diglycerides, DATEM, propylene glycol, titanium dioxide, potassium bromate, azodicarbonamide, MSG).
- **Yellow:** Dirty Dozen produce that isn’t organic; glyphosate-prone crops that are non-GMO but not organic; dairy (milk, cheese, yogurt, butter, cream, and the like) that isn’t organic, non-GMO, or grass-fed, when the brand isn’t mainstream; cane sugar, unnamed sugar, brown sugar, and agave; natural flavors; gums and carrageenan; other plant lecithins; sugar alcohols; organic enriched flour; caramel color.
- **Green:** olive, avocado, coconut, tallow, and lard; salt, water, herbs, and spices; organic glyphosate-prone crops; honey, maple syrup, and coconut sugar; dairy that is organic, non-GMO, or grass-fed (including from a known brand — the separate mainstream score penalty still applies); organic or pasture-raised eggs; meat that is organic, non-GMO, or grass-fed / pasture-raised; organic Dirty Dozen produce.

Almond milk, oat milk, soy milk, and coconut milk are not animal dairy. Oat milk and soy milk can still be red when the crop itself is conventional. Peanut butter, almond butter, and cocoa butter are not dairy. Beef tallow and lard stay on the fat rules.

**Dirty Dozen (2026).** Environmental Working Group, [Shopper’s Guide to Pesticides in Produce](https://www.ewg.org/foodnews/dirty-dozen.php): spinach; kale, collard, and mustard greens; strawberries; grapes; nectarines; peaches; cherries; apples; blackberries; pears; potatoes; blueberries. Organic on that ingredient phrase turns it green. Non-GMO does not, because this list is about pesticide residue. We don’t paint an item green just because the product name says organic. Raisins and sultanas count as grapes. Sweet potatoes, mustard the condiment, green beans, and bell peppers are not on the 2026 list. Potato starch counts as potatoes.

Organic or non-GMO on a refined corn or soy additive moves it from red to yellow. It does not make a seed oil okay. Organic on a glyphosate-prone crop, or on the product, clears that crop. Non-GMO alone turns it yellow.

Honey, maple syrup, and coconut sugar are not counted in the added-sugar score deduction. Cane sugar, unnamed sugar, and agave still are.

## Catalog, lab tests, and news

The bottom nav opens **Scan**, **Catalog**, **Household**, **Lab tests**, and **News**. Both catalogs are static JSON. There is no server. Scans check the shared food catalog, then the shared household catalog, then products saved on this phone, then Open Food Facts.

**Add a product in the app**

On the home screen, **Add a product** saves a food or household product in this browser (`localStorage`, key `tortuga.mine.v1`). There is no account and nothing is uploaded. The saved entry uses the same fields as `data/catalog.json` (`name`, `brand`, `barcode`, `ingredients`, `labels`, `labelsTags`) or `data/household.json`. It grades immediately with the certifications you marked.

**Grade a label by hand** has the same fields. Leave **Save this food on this phone** unchecked to grade without keeping it. The paste box on a missing barcode can save the same way.

Saved products are listed under **My products** on the home screen, and on the Catalog or Household tab. Open one to see the grade again, copy a JSON block for the shared catalog, or remove it from this phone. The same barcode replaces the copy already saved on this phone. A scan still opens the shared catalog when that barcode is already published there.

**Publish a product into the shared catalog**

The in-app list does not change `data/catalog.json`. To publish, open the saved product, copy the JSON block, and follow the steps below. Add a real source URL. Don’t invent ingredients.

## Household products

`data/household.json` is a starter list of laundry detergent, dish soap, and hand soap. Ingredient lists are copied from [Open Beauty Facts](https://world.openbeautyfacts.org/). We don’t invent ingredients.

The grade is **Tortuga’s own**. It follows the published [10 Commandments of Bobby Approved Ingredients](https://www.shopflavcity.com/pages/bobby-approved-app) (Bobby Parrish / FlavCity): free of seed oils, refined or artificial sugars, harmful preservatives, GMOs, artificial or “natural” flavors, harmful pesticides and chemicals, artificial colors, ultra-processed ingredients, harmful toxins, and harmful fragrances. It is **not** an official Bobby Approved score, badge, or certification. We don’t use the Bobby Approved app or its database.

On a household label we can actually read:

- **Fragrance, parfum, perfume** (and “fragrance allergen”) are a hard avoid: red, −40, and the household check fails. “Fragrance-free” and “unscented” do not count. A named essential oil, such as lavender oil, is not that umbrella term.
- **Isothiazolinones** (methylisothiazolinone, benzisothiazolinone, and the same family), **formaldehyde releasers** (DMDM hydantoin, quaternium-15, and the same family), **parabens**, and **triclosan** are red harmful preservatives (−22 each, max −44). Isothiazolinones are widely recognized skin sensitizers; methylisothiazolinone is banned in leave-on cosmetics in the EU.
- **Colorants** are red (−15). **Optical brighteners** (fluorescent brightener, distyrylbiphenyl disulfonate) are red (−22).
- **Seed oils** use the same list as food (−35). **Flavors** are red (−15).
- **Sodium benzoate, potassium sorbate, and phenoxyethanol** are yellow limits (−8 each, max −16) and do not fail the check by themselves.

Bands match the food score: 80–100 Cleaner, 50–79 Mixed, 0–49 Poor.

**Add a household product**

1. Open the product on Open Beauty Facts, Open Products Facts, or the brand’s ingredient page. Copy the ingredient list. Don’t invent one.
2. Add an object to `products` with `barcode`, `name`, `brand`, `category`, `ingredients`, `sourceName`, `sourceUrl`, and `added` (`YYYY-MM-DD`).
3. Grade it: `node -e "const R=require('./rules.js'); console.log(JSON.stringify(R.gradeHousehold(process.argv[1]),null,2))" "paste ingredients"`.
4. Copy `pass`, `score`, `band.id`, and `band.label` into `grade`.
5. Run `node tests/data.test.js`.

Lab tests are public results we looked up and summarized. Each one names the lab or publisher, the date, the findings with units, and a source link. A barcode is set only when the source names that product. Brand-only studies say so and do not pretend a catalog SKU was the bottle in the study.

News is a list of daily reports. The first one is **Monday, November 9, 2026** (`America/Los_Angeles`).

### `data/catalog.json`

```json
{
  "schemaVersion": 1,
  "updated": "2026-11-09",
  "products": [
    {
      "barcode": "041570054161",
      "name": "Product name",
      "brand": "Brand",
      "image": "https://images.openfoodfacts.org/...",
      "ingredients": "Water, almonds, sea salt",
      "ingredientsLang": "en",
      "labels": "Organic, Non-GMO Project",
      "labelsTags": ["en:organic"],
      "nova": 3,
      "nutriments": { "sugars100g": 0, "fat100g": 1.1 },
      "offUrl": "https://world.openfoodfacts.org/product/041570054161",
      "added": "2026-11-09",
      "quantity": "32 fl oz",
      "grade": {
        "sosPass": false,
        "gmoStatus": "non-gmo",
        "gmoLabel": "Non-GMO",
        "score": 76,
        "band": "mixed",
        "bandLabel": "Mixed"
      }
    }
  ]
}
```

`image`, `nova`, and `quantity` may be null or omitted. `grade` must match `rules.js` for the stored ingredients (the data test checks this). The phone grades again when you open a product, so the flags and colors always come from the engine.

**Add a food product to `data/catalog.json`**

1. Open the product on Open Food Facts and copy the real ingredient list. Don’t invent one.
2. Add an object to `products` with the fields above. `added` is the day you added it (`YYYY-MM-DD`).
3. Grade it with Node: `node -e "const R=require('./rules.js'); console.log(JSON.stringify(R.grade(process.argv[1],{novaGroup:3,sugars100g:0}),null,2))" "paste ingredients here"` and copy `sos.pass`, `gmo.status`, `gmo.label`, `score`, `band.id`, and `band.label` into `grade`.
4. Run `node tests/data.test.js`.

**Reseed from Open Food Facts** (optional, needs a network): `node scripts/seed-catalog.js`. It overwrites `data/catalog.json`. Don’t run it on a schedule unless you mean to replace hand-added products.

### `data/lab-tests.json`

```json
{
  "schemaVersion": 1,
  "tests": [
    {
      "id": "short-unique-id",
      "product": "What was tested, in plain language",
      "brand": "Brand or null",
      "barcode": "digits or null",
      "match": "sku",
      "scopeNote": "Say if this is one jar, a brand line, or a whole category.",
      "date": "2026-11-04",
      "lab": "Who measured it",
      "publisher": "Who published it",
      "summary": "A few sentences in our own words.",
      "findings": [{ "analyte": "Lead", "value": "2.118 ppm", "note": "Which sample." }],
      "sourceName": "FDA",
      "sourceUrl": "https://www.fda.gov/..."
    }
  ]
}
```

`match` is `sku` (barcode or exact product in the source), `brand-samples` (named brands, no barcode), `product-line`, or `category`. `brands` is an optional array when several brands were named and none has a barcode. `alsoSee` is an optional list of `{ "name", "url" }`.

Never type a number that isn’t in the source you opened. Don’t paste the article. Summarize and link.

### `data/news.json` — daily report

A daily routine should add **one report object at the start** of `reports` and publish the site (this repo’s GitHub Pages branch is `main`).

```json
{
  "id": "2026-11-10",
  "date": "2026-11-10",
  "timezone": "America/Los_Angeles",
  "title": "Tuesday, November 10, 2026",
  "dek": "One sentence on what today’s note covers.",
  "items": [
    {
      "id": "short-unique-id",
      "category": "recall",
      "headline": "Short headline",
      "summary": "A short paragraph in our own words. No invented products, quotes, or numbers.",
      "sourceName": "U.S. FDA",
      "sourceUrl": "https://www.fda.gov/...",
      "sourceDate": "2026-11-10",
      "labTestId": "optional-id-from-lab-tests.json"
    }
  ]
}
```

`category` is one of `launch`, `recall`, `alert`, `study`, `policy`, `lab`. `labTestId` is optional and opens that test from the News screen. `alsoSee` is an optional array of `{ "name", "url" }`.

**What the daily update should do**

1. Use the calendar date in **America/Los_Angeles**, including the weekday in `title`.
2. Open real sources (FDA, USDA, a journal, a publisher). Skip anything you can’t open.
3. Write a short summary. Don’t copy the article. Don’t invent a launch, a recall, a study, or a lab number.
4. Insert the report at the **top** of `reports` in `data/news.json`. Leave older reports in place.
5. If a story has a new public lab result with units, add that test to `data/lab-tests.json` too and set `labTestId`.
6. Run `node tests/data.test.js`.
7. Commit and push to the branch GitHub Pages serves (`main` for this repo). The phone loads JSON from the network first, so a reload shows the new report. If the screen looks stale, reload once so the service worker can replace the cached file.

## Credits

Product data © [Open Food Facts](https://world.openfoodfacts.org/) contributors, ODbL. Scanner: html5-qrcode (Apache-2.0).
