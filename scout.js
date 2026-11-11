/*
 * Packages a product report or a catalog upload so a person can send it
 * to Scout (the maintainer). Nothing here uploads by itself.
 *
 * Payload shape (version 1), also shown in data/scout-payload.example.json:
 * {
 *   "kind": "tortuga-report" | "tortuga-catalog",
 *   "version": 1,
 *   "exported": "ISO-8601",
 *   "profile": { "id": "local id", "name": "display name" },
 *   "item": {
 *     "listing": "unverified",
 *     "product": { "name", "brand", "code", "kind", "ingredients", "labels", "certifications" },
 *     "report": { "ingredients", "oils", "certifications", "betterForYou", "note", "analysis" } | null,
 *     "grade": { "score", "band", "pass" } | null
 *   }
 * }
 * A daily review can branch on kind and read item.listing, item.product, and item.report.
 * The phone must not set listing to "verified". That happens when someone edits the shared catalog.
 *
 * Works in the browser (window.TortugaScout) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TortugaScout = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var REPO = 'https://github.com/lizethbran13-cmyk/tortuga-scan';

  function nowIso(date) {
    try { return (date ? new Date(date) : new Date()).toISOString(); }
    catch (e) { return ''; }
  }

  function clean(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  function productBlock(product) {
    product = product || {};
    return {
      name: clean(product.name),
      brand: clean(product.brand),
      code: clean(product.code || product.barcode),
      kind: product.kind === 'household' ? 'household' : 'food',
      ingredients: String(product.ingredients || ''),
      labels: clean(product.labels),
      certifications: product.certifications || []
    };
  }

  function reportBlock(report) {
    if (!report) return null;
    return {
      ingredients: String(report.ingredients || ''),
      oils: clean(report.oils),
      certifications: report.certifications || [],
      betterForYou: !!report.betterForYou,
      note: String(report.note || ''),
      analysis: String(report.analysis || '')
    };
  }

  function gradeBlock(grade) {
    if (!grade || grade.score == null) return null;
    return {
      score: grade.score,
      band: grade.band && grade.band.id ? grade.band.id : (grade.band || ''),
      pass: !!grade.pass
    };
  }

  function payload(kind, input) {
    input = input || {};
    var profile = input.profile || {};
    return {
      kind: kind,
      version: 1,
      exported: input.exported || nowIso(),
      profile: { id: clean(profile.id), name: clean(profile.name) },
      item: {
        listing: 'unverified',
        product: productBlock(input.product),
        report: kind === 'tortuga-report' ? reportBlock(input.report) : null,
        grade: gradeBlock(input.grade)
      }
    };
  }

  function reportPayload(input) { return payload('tortuga-report', input); }
  function catalogPayload(input) { return payload('tortuga-catalog', input); }

  function plainText(data) {
    var item = (data && data.item) || {};
    var product = item.product || {};
    var report = item.report;
    var grade = item.grade;
    var profile = (data && data.profile) || {};
    var lines = [
      data && data.kind === 'tortuga-catalog' ? 'Tortuga catalog upload' : 'Tortuga report',
      'Listing: unverified',
      '',
      'Product: ' + (product.name || 'Unknown'),
      'Brand: ' + (product.brand || ''),
      'Barcode: ' + (product.code || ''),
      'Kind: ' + (product.kind || 'food'),
      'Ingredients: ' + (product.ingredients || '')
    ];
    if (report) {
      lines.push(
        '',
        'Noticed ingredients: ' + (report.ingredients || ''),
        'Oils: ' + (report.oils || ''),
        'Certifications: ' + (Array.isArray(report.certifications) ? report.certifications.join(', ') : ''),
        'Better for You requested: ' + (report.betterForYou ? 'yes' : 'no'),
        'Note: ' + (report.note || ''),
        'Torty note: ' + (report.analysis || '')
      );
    }
    if (grade) lines.push('', 'Score on this phone: ' + grade.score + ' ' + (grade.band || '') + (grade.pass ? ' Pass' : ' Fail'));
    lines.push('', 'From: ' + (profile.name || 'someone on this phone') + (profile.id ? ' (' + profile.id + ')' : ''));
    lines.push('This stayed on the phone until it was copied or shared. It is not verified.');
    return lines.join('\n');
  }

  function titleFor(data) {
    var product = data && data.item && data.item.product;
    var name = (product && product.name) || 'item';
    var prefix = data && data.kind === 'tortuga-catalog' ? '[Tortuga catalog]' : '[Tortuga report]';
    return prefix + ' ' + name;
  }

  function bodyFor(data) {
    var json = JSON.stringify(data, null, 2);
    return [
      '## ' + titleFor(data),
      '',
      plainText(data),
      '',
      '```json',
      json,
      '```',
      '',
      'Sent from the Tortuga Scan app on this phone. Nothing was uploaded automatically.'
    ].join('\n');
  }

  function githubIssueUrl(data) {
    var title = encodeURIComponent(titleFor(data));
    var body = encodeURIComponent(bodyFor(data));
    return REPO + '/issues/new?title=' + title + '&body=' + body;
  }

  return {
    reportPayload: reportPayload,
    catalogPayload: catalogPayload,
    plainText: plainText,
    githubIssueUrl: githubIssueUrl,
    titleFor: titleFor,
    REPO: REPO
  };
});
