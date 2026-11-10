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
    assert.equal(p.grade.sosPass, g.sos.pass, p.barcode + ' sos');
    assert.equal(p.grade.gmoStatus, g.gmo.status, p.barcode + ' gmo');
    assert.equal(p.grade.score, g.score, p.barcode + ' score');
    assert.equal(p.grade.band, g.band.id, p.barcode + ' band');
    const light = R.classifyIngredients(p.ingredients);
    assert.ok(light.items.length > 0, p.barcode + ' colors');
  });
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
