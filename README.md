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
index.html             App shell (PWA meta, header, views, dialog)
styles.css             Natural green / cream design, mobile-first
app.js                 Camera scanning, Open Food Facts lookup, rendering
rules.js               Rules engine (browser + Node), no dependencies
sw.js                  Service worker: caches the app shell (lookups still need network)
manifest.webmanifest   PWA manifest (Add to Home Screen)
icons/                 tortuga-logo.png (header), icon-192/512.png, apple-touch-icon.png, tortoise-mark.svg (fallback)
vendor/                html5-qrcode 2.3.8 (Apache-2.0), vendored
tests/rules.test.js    Node tests for the rules engine
.nojekyll              Serve files as-is on GitHub Pages
```

## Run / deploy

No build step.

- **Local:** `python3 -m http.server 8000` in this folder, then open <http://localhost:8000>. (Camera works on `localhost`; on a phone you need HTTPS.)
- **GitHub Pages:** push this folder as the repo root, then Settings → Pages → *Deploy from a branch* → `main` / `(root)`. Open the `https://<user>.github.io/<repo>/` link on the iPhone.
- **Add to Home Screen (iPhone):** open the link in Safari → Share → *Add to Home Screen*.
- **Tests:** `node tests/rules.test.js` (Node 18+; uses only `node:assert`).
- Deep link to a product: `?code=041570054161`.

## How it works

1. **Scan.** Tapping *Scan barcode* calls `Html5Qrcode.start({ facingMode: "environment" })` directly from the tap (required on iOS). The video is `playsinline` + `muted`. Formats: EAN-13, EAN-8, UPC-A, UPC-E. A code must pass the GTIN checksum and read the same twice in a row before we accept it. *Stop scanning* releases the camera; it's also released when the app goes to the background.
2. **Look up.** `GET https://world.openfoodfacts.org/api/v2/product/{code}.json?fields=code,product_name,product_name_en,brands,image_front_url,image_front_small_url,ingredients_text,ingredients_text_en,ingredients_text_fr,nova_group,nutriments,labels,labels_tags,quantity` with `User-Agent: TortugaScan/0.1 (personal clean-eating scanner prototype)`. (Browsers usually drop a custom `User-Agent` from `fetch`; OFF's CORS allows it, so it is sent where the browser permits.) We try the code as scanned, then the UPC-A ⇄ EAN-13 variant (add / remove a leading `0`), and UPC-E expanded to UPC-A.
3. **Missing data.** If the product isn't on Open Food Facts, or has no ingredient list, you get a paste-in box (with an optional product name, so “Organic” / “Non-GMO” claims count) and can grade any label by hand.
4. **Grade.** `rules.js` normalizes the text (lowercase, accents, OFF's `_allergen_` markup), drops cross-contact lines (“may contain…”, “made in a facility…”), and runs the rules below. Ingredient language preference: English, then the main list, then French (with a warning).

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
| Added sugar in ingredients (sugar, cane sugar, syrups, HFCS, dextrose, maltodextrin, honey, agave, molasses…) | −8 |
| …plus, only if added sugar is listed: sugars ≥ 15 g/100 g | −7 more |
| …or sugars ≥ 25 g/100 g (instead) | −12 more |
| NOVA group 4 / group 3 (from OFF) | −15 / −5 |

Bands: **80–100 Cleaner**, **50–79 Mixed**, **0–49 Poor**.

## iOS notes

- The camera only works over **HTTPS** (GitHub Pages is fine) or `localhost`.
- Permission is requested on the first tap of *Scan barcode*. If it was denied: Safari `aA` → Website Settings → Camera → Allow (or Settings → Safari → Camera). Home Screen apps keep their own permission and may ask again.
- iPhone Safari has no `BarcodeDetector`, so decoding uses html5-qrcode's built-in ZXing decoder. Hold the barcode flat, fill the frame, and use good light; manual entry is always available.
- Open Food Facts coverage of US products is good but not complete; ingredient lists can be stale.

## Credits

Product data © [Open Food Facts](https://world.openfoodfacts.org/) contributors, ODbL. Scanner: html5-qrcode (Apache-2.0).
