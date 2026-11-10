# Tortuga Scan

A personal, phone-first scanner for the grocery aisle and the laundry shelf. It is a static site (no build step, no server). Scan a barcode, type it, or paste an ingredient list.

You get:

1. **An Olive-style meter.** The arrow lands on **Avoid** (red, 0–44), **Limit** (yellow, 45–59), or **Eat as you like** (green, 60–100).
2. **Pass or Fail** on that same panel. Fail if the score is under 45. Pass at 45 or more.
3. **Torty**, the tortoise, saying what she thinks from the flags that are actually on the label.
4. **A Tortuga score, 0–100**, with the math shown. Floor is 0.
5. **Ingredient colors** (green / yellow / red) and an Ingredient Book of cleaned ingredient names, not raw label scraps.
6. **An approved store** of products that score 60 or more, with a Grok Bot link and a brand website when we have a real one.

> **Disclaimer.** Inspired by published Bobby Approved standards and an Olive-style meter. Not affiliated with FlavCity, Bobby Approved, Olive, or Seed Oil Scout. Not their score, badge, lab test, or certification. Grades use the ingredient list in our catalog, on Open Food Facts or Open Beauty Facts (which can be incomplete or out of date), or what you paste. We can’t verify manufacturing, cross-contact, or what a lab would find in the box. Always read the package.

The published standard we follow for the idea of the rules is the [10 Commandments of Bobby Approved Ingredients](https://www.shopflavcity.com/pages/bobby-approved-app). Tortuga does not use that app or its database. Seed oils are one Tortuga rule inside that idea. There is no Seed Oil Safe check and no SOS pass/fail.

## Files

```
index.html             App shell, tabs, forms
styles.css             Cream and olive, mobile-first
app.js                 Camera, routing, meter, Torty, store, book
rules.js               Rules engine (browser + Node)
sw.js                  Service worker (cache name tortuga-shell-v6)
404.html               GitHub Pages fallback so /product/… reloads
manifest.webmanifest   Add to Home Screen
data/catalog.json      Food catalog
data/household.json    Household catalog
data/websites.json     Brand homepages that were checked
data/lab-tests.json    Public lab tests we cite
data/news.json         Daily news reports
icons/torty-portrait.png   Torty, the talking mascot (cream background)
icons/tortuga-logo.png     Walking tortoise used as the app icon
scripts/seed-catalog.js    Optional: rebuild the food catalog from Open Food Facts
vendor/                html5-qrcode 2.3.8 (Apache-2.0)
tests/rules.test.js    Rules, meter, brands, routes
tests/data.test.js     Catalog, household, labs, news, shell
```

## Run / deploy

No build step.

- **Local:** `python3 -m http.server 8000` in this folder, then open <http://localhost:8000>. The camera works on `localhost`. A phone needs HTTPS.
- **GitHub Pages:** Settings → Pages → Deploy from a branch → `main` / `(root)`. Open the `https://` link in Safari.
- **Add to Home Screen (iPhone):** Share → Add to Home Screen.
- **Tests:** `node tests/rules.test.js` and `node tests/data.test.js` (Node 18+, `node:assert` only).

### Links

| What | URL |
|---|---|
| A product | `?code=0016000275287` or `?product=0016000275287` or `/product/0016000275287` |
| Catalog | `?tab=catalog` |
| Household inside the catalog | `?tab=household` |
| Store | `?tab=store` or `/store` |
| Ingredient book | `?tab=book` or `/ingredient/oats` |
| A brand | `/brand/cheerios` |
| News, lab tests | `?tab=news`, `?tab=labs` (both open More) |

On GitHub Pages, a reload of `/product/…`, `/brand/…`, `/ingredient/…`, or `/store` is served by `404.html`, which sends the browser back to the app and restores the page. Query links work everywhere, including a local static server.

## How a scan works

1. **Scan.** *Scan barcode* calls `Html5Qrcode.start({ facingMode: "environment" })` from the tap (required on iOS). The video is `playsinline` and muted. Formats: EAN-13, EAN-8, UPC-A, UPC-E. A code must pass the GTIN checksum and read the same twice in a row. *Stop scanning* releases the camera. So does leaving the app.
2. **Look up.** The barcode is checked against `data/catalog.json` (including UPC-A ⇄ EAN-13), then `data/household.json`, then products saved on this phone (`localStorage`, key `tortuga.mine.v1`). If it isn’t in any of those, we ask Open Food Facts and say so. Live request: `GET https://world.openfoodfacts.org/api/v2/product/{code}.json` with `User-Agent: TortugaScan/0.3 (personal clean-eating scanner)`. Browsers may drop a custom User-Agent. We try the scanned code, the UPC-A ⇄ EAN-13 form, and UPC-E expanded to UPC-A.
3. **Grade by hand / add a product.** Both live under **More**. Certification switches: Organic, Non-GMO, Grass-fed, Pasture-raised. A word already in the name or brand still counts. Household can record Fragrance-free or Unscented. Those words do not erase fragrance, parfum, or perfume in the ingredient list, and they are not a Bobby Approved badge.
4. **Photos.** Catalog and household cards use the `image` URL when the record has one (Open Food Facts or Open Beauty Facts front-of-pack). If that URL fails, the card shows a placeholder. On a product with no photo, or to override one, *Take a photo* or *Choose a photo* stores a resized JPEG in IndexedDB (`tortuga-photos`) on this phone. Nothing is uploaded.
5. **Pages.** A product tap opens its page: photo, meter, Torty, flags, and More (colored ingredients linking into the book, nutrition when we have it, GMO, sources). A brand tap opens that brand’s food and household items. **Tortuga Certified Clean Brand** means every catalog item for that brand scores **above 60**. **Tortuga Certified Garbage Brand** means every one scores **below 35**. Anything mixed gets neither badge. The page says the label uses only the products in this catalog, not the brand’s full lineup, and that it is Tortuga’s own label.

## The score

Start at 100. Subtract. Stop at 0.

| Rule | Points |
|---|---|
| Seed oil | −56 |
| Each other avoid category (soy, artificial sweetener, gum, plant lecithin, natural flavor, dye) | −14 |
| GMO confirmed / possible GMO | −16 / −10 |
| Other additives (BHA, BHT, TBHQ, benzoates, sorbates, nitrites, polysorbates, mono- and diglycerides, DATEM, propylene glycol, titanium dioxide, potassium bromate, azodicarbonamide, artificial flavor, MSG) | −10 each, max −30 |
| Added sugar in the ingredients. Honey, maple syrup, and coconut sugar are not deducted | −10 |
| …and, only if added sugar is listed, sugars ≥ 15 g/100 g | −8 more |
| …or sugars ≥ 25 g/100 g (instead) | −14 more |
| NOVA 4 / NOVA 3 | −30 / −8 |
| Glyphosate-prone crop, conventional, once | −41 |
| Glyphosate-prone crop, non-GMO but not organic | −12 |
| Refined starch (corn starch, or modified food starch that isn’t a named potato, tapioca, rice, arrowroot, or cassava starch) | −12 each, max −24 |
| Mainstream brand, once | −8 |
| Stacked flags: 3 or more of the groups above, not counting the mainstream line or NOVA 3 | −4 per group past the second, max −16 |

A seed oil alone is 44, which is a Fail on Avoid. A single conventional glyphosate-prone crop is 59, Limit, Pass. Organic still clears that crop completely. Non-GMO without organic still costs 12 and does not fully pass the crop check. Those certifications do not waive a seed oil, refined starch, Dirty Dozen produce, or the mainstream penalty.

**Meter.** Avoid 0–44 Fail. Limit 45–59 Pass. Eat as you like 60–100 Pass.

**Mainstream (−8).** Once, when the brand or the product name matches a well-known mass-market packaged-food brand (General Mills, Cheerios, Kellogg’s, Nestlé, Coca-Cola, Pepsi, Kraft, Heinz, Post, and the same kind of grocery name). Not a map of which company owns which brand. Plain salt from a mainstream name stays in Eat. A processed one usually does not.

**Glyphosate-prone crops.** Tortuga’s own check, not a lab test of that barcode. Wheat (including wheat flour when the flour isn’t another grain), oats, barley, rye, sorghum, millet, corn, dry beans, chickpeas, lentils, peas (not snap or snow peas), soy foods, sunflower, flax, canola, cottonseed, and sugar beet. Organic on the ingredient or the product is green and a full pass. Non-GMO only is yellow. Rice, quinoa, buckwheat, potatoes, green beans, and snap peas are not on the list. Lecithin keeps its own color.

Sources for the crop list, not numbers we measured: [CFIA, glyphosate testing in 2015–2016](https://open-science.canada.ca/handle/123456789/3743), [EWG’s 2018 oat-cereal tests](https://www.ewg.org/news-insights/news/2018/10/new-round-ewg-testing-finds-glyphosate-kids-breakfast-foods-quaker-oats), and the [EPA glyphosate page](https://www.epa.gov/ingredients-used-pesticide-products/glyphosate).

**Stack.** A product with several flag groups at once cannot sit in the 50s on the strength of any one of them being small. Mainstream brand and NOVA 3 are not stack groups.

## Ingredient colors

Each ingredient line is green, yellow, or red. This is separate from the meter, and the book explains the color in a short original note.

- **Red:** seed oils (even if the line says organic); artificial sweeteners, dyes, and flavors; confirmed GMO wording; conventional corn starch, corn syrup, dextrose, and maltodextrin; modified food starch when the source isn’t named; soy protein, soy flour, soy lecithin, and TVP; conventional glyphosate-prone crops; eggs that are not organic or pasture-raised; meat that is not organic, non-GMO, or grass-fed / pasture-raised; dairy from a mainstream brand that is not organic, non-GMO, or grass-fed; and the clean-score additives.
- **Yellow:** Dirty Dozen produce that isn’t organic; glyphosate-prone crops that are non-GMO but not organic; dairy that isn’t organic, non-GMO, or grass-fed, when the brand isn’t mainstream; cane sugar, unnamed sugar, brown sugar, and agave; natural flavors; gums and carrageenan; other plant lecithins; sugar alcohols; organic enriched flour; caramel color.
- **Green:** olive, avocado, coconut, tallow, and lard; salt, water, herbs, and spices; organic glyphosate-prone crops; honey, maple syrup, and coconut sugar; dairy that is organic, non-GMO, or grass-fed; organic or pasture-raised eggs; meat that is organic, non-GMO, or grass-fed / pasture-raised; organic Dirty Dozen produce.

**Dirty Dozen (2026).** [EWG Shopper’s Guide](https://www.ewg.org/foodnews/dirty-dozen.php): spinach; kale, collard, and mustard greens; strawberries; grapes; nectarines; peaches; cherries; apples; blackberries; pears; potatoes; blueberries. Organic on that ingredient phrase turns it green. Non-GMO does not. Raisins count as grapes. Sweet potatoes, mustard the condiment, green beans, and bell peppers are not on the 2026 list.

Milk and eggs do not change the score by themselves. See the colors. A mainstream dairy brand still pays the −8 brand penalty, and the dairy line can be red.

## Household

`data/household.json` is laundry detergent, dish soap, hand soap, and a few other cleaners. Ingredient lists are copied from [Open Beauty Facts](https://world.openbeautyfacts.org/) or [Open Products Facts](https://world.openproductsfacts.org/). We don’t invent ingredients. Each product has a `sourceUrl`.

The grade is Tortuga’s own, on the same meter. It is not an official Bobby Approved score.

- **Fragrance, parfum, perfume** are a hard avoid (−56). Two or more named fragrance allergens (linalool, limonene, geraniol, and the same family), when the label does not name an essential oil, count as that umbrella. “Fragrance-free” and “unscented” do not. A named essential oil, such as lavender oil, is not the umbrella.
- **Isothiazolinones, formaldehyde releasers, parabens, triclosan:** −42 each, max −84.
- **Colorants**, including CI numbers, and **optical brighteners:** −42.
- **Seed oils:** −56, same list as food, including INCI such as *Helianthus annuus seed oil*.
- **Flavors:** −42.
- **Sodium benzoate, potassium sorbate, phenoxyethanol:** −8 each, max −16. They do not fail the meter by themselves.
- Two or more red groups add a stack of −8 per extra group, max −18.

## Store and websites

The store lists food and household products with a score of 60 or more. **Buy with Grok Bot** opens:

`grokbot://app/v1/agent?id=a4483b75-73bb-47ac-8893-938cbf85736a`

plus `&q=` and the product name. That is a Grok Bot app link. This site cannot check out. **Go to website** appears only when `data/websites.json` has a homepage we actually opened for that brand. Most products do not have one. We do not invent prices or retailer URLs.

## iOS notes

- The camera only works over **HTTPS** (GitHub Pages is fine) or `localhost`.
- Permission is requested on the first tap of *Scan barcode*. If it was denied: Safari `aA` → Website Settings → Camera → Allow. Home Screen apps keep their own permission.
- iPhone Safari has no `BarcodeDetector`, so decoding uses html5-qrcode’s ZXing decoder. Hold the barcode flat and use good light. Typing the number always works.
- Taking a package photo uses the file input with `capture="environment"`, which opens the camera on an iPhone.

## Saved products

**Add a product** stores a food or household item in this browser (`localStorage`, key `tortuga.mine.v1`). There is no account and nothing is uploaded. A package photo, if you take one, goes to IndexedDB instead of the product record. The saved entry uses the same fields as the catalog JSON, including `labels` and `labelsTags` from the certification switches. A scan still opens the shared catalog when that barcode is already published there.

**Grade a label by hand** can save the same way. Leave the checkbox off to grade without keeping it.

## `data/catalog.json`

`grade` must match `rules.js`. The phone grades again when you open a product.

```json
"grade": {
  "pass": false,
  "avoidPass": true,
  "gmoStatus": "possible",
  "gmoLabel": "Possible GMO — not confirmed",
  "score": 11,
  "band": "avoid",
  "bandLabel": "Avoid"
}
```

`pass` is the meter (score ≥ 45). `avoidPass` means none of the avoid-ingredient categories matched (seed oil, soy, sweetener, gum, lecithin, natural flavor, dye). That is not a third-party badge. `band` is `avoid`, `limit`, or `eat`.

**Add a food product**

1. Copy the real ingredient list from Open Food Facts. Don’t invent one.
2. Add the object. `added` is `YYYY-MM-DD`. Use an `image` URL from Open Food Facts when the product page has a front photo. Leave it off when it doesn’t.
3. Grade it: `node -e "const R=require('./rules.js'); const g=R.grade(process.argv[1],{novaGroup:3,sugars100g:0}); console.log(g.score, g.pass, g.band.id)" "ingredients"`.
4. Copy `pass`, `sos.pass` into `avoidPass`, `gmo.status`, `gmo.label`, `score`, `band.id`, and `band.label`.
5. Run `node tests/data.test.js`.

**Reseed from Open Food Facts** (optional, needs a network): `node scripts/seed-catalog.js`. It overwrites `data/catalog.json`.

## `data/household.json`

1. Copy the ingredient list from Open Beauty Facts, Open Products Facts, or the brand’s own ingredient page. Don’t invent one.
2. Add `barcode`, `name`, `brand`, `category`, `ingredients`, `sourceName`, `sourceUrl`, and `added`.
3. Grade it: `node -e "const R=require('./rules.js'); const g=R.gradeHousehold(process.argv[1]); console.log(g.score, g.pass, g.band)" "ingredients"`.
4. Run `node tests/data.test.js`.

## Lab tests and news

Unchanged in shape. Lab tests are public results we looked up. A barcode is set only when the source names that product. News is a list of daily reports. The first one is **Monday, November 9, 2026** (`America/Los_Angeles`). Don’t invent a recall, a study, or a lab number. Summarize and link.

## Credits

Product data © [Open Food Facts](https://world.openfoodfacts.org/), [Open Beauty Facts](https://world.openbeautyfacts.org/), and [Open Products Facts](https://world.openproductsfacts.org/) contributors, ODbL. Scanner: html5-qrcode (Apache-2.0). Torty is original artwork for this app.
