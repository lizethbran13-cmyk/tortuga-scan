/* Tortuga place scores, 0–10. Separate from the 0–100 package meter in rules.js.
   A place is not a Yelp, Google, Olive, or Seed Oil Scout score.
   Works in the browser (window.TortugaPlaces) and in Node (module.exports). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else root.TortugaPlaces = factory(root.ScoutRules);
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  // Bands are place bands. They are not the package meter (Avoid under 45 / Limit 45–59 / Eat 60–100).
  var AVOID_MAX = 4.4;
  var LIMIT_MAX = 5.9;
  var APPROVED_AT = 7;
  var MIN_REPORTS_FOR_SCORE = 2;
  var MIN_REPORTS_FOR_APPROVED = 3;
  var MIXED_SPREAD = 3.5;
  var SHOP_KINDS = { grocer: 1, shop: 1, chocolatier: 1 };

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function placeBand(score) {
    if (score == null || score !== score) return null;
    var n = round1(score);
    if (n <= AVOID_MAX) return { id: 'avoid', label: 'Avoid' };
    if (n <= LIMIT_MAX) return { id: 'limit', label: 'Limit' };
    return { id: 'eat', label: 'Eat / favorable' };
  }

  function asList(value) {
    if (value == null || value === '') return [];
    if (Array.isArray(value)) return value.map(function (v) { return String(v); });
    return [String(value)];
  }

  function pushUnique(list, name) {
    if (list.indexOf(name) < 0) list.push(name);
  }

  // Cooking-fat words only. A dish name, "olive", or "peanut butter" is not a fat finding.
  function classifyFatText(text) {
    // "seed oil-free" and "eliminating seed oils" are not a finding that the kitchen uses them.
    var t = String(text || '').toLowerCase()
      .replace(/\bseed oils?[-\s]*free\b/g, ' ')
      .replace(/\b(?:no|without|free of|free from|zero)\s+seed oils?\b/g, ' ')
      .replace(/\b(?:eliminating|eliminate|avoiding|avoid)\s+seed oils?\b/g, ' ');
    var favorable = [];
    var seed = [];
    var friedUnknown = false;
    if (oilsInPhrase(t, 'olive')) pushUnique(favorable, 'olive oil');
    if (oilsInPhrase(t, 'avocado')) pushUnique(favorable, 'avocado oil');
    if (oilsInPhrase(t, 'coconut')) pushUnique(favorable, 'coconut oil');
    if (/\bduck fats?\b/.test(t)) pushUnique(favorable, 'duck fat');
    if (/\bbeef fats?\b|\btallows?\b/.test(t)) pushUnique(favorable, 'tallow');
    if (/\blards?\b/.test(t)) pushUnique(favorable, 'lard');
    if (/\bghee\b/.test(t)) pushUnique(favorable, 'ghee');
    if (/\bbutter\b/.test(t) && !/\b(?:peanut|almond|cashew|sunflower|apple|cocoa|shea|cookie) butters?\b/.test(t)) {
      pushUnique(favorable, 'butter');
    }
    if (/\b(?:canola|rapeseed)\b/.test(t)) pushUnique(seed, 'canola');
    if (/\bsoy(?:bean)? oils?\b/.test(t)) pushUnique(seed, 'soybean oil');
    if (/\bvegetable oils?\b/.test(t)) pushUnique(seed, 'vegetable oil');
    if (/\bsunflower oils?\b/.test(t)) pushUnique(seed, 'sunflower oil');
    if (/\bsafflower oils?\b/.test(t)) pushUnique(seed, 'safflower oil');
    if (/\bcorn oils?\b/.test(t)) pushUnique(seed, 'corn oil');
    if (/\bcottonseed oils?\b/.test(t)) pushUnique(seed, 'cottonseed oil');
    if (/\b(?:grapeseed|grape seed) oils?\b/.test(t)) pushUnique(seed, 'grapeseed oil');
    if (/\brice bran oils?\b/.test(t)) pushUnique(seed, 'rice bran oil');
    if (/\bseed oils?\b/.test(t)) pushUnique(seed, 'seed oil');
    if (/\b(?:fryer oil unknown|fried,\s*oil not listed|deep fried,\s*unknown oil|oil not listed)\b/.test(t)) {
      friedUnknown = true;
    }
    return { favorable: favorable, seed: seed, friedUnknown: friedUnknown };
  }

  function mergeFat(into, part) {
    part.favorable.forEach(function (n) { pushUnique(into.favorable, n); });
    part.seed.forEach(function (n) { pushUnique(into.seed, n); });
    if (part.friedUnknown) into.friedUnknown = true;
  }

  function fatSignal(profile) {
    var fav = profile.favorable.length > 0;
    var seed = profile.seed.length > 0;
    if (fav && seed) return 'mixed';
    if (seed) return 'seed';
    if (fav) return 'favorable';
    if (profile.friedUnknown) return 'fried-unknown';
    return 'none';
  }

  function fatScoreFor(signal, partial) {
    if (signal === 'mixed') return 4.2;
    if (signal === 'seed') return 2.0;
    if (signal === 'favorable') return partial ? 7.0 : 9.0;
    if (signal === 'fried-unknown') return 4.0;
    return null;
  }

  function mean(nums) {
    if (!nums.length) return null;
    var s = nums.reduce(function (a, b) { return a + b; }, 0);
    return round1(s / nums.length);
  }

  function isShop(place) {
    return !!SHOP_KINDS[(place && place.kind) || ''];
  }

  function sourcedFatNotes(place) {
    return (place.sourcedNotes || []).filter(function (n) {
      return n && (n.kind === 'cooking-fat' || (n.fats && n.fats.length));
    });
  }

  function gradedOfferings(place) {
    var out = [];
    (place.offerings || []).forEach(function (o) {
      var text = String((o && o.ingredients) || '').trim();
      if (text.length < 8 || !R || !R.grade) return;
      var g = R.grade(text, { productName: o.name || '' });
      out.push({ name: o.name, score100: g.score, score10: round1(g.score / 10), band: g.band });
    });
    return out;
  }

  function reportRatings(reports) {
    var nums = [];
    (reports || []).forEach(function (r) {
      if (!r) return;
      var n = Number(r.rating);
      if (n === n && n >= 0 && n <= 10) nums.push(n);
    });
    return nums;
  }

  function oilsInPhrase(text, name) {
    var t = String(text || '');
    var reOne = new RegExp('\\b' + name + ' oils?\\b');
    var reLead = new RegExp('\\b' + name + ' and [a-z]+\\s+oils?\\b');
    var reTail = new RegExp('\\b[a-z]+ and ' + name + ' oils?\\b');
    return reOne.test(t) || reLead.test(t) || reTail.test(t);
  }

  function collectFats(place, reports) {
    var notes = { favorable: [], seed: [], friedUnknown: false };
    var all = { favorable: [], seed: [], friedUnknown: false };
    var partial = false;
    sourcedFatNotes(place).forEach(function (n) {
      if (n.completeness === 'partial') partial = true;
      var part = classifyFatText(asList(n.fats).concat([n.text || '']).join(', '));
      mergeFat(notes, part);
      mergeFat(all, part);
    });
    (reports || []).forEach(function (r) {
      mergeFat(all, classifyFatText(asList(r.fats).join(', ')));
    });
    return {
      profile: all,
      signal: fatSignal(all),
      noteSignal: fatSignal(notes),
      partial: partial
    };
  }

  function emptyResult(place, extras) {
    var base = {
      status: 'unrated',
      score: null,
      band: null,
      approved: false,
      label: 'Unrated — need reports',
      basis: 'none',
      preliminary: false,
      shop: isShop(place),
      reportCount: 0,
      spread: null,
      signal: 'none',
      fatNames: [],
      seedNames: [],
      partial: false,
      conflicts: [],
      gradedItems: [],
      headline: 'Not enough reports yet'
    };
    Object.keys(extras || {}).forEach(function (k) { base[k] = extras[k]; });
    return base;
  }

  /**
   * Grade one place from its public record plus reports stored on this phone
   * (and any shared reports passed in). Does not invent a score.
   *
   * Numeric score when:
   * - a restaurant or cafe has sourced notes that name cooking fats, or
   * - there are at least two ratings, or
   * - a shop has at least two offerings with real ingredient lists.
   * One rating is never enough. A grocer is not scored as a fryer.
   *
   * Tortuga approved only at 7.0 or higher, with three or more ratings
   * averaging at least 7, no mixed or seed-oil conflict, and favorable fat
   * evidence that is not only a partial company claim.
   * Consistent seed-oil evidence caps the score at 4.4.
   * Mixed evidence caps it at 5.9 and cannot be approved.
   */
  function gradePlace(place, reports) {
    place = place || {};
    reports = reports || [];
    var ratings = reportRatings(reports);
    var fats = collectFats(place, reports);
    var items = gradedOfferings(place);
    var shop = isShop(place);
    var spread = ratings.length >= 2 ? round1(Math.max.apply(null, ratings) - Math.min.apply(null, ratings)) : null;
    var conflicts = [];
    if (fats.signal === 'mixed') {
      conflicts.push('Favorable fats and seed oils are both named: ' + fats.profile.favorable.join(', ') + ' and ' + fats.profile.seed.join(', ') + '.');
    }
    if (spread != null && spread >= MIXED_SPREAD) {
      conflicts.push('Ratings run from ' + Math.min.apply(null, ratings) + ' to ' + Math.max.apply(null, ratings) + '.');
    }
    var mixed = conflicts.length > 0;
    var reportMean = ratings.length >= MIN_REPORTS_FOR_SCORE ? mean(ratings) : null;
    var itemMean = items.length >= 2 ? mean(items.map(function (it) { return it.score10; })) : null;
    // A single report can name a fat, but that is not enough for a number.
    // Public notes can. Two or more reports can.
    var fatScore = (fats.noteSignal !== 'none' || ratings.length >= MIN_REPORTS_FOR_SCORE)
      ? fatScoreFor(fats.signal, fats.partial && fats.noteSignal !== 'none' && ratings.length < MIN_REPORTS_FOR_SCORE)
      : null;
    var shared = {
      shop: shop,
      reportCount: ratings.length,
      spread: spread,
      signal: fats.signal,
      fatNames: fats.profile.favorable.slice(),
      seedNames: fats.profile.seed.slice(),
      partial: fats.partial,
      conflicts: conflicts,
      gradedItems: items
    };

    var score = null;
    var basis = 'none';
    var preliminary = false;

    if (shop) {
      // Shops, grocers, and chocolatiers: no restaurant fat score from silence.
      if (reportMean != null && itemMean != null) {
        score = round1(itemMean * 0.6 + reportMean * 0.4);
        basis = 'blended';
      } else if (reportMean != null) {
        score = reportMean;
        basis = 'reports';
      } else if (itemMean != null) {
        score = itemMean;
        basis = 'ingredients';
        preliminary = true;
      }
      if (score != null && fats.signal === 'seed') score = Math.min(score, AVOID_MAX);
      if (score != null && mixed) score = Math.min(score, LIMIT_MAX);
    } else if (fatScore == null && reportMean == null && itemMean == null) {
      score = null;
    } else if (fatScore != null && reportMean == null && itemMean == null) {
      score = fatScore;
      basis = 'public-notes';
      preliminary = true;
    } else if (fatScore == null && reportMean != null && itemMean == null) {
      score = reportMean;
      basis = 'reports';
    } else if (fatScore == null && reportMean == null && itemMean != null) {
      score = itemMean;
      basis = 'ingredients';
      preliminary = true;
    } else {
      var parts = [];
      if (fatScore != null) parts.push([0.7, fatScore]);
      if (reportMean != null) parts.push([0.3, reportMean]);
      if (itemMean != null) parts.push([0.15, itemMean]);
      var w = parts.reduce(function (s, p) { return s + p[0]; }, 0);
      score = round1(parts.reduce(function (s, p) { return s + p[0] * p[1]; }, 0) / w);
      basis = 'blended';
      if (fats.signal === 'seed') score = Math.min(score, AVOID_MAX);
      if (mixed) score = Math.min(score, LIMIT_MAX);
    }

    if (score == null) {
      return emptyResult(place, shared);
    }
    score = round1(Math.max(0, Math.min(10, score)));
    var band = placeBand(score);
    var status = mixed ? 'mixed' : (preliminary ? 'preliminary' : 'scored');
    var favorableEvidence = fats.signal === 'favorable' && !fats.partial;
    var reportsFavorable = fats.signal === 'favorable' && fats.profile.favorable.length > 0 &&
      (reports || []).some(function (r) { return classifyFatText(asList(r.fats).join(', ')).favorable.length > 0; });
    var approved = status === 'scored' && score >= APPROVED_AT && !mixed && fats.signal !== 'seed' &&
      ratings.length >= MIN_REPORTS_FOR_APPROVED && reportMean >= APPROVED_AT &&
      (favorableEvidence || reportsFavorable);
    var label = approved ? 'Tortuga approved' : (status === 'mixed' ? 'Mixed — need more reports' : (preliminary ? band.label + ' · not approved' : band.label));
    var headline = approved ? 'Tortuga approved' : (preliminary ? 'From public notes — not enough reports to approve' : (status === 'mixed' ? 'Reports disagree' : 'Scored from reports'));
    if (shop && basis === 'ingredients') headline = 'From published ingredient lists — not a restaurant seed-oil score';
    if (shop && basis === 'reports') headline = 'From reports on what people bought — not a restaurant seed-oil score';
    return Object.assign(shared, {
      status: status,
      score: score,
      band: band,
      approved: !!approved,
      label: label,
      basis: basis,
      preliminary: preliminary,
      headline: headline
    });
  }

  function whatLists(place, reports) {
    var get = [];
    var skip = [];
    function add(list, row) {
      if (list.some(function (x) { return x.name.toLowerCase() === row.name.toLowerCase() && x.from === row.from; })) return;
      list.push(row);
    }
    (place.offerings || []).forEach(function (o) {
      if (!o || !o.name || (o.suggest !== 'get' && o.suggest !== 'skip')) return;
      var row = { name: o.name, why: o.note || '', source: o.sourceUrl || '', from: 'official' };
      if (o.suggest === 'get') add(get, row);
      else add(skip, row);
    });
    (reports || []).forEach(function (r) {
      if (!r || !r.ordered) return;
      var fats = classifyFatText(asList(r.fats).join(', '));
      var rating = Number(r.rating);
      var named = fats.favorable.concat(fats.seed);
      if (fats.seed.length || (rating === rating && rating <= 4)) {
        add(skip, {
          name: r.ordered,
          why: 'From a report on this phone' + (named.length ? '. Fats named: ' + named.join(', ') + '.' : '.'),
          source: '',
          from: 'report'
        });
      } else if (rating === rating && rating >= 7 && !fats.seed.length) {
        add(get, {
          name: r.ordered,
          why: 'From a report on this phone' + (fats.favorable.length ? '. Fats named: ' + fats.favorable.join(', ') + '.' : '. No cooking fat was written down.'),
          source: '',
          from: 'report'
        });
      }
    });
    return { get: get, skip: skip, prompt: get.length === 0 && skip.length === 0 };
  }

  function gradeMenuLine(line) {
    line = line || {};
    var name = String(line.name || '').trim();
    var ingredients = String(line.ingredients || '').trim();
    if (ingredients.length < 3) {
      return {
        name: name,
        status: 'needs-ingredients',
        score: null,
        band: null,
        pass: null,
        summary: 'Needs ingredients or a report. A dish name is not an ingredient list, so Tortuga will not guess the cooking fat.'
      };
    }
    var g = R.grade(ingredients, { productName: name });
    return {
      name: name,
      status: 'graded',
      score: g.score,
      band: g.band,
      pass: g.pass,
      flags: (g.deductions || []).map(function (d) { return d.label; }),
      summary: 'Graded with Tortuga’s package rules from the ingredients you typed. This number is the 0–100 package score, not the 0–10 place score.'
    };
  }

  function joinList(items) {
    var list = (items || []).filter(Boolean);
    if (!list.length) return '';
    if (list.length === 1) return list[0];
    if (list.length === 2) return list[0] + ' and ' + list[1];
    return list.slice(0, -1).join(', ') + ', and ' + list[list.length - 1];
  }

  function tortyPlace(place, result) {
    place = place || {};
    result = result || gradePlace(place, []);
    var name = place.name || 'this place';
    var line;
    if (result.status === 'unrated' || result.score == null) {
      line = name + ' is on the map, and I don’t have enough to score it. I need reports that say what you ordered and which fats you actually saw. I won’t guess from the name of a dish or from the kind of place.';
      if (result.shop) line += ' A shop doesn’t get a restaurant seed-oil score from me.';
    } else if (result.preliminary && result.basis === 'public-notes') {
      line = 'The public notes I have for ' + name + (result.fatNames.length ? ' name ' + joinList(result.fatNames) : ' don’t name a cooking fat I can use') + '.';
      if (result.seedNames.length) line += ' They also name ' + joinList(result.seedNames) + '.';
      line += ' That is the source talking, not a meal I watched. The place score is ' + result.score + ' (' + (result.band ? result.band.label : 'unrated') + '), and it is not a Tortuga approved badge. I still want reports from the table.';
      if (result.partial) line += ' The company pages I read don’t describe every ingredient the same way, so I’m not treating the kitchen as finished.';
    } else if (result.preliminary && result.basis === 'ingredients') {
      line = name + ' has published ingredient lists I can grade as packages. The place score is ' + result.score + '. That is not a restaurant seed-oil score, and it is not approved.';
    } else if (result.status === 'mixed') {
      line = 'I won’t give ' + name + ' a clean badge. The score on this phone is ' + result.score + ', and the reports disagree. ' + (result.conflicts[0] || '');
    } else {
      line = name + ' scores ' + result.score + ' on the place scale, ' + (result.band ? result.band.label : '') + ', from ' + result.reportCount + ' reports.';
      if (result.fatNames.length) line += ' Fats actually named: ' + joinList(result.fatNames) + '.';
      else line += ' Nobody has written down a cooking fat yet.';
      if (result.seedNames.length) line += ' Seed oils named: ' + joinList(result.seedNames) + '.';
      if (result.approved) line += ' That’s enough, and consistent enough, for a Tortuga approved badge on this phone.';
      else line += ' It is not a Tortuga approved badge.';
    }
    line += ' This is not a Yelp score, a Google score, or a Seed Oil Scout score.';
    return line;
  }

  function parseCoord(value) {
    if (value == null || String(value).trim() === '') return null;
    var n = parseFloat(String(value).trim());
    return n === n ? n : null;
  }

  function normalizeWebsite(input) {
    var raw = String(input || '').trim();
    if (!raw) return { ok: true, url: '' };
    var withScheme = raw;
    if (/^https:\/\//i.test(raw)) withScheme = raw;
    else if (/^http:\/\//i.test(raw)) withScheme = raw.replace(/^http:\/\//i, 'https://');
    else if (/^\/\//.test(raw)) withScheme = 'https:' + raw;
    else withScheme = 'https://' + raw.replace(/^\/+/, '');
    var url;
    try { url = new URL(withScheme); }
    catch (e) {
      return { ok: false, url: '', message: 'That website could not be read. Use a domain such as example.com, or leave it blank.' };
    }
    if (!url.hostname || url.hostname.indexOf('.') < 0 || url.protocol !== 'https:') {
      return { ok: false, url: '', message: 'That website needs a full domain, such as example.com. You can leave it blank.' };
    }
    return { ok: true, url: url.href };
  }

  function preparePlaceDraft(fields) {
    fields = fields || {};
    var name = String(fields.name || '').trim();
    var address = String(fields.address || '').trim();
    if (!name) return { ok: false, field: 'name', message: 'Add a name, then save again.' };
    if (!address) return { ok: false, field: 'address', message: 'Add a street address, then save again.' };
    var web = normalizeWebsite(fields.website);
    if (!web.ok) return { ok: false, field: 'website', message: web.message };
    var latText = String(fields.lat == null ? '' : fields.lat).trim();
    var lngText = String(fields.lng == null ? '' : fields.lng).trim();
    var lat = parseCoord(latText);
    var lng = parseCoord(lngText);
    if ((latText || lngText) && (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180)) {
      return { ok: false, field: 'lat', message: 'Those coordinates are not usable. Use where you are, drop a pin, or clear both boxes so the address can be looked up.' };
    }
    var draft = { ok: true, name: name, address: address, website: web.url, city: String(fields.city || '').trim() };
    if (lat === null || lng === null) {
      draft.needsGeocode = true;
      draft.lat = null;
      draft.lng = null;
      return draft;
    }
    draft.needsGeocode = false;
    draft.lat = Math.round(lat * 1e6) / 1e6;
    draft.lng = Math.round(lng * 1e6) / 1e6;
    return draft;
  }

  function nominatimQuery(address, city) {
    return [String(address || '').trim(), String(city || '').trim(), 'Nevada'].filter(Boolean).join(', ');
  }

  function geocodeHit(rows) {
    var hit = rows && rows[0];
    if (!hit) return null;
    var lat = parseCoord(hit.lat);
    var lng = parseCoord(hit.lon);
    if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, label: hit.display_name || '' };
  }

  function slugItem(name) {
    var s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s || 'item';
  }

  var ORDER_DENY = /(^|\.)(doordash|ubereats|grubhub|postmates|yelp|google|facebook|instagram)\./i;

  function orderChoices(place) {
    place = place || {};
    var shop = !!SHOP_KINDS[place.kind];
    var raw = String(place.orderUrl || '').trim();
    var orderUrl = (/^https:\/\//i.test(raw) && !ORDER_DENY.test(raw)) ? raw : '';
    return {
      grok: shop,
      orderUrl: orderUrl,
      viewOnly: !shop && !orderUrl
    };
  }

  function catalogMenuItems(place) {
    place = place || {};
    return (place.offerings || []).filter(function (o) { return o && o.name; }).map(function (o) {
      return {
        id: o.id || slugItem(o.name),
        placeId: place.id,
        name: String(o.name),
        note: o.note || '',
        ingredients: o.ingredients || '',
        sourceUrl: o.sourceUrl || '',
        fats: o.fats || [],
        origin: 'catalog'
      };
    });
  }

  function mergeMenu(place, phoneItems) {
    var byId = {};
    catalogMenuItems(place).forEach(function (it) { byId[it.id] = it; });
    (phoneItems || []).forEach(function (it) {
      if (!it || it.placeId !== (place && place.id) || !it.name) return;
      var id = it.id || slugItem(it.name);
      byId[id] = {
        id: id,
        placeId: place.id,
        name: String(it.name),
        note: it.note || '',
        ingredients: it.ingredients || '',
        sourceUrl: it.sourceUrl || '',
        fats: it.fats || [],
        origin: 'phone'
      };
    });
    return Object.keys(byId).map(function (k) { return byId[k]; }).sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
  }

  function rulesSummary() {
    return {
      scale: '0-10',
      avoidMax: AVOID_MAX,
      limitMax: LIMIT_MAX,
      approvedAt: APPROVED_AT,
      minReportsForScore: MIN_REPORTS_FOR_SCORE,
      minReportsForApproved: MIN_REPORTS_FOR_APPROVED,
      mixedSpread: MIXED_SPREAD,
      note: 'Place scores run from 0 to 10, one decimal. They are not the 0–100 package score. Avoid is 0–4.4. Limit is 4.5–5.9. Eat / favorable is 6.0–10. Tortuga approved needs 7.0 or higher, three or more ratings averaging at least 7, and fat evidence that is not mixed or only a partial company claim. Fewer than two ratings, and no sourced cooking fats or published ingredient lists, stays Unrated — need reports. Seed-oil evidence caps a place at 4.4. Mixed evidence caps it at 5.9. Grocers, shops, and chocolatiers are not given a restaurant seed-oil score for merely being a store.'
    };
  }

  return {
    APPROVED_AT: APPROVED_AT,
    AVOID_MAX: AVOID_MAX,
    LIMIT_MAX: LIMIT_MAX,
    placeBand: placeBand,
    classifyFatText: classifyFatText,
    gradePlace: gradePlace,
    gradeMenuLine: gradeMenuLine,
    slugItem: slugItem,
    parseCoord: parseCoord,
    normalizeWebsite: normalizeWebsite,
    preparePlaceDraft: preparePlaceDraft,
    nominatimQuery: nominatimQuery,
    geocodeHit: geocodeHit,
    orderChoices: orderChoices,
    mergeMenu: mergeMenu,
    whatLists: whatLists,
    tortyPlace: tortyPlace,
    rulesSummary: rulesSummary
  };
});
