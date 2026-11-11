// Run: node tests/places.test.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const P = require('../places.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message.split('\n').join('\n      ')); }
}

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'places.json'), 'utf8'));
const places = data.places;

console.log('Place scores');
test('no evidence stays unrated, including a grocer and Ethel M', () => {
  const ethel = places.find(p => p.id === 'ethel-m-henderson-flagship');
  const g = P.gradePlace(ethel, []);
  assert.equal(g.score, null);
  assert.equal(g.status, 'unrated');
  assert.equal(g.approved, false);
  assert.match(g.label, /Unrated/);
  const sprouts = places.find(p => p.id === 'sprouts-henderson-stephanie');
  const s = P.gradePlace(sprouts, []);
  assert.equal(s.score, null);
  assert.equal(s.shop, true);
  assert.equal(P.tortyPlace(ethel, g).includes('olive oil'), false);
  assert.match(P.tortyPlace(ethel, g), /don’t have enough/i);
});

test('one report is not enough, two ratings score, seed oil caps at 4.4', () => {
  const place = { id: 'x', name: 'Test Cafe', kind: 'cafe', sourcedNotes: [], offerings: [] };
  const one = P.gradePlace(place, [{ rating: 9, fats: 'olive oil', ordered: 'fish' }]);
  assert.equal(one.score, null);
  const two = P.gradePlace(place, [
    { rating: 9, fats: 'olive oil', ordered: 'fish' },
    { rating: 8, fats: 'butter', ordered: 'eggs' }
  ]);
  assert.equal(two.status, 'scored');
  assert.ok(two.score >= 7);
  assert.equal(two.approved, false, 'two reports cannot approve');
  const seed = P.gradePlace(place, [
    { rating: 9, fats: 'canola oil', ordered: 'fries' },
    { rating: 8, fats: 'vegetable oil', ordered: 'chicken' }
  ]);
  assert.ok(seed.score <= 4.4, 'score ' + seed.score);
  assert.equal(seed.band.id, 'avoid');
  assert.equal(seed.approved, false);
});

test('three consistent favorable reports can approve, and a conflict cannot', () => {
  const place = { id: 'x', name: 'Test Kitchen', kind: 'restaurant', sourcedNotes: [], offerings: [] };
  const reports = [1, 2, 3].map(function (n) {
    return { rating: 8, fats: 'olive oil', ordered: 'greens ' + n };
  });
  const ok = P.gradePlace(place, reports);
  assert.equal(ok.approved, true);
  assert.ok(ok.score >= 7);
  const mixed = P.gradePlace(place, [
    { rating: 9, fats: 'olive oil', ordered: 'fish' },
    { rating: 8, fats: 'olive oil', ordered: 'eggs' },
    { rating: 3, fats: 'canola', ordered: 'fries' }
  ]);
  assert.equal(mixed.approved, false);
  assert.ok(mixed.conflicts.length > 0);
  assert.ok(mixed.score <= 5.9);
});

test('partial public cooking-fat notes score but do not approve, and seed-oil-free is not a seed-oil finding', () => {
  const tfk = places.find(p => p.id === 'true-food-forum');
  const fats = P.classifyFatText(tfk.sourcedNotes[0].text);
  assert.deepEqual(fats.seed, []);
  assert.ok(fats.favorable.indexOf('olive oil') >= 0);
  assert.ok(fats.favorable.indexOf('avocado oil') >= 0);
  const g = P.gradePlace(tfk, []);
  assert.equal(g.preliminary, true);
  assert.equal(g.approved, false);
  assert.equal(g.score, 7);
  assert.match(P.tortyPlace(tfk, g), /avocado oil/);
  assert.match(P.tortyPlace(tfk, g), /not a Tortuga approved/);
  assert.doesNotMatch(P.tortyPlace(tfk, g), /they cook everything/i);
});

test('a shop is not scored from silence, and published ingredient lists are not a fryer score', () => {
  const shop = {
    id: 'shop', name: 'Sample Grocer', kind: 'grocer', sourcedNotes: [],
    offerings: [
      { name: 'Olive oil', ingredients: 'organic extra virgin olive oil' },
      { name: 'Honey', ingredients: 'raw honey' }
    ]
  };
  const g = P.gradePlace(shop, []);
  assert.equal(g.basis, 'ingredients');
  assert.equal(g.preliminary, true);
  assert.equal(g.approved, false);
  assert.match(g.headline, /not a restaurant seed-oil score/);
  const silent = P.gradePlace({ id: 's', name: 'Store', kind: 'chocolatier', offerings: [], sourcedNotes: [] }, []);
  assert.equal(silent.score, null);
});

test('menu lines need ingredients, and a caesar salad name is not assumed seed-oil free or not', () => {
  const bare = P.gradeMenuLine({ name: 'Caesar salad' });
  assert.equal(bare.status, 'needs-ingredients');
  assert.equal(bare.score, null);
  assert.doesNotMatch(bare.summary, /seed oil/i);
  const namedAsIngredients = P.gradeMenuLine({ name: 'Caesar salad', ingredients: 'Caesar salad' });
  assert.equal(namedAsIngredients.status, 'graded');
  assert.ok(!(namedAsIngredients.flags || []).some(f => /seed oil/i.test(f)));
  const oils = P.gradeMenuLine({ name: 'Greens', ingredients: 'olive oil, lemon, salt' });
  assert.equal(oils.status, 'graded');
  assert.ok(oils.score >= 60);
  const canola = P.gradeMenuLine({ name: 'Slaw', ingredients: 'cabbage, canola oil, sugar' });
  assert.ok(canola.score < 45);
});

test('peanut butter is not a cooking fat, and what-to-get comes only from a marked source or a report', () => {
  const pb = P.classifyFatText('peanut butter and apple butter');
  assert.deepEqual(pb.favorable, []);
  const flower = places.find(p => p.id === 'flower-child-las-vegas');
  const lists = P.whatLists(flower, []);
  assert.equal(lists.get.length, 1);
  assert.match(lists.get[0].name, /Olive oil roasted vegetables/);
  assert.equal(lists.skip.length, 0);
  const ethel = P.whatLists(places.find(p => p.id === 'ethel-m-henderson-flagship'), []);
  assert.equal(ethel.prompt, true);
  const withReport = P.whatLists(flower, [{ ordered: 'fries', rating: 3, fats: 'canola oil' }]);
  assert.ok(withReport.skip.some(s => s.name === 'fries' && s.from === 'report'));
});

test('a place menu grades ingredients only and order links stay on official sites', () => {
  const ethel = places.find(p => p.id === 'ethel-m-henderson-flagship');
  const items = P.mergeMenu(ethel, []);
  assert.ok(items.some(it => /strawberry/i.test(it.name)));
  assert.ok(items.some(it => /peanut brittle milk/i.test(it.name)));
  items.forEach(it => {
    assert.equal(P.gradeMenuLine(it).status, 'needs-ingredients');
    assert.equal(it.ingredients || '', '');
  });
  const order = P.orderChoices(ethel);
  assert.equal(order.grok, true);
  assert.match(order.orderUrl, /^https:\/\/www\.ethelm\.com\//);
  assert.equal(order.viewOnly, false);
  const forum = P.orderChoices(places.find(p => p.id === 'true-food-forum'));
  assert.equal(forum.grok, false);
  assert.match(forum.orderUrl, /^https:\/\/order\.truefoodkitchen\.com\//);
  const bare = P.orderChoices({ kind: 'restaurant', orderUrl: 'https://www.doordash.com/store/example' });
  assert.equal(bare.orderUrl, '');
  assert.equal(bare.viewOnly, true);
  const phone = P.mergeMenu(ethel, [{ placeId: ethel.id, id: 'peppermint-shake', name: 'Peppermint shake', ingredients: 'milk, cocoa' }]);
  const added = phone.find(it => it.id === 'peppermint-shake');
  assert.equal(added.origin, 'phone');
  assert.equal(P.gradeMenuLine(added).status, 'graded');
  places.forEach(p => {
    if (!p.orderUrl) return;
    assert.match(p.orderUrl, /^https:\/\//, p.id);
    assert.doesNotMatch(p.orderUrl, /doordash|ubereats|grubhub|yelp\.com|google\.com/i, p.id);
  });
});

test('adding a place accepts a bare website and does not fail quietly without coordinates', () => {
  assert.equal(P.normalizeWebsite('').url, '');
  assert.equal(P.normalizeWebsite('place.com').url, 'https://place.com/');
  assert.equal(P.normalizeWebsite('www.place.com').url, 'https://www.place.com/');
  assert.equal(P.normalizeWebsite('http://place.com/menu').url, 'https://place.com/menu');
  assert.equal(P.normalizeWebsite('https://place.com').ok, true);
  assert.equal(P.normalizeWebsite('not a url').ok, false);
  const missing = P.preparePlaceDraft({ name: '', address: '1 Main', website: 'place.com' });
  assert.equal(missing.ok, false);
  assert.equal(missing.field, 'name');
  const noAddress = P.preparePlaceDraft({ name: 'Cafe', address: '  ', lat: '', lng: '' });
  assert.equal(noAddress.field, 'address');
  const lookup = P.preparePlaceDraft({
    name: 'Cafe', address: '124 S 6th Street', city: 'Las Vegas', website: 'www.place.com', lat: '', lng: ''
  });
  assert.equal(lookup.ok, true);
  assert.equal(lookup.needsGeocode, true);
  assert.equal(lookup.website, 'https://www.place.com/');
  assert.equal(P.nominatimQuery(lookup.address, lookup.city), '124 S 6th Street, Las Vegas, Nevada');
  const badCoord = P.preparePlaceDraft({ name: 'Cafe', address: '1 Main', lat: 'nope', lng: '' });
  assert.equal(badCoord.ok, false);
  assert.equal(badCoord.field, 'lat');
  const pinned = P.preparePlaceDraft({ name: 'Cafe', address: '1 Main', lat: '36.1', lng: '-115.2', website: 'http://place.com' });
  assert.equal(pinned.needsGeocode, false);
  assert.equal(pinned.lat, 36.1);
  assert.equal(pinned.lng, -115.2);
  assert.equal(pinned.website, 'https://place.com/');
  assert.equal(P.geocodeHit([]), null);
  assert.deepEqual(P.geocodeHit([{ lat: '36.167898', lon: '-115.140607', display_name: 'Carson Kitchen' }]), {
    lat: 36.167898, lng: -115.140607, label: 'Carson Kitchen'
  });
});

test('bands are the 0–10 place bands', () => {
  assert.equal(P.placeBand(4.4).id, 'avoid');
  assert.equal(P.placeBand(4.5).id, 'limit');
  assert.equal(P.placeBand(5.9).id, 'limit');
  assert.equal(P.placeBand(6).id, 'eat');
  assert.equal(P.placeBand(10).id, 'eat');
  assert.match(P.rulesSummary().note, /not the 0–100/);
  assert.equal(P.APPROVED_AT, 7);
});

console.log('Catalog');
const DENY = /(^|\.)(yelp|google|facebook|instagram|tripadvisor|wikipedia|foursquare|mapquest|waze|apple|bing|youtube)\.com$/i;
test('starter catalog is real-shaped Las Vegas and Henderson data', () => {
  assert.ok(places.length >= 20 && places.length <= 40, 'count ' + places.length);
  assert.equal(data.reports.length, 0);
  const ids = new Set();
  const cities = new Set();
  places.forEach(p => {
    assert.match(p.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(p.id), 'duplicate ' + p.id);
    ids.add(p.id);
    assert.ok(p.name && p.address && p.summary, p.id);
    assert.ok(['restaurant', 'cafe', 'grocer', 'shop', 'chocolatier'].includes(p.kind), p.id + ' kind');
    assert.ok(p.city === 'Las Vegas' || p.city === 'Henderson', p.id + ' city');
    cities.add(p.city);
    assert.equal(typeof p.lat, 'number', p.id);
    assert.equal(typeof p.lng, 'number', p.id);
    assert.ok(p.lat >= 35.9 && p.lat <= 36.4, p.id + ' lat ' + p.lat);
    assert.ok(p.lng >= -115.5 && p.lng <= -114.85, p.id + ' lng ' + p.lng);
    assert.equal(p.score, undefined, p.id + ' must not bake in a score');
    assert.equal(p.rating, undefined, p.id);
    assert.ok(p.sources && p.sources.length, p.id + ' sources');
    p.sources.forEach(s => {
      assert.ok(s.title && s.url, p.id);
      assert.match(s.url, /^https:\/\//, p.id + ' ' + s.url);
    });
    assert.match(p.website, /^https:\/\//, p.id);
    const host = new URL(p.website).hostname;
    assert.doesNotMatch(host, DENY, p.id + ' ' + host);
    assert.ok(!/maps\.google|goo\.gl|bit\.ly/.test(host), host);
    (p.offerings || []).forEach(o => {
      if (o.suggest) assert.match(o.sourceUrl, /^https:\/\//, p.id + ' offering');
    });
  });
  assert.ok(cities.has('Las Vegas') && cities.has('Henderson'));
  const ethel = places.find(p => p.id === 'ethel-m-henderson-flagship');
  assert.ok(ethel, 'flagship');
  assert.match(ethel.address, /2 Cactus Garden/);
  assert.match(ethel.phone, /702-435-2608/);
  assert.match(ethel.website, /^https:\/\/www\.ethelm\.com\//);
  assert.equal(P.gradePlace(ethel, []).approved, false);
});

test('Flower Child Henderson is the official address and stays unrated', () => {
  const place = places.find(p => p.id === 'flower-child-henderson');
  assert.ok(place);
  assert.equal(place.city, 'Henderson');
  assert.match(place.address, /2215 Village View/);
  assert.match(place.address, /89052/);
  assert.equal(place.phone, '725-291-0111');
  assert.equal(place.website, 'https://www.iamaflowerchild.com/locations/flower-child-henderson/');
  assert.equal(place.orderUrl, undefined);
  assert.equal(P.orderChoices(place).viewOnly, true);
  assert.equal(P.gradePlace(place, []).status, 'unrated');
  const names = place.offerings.map(o => o.name.toLowerCase());
  assert.ok(names.some(n => n.indexOf('olive oil roasted vegetables') >= 0));
  place.offerings.forEach(o => {
    assert.match(o.sourceUrl, /^https:\/\/www\.iamaflowerchild\.com\//);
    assert.equal(o.ingredients, undefined);
  });
});

test('shell points at the map, place routes, and cache v11', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const missing = fs.readFileSync(path.join(root, '404.html'), 'utf8');
  const rules = fs.readFileSync(path.join(root, 'rules.js'), 'utf8');
  assert.match(sw, /tortuga-shell-v11/);
  assert.match(html, /id="addPlaceForm"[^>]*novalidate/);
  assert.match(html, /id="addPlaceStatus"[^>]*aria-live="assertive"/);
  assert.doesNotMatch(html, /id="addPlaceWeb"[^>]*type="url"/);
  assert.match(app, /preparePlaceDraft/);
  assert.match(app, /nominatim\.openstreetmap\.org/);
  assert.match(sw, /data\/places\.json/);
  assert.match(sw, /data\/map-style\.json/);
  assert.match(sw, /places\.js/);
  assert.match(sw, /vendor\/maplibre-gl\.js/);
  assert.match(html, /id="view-map"/);
  assert.match(html, /data-tab="map"/);
  assert.match(html, /data-tab="book"/);
  assert.match(html, /id="reportForm"/);
  assert.match(html, /id="addPlaceForm"/);
  assert.match(html, /id="menuForm"/);
  assert.match(html, /id="view-place-menu"/);
  assert.match(app, /tortuga\.menu\.v1/);
  assert.match(app, /Buy with Grok Bot/);
  assert.match(html, /capture="environment"/);
  assert.match(missing, /place/);
  assert.match(rules, /place/);
  assert.match(app, /tortuga\.places\.v1/);
  assert.match(app, /tortuga\.reports\.v1/);
  assert.doesNotMatch(html + app, /tile\.openstreetmap\.org/);
  assert.match(html + app, /OpenStreetMap/);
  assert.match(html + app, /OpenFreeMap/);
  const style = fs.readFileSync(path.join(root, 'data', 'map-style.json'), 'utf8');
  assert.match(style, /tiles\.openfreemap\.org/);
  assert.doesNotMatch(style, /tile\.openstreetmap\.org/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
