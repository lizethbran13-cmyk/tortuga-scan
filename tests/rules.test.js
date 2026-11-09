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
  assert.equal(r.score, 0); // 100 - 35 - 12*5 - 8 - 8 - 12 - 15 floors at 0
});
test('junk list without nutriments still scores low', () => {
  const r = R.grade('canola oil, soy lecithin, natural flavors, red 40, xanthan gum');
  assert.ok(r.score < 50, 'score ' + r.score);
});
test('score math adds up exactly', () => {
  const r = R.grade('oats, cane sugar, sea salt, natural flavor', { novaGroup: 3, sugars100g: 18 });
  // 100 - natural flavor 12 - sugar 8 - high sugar 7 - NOVA3 5 = 68
  assert.equal(r.score, 68);
  assert.equal(r.band.label, 'Mixed');
  assert.equal(100 - r.deductions.reduce((s, d) => s + d.points, 0), 68);
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
