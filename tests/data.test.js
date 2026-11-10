// Run: node tests/data.test.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = require('../rules.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message.split('\n').join('\n      ')); }
}
function read(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', name), 'utf8'));
}

const catalog = read('catalog.json');
const labs = read('lab-tests.json');
const news = read('news.json');

console.log('Catalog');
test('has a starter catalog (a few dozen is enough for v2)', () => {
  assert.ok(catalog.products.length >= 40, 'count ' + catalog.products.length);
});
test('required barcodes are present', () => {
  const keys = new Set();
  catalog.products.forEach(p => {
    R.barcodeCandidates(p.barcode).forEach(c => keys.add(c));
    keys.add(String(p.barcode));
  });
  for (const code of ['041570054161', '0016000275287', '3017624010701', '049000006346']) {
    const ok = R.barcodeCandidates(code).some(c => keys.has(c));
    assert.ok(ok, 'missing ' + code);
  }
});
test('every product has ingredients, a source URL, and a grade that matches rules.js', () => {
  const seen = new Set();
  catalog.products.forEach(p => {
    assert.ok(p.barcode && String(p.barcode).length >= 8, 'barcode');
    assert.ok(p.name && p.name.length > 1, p.barcode);
    assert.ok(p.ingredients && p.ingredients.length >= 20, p.barcode + ' ingredients');
    assert.ok(/^https:\/\/world\.openfoodfacts\.org\/product\//.test(p.offUrl), p.barcode);
    assert.equal(p.added, '2026-11-09', p.barcode);
    assert.ok(!seen.has(p.barcode), 'duplicate ' + p.barcode);
    seen.add(p.barcode);
    const g = R.grade(p.ingredients, {
      novaGroup: p.nova,
      sugars100g: p.nutriments && p.nutriments.sugars100g,
      productName: p.name,
      brand: p.brand,
      labels: p.labels,
      labelsTags: p.labelsTags
    });
    assert.equal(p.grade.pass, g.pass, p.barcode + ' pass');
    assert.equal(p.grade.pass, g.score >= 45, p.barcode + ' pass cutoff');
    assert.equal(p.grade.avoidPass, g.sos.pass, p.barcode + ' avoid categories');
    assert.equal(p.grade.gmoStatus, g.gmo.status, p.barcode + ' gmo');
    assert.equal(p.grade.score, g.score, p.barcode + ' score');
    assert.equal(p.grade.band, g.band.id, p.barcode + ' band');
    assert.ok(['avoid', 'limit', 'eat'].includes(p.grade.band), p.barcode + ' meter');
    const light = R.classifyIngredients(p.ingredients);
    assert.ok(light.items.length > 0, p.barcode + ' colors');
  });
});

console.log('Household');
const household = read('household.json');
test('household catalog is dozens of real cited lists with matching grades', () => {
  assert.ok(household.products.length >= 40, 'count ' + household.products.length);
  assert.match(household.about, /not an official Bobby Approved/i);
  assert.match(household.about, /Olive-style/i);
  assert.match(household.standard, /shopflavcity\.com\/pages\/bobby-approved-app/);
  const seen = new Set();
  const cats = new Set();
  let fragranceFail = 0, pass = 0, images = 0;
  household.products.forEach(p => {
    assert.ok(p.barcode && p.name && p.brand, p.barcode);
    assert.ok(p.ingredients && p.ingredients.length >= 40, p.barcode + ' ingredients');
    assert.match(p.sourceUrl, /^https:\/\/world\.open(?:beauty|products)facts\.org\/product\//);
    assert.ok(!seen.has(p.barcode), 'duplicate ' + p.barcode);
    seen.add(p.barcode);
    cats.add(p.category);
    if (p.image) {
      images++;
      assert.match(p.image, /^https:\/\/images\.open(?:beauty|products)facts\.org\//, p.barcode);
    }
    const g = R.gradeHousehold(p.ingredients);
    assert.equal(p.grade.pass, g.pass, p.barcode + ' pass');
    assert.equal(p.grade.pass, g.score >= 45, p.barcode + ' cutoff');
    assert.equal(p.grade.score, g.score, p.barcode + ' score');
    assert.equal(p.grade.band, g.band.id, p.barcode);
    if (!g.pass && g.deductions.some(d => /fragrance/i.test(d.label))) fragranceFail++;
    if (g.pass) pass++;
  });
  assert.ok(fragranceFail >= 3, 'fragrance fails ' + fragranceFail);
  assert.ok(pass >= 8, 'passes ' + pass);
  assert.ok(images >= 30, 'photos ' + images);
  assert.ok(cats.has('Laundry detergent') && cats.has('Dish soap') && cats.has('Hand soap'));
});

console.log('Lab tests');
test('cites real sources and does not leave findings blank', () => {
  assert.ok(labs.tests.length >= 4);
  const ids = new Set();
  labs.tests.forEach(t => {
    assert.ok(t.id && !ids.has(t.id));
    ids.add(t.id);
    assert.ok(t.product && t.summary && t.scopeNote);
    assert.ok(t.lab && t.publisher);
    assert.ok(/^https:\/\//.test(t.sourceUrl), t.id);
    assert.ok(t.date, t.id);
    assert.ok(t.findings && t.findings.length, t.id);
    t.findings.forEach(f => {
      assert.ok(f.analyte && f.value, t.id);
      assert.ok(/\d/.test(f.value), t.id + ' finding needs a number: ' + f.value);
    });
    if (t.match === 'sku') assert.ok(t.barcode, t.id + ' sku needs a barcode');
    if (t.match !== 'sku') assert.ok(/not|category|brand|line|samples|did not|no barcode/i.test(t.scopeNote), t.id);
  });
});

console.log('Hand entry');
test('the app lets you attach certifications when grading or adding a product', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.match(html, /id="addProductForm"/);
  assert.match(html, /id="pasteHomeCerts"/);
  assert.match(html, /id="addFoodCerts"/);
  assert.match(html, /id="addHouseholdClaims"/);
  assert.match(html, /Grade a label by hand/);
  assert.match(app, /mergeCertifications/);
  assert.match(app, /tortuga\.mine\.v1/);
  assert.match(app, /certPickerHtml/);
  assert.match(sw, /tortuga-shell-v7/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.doesNotMatch(css, /\.needle\s*\{[^}]*transform-origin/);
  assert.match(app, /rotate\(' \+ \(-90 \+ \(target \+ 90\) \* e\) \+ ' 160 148\)/);
  assert.match(html + app, /icons\/torty-portrait\.png/);
  assert.match(app, /grokbot:\/\/app\/v1\/agent\?id=a4483b75-73bb-47ac-8893-938cbf85736a/);
  assert.match(html, /Not affiliated with FlavCity, Bobby Approved, Olive, or Seed Oil Scout/);
  assert.match(app, /indexedDB\.open/);
  assert.match(app, /tortuga-photos/);
  assert.doesNotMatch(html + app, /Seed Oil Safe/i);
  assert.doesNotMatch(html + app, /Bobby Approved certification/i);
  assert.match(html, /id="view-store"/);
  assert.match(html, /id="view-book"/);
  assert.match(html, /data-tab="book"/);
});

test('Cheerios fails the new meter and photos are real URLs when present', () => {
  const cheer = catalog.products.find(p => p.barcode === '0016000275287');
  assert.ok(cheer, 'cheerios');
  assert.equal(cheer.grade.score, 11);
  assert.equal(cheer.grade.pass, false);
  assert.equal(cheer.grade.band, 'avoid');
  let foodImg = 0;
  catalog.products.forEach(p => {
    if (!p.image) return;
    foodImg++;
    assert.match(p.image, /^https:\/\/images\.openfoodfacts\.org\//, p.barcode);
  });
  assert.ok(foodImg >= 200, 'food photos ' + foodImg);
  const sites = read('websites.json');
  assert.match(sites.sites.cheerios, /^https:\/\/www\.cheerios\.com/);
  assert.match(sites.sites.tide, /^https:\/\/tide\.com/);
  Object.keys(sites.sites).forEach(slug => {
    assert.match(sites.sites[slug], /^https:\/\//, slug);
  });
});

console.log('News');
test('first report is Monday, November 9, 2026 in Los Angeles', () => {
  assert.equal(news.timezone, 'America/Los_Angeles');
  const report = news.reports[0];
  assert.equal(report.id, '2026-11-09');
  assert.equal(report.date, '2026-11-09');
  assert.equal(report.timezone, 'America/Los_Angeles');
  assert.match(report.title, /Monday, November 9, 2026/);
  assert.ok(report.items.length >= 3);
  report.items.forEach(item => {
    assert.ok(item.headline && item.summary);
    assert.ok(/^https:\/\//.test(item.sourceUrl), item.id);
    assert.ok(['launch', 'recall', 'alert', 'study', 'policy', 'lab'].includes(item.category), item.id);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
