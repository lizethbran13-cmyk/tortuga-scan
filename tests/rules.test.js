// Run: node tests/rules.test.js
'use strict';
const assert = require('node:assert/strict');
const R = require('../rules.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message.split('\n').join('\n      ')); }
}
const cat = (r, id) => r.sos.categories.find(c => c.id === id);
const fails = (text, id) => cat(R.grade(text), id).failed;

console.log('Seed oils');
test('olive oil does not fail', () => assert.equal(fails('extra virgin olive oil, sea salt', 'seedOils'), false));
test('avocado oil does not fail', () => assert.equal(fails('avocado oil', 'seedOils'), false));
test('butter does not fail', () => assert.equal(fails('cream, butter, salt', 'seedOils'), false));
test('other OK fats do not fail (coconut, MCT, ghee, tallow, lard, palm, sesame, flax, walnut, almond, peanut, macadamia)', () => {
  assert.equal(fails('coconut oil, mct oil, ghee, beef tallow, lard, palm oil, toasted sesame oil, flaxseed oil, linseed oil, walnut oil, almond oil, peanut oil, macadamia nut oil', 'seedOils'), false);
});
test('vegetable oil fails', () => assert.equal(fails('flour, vegetable oil, salt', 'seedOils'), true));
test('vegetable oils fails', () => assert.equal(fails('vegetable oils (palm, rapeseed)', 'seedOils'), true));
test('vegetable shortening fails', () => assert.equal(fails('flour, vegetable shortening', 'seedOils'), true));
test('canola oil fails', () => assert.equal(fails('canola oil', 'seedOils'), true));
test('expeller-pressed canola oil fails', () => assert.equal(fails('organic expeller-pressed canola oil', 'seedOils'), true));
test('high oleic sunflower oil fails', () => assert.equal(fails('potatoes, high oleic sunflower oil, salt', 'seedOils'), true));
test('high-oleic safflower oil fails', () => assert.equal(fails('high-oleic safflower oil', 'seedOils'), true));
test('"canola and/or sunflower oil" flags both', () => {
  const hits = cat(R.grade('canola and/or sunflower oil'), 'seedOils').hits.map(h => h.rule);
  assert.ok(hits.includes('Canola oil') && hits.includes('Sunflower oil'), hits.join(','));
});
test('"olive and/or canola oil" fails (canola) but not for olive', () => {
  const hits = cat(R.grade('olive and/or canola oil'), 'seedOils').hits.map(h => h.rule);
  assert.deepEqual(hits, ['Canola oil']);
});
test('grape seed / cottonseed / rice bran / soybean / rapeseed oils fail', () => {
  for (const s of ['grape seed oil', 'grapeseed oil', 'cottonseed oil', 'rice bran oil', 'soybean oil', 'soy bean oil', 'rapeseed oil', 'partially hydrogenated soybean oil', 'maize oil'])
    assert.equal(fails(s, 'seedOils'), true, s);
});
test('corn does not fail as corn oil', () => assert.equal(fails('whole grain corn, water, lime', 'seedOils'), false));
test('corn starch / corn syrup do not fail as corn oil', () => {
  assert.equal(fails('corn starch, corn syrup, corn flour', 'seedOils'), false);
});
test('"corn, olive oil" does not fail as corn oil', () => assert.equal(fails('ground corn, olive oil, salt', 'seedOils'), false));
test('corn oil fails', () => assert.equal(fails('corn oil', 'seedOils'), true));
test('sunflower seeds do not fail seed oil', () => assert.equal(fails('sunflower seeds, sea salt', 'seedOils'), false));
test('sunflower lecithin is not a seed oil', () => assert.equal(fails('cocoa butter, sunflower lecithin', 'seedOils'), false));
test('oil parenthetical "vegetable oil (sunflower)" reports sunflower', () => {
  const hits = cat(R.grade('vegetable oil (sunflower)'), 'seedOils').hits.map(h => h.rule);
  assert.ok(hits.includes('Sunflower oil'), hits.join(','));
});

console.log('Soy');
test('soy protein fails soy', () => assert.equal(fails('soy protein isolate', 'soy'), true));
test('soy lecithin fails soy', () => assert.equal(fails('soy lecithin', 'soy'), true));
test('soy lecithin also fails plant lecithin', () => assert.equal(fails('soy lecithin', 'lecithins'), true));
test('soy sauce, tamari, tofu, tempeh, miso, edamame fail soy', () => {
  for (const s of ['soy sauce', 'tamari', 'tofu', 'tempeh', 'white miso', 'edamame', 'natto', 'hydrolyzed soy protein', 'textured soy protein', 'lecithins (_soya_)'])
    assert.equal(fails(s, 'soy'), true, s);
});
test('soybean oil is graded as a seed oil, not double-counted as soy', () => {
  const r = R.grade('soybean oil');
  assert.equal(cat(r, 'seedOils').failed, true);
  assert.equal(cat(r, 'soy').failed, false);
});
test('sunflower lecithin fails plant lecithin but not soy', () => {
  const r = R.grade('sugar, cocoa butter, sunflower lecithin');
  assert.equal(cat(r, 'lecithins').failed, true);
  assert.equal(cat(r, 'soy').failed, false);
});
test('bare lecithin flags as likely plant lecithin with a note', () => {
  const h = cat(R.grade('cocoa, lecithin, vanilla'), 'lecithins').hits;
  assert.equal(h.length, 1);
  assert.ok(/likely/i.test(h[0].note));
});
test('egg lecithin does not flag', () => assert.equal(fails('egg lecithin', 'lecithins'), false));
test('"may contain soy" cross-contact line is ignored', () => {
  const r = R.grade('almonds, sea salt. May contain traces of soy and peanuts.');
  assert.equal(cat(r, 'soy').failed, false);
  assert.equal(r.ignored.length, 1);
});

console.log('Sweeteners');
test('sucralose fails', () => assert.equal(fails('water, sucralose', 'sweeteners'), true));
test('ace-K / acesulfame potassium / aspartame fail', () => {
  for (const s of ['acesulfame potassium', 'acesulfame k', 'ace-k', 'aspartame', 'saccharin', 'neotame', 'E950'])
    assert.equal(fails(s, 'sweeteners'), true, s);
});
test('stevia, monk fruit, erythritol, xylitol, allulose do not fail', () => {
  assert.equal(fails('stevia leaf extract, monk fruit extract, erythritol, xylitol, allulose', 'sweeteners'), false);
});

console.log('Gums');
test('xanthan, guar, gellan, locust bean, gum arabic, cellulose gum, carrageenan fail', () => {
  for (const s of ['xanthan gum', 'guar gum', 'gellan gum', 'locust bean gum', 'carob bean gum', 'gum arabic', 'acacia gum', 'cellulose gum', 'carboxymethylcellulose', 'tara gum', 'gum karaya', 'tragacanth', 'carrageenan'])
    assert.equal(fails(s, 'gums'), true, s);
});
test('carob powder and acacia honey do not fail gums', () => assert.equal(fails('carob powder, acacia honey', 'gums'), false));

console.log('Natural flavors and dyes');
test('natural flavors fails', () => assert.equal(fails('water, natural flavors', 'naturalFlavors'), true));
test('natural flavour / natural flavoring / natural vanilla flavor fail', () => {
  for (const s of ['natural flavour', 'natural flavoring', 'natural vanilla flavor', 'natural and artificial flavors'])
    assert.equal(fails(s, 'naturalFlavors'), true, s);
});
test('paprika does not fail dyes', () => assert.equal(fails('paprika', 'dyes'), false));
test('turmeric, annatto, beet juice do not fail dyes', () => assert.equal(fails('turmeric, annatto, beet juice (for color)', 'dyes'), false));
test('red bell pepper does not fail dyes', () => assert.equal(fails('red bell pepper, red onion', 'dyes'), false));
test('Red 40 fails dyes', () => assert.equal(fails('sugar, red 40', 'dyes'), true));
test('Yellow 5, Blue 1 Lake, FD&C Red No. 3, E129, tartrazine, artificial color fail', () => {
  for (const s of ['yellow 5', 'blue 1 lake', 'fd&c red no. 3', 'E129', 'e-102', 'tartrazine', 'artificial color', 'artificial colours'])
    assert.equal(fails(s, 'dyes'), true, s);
});

console.log('Score');
test('"organic whole milk, sea salt" passes SOS and scores high', () => {
  const r = R.grade('organic whole milk, sea salt');
  assert.equal(r.sos.pass, true);
  assert.ok(r.score >= 90, 'score ' + r.score);
  assert.equal(r.band.label, 'Cleaner');
});
test('junk list fails many categories and scores low', () => {
  const r = R.grade('enriched flour, sugar, canola oil, soy lecithin, natural flavors, red 40, xanthan gum, tbhq', { novaGroup: 4, sugars100g: 30 });
  const failedIds = r.sos.categories.filter(c => c.failed).map(c => c.id);
  assert.equal(r.sos.pass, false);
  for (const id of ['seedOils', 'soy', 'lecithins', 'naturalFlavors', 'dyes', 'gums']) assert.ok(failedIds.includes(id), 'missing ' + id);
  assert.ok(r.score < 50, 'score ' + r.score);
  assert.equal(r.band.label, 'Poor');
  assert.equal(r.score, 0); // seed oil, categories, sugar, GMO, NOVA 4, glyphosate crops, refined starch — floors at 0
});
test('junk list without nutriments still scores low', () => {
  const r = R.grade('canola oil, soy lecithin, natural flavors, red 40, xanthan gum');
  assert.ok(r.score < 50, 'score ' + r.score);
});
test('score math adds up exactly', () => {
  const r = R.grade('oats, cane sugar, sea salt, natural flavor', { novaGroup: 3, sugars100g: 18 });
  // 100 - natural flavor 12 - sugar 8 - high sugar 7 - NOVA 3 (5) - conventional oats 35 = 33
  assert.equal(r.score, 33);
  assert.equal(r.band.label, 'Poor');
  assert.equal(r.glyphosate.pass, false);
  assert.equal(100 - r.deductions.reduce((s, d) => s + d.points, 0), 33);
});
test('additive bucket caps at 24', () => {
  const r = R.grade('water, bha, bht, tbhq, sodium benzoate, potassium sorbate, polysorbate 80');
  const d = r.deductions.find(x => /additives/i.test(x.label));
  assert.equal(d.points, 24);
});
test('high sugar extra only applies when added sugar is listed', () => {
  const r = R.grade('raisins', { sugars100g: 59 });
  assert.equal(r.score, 100);
});
test('"no sugar added" is not counted as sugar', () => assert.equal(R.grade('apples. no sugar added').sugars.length, 0));
test('mono- and diglycerides counts as additive', () => assert.equal(R.grade('mono- and diglycerides').additives.length, 1));

console.log('GMO (Tortuga Scan check)');
const gmo = (text, opts) => R.grade(text, opts).gmo;
test('bioengineered disclosure is confirmed GMO', () => assert.equal(gmo('corn, sugar. contains bioengineered food ingredients').status, 'gmo'));
test('"genetically modified soy" is confirmed GMO', () => assert.equal(gmo('genetically modified soy flour, water').status, 'gmo'));
test('OFF label tag en:contains-gmos is confirmed GMO', () => assert.equal(gmo('corn', { labelsTags: ['en:contains-gmos'] }).status, 'gmo'));
test('"derived from bioengineering" in labels is confirmed GMO', () => assert.equal(gmo('sugar', { labels: 'Ingredient(s) derived from bioengineering' }).status, 'gmo'));
test('confirmed GMO deducts 12 and does not change the SOS pass', () => {
  const r = R.grade('water, sea salt. bioengineered');
  assert.equal(r.score, 88); assert.equal(r.sos.pass, true);
});
test('Non-GMO Project label is non-GMO, even with corn', () => {
  const g = gmo('corn, sea salt', { labels: 'Non GMO project', labelsTags: ['en:no-gmos', 'en:non-gmo-project'] });
  assert.equal(g.status, 'non-gmo'); assert.equal(g.points, 0);
});
test('USDA Organic label is not GMO', () => {
  const g = gmo('organic corn, organic cane sugar', { labelsTags: ['en:organic', 'en:usda-organic'] });
  assert.equal(g.status, 'non-gmo'); assert.ok(g.claims.includes('Certified organic'));
});
test('"non-GMO" is not mistaken for GMO', () => assert.notEqual(gmo('non-gmo corn, salt. no gmos').status, 'gmo'));
test('organic corn / soy / canola in the ingredients are not a GMO caution', () => {
  assert.equal(gmo('organic corn, organic soybeans, organic expeller pressed canola oil').status, 'none');
});
test('conventional corn + sugar with no claim is a possible-GMO caution (-6), not a fail', () => {
  const r = R.grade('whole grain corn, sugar, salt');
  assert.equal(r.gmo.status, 'possible'); assert.equal(r.gmo.points, 6);
  assert.ok(r.deductions.some(d => /Possible GMO/.test(d.label) && d.points === 6));
});
test('cane sugar alone is not a GMO caution', () => assert.equal(gmo('oats, cane sugar, salt').status, 'none'));
test('plain sugar is a possible GMO caution', () => assert.equal(gmo('oats, sugar').status, 'possible'));
test('canola oil without claims is a possible GMO caution', () => assert.equal(gmo('canola oil').status, 'possible'));
test('clean milk list has no GMO indicators', () => assert.equal(gmo('organic whole milk, sea salt').status, 'none'));

console.log('Barcodes');
test('12-digit UPC-A also tries EAN-13 with leading 0', () => assert.deepEqual(R.barcodeCandidates('049000006346'), ['049000006346', '0049000006346']));
test('EAN-13 with leading 0 also tries UPC-A', () => assert.deepEqual(R.barcodeCandidates('0049000006346'), ['0049000006346', '049000006346']));
test('UPC-E expands to UPC-A', () => assert.equal(R.upcEtoUpcA('04252614'), '042100005264'));
test('non-digits are stripped', () => assert.equal(R.barcodeCandidates(' 3017-6240 10701 ')[0], '3017624010701'));

console.log('Traffic light');
const leaf = (text) => {
  const out = [];
  (function walk(items) {
    items.forEach(i => {
      if (i.children && i.children.length) walk(i.children);
      else out.push(i.color);
    });
  })(R.classifyIngredients(text).items);
  return out;
};
const one = (text) => R.classifyIngredients(text).items[0];

test('olive, avocado, coconut, tallow, and lard stay green', () => {
  for (const s of ['extra virgin olive oil', 'avocado oil', 'coconut oil', 'beef tallow', 'lard', 'palm oil', 'toasted sesame oil', 'sea salt', 'filtered water', 'almond butter', 'cocoa butter'])
    assert.equal(one(s).color, 'green', s);
});
test('seed oils are red, including organic canola', () => {
  for (const s of ['canola oil', 'organic canola oil', 'high oleic sunflower oil', 'vegetable oil', 'soybean oil', 'grapeseed oil', 'rice bran oil'])
    assert.equal(one(s).color, 'red', s);
});
test('sunflower seeds are a glyphosate crop; sunflower lecithin stays yellow', () => {
  assert.equal(one('sunflower seeds').color, 'red');
  assert.equal(fails('sunflower seeds', 'seedOils'), false);
  assert.equal(one('sunflower lecithin').color, 'yellow');
  assert.ok(!/Glyphosate/.test((one('sunflower lecithin').reasons[0] || {}).label || ''));
});
test('olive and/or canola oil is red', () => assert.equal(one('olive and/or canola oil').color, 'red'));
test('ground corn is not red corn oil; conventional corn and corn starch are red', () => {
  assert.equal(fails('ground corn', 'seedOils'), false);
  assert.equal(one('ground corn').color, 'red');
  assert.ok(/Glyphosate-prone crop · Corn/.test(one('ground corn').reasons[0].label));
  assert.equal(one('corn starch').color, 'red');
  assert.equal(one('organic corn starch').color, 'yellow');
  assert.equal(one('non-gmo corn starch').color, 'yellow');
  assert.equal(one('organic corn').color, 'green');
  assert.equal(one('non-gmo corn').color, 'yellow');
});
test('refined sugar is yellow; honey, maple, and coconut sugar are green', () => {
  assert.equal(one('sugar').color, 'yellow');
  assert.equal(one('brown sugar').color, 'yellow');
  assert.equal(one('cane sugar').color, 'yellow');
  assert.equal(one('organic cane sugar').color, 'yellow');
  assert.equal(one('organic sugar').color, 'yellow');
  assert.equal(one('agave').color, 'yellow');
  assert.equal(one('beet sugar').color, 'red');
  assert.equal(one('honey').color, 'green');
  assert.equal(one('maple syrup').color, 'green');
  assert.equal(one('coconut sugar').color, 'green');
  assert.equal(one('sugar snap peas').color, 'green');
  assert.equal(R.grade('honey').score, 100);
});
test('artificial sweeteners, dyes, and flavors are red; natural flavors and stevia are not', () => {
  assert.equal(one('sucralose').color, 'red');
  assert.equal(one('red 40').color, 'red');
  assert.equal(one('artificial flavors').color, 'red');
  assert.equal(one('natural and artificial flavors').color, 'red');
  assert.equal(one('natural flavors').color, 'yellow');
  assert.equal(one('natural vanilla flavor').color, 'yellow');
  assert.equal(one('stevia leaf extract').color, 'green');
  assert.equal(one('monk fruit extract').color, 'green');
  assert.equal(one('erythritol').color, 'yellow');
});
test('gums and carrageenan are yellow; carob powder is green', () => {
  assert.equal(one('xanthan gum').color, 'yellow');
  assert.equal(one('gellan gum').color, 'yellow');
  assert.equal(one('carrageenan').color, 'yellow');
  assert.equal(one('carob powder').color, 'green');
  assert.equal(one('acacia honey').color, 'green');
  assert.equal(fails('acacia honey', 'gums'), false);
});
test('soy lecithin and soy protein are red; conventional tofu is red; organic soy stays milder', () => {
  assert.equal(one('soy lecithin').color, 'red');
  assert.equal(one('soy protein isolate').color, 'red');
  assert.equal(one('textured vegetable protein').color, 'red');
  assert.equal(one('tofu').color, 'red');
  assert.equal(one('organic tofu').color, 'yellow');
  assert.equal(one('organic soy lecithin').color, 'yellow');
  assert.equal(one('egg lecithin').color, 'red');
});
test('confirmed GMO wording is red; non-GMO corn is yellow, not red', () => {
  assert.equal(one('bioengineered corn').color, 'red');
  assert.equal(one('non-gmo corn').color, 'yellow');
});
test('2026 Dirty Dozen: conventional yellow, organic green, sweet potato and mustard are not', () => {
  for (const s of ['spinach', 'kale', 'strawberries', 'grapes', 'raisins', 'nectarines', 'peaches', 'cherries', 'apples', 'blackberries', 'pears', 'potatoes', 'blueberries', 'collard greens', 'mustard greens'])
    assert.equal(one(s).color, 'yellow', s);
  assert.equal(one('organic strawberries').color, 'green');
  assert.equal(one('organic baby spinach').color, 'green');
  assert.equal(one('non-gmo strawberries').color, 'yellow');
  assert.equal(one('sweet potato').color, 'green');
  assert.equal(one('dijon mustard').color, 'green');
  assert.equal(one('green beans').color, 'green');
  assert.equal(one('bell peppers').color, 'green');
  assert.equal(one('cherry tomatoes').color, 'green');
  assert.equal(one('apple cider vinegar').color, 'green');
  assert.equal(one('pineapple').color, 'green');
  assert.ok(/Dirty Dozen 2026/.test(one('spinach').reasons[0].label));
});
test('grapeseed oil is red, not a Dirty Dozen grape', () => {
  const item = one('grapeseed oil');
  assert.equal(item.color, 'red');
  assert.ok(item.reasons.every(r => !/Dirty Dozen/.test(r.label)));
});
test('worse additives are red; conventional wheat flour is red; caramel color is yellow', () => {
  for (const s of ['bha', 'tbhq', 'monosodium glutamate', 'titanium dioxide', 'dextrose', 'maltodextrin'])
    assert.equal(one(s).color, 'red', s);
  assert.equal(one('organic maltodextrin').color, 'yellow');
  assert.equal(one('tapioca maltodextrin').color, 'yellow');
  assert.equal(one('enriched flour').color, 'red');
  assert.equal(one('organic enriched wheat flour').color, 'yellow');
  assert.equal(one('whole wheat flour').color, 'red');
  assert.equal(one('organic whole wheat flour').color, 'green');
  assert.equal(one('caramel color').color, 'yellow');
  assert.equal(one('paprika').color, 'green');
});
test('modified food starch is red unless a non-corn source is named', () => {
  assert.equal(one('modified food starch').color, 'red');
  const tapioca = one('modified food starch (tapioca)');
  assert.equal(tapioca.color, 'green');
});
test('parent color follows the worst child, and cross-contact is not graded', () => {
  const chips = one('chocolate chips (cane sugar, cocoa butter, soy lecithin)');
  assert.equal(chips.color, 'red');
  assert.equal(chips.children[0].color, 'yellow');
  assert.equal(chips.children[1].color, 'green');
  assert.equal(chips.children[2].color, 'red');
  assert.equal(one('may contain traces of soy and peanuts').color, 'none');
});
test('almondmilk label: natural flavors, lecithin, and gum are yellow; water is green', () => {
  const text = 'ALMONDMILK (FILTERED WATER, ALMONDS), CALCIUM CARBONATE, NATURAL FLAVORS, SEA SALT, SUNFLOWER LECITHIN, GELLAN GUM, VITAMIN D2.';
  const items = R.classifyIngredients(text).items;
  const by = {};
  items.forEach(i => { by[i.text.toLowerCase()] = i; });
  assert.equal(by['almondmilk'].color, 'green');
  assert.equal(by['almondmilk'].children[0].color, 'green');
  assert.equal(by['natural flavors'].color, 'yellow');
  assert.equal(by['sunflower lecithin'].color, 'yellow');
  assert.equal(by['gellan gum'].color, 'yellow');
  assert.equal(by['sea salt'].color, 'green');
});
test('cheerios-style list can pass SOS and still have red ingredients', () => {
  const text = 'whole grain oats, corn starch, sugar, salt, tripotassium phosphate';
  const g = R.grade(text);
  assert.equal(g.sos.pass, true);
  const cols = leaf(text);
  assert.deepEqual(cols, ['red', 'red', 'yellow', 'green', 'green']);
});
console.log('Clean score overhaul');
const pts = (r, re) => {
  const d = r.deductions.find(x => re.test(x.label));
  return d ? d.points : 0;
};
test('plain olive oil from a small brand stays 100 and green', () => {
  const r = R.grade('extra virgin olive oil', { brand: 'California Olive Ranch' });
  assert.equal(r.score, 100);
  assert.equal(r.band.label, 'Cleaner');
  assert.equal(r.glyphosate.pass, true);
  assert.equal(r.mainstream, null);
  assert.equal(one('extra virgin olive oil').color, 'green');
});
test('organic oats pass; non-GMO oats are yellow; conventional oats are red', () => {
  const plain = R.grade('rolled oats', { brand: 'Local mill' });
  assert.equal(plain.score, 65);
  assert.equal(plain.band.label, 'Mixed');
  assert.equal(plain.glyphosate.status, 'fail');
  assert.equal(pts(plain, /Glyphosate/), 35);
  assert.equal(one('rolled oats').color, 'red');
  const organic = R.grade('organic rolled oats', { brand: 'Local mill' });
  assert.equal(organic.score, 100);
  assert.equal(organic.glyphosate.pass, true);
  assert.equal(one('organic rolled oats').color, 'green');
  const claimed = R.grade('rolled oats', { productName: 'Organic rolled oats', brand: 'Local mill' });
  assert.equal(claimed.score, 100);
  assert.equal(claimed.glyphosate.cleared, true);
  const nongmo = R.grade('non-gmo rolled oats');
  assert.equal(nongmo.glyphosate.status, 'limit');
  assert.equal(nongmo.glyphosate.pass, false);
  assert.equal(nongmo.score, 88);
  assert.equal(one('non-gmo rolled oats').color, 'yellow');
  assert.equal(R.classifyIngredients('whole wheat flour, water', { labelsTags: ['en:non-gmo-project'] }).items[0].color, 'yellow');
});
test('conventional wheat fails glyphosate; non-GMO wheat is a limit, not a full pass', () => {
  const wheat = R.grade('semolina (wheat), durum wheat flour', { brand: 'Barilla', productName: 'Thin Spaghetti' });
  assert.equal(wheat.glyphosate.pass, false);
  assert.equal(wheat.score, 61); // 100 - 35 glyphosate - 4 mainstream
  assert.equal(wheat.band.label, 'Mixed');
  const limited = R.grade('semolina (wheat), durum wheat flour', { brand: 'Barilla', labels: 'Non GMO project' });
  assert.equal(limited.glyphosate.status, 'limit');
  assert.equal(limited.glyphosate.pass, false);
  assert.equal(limited.score, 84); // 100 - 12 non-GMO glyphosate - 4 mainstream
  assert.equal(limited.band.label, 'Cleaner');
});
test('green beans, snap peas, rice, buckwheat, and almond flour are not glyphosate crops', () => {
  for (const s of ['green beans', 'string beans', 'sugar snap peas', 'brown rice', 'buckwheat flour', 'almond flour', 'coconut milk', 'milk thistle', 'eggplant', 'jelly beans', 'vanilla beans']) {
    const item = one(s);
    assert.ok(!item.reasons.some(r => /Glyphosate/.test(r.label)), s + ' ' + item.color);
  }
  assert.equal(one('locust bean gum').color, 'yellow');
  assert.equal(R.grade('locust bean gum').glyphosate.pass, true);
  assert.equal(R.grade('soy lecithin').glyphosate.pass, true);
  assert.equal(R.grade('soy fat lecithin').glyphosate.pass, true);
  assert.equal(R.grade('soybean oil').glyphosate.pass, false);
  assert.equal(one('carob bean gum').color, 'yellow');
  assert.equal(one('black beans').color, 'red');
  assert.equal(one('organic black beans').color, 'green');
  assert.equal(one('chickpea flour').color, 'red');
  assert.equal(one('organic chickpea flour').color, 'green');
});
test('dairy, eggs, and meat follow the claim rules', () => {
  assert.equal(one('whole milk').color, 'yellow');
  assert.equal(one('cheddar cheese').color, 'yellow');
  assert.equal(one('plain yogurt').color, 'yellow');
  assert.equal(one('butter').color, 'yellow');
  assert.equal(one('heavy cream').color, 'yellow');
  assert.equal(R.classifyIngredients('whole milk', { brand: 'fairlife', productName: '2% milk' }).items[0].color, 'red');
  assert.equal(one('organic whole milk').color, 'green');
  assert.equal(one('grass-fed butter').color, 'green');
  assert.equal(one('non-gmo cheese').color, 'green');
  assert.equal(R.classifyIngredients('whole milk', { labelsTags: ['en:usda-organic'] }).items[0].color, 'green');
  assert.equal(one('eggs').color, 'red');
  assert.equal(one('non-gmo eggs').color, 'red');
  assert.equal(one('organic eggs').color, 'green');
  assert.equal(one('pasture-raised eggs').color, 'green');
  assert.equal(one('chicken breast').color, 'red');
  assert.equal(one('organic chicken breast').color, 'green');
  assert.equal(one('grass-fed ground beef').color, 'green');
  assert.equal(one('almondmilk').color, 'green');
  assert.equal(one('coconut milk').color, 'green');
  const milk = R.grade('whole milk');
  assert.equal(milk.score, 100);
  assert.equal(pts(milk, /Mainstream|Glyphosate/), 0);
});
test('mainstream brand is a flat 4 point deduction', () => {
  const r = R.grade('sea salt', { brand: 'Cheerios', productName: 'Cheerios' });
  assert.equal(r.score, 96);
  assert.equal(r.band.label, 'Cleaner');
  assert.equal(pts(r, /Mainstream/), 4);
  assert.equal(r.mainstream.match, 'cheerios');
  const summary = R.rulesSummary();
  assert.equal(summary.points.mainstream, 4);
  assert.equal(summary.points.glyphosate, 35);
  assert.equal(summary.points.nova[4], 22);
  assert.equal(summary.points.nova[3], 5);
  assert.equal(summary.points.refinedStarchEach, 8);
});
test('Cheerios 0016000275287 is Poor: sugar, possible GMO, oats and corn, corn starch, brand', () => {
  const text = 'Whole Grain Oats, Corn Starch, Sugar, Salt, Tripotassium Phosphate, Vitamin E (mixed tocopherols), Calcium Carbonate, Iron, Zinc, Vitamin C (sodium ascorbate), A B Vitamin (niacinamide), Vitamin B6 (pyridoxine hydrochloride), Vitamin A (palmitate), Vitamin B1 (thiamin mononitrate), A B Vitamin (folic acid), Vitamin B12, Vitamin D3';
  const r = R.grade(text, { novaGroup: null, sugars100g: 5.128, productName: 'Cheerios', brand: 'Cheerios', labels: 'Orthodox Union Kosher' });
  assert.equal(r.sos.pass, true);
  assert.equal(r.glyphosate.pass, false);
  assert.equal(pts(r, /Added sugar/), 8);
  assert.equal(pts(r, /Possible GMO/), 6);
  assert.equal(pts(r, /Glyphosate/), 35);
  assert.equal(pts(r, /Refined starch/), 8);
  assert.equal(pts(r, /Mainstream/), 4);
  assert.equal(pts(r, /NOVA/), 0);
  assert.equal(r.score, 39);
  assert.equal(r.band.label, 'Poor');
  const cols = leaf(text);
  assert.equal(cols[0], 'red');
  assert.equal(cols[1], 'red');
  assert.equal(cols[2], 'yellow');
});
test('a seed oil scores lower once the crop is also glyphosate-prone', () => {
  const r = R.grade('canola oil');
  assert.equal(r.sos.pass, false);
  assert.equal(r.glyphosate.pass, false);
  assert.equal(pts(r, /Seed oils/), 35);
  assert.equal(pts(r, /Glyphosate/), 35);
  assert.equal(pts(r, /Possible GMO/), 6);
  assert.equal(r.score, 24);
  assert.equal(r.band.label, 'Poor');
  const organic = R.grade('organic expeller-pressed canola oil');
  assert.equal(organic.sos.pass, false);
  assert.equal(organic.glyphosate.pass, true);
  assert.equal(organic.score, 65);
});
test('NOVA 4 alone is no longer a Cleaner score', () => {
  const r = R.grade('carbonated water', { novaGroup: 4 });
  assert.equal(r.score, 78);
  assert.equal(r.band.label, 'Mixed');
  assert.equal(pts(r, /NOVA/), 22);
});

console.log('Household (Bobby Approved-style, Tortuga’s own grade)');
test('umbrella fragrance fails and is not an official Bobby score', () => {
  const r = R.gradeHousehold('water, sodium lauryl sulfate, fragrances, colorants');
  assert.equal(r.pass, false);
  assert.equal(r.score, 45);
  assert.ok(/not an official Bobby Approved/i.test(r.standard));
  assert.equal(R.classifyHousehold('fragrances').items[0].color, 'red');
});
test('fragrance-free and a named essential oil are not the umbrella fragrance', () => {
  assert.equal(R.gradeHousehold('fragrance-free, water, glycerin').pass, true);
  assert.equal(R.gradeHousehold('unscented. water, decyl glucoside').pass, true);
  const oil = R.gradeHousehold('Water, Decyl Glucoside, Lavandula Angustifolia (Lavender) Oil');
  assert.equal(oil.pass, true);
  assert.equal(oil.score, 100);
});
test('isothiazolinone preservative fails; benzoate alone is a limit', () => {
  const mit = R.gradeHousehold('water, methylisothiazolinone');
  assert.equal(mit.pass, false);
  assert.equal(mit.score, 78);
  const mild = R.gradeHousehold('water, sodium benzoate, potassium sorbate');
  assert.equal(mild.pass, true);
  assert.equal(mild.score, 84);
  assert.equal(mild.band.label, 'Cleaner');
});
test('no parabens does not flag parabens', () => {
  assert.equal(R.gradeHousehold('water, no parabens, glycerin').pass, true);
});

console.log('Package certifications');
function certOpts(ids, extra, kind) {
  const merged = R.mergeCertifications('', [], ids, kind);
  return Object.assign({}, extra || {}, merged);
}
test('certification list is the four food claims and two household on-label words', () => {
  assert.deepEqual(R.foodCertifications.map(c => c.id), ['organic', 'non-gmo', 'grass-fed', 'pasture-raised']);
  assert.deepEqual(R.householdClaims.map(c => c.id), ['fragrance-free', 'unscented']);
  assert.match(R.rulesSummary().certifications.note, /not a lab test/i);
  assert.match(R.rulesSummary().certifications.note, /Bobby Approved/i);
});
test('conventional oats vs the same oats marked organic', () => {
  const plain = R.grade('rolled oats', { brand: 'Local mill' });
  assert.equal(plain.score, 65);
  assert.equal(plain.glyphosate.status, 'fail');
  assert.equal(plain.glyphosate.pass, false);
  assert.equal(pts(plain, /Glyphosate/), 35);
  assert.equal(plain.gmo.status, 'none');
  assert.equal(one('rolled oats').color, 'red');

  const opts = certOpts(['organic'], { brand: 'Local mill' });
  assert.match(opts.labels, /Certified organic/);
  assert.ok(opts.labelsTags.includes('en:organic'));
  assert.ok(opts.labelsTags.includes('en:certified-organic'));
  const organic = R.grade('rolled oats', opts);
  assert.equal(organic.score, 100);
  assert.equal(organic.glyphosate.pass, true);
  assert.equal(organic.glyphosate.cleared, true);
  assert.equal(organic.glyphosate.points, 0);
  assert.equal(organic.gmo.status, 'non-gmo');
  assert.ok(organic.gmo.claims.includes('Certified organic'));
  assert.equal(R.classifyIngredients('rolled oats', opts).items[0].color, 'green');
  assert.equal(R.certificationsPresent(opts)[0].id, 'organic');
  assert.equal(organic.sos.pass, true);
});
test('Non-GMO only is a yellow glyphosate limit and does not clear eggs', () => {
  const opts = certOpts(['non-gmo']);
  assert.match(opts.labels, /Non-GMO/);
  assert.equal(/project/i.test(opts.labels), false);
  const oats = R.grade('rolled oats', opts);
  assert.equal(oats.glyphosate.status, 'limit');
  assert.equal(oats.glyphosate.pass, false);
  assert.equal(oats.glyphosate.cleared, false);
  assert.equal(pts(oats, /Glyphosate/), 12);
  assert.equal(oats.score, 88);
  assert.equal(oats.gmo.status, 'non-gmo');
  assert.equal(R.classifyIngredients('rolled oats', opts).items[0].color, 'yellow');
  assert.equal(R.classifyIngredients('whole milk', opts).items[0].color, 'green');
  assert.equal(R.classifyIngredients('cheddar cheese', opts).items[0].color, 'green');
  assert.equal(R.classifyIngredients('chicken breast', opts).items[0].color, 'green');
  assert.equal(R.classifyIngredients('eggs', opts).items[0].color, 'red');
});
test('grass-fed clears dairy and meat, not eggs or glyphosate crops', () => {
  const opts = certOpts(['grass-fed']);
  assert.equal(R.classifyIngredients('whole milk', opts).items[0].color, 'green');
  assert.equal(R.classifyIngredients('butter', opts).items[0].color, 'green');
  assert.equal(R.classifyIngredients('ground beef', opts).items[0].color, 'green');
  assert.equal(R.classifyIngredients('eggs', opts).items[0].color, 'red');
  const oats = R.grade('rolled oats', opts);
  assert.equal(oats.glyphosate.status, 'fail');
  assert.equal(oats.score, 65);
  assert.equal(R.classifyIngredients('rolled oats', opts).items[0].color, 'red');
  assert.notEqual(oats.gmo.status, 'non-gmo');
});
test('pasture-raised clears eggs and meat, not dairy or glyphosate crops', () => {
  const opts = certOpts(['pasture-raised']);
  assert.equal(R.classifyIngredients('eggs', opts).items[0].color, 'green');
  assert.equal(R.classifyIngredients('chicken breast', opts).items[0].color, 'green');
  assert.equal(R.classifyIngredients('whole milk', opts).items[0].color, 'yellow');
  const oats = R.grade('rolled oats', opts);
  assert.equal(oats.glyphosate.status, 'fail');
  assert.equal(oats.score, 65);
  assert.equal(R.classifyIngredients('rolled oats', opts).items[0].color, 'red');
});
test('organic on the product clears dairy, eggs, and meat, and beats non-GMO on crops', () => {
  const opts = certOpts(['organic', 'non-gmo', 'grass-fed', 'pasture-raised']);
  assert.equal(R.classifyIngredients('whole milk', opts).items[0].color, 'green');
  assert.equal(R.classifyIngredients('eggs', opts).items[0].color, 'green');
  assert.equal(R.classifyIngredients('chicken breast', opts).items[0].color, 'green');
  const oats = R.grade('rolled oats', opts);
  assert.equal(oats.score, 100);
  assert.equal(oats.glyphosate.pass, true);
  assert.equal(oats.glyphosate.cleared, true);
  assert.equal(R.classifyIngredients('rolled oats', opts).items[0].color, 'green');
});
test('product certifications do not waive seed oils, refined starch, Dirty Dozen, or mainstream brands', () => {
  const opts = certOpts(['organic']);
  const oil = R.grade('canola oil', opts);
  assert.equal(oil.sos.pass, false);
  assert.equal(oil.glyphosate.pass, true);
  assert.equal(pts(oil, /Seed oils/), 35);
  assert.equal(R.classifyIngredients('canola oil', opts).items[0].color, 'red');
  const starch = R.grade('corn starch', opts);
  assert.equal(pts(starch, /Refined starch/), 8);
  assert.equal(R.classifyIngredients('corn starch', opts).items[0].color, 'red');
  assert.equal(R.classifyIngredients('strawberries', opts).items[0].color, 'yellow');
  const quaker = R.grade('rolled oats', certOpts(['organic'], { brand: 'Quaker', productName: 'Quaker oats' }));
  assert.equal(pts(quaker, /Mainstream/), 4);
  assert.equal(quaker.glyphosate.pass, true);
  assert.equal(quaker.score, 96);
  const sugar = R.grade('oats, cane sugar', Object.assign({ sugars100g: 18 }, opts));
  assert.equal(pts(sugar, /Added sugar/), 8);
  assert.ok(sugar.score < 100);
});
test('unchecking a certification removes it and leaves other labels', () => {
  const kept = R.mergeCertifications('Kosher, Certified organic, Grass-fed', ['en:kosher', 'en:organic', 'en:usda-organic', 'en:grass-fed'], ['grass-fed']);
  assert.match(kept.labels, /Kosher/);
  assert.match(kept.labels, /Grass-fed/);
  assert.equal(/organic/i.test(kept.labels), false);
  assert.ok(kept.labelsTags.includes('en:kosher'));
  assert.ok(kept.labelsTags.includes('en:grass-fed'));
  assert.equal(kept.labelsTags.includes('en:organic'), false);
  assert.equal(kept.labelsTags.includes('en:usda-organic'), false);
  const cleared = R.mergeCertifications(kept.labels, kept.labelsTags, []);
  assert.equal(/grass-fed/i.test(cleared.labels), false);
  assert.match(cleared.labels, /Kosher/);
  const oats = R.grade('rolled oats', cleared);
  assert.equal(oats.glyphosate.status, 'fail');
});
test('an organic word inside the ingredient list is not a product certification', () => {
  assert.equal(R.certificationsPresent({ ingredients: 'organic rolled oats', productName: 'Rolled oats' }).length, 0);
  assert.equal(R.certificationsPresent({ productName: 'Organic rolled oats' })[0].id, 'organic');
});
test('household fragrance-free and unscented do not erase fragrance or invent a Bobby badge', () => {
  const claims = R.mergeCertifications('', [], ['fragrance-free', 'unscented'], 'household');
  assert.match(claims.labels, /Fragrance-free/);
  assert.match(claims.labels, /Unscented/);
  assert.deepEqual(claims.labelsTags, []);
  const dirty = R.gradeHousehold('water, sodium lauryl sulfate, fragrances');
  assert.equal(dirty.pass, false);
  assert.ok(dirty.deductions.some(d => /fragrance/i.test(d.label)));
  const present = R.certificationsPresent({ labels: claims.labels, ingredients: 'water, fragrances' }, 'household');
  assert.deepEqual(present.map(c => c.id), ['fragrance-free', 'unscented']);
  assert.match(R.gradeHousehold('unscented. water, glycerin').standard, /not an official Bobby Approved/i);
  assert.equal(R.certificationsPresent({ ingredients: 'fragrance-free, water, glycerin' }, 'household')[0].id, 'fragrance-free');
});

test('rules summary cites the 2026 Dirty Dozen', () => {
  const d = R.rulesSummary().dirtyDozen;
  assert.equal(d.year, 2026);
  assert.equal(d.items.length, 12);
  assert.ok(d.items[0].indexOf('Spinach') === 0);
  assert.ok(/ewg\.org\/foodnews\/dirty-dozen/.test(d.url));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
