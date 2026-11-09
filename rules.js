/*
 * Tortuga Scan — rules engine
 * Our own implementation of Seed Oil Scout's *published* "Seed Oil Safe" guidelines
 * (https://www.seedoilscout.com/seedoilsafe) plus our own 0–100 "Tortuga Scan clean score" (inspired by categories Olive publicly describes).
 * Not affiliated with, endorsed by, or an official certification from Seed Oil Scout or Olive.
 * Works in the browser (window.ScoutRules) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScoutRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- text prep
  function normalize(text) {
    return String(text || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // strip accents
      .toLowerCase()
      .replace(/[_*]/g, ' ')                            // OFF allergen markup: _soya_
      .replace(/[\u2010-\u2015]/g, '-')                 // fancy dashes
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\[/g, '(').replace(/\]/g, ')')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Merge multi-word oil names into single tokens so the oil scanner is simpler.
  function mergeOilNames(t) {
    return t
      .replace(/\bgrape[\s-]+seed\b/g, 'grapeseed')
      .replace(/\bcotton[\s-]+seed\b/g, 'cottonseed')
      .replace(/\brape[\s-]+seed\b/g, 'rapeseed')
      .replace(/\brice[\s-]+bran\b/g, 'ricebran')
      .replace(/\bsoy[a]?[\s-]+beans?\b/g, 'soybean')
      .replace(/\bsoybeans\b/g, 'soybean')
      .replace(/\b(high|mid|low)[\s-]+oleic\b/g, '$1oleic')
      .replace(/\bexpeller[\s-]+pressed\b/g, 'expellerpressed')
      .replace(/\bcold[\s-]+pressed\b/g, 'coldpressed')
      .replace(/\bnon[\s-]+gmo\b/g, 'nongmo')
      .replace(/\band\s*\/\s*or\b/g, 'andor');
  }

  // Cross-contact / facility statements are not ingredients; drop them before grading.
  var CROSS_CONTACT = /\b(may contain|may also contain|made (?:in|on) (?:a )?(?:facility|equipment|shared)|produced (?:in|on) (?:a )?(?:facility|equipment)|processed (?:in|on) (?:a )?(?:facility|equipment)|manufactured (?:in|on) (?:a )?(?:facility|equipment)|packaged (?:in|on) (?:a )?(?:facility|equipment)|traces? of)[^.]*\.?/g;

  function stripCrossContact(t) {
    var removed = [];
    var out = t.replace(CROSS_CONTACT, function (m) { removed.push(m.trim()); return ' '; });
    return { text: out.replace(/\s+/g, ' ').trim(), removed: removed };
  }

  // Context = the ingredient segment around a match, for showing in the UI.
  function contextAt(text, index, length) {
    var start = index, end = index + length, depth = 0;
    for (var i = index - 1; i >= 0; i--) {
      var c = text[i];
      if (c === ')') depth++;
      else if (c === '(') { if (depth === 0) { start = i + 1; break; } depth--; }
      else if ((c === ',' || c === ';' || c === '.') && depth === 0) { start = i + 1; break; }
      start = i;
    }
    depth = 0;
    for (var j = index + length; j < text.length; j++) {
      var d = text[j];
      if (d === '(') depth++;
      else if (d === ')') { if (depth === 0) break; depth--; }
      else if ((d === ',' || d === ';' || d === '.') && depth === 0) break;
      end = j + 1;
    }
    var s = text.slice(start, end).trim();
    if (s.length > 90) {
      var rel = index - start;
      var a = Math.max(0, rel - 35);
      s = (a > 0 ? '…' : '') + text.slice(start + a, Math.min(end, start + a + 85)).trim() + '…';
    }
    return s;
  }

  // ---------------------------------------------------------------- seed oils
  var SEED_OIL_NAMES = {
    canola: 'Canola oil', rapeseed: 'Rapeseed oil',
    soybean: 'Soybean oil', soya: 'Soybean oil', soy: 'Soybean oil',
    corn: 'Corn oil', maize: 'Corn (maize) oil',
    sunflower: 'Sunflower oil', sunflowerseed: 'Sunflower oil',
    safflower: 'Safflower oil', grapeseed: 'Grapeseed oil', cottonseed: 'Cottonseed oil',
    ricebran: 'Rice bran oil', vegetable: 'Generic vegetable oil'
  };
  // Oils that are NOT on the seed-oil list. They can appear inside a chain like
  // "olive and/or canola oil" so we recognise them while walking the chain.
  var OK_OIL_NAMES = ['olive', 'avocado', 'coconut', 'mct', 'palm', 'palmkernel', 'kernel', 'sesame', 'flax',
    'flaxseed', 'linseed', 'walnut', 'almond', 'peanut', 'groundnut', 'macadamia', 'hazelnut', 'pumpkin',
    'pistachio', 'hemp', 'hempseed', 'extra', 'virgin', 'butter', 'fish', 'cod', 'krill', 'algal', 'algae', 'truffle'];
  var OIL_MODIFIERS = ['organic', 'expellerpressed', 'coldpressed', 'refined', 'unrefined', 'higholeic', 'midoleic',
    'lowoleic', 'nongmo', 'partially', 'fully', 'hydrogenated', 'interesterified', 'seed', 'bean', 'pure', 'light',
    'toasted', 'roasted', 'cooking', 'salad', 'non', 'gmo', 'high', 'oleic', 'non-gmo', 'deodorized', 'winterized'];
  var CONNECTORS = ['and', 'or', 'andor', '&', '/', ','];

  // Names that are almost always an oil on a label, so we flag them even without the word "oil".
  // (Followed by "lecithin" they are lecithins, handled by the lecithin rule instead.)
  var STRONG_SEED_OILS = /\b(canola|rapeseed|cottonseed|grapeseed)\b(?!\s+(?:lecithin|extract|flour|protein))/g;

  function findSeedOils(text) {
    var t = mergeOilNames(text);
    var hits = [];
    var tokenRe = /[a-z0-9-]+|[,&\/()]/g;
    var tokens = [], m;
    while ((m = tokenRe.exec(t))) tokens.push({ w: m[0], i: m.index });

    for (var k = 0; k < tokens.length; k++) {
      var w = tokens[k].w;
      if (w !== 'oil' && w !== 'oils' && w !== 'shortening' && w !== 'shortenings') continue;
      var found = [];
      var sawConj = false;
      var startIdx = tokens[k].i;
      // walk backwards over the chain: "organic expeller-pressed canola and/or high oleic sunflower oil"
      for (var b = k - 1; b >= 0; b--) {
        var tw = tokens[b].w;
        if (tw === ',') { if (!sawConj) break; startIdx = tokens[b].i; continue; }
        if (CONNECTORS.indexOf(tw) >= 0) { sawConj = true; startIdx = tokens[b].i; continue; }
        if (SEED_OIL_NAMES[tw]) { found.push(tw); startIdx = tokens[b].i; continue; }
        if (OK_OIL_NAMES.indexOf(tw) >= 0 || OIL_MODIFIERS.indexOf(tw) >= 0) { startIdx = tokens[b].i; continue; }
        break;
      }
      // "shortening" alone only counts when it's "vegetable shortening" (or a named seed oil shortening)
      if (/^shortening/.test(w) && found.length === 0) continue;
      // forward parenthetical: "vegetable oil (canola, sunflower)" or "oil (sunflower)"
      var endIdx = tokens[k].i + w.length;
      if (tokens[k + 1] && tokens[k + 1].w === '(') {
        for (var f = k + 2; f < tokens.length && tokens[f].w !== ')'; f++) {
          if (SEED_OIL_NAMES[tokens[f].w] && tokens[f].w !== 'vegetable') found.push(tokens[f].w);
          endIdx = tokens[f].i + tokens[f].w.length;
        }
        if (tokens[f] && tokens[f].w === ')') endIdx = tokens[f].i + 1;
      }
      var phrase = t.slice(startIdx, endIdx).replace(/^[\s,&\/]+/, '').trim();
      found.forEach(function (name) {
        hits.push({ name: name, label: SEED_OIL_NAMES[name], match: phrase, index: startIdx, length: endIdx - startIdx, text: t });
      });
    }
    STRONG_SEED_OILS.lastIndex = 0;
    while ((m = STRONG_SEED_OILS.exec(t))) {
      var nm = m[1];
      var already = hits.some(function (h) { return h.name === nm; });
      if (!already) hits.push({ name: nm, label: SEED_OIL_NAMES[nm], match: m[0], index: m.index, length: m[0].length, text: t });
    }
    // de-duplicate by oil name, keep first occurrence
    var seen = {};
    return hits.filter(function (h) {
      var key = SEED_OIL_NAMES[h.name];
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).map(function (h) {
      return {
        rule: h.name === 'vegetable' ? 'Generic "vegetable oil" — usually a seed-oil blend' : h.label,
        match: h.match,
        context: contextAt(h.text, h.index, h.length)
      };
    });
  }

  // ---------------------------------------------------------------- pattern rules
  function scan(text, patterns) {
    var out = [], seenRule = {};
    patterns.forEach(function (p) {
      var re = new RegExp(p.re.source, 'g');
      var m;
      while ((m = re.exec(text))) {
        if (p.skip && p.skip(text, m)) continue;
        var key = p.rule + '|' + m[0];
        if (!seenRule[key]) {
          seenRule[key] = true;
          out.push({ rule: p.rule, match: m[0].trim(), context: contextAt(text, m.index, m[0].length), note: p.note });
        }
        if (m[0].length === 0) re.lastIndex++;
      }
    });
    // collapse identical rule+context duplicates
    var seenCtx = {};
    return out.filter(function (h) {
      var k = h.rule + '|' + h.context;
      if (seenCtx[k]) return false;
      seenCtx[k] = true;
      return true;
    });
  }

  var E = function (nums) { return new RegExp('\\b(?:e|ins)[\\s-]?(?:' + nums.join('|') + ')[a-z]?\\b'); };

  var SOY = [
    // soy words, except when they are the oil (that's graded under seed oils)
    { re: /\b(?:soy|soya|soja|soybeans?|soy[\s-]?beans?)\b(?![\s-]*(?:(?:bean|organic|refined|hydrogenated|partially|fully|expeller[\s-]?pressed|nongmo|non[\s-]?gmo)[\s-]+)*oils?\b)/, rule: 'Soy' },
    { re: /\b(?:tamari|shoyu|miso|edamame|tofu|tempeh|natto|okara|yuba)\b/, rule: 'Soy food (tamari, miso, tofu, tempeh, etc.)' },
    { re: /\btextured vegetable protein\b|\btvp\b/, rule: 'Textured vegetable protein (usually soy)', note: 'TVP is almost always made from soy.' }
  ];

  var SWEETENERS = [
    { re: /\baspartame\b/, rule: 'Aspartame' },
    { re: /\bsucralose\b/, rule: 'Sucralose' },
    { re: /\bacesulfame(?:[\s-]*(?:potassium|k))?\b|\bace[\s-]?k\b/, rule: 'Acesulfame potassium (Ace-K)' },
    { re: /\bsaccharin(?:e)?\b/, rule: 'Saccharin' },
    { re: /\bneotame\b/, rule: 'Neotame' },
    { re: /\badvantame\b/, rule: 'Advantame' },
    { re: /\bcyclamates?\b/, rule: 'Cyclamate' },
    { re: E(['950', '951', '952', '954', '955', '961', '962', '969']), rule: 'Artificial sweetener (E-number)' }
  ];

  var GUMS = [
    { re: /\bxanthan(?:\s+gum)?\b/, rule: 'Xanthan gum' },
    { re: /\bguar(?:\s+gum)?\b/, rule: 'Guar gum' },
    { re: /\bgellan(?:\s+gum)?\b/, rule: 'Gellan gum' },
    { re: /\b(?:locust bean|carob bean|carob seed)(?:\s+gum)?\b|\bcarob gum\b/, rule: 'Locust bean / carob bean gum' },
    { re: /\bgum arabic\b|\bacacia(?:\s+(?:gum|senegal|fiber|fibre))?\b|\bgum acacia\b/, rule: 'Gum arabic / acacia gum',
      skip: function (t, m) { return /^acacia$/.test(m[0]) && /^\s*(?:honey|wood|tree)/.test(t.slice(m.index + m[0].length, m.index + m[0].length + 8)); } },
    { re: /\bcellulose gum\b|\b(?:sodium\s+)?carboxy[\s-]?methyl[\s-]?cellulose\b|\bcmc\b/, rule: 'Cellulose gum (CMC)' },
    { re: /\btara(?:\s+gum)\b/, rule: 'Tara gum' },
    { re: /\b(?:gum\s+)?karaya(?:\s+gum)?\b/, rule: 'Karaya gum' },
    { re: /\b(?:gum\s+)?tragacanth(?:\s+gum)?\b/, rule: 'Tragacanth gum' },
    { re: /\bvegetable gums?\b|\bgum blend\b|\bnatural gums?\b/, rule: 'Unspecified gum' },
    { re: /\bcarrageenan\b|\bcarrageenin\b/, rule: 'Carrageenan', note: 'Not a gum strictly, but a common clean-eating avoid; we group it here.' },
    { re: E(['407', '407a', '410', '412', '413', '414', '415', '416', '417', '418', '466']), rule: 'Gum / thickener (E-number)' }
  ];

  var LECITHINS = [
    { re: /\b(?:soy|soya|soybean)\s+lecithins?\b|\blecithins?\s*\((?:from\s+)?(?:soy|soya|soybean)\)/, rule: 'Soy lecithin' },
    { re: /\bsunflower(?:\s+seed)?\s+lecithins?\b|\blecithins?\s*\((?:from\s+)?sunflower\)/, rule: 'Sunflower lecithin' },
    { re: /\b(?:rapeseed|canola|rape seed)\s+lecithins?\b|\blecithins?\s*\((?:from\s+)?(?:rapeseed|canola)\)/, rule: 'Rapeseed / canola lecithin' },
    {
      re: /\blecithins?\b(?!\s*\()/, rule: 'Lecithin (source not stated)',
      note: 'Source not listed. Most food lecithin is soy or sunflower, so we treat it as a likely plant lecithin.',
      skip: function (t, m) {
        var before = t.slice(Math.max(0, m.index - 22), m.index);
        return /\b(?:egg|egg yolk|yolk|soy|soya|soybean|sunflower|sunflower seed|rapeseed|canola)\s+$/.test(before);
      }
    },
    { re: E(['322']), rule: 'Lecithin (E322)', note: 'E322 is lecithin, usually from soy or sunflower.' }
  ];

  var NATURAL_FLAVORS = [
    { re: /\bnatural\s+(?:[a-z]+\s+){0,2}?flavou?r(?:s|ing|ings)?\b/, rule: 'Natural flavor(s)' },
    { re: /\bflavou?r(?:s|ing|ings)?\s*\(\s*natural\b/, rule: 'Natural flavor(s)' },
    { re: /\bnatural and artificial flavou?r(?:s|ing|ings)?\b/, rule: 'Natural flavor(s)' }
  ];

  var DYES = [
    { re: /\bfd\s*&\s*c\b[^,;]*/, rule: 'FD&C synthetic dye' },
    { re: /\b(?:red|yellow|blue|green|citrus red)\s*(?:no\.?\s*|#\s*)?(?:40|3|5|6|1|2|3)\b(?:\s+lake)?/, rule: 'Synthetic dye',
      skip: function (t, m) { return /\b(?:red|yellow|blue|green)\s*(?:no\.?\s*|#\s*)?[0-9]+\s*(?:%|g\b|mg\b)/.test(t.slice(m.index, m.index + m[0].length + 4)); } },
    { re: /\borange b\b/, rule: 'Synthetic dye (Orange B)' },
    { re: /\ballura red\b|\btartrazine\b|\bsunset yellow\b|\bbrilliant blue\b|\berythrosine?\b|\bindigo carmine\b|\bindigotine\b|\bfast green\b|\bponceau\b|\bcarmoisine\b|\bazorubine\b|\bquinoline yellow\b|\bpatent blue\b|\bbrilliant black\b|\bgreen s\b/, rule: 'Synthetic dye (named)' },
    { re: E(['102', '104', '110', '122', '123', '124', '127', '129', '131', '132', '133', '142', '143', '151', '155']), rule: 'Synthetic dye (E-number)' },
    { re: /\bartificial(?:ly)?\s+(?:colou?r(?:s|ing|ings|ed)?)\b/, rule: 'Artificial color' },
    { re: /\bcolou?r(?:s|ing)?\s+added\b|\bcolou?r(?:s|ing)?\s*\(\s*artificial/, rule: 'Artificial color',
      skip: function (t, m) { return !/artificial/.test(m[0]) && !/artificial/.test(t.slice(Math.max(0, m.index - 20), m.index)); } }
  ];

  var ADDITIVES = [
    { re: /\bbha\b|\bbutylated hydroxyanisole\b|\be[\s-]?320\b/, rule: 'BHA' },
    { re: /\bbht\b|\bbutylated hydroxytoluene\b|\be[\s-]?321\b/, rule: 'BHT' },
    { re: /\btbhq\b|\btert[\s-]?butyl[\s-]?hydroquinone\b|\btertiary butylhydroquinone\b|\be[\s-]?319\b/, rule: 'TBHQ' },
    { re: /\b(?:sodium|potassium)\s+benzoate\b|\be[\s-]?21[12]\b/, rule: 'Benzoate preservative' },
    { re: /\b(?:potassium|calcium|sodium)\s+sorbate\b|\be[\s-]?20[0-3]\b/, rule: 'Sorbate preservative' },
    { re: /\b(?:sodium|potassium)\s+nitr[ia]te\b|\be[\s-]?25[0-2]\b/, rule: 'Nitrite / nitrate' },
    { re: /\bpolysorbates?(?:\s*[- ]?\d+)?\b|\be[\s-]?43[2-6]\b/, rule: 'Polysorbate' },
    { re: /\bmono[\s-]*(?:(?:and|&)\s*|-\s*)?di[\s-]?glycerides\b|\bmono[\s-]?glycerides\b|\bdi[\s-]?glycerides\b|\be[\s-]?471\b/, rule: 'Mono- and diglycerides' },
    { re: /\bdatem\b|\bdiacetyl tartaric\b|\be[\s-]?472e\b/, rule: 'DATEM' },
    { re: /\bpropylene glycol\b|\be[\s-]?1520\b/, rule: 'Propylene glycol' },
    { re: /\btitanium dioxide\b|\be[\s-]?171\b/, rule: 'Titanium dioxide' },
    { re: /\bpotassium bromate\b|\bbromated\b/, rule: 'Potassium bromate' },
    { re: /\bazodicarbonamide\b/, rule: 'Azodicarbonamide' },
    { re: /\bartificial(?:ly)?\s+flavou?r(?:s|ing|ings|ed)?\b|\bnatural and artificial flavou?r/, rule: 'Artificial flavor' },
    { re: /\bmonosodium glutamate\b|\bmsg\b|\be[\s-]?621\b/, rule: 'MSG' }
  ];

  var SUGARS = [
    { re: /\b(?:high[\s-]fructose\s+)?corn syrup(?:\s+solids)?\b|\bhfcs\b/, rule: 'Corn syrup / HFCS' },
    { re: /\b(?:brown rice|rice|tapioca|glucose|glucose[\s-]fructose|fructose|malt|barley malt|date|maple|agave|golden|cane|invert(?:ed)?(?:\s+sugar)?|sorghum|oat)\s+syrups?\b/, rule: 'Syrup' },
    { re: /\b(?:(?:organic|raw|pure|cane|brown|coconut|palm|date|beet|powdered|icing|confectioners'?|turbinado|demerara|muscovado|invert|cultured|granulated|white|evaporated cane)\s+)*sugars?\b/, rule: 'Sugar',
      skip: function (t, m) { return /^\s*(?:snap|alcohol)/.test(t.slice(m.index + m[0].length, m.index + m[0].length + 9)) || /\b(?:no|without|zero)\s+(?:added\s+)?$/.test(t.slice(Math.max(0, m.index - 14), m.index)); } },
    { re: /\b(?:evaporated\s+)?cane juice(?:\s+crystals)?\b/, rule: 'Cane juice' },
    { re: /\bdextrose\b|\bmaltodextrin\b|\bsucrose\b|\bmaltose\b|\bglucose\b(?!\s+syrup)|\bfructose\b(?!\s+(?:corn|syrup))/, rule: 'Sugar (dextrose, maltodextrin, glucose…)' },
    { re: /\bmolasses\b|\bhoney\b|\bagave(?:\s+nectar)?\b(?!\s+syrup)|\bfruit juice concentrate\b|\bjuice concentrate\b/, rule: 'Sweetener (honey, molasses, agave…)' }
  ];


  // ---------------------------------------------------------------- GMO (Tortuga Scan check, not on the SOS list)
  var GMO_CONFIRMED = [
    { re: /\b(?:contains\s+)?bio[\s-]?engineered(?:\s+food)?(?:\s+ingredients?)?\b/, rule: 'Bioengineered disclosure (US)' },
    { re: /\bderived from bio[\s-]?engineering\b/, rule: 'Bioengineered disclosure (US)' },
    { re: /\bgenetically (?:modified|engineered)\b/, rule: 'Genetically modified / engineered' },
    { re: /\b(?:partially\s+)?produced with genetic engineering\b/, rule: 'Produced with genetic engineering' },
    { re: /\bgmos?\b|\bgm (?:soy|soya|corn|maize|canola|rapeseed|sugar ?beet)/, rule: 'Labeled GMO' },
    { re: /\ben:(?:contains-gmos?|with-gmos?|gmos?|bioengineered[a-z-]*|genetically-modified[a-z-]*|produced-with-genetic-engineering)\b/, rule: 'Open Food Facts GMO label' }
  ];
  // Phrases that negate GMO; removed before we look for confirmed GMO wording.
  var GMO_NEGATIONS = /\b(?:non|no|not|without|free of|free from)[\s-]+(?:bio[\s-]?engineered|genetically (?:modified|engineered)|gmos?)(?:[\s-]+(?:ingredients?|organisms?|project|verified|certified|food))*\b|\bgmos?[\s-]+free\b|\bnot (?:produced with|derived from) (?:genetic engineering|bio[\s-]?engineering)\b|\ben:(?:no-gmos?|non-gmo[a-z-]*|gmo-free|without-gmos?|not-bioengineered[a-z-]*)\b/g;
  var GMO_CLEAR_CLAIMS = [
    { re: /\bnon[\s-]?gmo project\b|\ben:non-gmo-project[a-z-]*\b/, label: 'Non-GMO Project' },
    { re: /\b(?:usda|certified|eu|canada|ccof|qai|oregon tilth)[\s-]+organic\b|\ben:(?:usda-organic|eu-organic|organic|certified-organic|canada-organic|ab-agriculture-biologique)\b|^organic\b|\b100% organic\b/, label: 'Certified organic' },
    { re: /\bnon[\s-]?gmo\b|\bno gmos?\b|\bgmo[\s-]free\b|\bwithout gmos?\b|\bnot bio[\s-]?engineered\b|\ben:(?:no-gmos?|gmo-free|without-gmos?)\b/, label: 'Non-GMO claim' }
  ];
  // Conventional US crops that are usually GMO. Only a caution, never a confirmed fail.
  var GMO_RISK = [
    { re: /\b(?:soy|soya|soja|soybeans?|soybean)\b|\b(?:tofu|tempeh|edamame|miso|tamari|shoyu|natto)\b|\btextured vegetable protein\b/, crop: 'Soy' },
    { re: /\b(?:corn|maize|cornstarch|cornmeal|cornflour|hfcs)\b/, crop: 'Corn' },
    { re: /\b(?:dextrose|maltodextrin)\b/, crop: 'Corn (dextrose / maltodextrin are usually corn-derived)' },
    { re: /\b(?:canola|rapeseed)\b/, crop: 'Canola / rapeseed' },
    { re: /\bcottonseed\b/, crop: 'Cottonseed' },
    { re: /\b(?:sugar ?beets?|beet sugar)\b/, crop: 'Sugar beet' },
    { re: /\bsugar\b/, crop: 'Sugar (not specified as cane, so it may be from GMO sugar beets)',
      skip: function (t, m) {
        var before = t.slice(Math.max(0, m.index - 22), m.index);
        var after = t.slice(m.index + m[0].length, m.index + m[0].length + 12);
        return /\b(?:cane|coconut|date|maple|palm|turbinado|demerara|muscovado|panela|jaggery|sucanat|rapadura|beet|grape)\s+(?:\w+\s+)?$/.test(before) ||
          /^\s*(?:cane|snap|alcohol|\(cane\))/.test(after) || /\b(?:no|without|zero)\s+(?:added\s+)?$/.test(before);
      } },
    { re: /\bvegetable oils?\b|\bvegetable shortening\b/, crop: 'Generic vegetable oil (often soy, corn, or canola)' },
    { re: /\bpapaya\b/, crop: 'Papaya (some US papaya is GMO)' },
    { re: /\balfalfa\b/, crop: 'Alfalfa' }
  ];
  var ORGANIC_BEFORE = /\b(?:organic|non[\s-]?gmo|nongmo|non-gmo project verified|certified organic)\b[^,;()]{0,30}$/;

  function gmoCheck(text, opts) {
    var claimsRaw = normalize([opts.productName || '', opts.labels || '', (opts.labelsTags || []).join(' ')].join(' . '));
    var all = (text + ' . ' + claimsRaw);
    var withoutNeg = all.replace(GMO_NEGATIONS, ' ');

    var confirmed = scan(withoutNeg, GMO_CONFIRMED);
    var claims = [];
    GMO_CLEAR_CLAIMS.forEach(function (c) {
      var re = new RegExp(c.re.source, 'm');
      // Whole-product non-GMO claims can also be printed with the ingredients ("Non-GMO Project Verified").
      var src = c.label === 'Certified organic' ? claimsRaw : claimsRaw + ' . ' + text.replace(/\bnon[\s-]?gmo\s+(?=[a-z])(?!project|verified|certified)/g, ' ');
      if (re.test(src) && claims.indexOf(c.label) < 0) claims.push(c.label);
    });
    // "Organic" only counts as a whole-product claim from the name/labels, not from one ingredient.
    var risky = [];
    if (!confirmed.length && !claims.length) {
      risky = scan(text, GMO_RISK.map(function (r) {
        return {
          re: r.re, rule: r.crop,
          skip: function (t, m) {
            if (r.skip && r.skip(t, m)) return true;
            return ORGANIC_BEFORE.test(t.slice(Math.max(0, m.index - 40), m.index));
          }
        };
      }));
    }
    var status, label, points = 0;
    if (confirmed.length) { status = 'gmo'; label = 'GMO / bioengineered'; points = GMO_POINTS.confirmed; }
    else if (claims.length) { status = 'non-gmo'; label = claims[0] === 'Certified organic' ? 'Organic — not GMO' : 'Non-GMO'; }
    else if (risky.length) { status = 'possible'; label = 'Possible GMO — not confirmed'; points = GMO_POINTS.possible; }
    else { status = 'none'; label = 'No GMO indicators'; }
    return { status: status, label: label, points: points, confirmed: confirmed, claims: claims, risky: risky };
  }
  var GMO_POINTS = { confirmed: 12, possible: 6 };

  // ---------------------------------------------------------------- categories
  var CATEGORIES = [
    { id: 'seedOils', name: 'Seed oils', sos: true, points: 35 },
    { id: 'soy', name: 'Soy', sos: true, points: 12, patterns: SOY },
    { id: 'sweeteners', name: 'Artificial sweeteners', sos: true, points: 12, patterns: SWEETENERS },
    { id: 'gums', name: 'Gums (and carrageenan)', sos: true, points: 12, patterns: GUMS },
    { id: 'lecithins', name: 'Plant lecithins', sos: true, points: 12, patterns: LECITHINS },
    { id: 'naturalFlavors', name: 'Natural flavors', sos: true, points: 12, patterns: NATURAL_FLAVORS },
    { id: 'dyes', name: 'Dyes / artificial colors', sos: true, points: 12, patterns: DYES }
  ];

  var ADDITIVE_EACH = 8, ADDITIVE_CAP = 24;
  var SUGAR_BASE = 8, SUGAR_HIGH = { at: 15, extra: 7 }, SUGAR_VERY_HIGH = { at: 25, extra: 12 };
  var NOVA = { 4: 15, 3: 5 };

  // ---------------------------------------------------------------- traffic light
  // Per-ingredient colors for Lizeth's aisle rule. Not a certification.
  // Red = avoid. Yellow = limit. Green = nothing in those buckets hit.
  // Organic on the ingredient phrase clears a Dirty Dozen item to green.
  // Organic or non-GMO clears a GMO-red refined additive down to yellow, not green.
  // Seed oils stay red even when the phrase says organic.
  var DIRTY_DOZEN_2026 = [
    { re: /\bspinach\b/, name: 'Spinach' },
    { re: /\bkale\b/, name: 'Kale' },
    { re: /\bcollards?\b|\bcollard greens?\b/, name: 'Collard greens' },
    { re: /\bmustard greens?\b/, name: 'Mustard greens' },
    { re: /\bstrawberr(?:y|ies)\b/, name: 'Strawberries' },
    { re: /\bgrapes?\b|\braisins?\b|\bsultanas?\b/, name: 'Grapes' },
    { re: /\bnectarines?\b/, name: 'Nectarines' },
    { re: /\bpeaches?\b/, name: 'Peaches' },
    { re: /\bcherries\b|\bcherry\b/, name: 'Cherries' },
    { re: /\bapples?\b/, name: 'Apples' },
    { re: /\bblackberr(?:y|ies)\b/, name: 'Blackberries' },
    { re: /\bpears?\b/, name: 'Pears' },
    { re: /\bpotatoes?\b/, name: 'Potatoes' },
    { re: /\bblueberr(?:y|ies)\b/, name: 'Blueberries' }
  ];

  function hasOrganicWord(text) {
    return /\borganic\b/.test(String(text || '').replace(/\bnon[\s-]+organic\b/g, ' '));
  }
  function hasNonGmoWord(text) {
    return /\bnon[\s-]?gmo\b|\bnongmo\b/.test(text);
  }
  function clearsGmoRed(text) {
    return hasOrganicWord(text) || hasNonGmoWord(text);
  }

  function dirtyDozenHits(text) {
    var t = mergeOilNames(text)
      .replace(/\bsweet[\s-]?potatoes?\b/g, ' ')
      .replace(/\bapple cider vinegar\b|\bapple vinegar\b|\bapple pectin\b/g, ' ')
      .replace(/\bcherry tomatoes?\b/g, ' ')
      .replace(/\bgrape seeds?\b/g, ' ');
    var hits = [];
    DIRTY_DOZEN_2026.forEach(function (d) {
      var re = new RegExp(d.re.source, 'g');
      var m;
      while ((m = re.exec(t))) {
        var after = t.slice(m.index + m[0].length, m.index + m[0].length + 18);
        if (/^\s*flavou?r/.test(after)) continue;
        if (hits.indexOf(d.name) < 0) hits.push(d.name);
      }
    });
    return hits;
  }

  function isFillerPhrase(t) {
    if (!t) return true;
    if (/^[\d.\s%]+$/.test(t)) return true;
    if (/^(and|or|&)$/.test(t)) return true;
    if (/^(contains|including|with)\s+(less than\s+)?\d+(\.\d+)?\s*%?\s*(or less)?(\s+of)?(\s+the following)?$/.test(t)) return true;
    if (/^(less than\s+)?\d+(\.\d+)?\s*%?\s*(or less)?(\s+of)?(\s+the following)?$/.test(t)) return true;
    return false;
  }

  function uniquePush(list, level, label) {
    if (list.some(function (r) { return r.level === level && r.label === label; })) return;
    list.push({ level: level, label: label });
  }

  function classifyText(display) {
    var norm = normalize(display);
    var stripped = stripCrossContact(norm);
    if (!stripped.text) return { color: 'none', reasons: [{ level: 'none', label: 'Cross-contact line, not graded' }] };
    if (isFillerPhrase(stripped.text)) return { color: 'none', reasons: [{ level: 'none', label: 'Label note, not an ingredient' }] };
    var text = stripped.text;
    var reasons = [];

    findSeedOils(text).forEach(function (h) { uniquePush(reasons, 'red', 'Seed oil · ' + h.rule); });

    var gmoHits = scan(text.replace(GMO_NEGATIONS, ' '), GMO_CONFIRMED);
    if (gmoHits.length) uniquePush(reasons, 'red', 'GMO / bioengineered');

    scan(text, SWEETENERS).forEach(function (h) { uniquePush(reasons, 'red', 'Artificial sweetener · ' + h.rule); });
    scan(text, DYES).forEach(function (h) { uniquePush(reasons, 'red', 'Artificial dye · ' + h.rule); });
    scan(text, ADDITIVES).forEach(function (h) { uniquePush(reasons, 'red', 'Additive · ' + h.rule); });

    var cornRefined = /\b(?:modified\s+)?corn[\s-]?starch\b|\bcornstarch\b|\bmaize[\s-]?starch\b|\bcorn syrup(?:\s+solids)?\b|\bhigh[\s-]fructose\s+corn syrup\b|\bhfcs\b/;
    if (cornRefined.test(text)) {
      uniquePush(reasons, clearsGmoRed(text) ? 'yellow' : 'red',
        clearsGmoRed(text) ? 'Refined corn (organic or non-GMO on this phrase)' : 'Refined corn (starch or syrup, usually GMO)');
    }
    var namedOtherStarch = /\b(?:tapioca|arrowroot|cassava|rice|wheat|potato)\b/.test(text);
    if (/\bmodified food starch\b/.test(text) && !namedOtherStarch && !cornRefined.test(text)) {
      uniquePush(reasons, clearsGmoRed(text) ? 'yellow' : 'red',
        clearsGmoRed(text) ? 'Modified starch (organic or non-GMO on this phrase)' : 'Modified food starch (often corn)');
    }
    var namedMaltodextrin = /\b(?:tapioca|rice|potato|wheat|cassava)\s+maltodextrin\b|\bmaltodextrin\s*\(\s*(?:tapioca|rice|potato|wheat|cassava)\b/;
    if (/\bdextrose\b/.test(text) || (/\bmaltodextrin\b/.test(text) && !namedMaltodextrin.test(text))) {
      uniquePush(reasons, clearsGmoRed(text) ? 'yellow' : 'red',
        clearsGmoRed(text) ? 'Dextrose / maltodextrin (organic or non-GMO on this phrase)' : 'Dextrose / maltodextrin (usually corn)');
    } else if (namedMaltodextrin.test(text)) {
      uniquePush(reasons, 'yellow', 'Maltodextrin (source named)');
    }

    var soyDerivative = /\b(?:soy|soya|soybean)[\s-]+(?:protein|flour|lecithin|fiber|fibre)s?\b|\bsoy[\s-]?protein[\s-]?isolate\b|\bhydrolyzed[\s-]+(?:soy|soya)(?:[\s-]+protein)?\b|\btextured[\s-]+(?:soy|vegetable)[\s-]+protein\b|\btvp\b/;
    if (soyDerivative.test(text)) {
      uniquePush(reasons, clearsGmoRed(text) ? 'yellow' : 'red',
        clearsGmoRed(text) ? 'Soy derivative (organic or non-GMO on this phrase)' : 'Soy derivative (protein, flour, or lecithin)');
    }

    var sugarWord = /\bsugars?\b/.test(text)
      && !/\b(?:no|without|zero)\s+(?:added\s+)?sugars?\b/.test(text)
      && !/\bsugars?\s+snap\b/.test(text)
      && !/\bsugar\s+alcohol/.test(text);
    var namedSugar = /\b(?:cane|coconut|date|maple|palm|turbinado|demerara|muscovado|panela|jaggery|sucanat|rapadura)\b/.test(text);
    if (sugarWord && !namedSugar) {
      if (clearsGmoRed(text)) uniquePush(reasons, 'yellow', 'Added sugar (organic or non-GMO on this phrase)');
      else uniquePush(reasons, 'red', /\bbeet\b/.test(text) ? 'Sugar from beets' : 'Sugar (not named as cane)');
    }

    var alreadyRed = reasons.some(function (r) { return r.level === 'red'; });
    if (!alreadyRed) {
      scan(text, NATURAL_FLAVORS).forEach(function (h) { uniquePush(reasons, 'yellow', 'Natural flavor'); });
      if (!reasons.some(function (r) { return r.label === 'Natural flavor'; }) && /\bflavou?r(?:s|ing|ings)?\b/.test(text)) {
        uniquePush(reasons, 'yellow', 'Flavor');
      }
      scan(text, GUMS).forEach(function (h) { uniquePush(reasons, 'yellow', 'Gum · ' + h.rule); });
      scan(text, LECITHINS).forEach(function (h) { uniquePush(reasons, 'yellow', 'Lecithin · ' + h.rule); });
      if (!soyDerivative.test(text)) {
        scan(text, SOY).forEach(function (h) { uniquePush(reasons, 'yellow', 'Soy · ' + h.rule); });
      }
      if (!cornRefined.test(text) && !/\b(?:dextrose|maltodextrin)\b/.test(text)) {
        if (/\b(?:corn|maize|popcorn|polenta|hominy|masa|cornmeal|corn[\s-]?flour|cornflour)\b/.test(text)) {
          uniquePush(reasons, clearsGmoRed(text) ? 'green' : 'yellow',
            clearsGmoRed(text) ? 'Corn (organic or non-GMO on this phrase)' : 'Corn (possible GMO — not confirmed)');
        }
      }
      var dozen = dirtyDozenHits(text);
      if (dozen.length) {
        if (hasOrganicWord(text)) uniquePush(reasons, 'green', 'Organic · ' + dozen.join(', '));
        else uniquePush(reasons, 'yellow', 'Dirty Dozen 2026 · ' + dozen.join(', '));
      }
      scan(text, SUGARS).forEach(function (h) {
        if (reasons.some(function (r) { return r.level === 'red' && /sugar|corn syrup|dextrose|maltodextrin/i.test(r.label); })) return;
        uniquePush(reasons, 'yellow', 'Added sugar · ' + h.rule);
      });
      if (/\b(?:erythritol|xylitol|allulose|sorbitol|maltitol|mannitol)\b/.test(text)) uniquePush(reasons, 'yellow', 'Sugar alcohol');
      if (/\b(?:enriched|bleached)\s+(?:wheat\s+|white\s+|unbleached\s+)*(?:flour|macaroni|pasta|corn\s*meal|cornmeal|rice)\b/.test(text)
        || /\bunbleached\s+enriched\b/.test(text)) {
        uniquePush(reasons, 'yellow', 'Enriched or bleached grain');
      }
      if (/\bcaramel colou?r\b/.test(text)) uniquePush(reasons, 'yellow', 'Caramel color');
      if (/\b(?:partially\s+)?hydrogenated\b/.test(text)) uniquePush(reasons, 'yellow', 'Hydrogenated fat');
    }

    var rank = { red: 3, yellow: 2, green: 1, none: 0 };
    var color = 'green';
    reasons.forEach(function (r) { if (rank[r.level] > rank[color]) color = r.level; });
    if (color === 'green') reasons = [];
    else reasons = reasons.filter(function (r) { return r.level === color; });
    return { color: color, reasons: reasons };
  }

  function tokenizeIngredients(s) {
    var parts = [], buf = '', depth = 0;
    function flush() {
      var t = buf.replace(/\s+/g, ' ').trim().replace(/^[\s,;:–—-]+|[\s,;:.–—-]+$/g, '').trim();
      if (t) parts.push(t);
      buf = '';
    }
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '(' || c === '[') { depth++; buf += c; }
      else if (c === ')' || c === ']') { depth = Math.max(0, depth - 1); buf += c; }
      else if ((c === ',' || c === ';' || c === '·' || c === '•') && depth === 0) flush();
      else buf += c;
    }
    flush();
    return parts;
  }

  function splitParen(part) {
    var s = part.trim(), depth = 0, start = -1, end = -1;
    for (var i = 0; i < s.length; i++) {
      if (s[i] === '(') { if (depth === 0) start = i; depth++; }
      else if (s[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (start < 0 || end < 0) return null;
    var name = s.slice(0, start).trim();
    var inner = s.slice(start + 1, end).trim();
    var trailing = s.slice(end + 1).trim().replace(/^[).]+/, '').trim();
    if (!inner) return null;
    var children = tokenizeIngredients(inner);
    if (!children.length) return null;
    if (trailing) name = (name + ' ' + trailing).trim();
    return { name: name, children: children };
  }

  function worstColor(list) {
    var rank = { red: 3, yellow: 2, green: 1, none: 0 };
    var best = 'none';
    list.forEach(function (c) { if (c && rank[c] > rank[best]) best = c; });
    return best === 'none' ? 'green' : best;
  }

  function classifyNode(raw) {
    var display = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!display) return null;
    var parsed = splitParen(display);
    if (parsed && parsed.children.length && parsed.name) {
        var children = parsed.children.map(classifyNode).filter(Boolean);
        var onlyNotes = children.length && children.every(function (ch) { return ch.color === 'none'; });
        if (!onlyNotes && children.length) {
          var nameForRules = parsed.name;
          if (/\bmodified food starch\b|\bmaltodextrin\b|\bdextrose\b/i.test(parsed.name)) {
            nameForRules = parsed.name + ' ' + parsed.children.join(' ');
          }
          var self = classifyText(nameForRules);
        var color = self.color === 'none'
          ? 'none'
          : worstColor([self.color].concat(children.map(function (ch) { return ch.color; })));
        var reasons = self.reasons.filter(function (r) { return r.level === color; });
        if (!reasons.length && color !== 'green' && color !== 'none') {
          children.forEach(function (ch) {
            ch.reasons.forEach(function (r) {
              if (r.level === color) uniquePush(reasons, r.level, r.label);
            });
          });
        }
        return { text: parsed.name, color: color, reasons: reasons.slice(0, 3), children: children };
      }
    }
    var leaf = classifyText(display);
    return { text: display, color: leaf.color, reasons: leaf.reasons.slice(0, 3), children: [] };
  }

  function tallyColors(items, acc) {
    acc = acc || { green: 0, yellow: 0, red: 0, none: 0 };
    items.forEach(function (it) {
      if (it.children && it.children.length) tallyColors(it.children, acc);
      else acc[it.color] = (acc[it.color] || 0) + 1;
    });
    return acc;
  }

  function classifyIngredients(ingredientsText) {
    var original = String(ingredientsText || '').replace(/\r/g, '').replace(/\n+/g, ', ');
    original = original.replace(/^\s*ingredients?\s*[:\-]\s*/i, '');
    var items = tokenizeIngredients(original).map(classifyNode).filter(Boolean);
    return { items: items, counts: tallyColors(items) };
  }

  function band(score) {
    if (score >= 80) return { id: 'cleaner', label: 'Cleaner' };
    if (score >= 50) return { id: 'mixed', label: 'Mixed' };
    return { id: 'poor', label: 'Poor' };
  }

  function num(v) {
    var n = typeof v === 'string' ? parseFloat(v) : v;
    return typeof n === 'number' && isFinite(n) ? n : null;
  }

  /**
   * Grade an ingredient list.
   * @param {string} ingredientsText
   * @param {{novaGroup?: number|string, sugars100g?: number|string}} [opts]
   */
  function grade(ingredientsText, opts) {
    opts = opts || {};
    var cleaned = stripCrossContact(normalize(ingredientsText));
    var text = cleaned.text;

    var categories = CATEGORIES.map(function (c) {
      var hits = c.id === 'seedOils' ? findSeedOils(text) : scan(text, c.patterns);
      return { id: c.id, name: c.name, points: c.points, failed: hits.length > 0, hits: hits };
    });

    var sosPass = categories.every(function (c) { return !c.failed; });

    var additiveHits = scan(text, ADDITIVES);
    // Count distinct additive rules, not every spelling of the same one
    var additiveRules = [];
    additiveHits.forEach(function (h) { if (additiveRules.indexOf(h.rule) < 0) additiveRules.push(h.rule); });

    var sugarHits = scan(text, SUGARS);
    var sugars100g = num(opts.sugars100g);
    var nova = num(opts.novaGroup);
    var gmo = gmoCheck(text, opts);

    var deductions = [];
    categories.forEach(function (c) {
      if (c.failed) deductions.push({ label: c.name, points: c.points, detail: c.hits.map(function (h) { return h.match; }).join(', ') });
    });
    if (additiveRules.length) {
      var ap = Math.min(ADDITIVE_CAP, additiveRules.length * ADDITIVE_EACH);
      deductions.push({ label: 'Other additives (' + additiveRules.length + ' × ' + ADDITIVE_EACH + ', max ' + ADDITIVE_CAP + ')', points: ap, detail: additiveRules.join(', ') });
    }
    if (sugarHits.length) {
      deductions.push({ label: 'Added sugar in ingredients', points: SUGAR_BASE, detail: sugarHits.map(function (h) { return h.match; }).join(', ') });
      if (sugars100g !== null && sugars100g >= SUGAR_VERY_HIGH.at) {
        deductions.push({ label: 'Very high sugar (' + round1(sugars100g) + ' g / 100 g, ≥ ' + SUGAR_VERY_HIGH.at + ')', points: SUGAR_VERY_HIGH.extra, detail: '' });
      } else if (sugars100g !== null && sugars100g >= SUGAR_HIGH.at) {
        deductions.push({ label: 'High sugar (' + round1(sugars100g) + ' g / 100 g, ≥ ' + SUGAR_HIGH.at + ')', points: SUGAR_HIGH.extra, detail: '' });
      }
    }
    if (gmo.points) {
      deductions.push({
        label: gmo.status === 'gmo' ? 'GMO / bioengineered (Tortuga Scan check)' : 'Possible GMO caution (Tortuga Scan check)',
        points: gmo.points,
        detail: (gmo.status === 'gmo' ? gmo.confirmed : gmo.risky).map(function (h) { return h.match; }).join(', ')
      });
    }
    if (nova && NOVA[nova]) {
      deductions.push({ label: 'NOVA group ' + nova + (nova === 4 ? ' (ultra-processed)' : ' (processed)'), points: NOVA[nova], detail: 'From Open Food Facts' });
    }

    var total = deductions.reduce(function (s, d) { return s + d.points; }, 0);
    var score = Math.max(0, 100 - total);

    return {
      hasIngredients: text.length > 0,
      sos: { pass: sosPass, categories: categories },
      score: score,
      band: band(score),
      deductions: deductions,
      additives: additiveHits,
      sugars: sugarHits,
      sugars100g: sugars100g,
      novaGroup: nova,
      gmo: gmo,
      ignored: cleaned.removed
    };
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  // ---------------------------------------------------------------- barcodes
  function upcEtoUpcA(e) {
    // e: 8 digits, number system 0 or 1
    if (!/^[01]\d{7}$/.test(e)) return null;
    var ns = e[0], d = e.slice(1, 7), check = e[7], x = d[5], body;
    if (x === '0' || x === '1' || x === '2') body = d.slice(0, 2) + x + '0000' + d.slice(2, 5);
    else if (x === '3') body = d.slice(0, 3) + '00000' + d.slice(3, 5);
    else if (x === '4') body = d.slice(0, 4) + '00000' + d[4];
    else body = d.slice(0, 5) + '0000' + x;
    return ns + body + check;
  }

  function barcodeCandidates(raw) {
    var code = String(raw || '').replace(/\D/g, '');
    if (!code) return [];
    var list = [code];
    if (code.length === 12) list.push('0' + code);
    if (code.length === 13 && code[0] === '0') list.push(code.slice(1));
    if (code.length === 8) {
      var a = upcEtoUpcA(code);
      if (a) { list.push(a); list.push('0' + a); }
    }
    if (code.length < 8) list.push(('0000000000000' + code).slice(-13));
    return list.filter(function (c, i) { return list.indexOf(c) === i; });
  }

  function rulesSummary() {
    return {
      seedOils: Object.keys(SEED_OIL_NAMES).map(function (k) { return SEED_OIL_NAMES[k]; })
        .filter(function (v, i, a) { return a.indexOf(v) === i; }),
      notSeedOils: ['olive', 'avocado', 'coconut', 'MCT', 'butter', 'ghee', 'tallow', 'lard', 'palm', 'sesame', 'flax / linseed', 'walnut', 'almond', 'peanut', 'macadamia'],
      points: { gmoConfirmed: GMO_POINTS.confirmed, gmoPossible: GMO_POINTS.possible, seedOil: 35, otherCategory: 12, additiveEach: ADDITIVE_EACH, additiveCap: ADDITIVE_CAP, sugarBase: SUGAR_BASE, sugarHigh: SUGAR_HIGH, sugarVeryHigh: SUGAR_VERY_HIGH, nova: NOVA },
      dirtyDozen: {
        year: 2026,
        source: 'Environmental Working Group, Shopper’s Guide to Pesticides in Produce',
        url: 'https://www.ewg.org/foodnews/dirty-dozen.php',
        items: ['Spinach', 'Kale, collard, and mustard greens', 'Strawberries', 'Grapes', 'Nectarines', 'Peaches', 'Cherries', 'Apples', 'Blackberries', 'Pears', 'Potatoes', 'Blueberries']
      }
    };
  }

  return {
    normalize: normalize,
    grade: grade,
    gmoCheck: function (t, o) { return gmoCheck(stripCrossContact(normalize(t)).text, o || {}); },
    findSeedOils: findSeedOils,
    barcodeCandidates: barcodeCandidates,
    upcEtoUpcA: upcEtoUpcA,
    band: band,
    rulesSummary: rulesSummary,
    classifyIngredients: classifyIngredients,
    DIRTY_DOZEN_YEAR: 2026,
    CATEGORIES: CATEGORIES.map(function (c) { return { id: c.id, name: c.name, points: c.points }; })
  };
});
