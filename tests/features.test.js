// Run: node tests/features.test.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = require('../rules.js');
const Chat = require('../torty.js');
const Scout = require('../scout.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message.split('\n').join('\n      ')); }
}

console.log('Torty chat');
test('Torty greets in a laid-back voice and does not claim a live person', () => {
  const session = Chat.fresh();
  assert.match(session.messages[0].text, /Hey/);
  assert.doesNotMatch(session.messages[0].text, /Bobby|Olive|Seed Oil Scout|official certification/i);
  const who = Chat.respond(session, 'who are you', {});
  assert.match(who.replies[0], /this phone/i);
  assert.match(who.replies[0], /no one else/i);
});
test('Torty explains an open product without a legal disclaimer', () => {
  const result = Chat.respond(Chat.fresh(), 'what do you think of this', {
    product: { name: 'Cheerios', kind: 'food' },
    grade: { score: 11, band: { id: 'avoid', label: 'Avoid' }, deductions: [{ label: 'Added sugar' }], hasIngredients: true }
  });
  assert.match(result.replies[0], /Cheerios/);
  assert.match(result.replies[0], /11/);
  assert.doesNotMatch(result.replies[0], /Bobby Approved|Seed Oil Scout|not quoting a lab/i);
});
test('saying report walks through a note, analyzes a seed oil, and offers Scout', () => {
  let session = Chat.fresh();
  let step = Chat.respond(session, 'report', { product: { name: 'Puffs', code: '123' } });
  assert.match(step.replies[0], /ingredients/i);
  step = Chat.respond(step.session, 'safflower oil, salt', {});
  step = Chat.respond(step.session, 'safflower oil', {});
  step = Chat.respond(step.session, 'none', {});
  step = Chat.respond(step.session, 'yes', {});
  step = Chat.respond(step.session, 'skip', {});
  assert.equal(step.action.type, 'save-report');
  assert.equal(step.action.report.better, 'yes');
  assert.match(step.replies[0], /seed oil/i);
  assert.match(step.replies[0], /Scout/);
  assert.match(step.replies[0], /don’t have Scout in this chat/i);
  const send = Chat.respond(step.session, 'send', {});
  assert.equal(send.action.type, 'send');
  assert.match(send.replies[0], /can’t deliver it myself/i);
});

console.log('Scout payload');
test('reports and catalog uploads share one unverified payload and a GitHub issue link', () => {
  const profile = { id: 'local-test', name: 'Ada' };
  const product = { name: 'Cowgirl Cheddar Cheezmos Puffs', brand: 'LesserEvil', code: '810197740876', kind: 'food', ingredients: 'organic corn' };
  const report = Scout.reportPayload({
    profile: profile,
    exported: '2026-11-11T00:00:00.000Z',
    product: product,
    report: { ingredients: 'organic corn', oils: 'avocado oil', certifications: ['usda-organic'], betterForYou: true, note: 'Cleaner than a dyed puff', analysis: 'No seed oil in what I was given.' },
    grade: { score: 100, band: { id: 'eat' }, pass: true }
  });
  assert.equal(report.kind, 'tortuga-report');
  assert.equal(report.version, 1);
  assert.equal(report.item.listing, 'unverified');
  assert.equal(report.item.report.betterForYou, true);
  assert.match(Scout.plainText(report), /Better for You requested: yes/);
  const reportUrl = Scout.githubIssueUrl(report);
  assert.match(reportUrl, /^https:\/\/github\.com\/lizethbran13-cmyk\/tortuga-scan\/issues\/new\?/);
  assert.match(decodeURIComponent(reportUrl), /\[Tortuga report\] Cowgirl Cheddar Cheezmos Puffs/);
  const upload = Scout.catalogPayload({ profile: profile, product: product, grade: { score: 100, band: 'eat', pass: true } });
  assert.equal(upload.kind, 'tortuga-catalog');
  assert.equal(upload.item.listing, 'unverified');
  assert.equal(upload.item.report, null);
  assert.match(decodeURIComponent(Scout.githubIssueUrl(upload)), /\[Tortuga catalog\]/);
  const example = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'scout-payload.example.json'), 'utf8'));
  assert.equal(example.version, 1);
  assert.equal(example.item.listing, 'unverified');
  assert.ok(example.item.product && example.item.report && example.item.grade);
});

console.log('Researched shelf');
test('verified picks keep their cited sources and Tortuga badges', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalog.json'), 'utf8'));
  const picks = catalog.products.filter(p => p.storePick);
  assert.ok(picks.length >= 4);
  const puff = picks.find(p => p.barcode === '810197740876');
  assert.ok(puff);
  assert.equal(puff.listing, 'verified');
  assert.match(puff.sourceUrl, /^https:\/\/www\.lesserevil\.com\//);
  assert.ok(puff.badges.some(b => b.id === 'better-for-you'));
  assert.ok(puff.badges.some(b => b.id === 'super-clean-brand' && b.scope === 'brand'));
  const flav = picks.filter(p => p.brand === 'FlavCity');
  assert.equal(flav.length, 2);
  flav.forEach(p => {
    assert.match(p.sourceUrl, /^https:\/\/www\.shopflavcity\.com\//);
    assert.match(p.research.basis, /not an official FlavCity/i);
    assert.equal(p.badges.some(b => /bobby approved/i.test(b.id || '')), false);
  });
  picks.forEach(p => {
    const g = R.grade(p.ingredients, { productName: p.name, brand: p.brand, labels: p.labels, labelsTags: p.labelsTags, badges: p.badges });
    assert.equal(p.grade.score, g.score, p.barcode);
    if (p.badges.some(b => b.id === 'better-for-you') && g.deductions.some(d => /seed oil/i.test(d.label))) {
      assert.ok(g.score < 60, p.barcode);
    }
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
