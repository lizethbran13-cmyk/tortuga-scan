/* Tortuga Scan — app logic. Plain JS, no build step. */
(function () {
  'use strict';

  var R = window.ScoutRules;
  var UA = 'TortugaScan/0.1 (personal clean-eating scanner prototype)';
  var OFF = 'https://world.openfoodfacts.org/api/v2/product/';
  var FIELDS = ['code', 'product_name', 'product_name_en', 'brands', 'image_front_url', 'image_front_small_url',
    'ingredients_text', 'ingredients_text_en', 'ingredients_text_fr', 'nova_group', 'nutriments', 'labels',
    'labels_tags', 'quantity'].join(',');
  var RECENT_KEY = 'tortuga.recent.v1';

  var $ = function (id) { return document.getElementById(id); };
  var views = { home: $('view-home'), scan: $('view-scan'), status: $('view-status'), result: $('view-result') };
  var scanner = null, scanning = false, lastProduct = null;

  // ------------------------------------------------------------ helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function show(name) {
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; });
    document.body.classList.toggle('scanning', name === 'scan');
    $('scanBtnLabel').textContent = (name === 'result' || name === 'status') ? 'Scan another' : 'Scan barcode';
    window.scrollTo(0, 0);
  }
  function validGtin(code) {
    if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
    var digits = code.split('').map(Number), check = digits.pop(), sum = 0;
    digits.reverse().forEach(function (d, i) { sum += d * (i % 2 === 0 ? 3 : 1); });
    return (10 - (sum % 10)) % 10 === check;
  }

  // ------------------------------------------------------------ logo fallback
  var logo = $('logoImg');
  function logoFail() { logo.hidden = true; $('logoFallback').hidden = false; }
  logo.addEventListener('error', logoFail);
  if (logo.complete && logo.naturalWidth === 0) logoFail();

  // ------------------------------------------------------------ camera scanner
  function scanHint(msg) { $('scanHint').textContent = msg; }

  function cameraErrorMessage(err) {
    var name = (err && (err.name || '')) + ' ' + String(err && err.message || err || '');
    if (!window.isSecureContext) return { title: 'Camera needs a secure page', body: 'Open Tortuga Scan from its https:// address (for example the GitHub Pages link). Cameras are blocked on plain http pages.' };
    if (/NotAllowed|Permission|denied/i.test(name)) return { title: 'Camera is blocked', body: 'Allow camera access to scan. On iPhone: tap the “aA” button in Safari’s address bar → Website Settings → Camera → Allow. You can also check Settings → Safari → Camera. If you added Tortuga Scan to your Home Screen, open it again after allowing. Or type the barcode below.' };
    if (/NotFound|Overconstrained|no camera|Requested device not found/i.test(name)) return { title: 'No camera found', body: 'We couldn’t find a rear camera on this device. Type the barcode instead.' };
    if (/NotReadable|TrackStart|in use|Could not start/i.test(name)) return { title: 'Camera is busy', body: 'Another app or tab may be using the camera. Close it and try again, or type the barcode.' };
    if (/library|Html5Qrcode/i.test(name)) return { title: 'Scanner didn’t load', body: 'The scanner code failed to load. Check your connection and reload, or type the barcode.' };
    return { title: 'Couldn’t start the camera', body: 'Something went wrong starting the camera (' + esc(String(err && err.message || err).slice(0, 120)) + '). Try again, or type the barcode.' };
  }

  function startScan() {
    if (scanning) return;
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return showCameraError(cameraErrorMessage(new Error('insecure')));
    }
    if (!window.Html5Qrcode) return showCameraError(cameraErrorMessage(new Error('Html5Qrcode library missing')));

    show('scan');
    scanHint('Starting camera…');
    var F = window.Html5QrcodeSupportedFormats;
    try {
      if (!scanner) {
        scanner = new window.Html5Qrcode('reader', {
          formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E],
          useBarCodeDetectorIfSupported: true,
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          verbose: false
        });
      }
    } catch (e) { return showCameraError(cameraErrorMessage(e)); }

    scanning = true;
    var lastRead = '', readCount = 0;
    // Must be called directly from the tap handler so iOS Safari will show the permission prompt.
    scanner.start(
      { facingMode: 'environment' },
      {
        fps: 12,
        qrbox: function (w, h) { return { width: Math.max(160, Math.floor(w * 0.78)), height: Math.max(90, Math.floor(h * 0.32)) }; },
        disableFlip: true
      },
      function onDecode(text) {
        var code = String(text).replace(/\D/g, '');
        if (!validGtin(code)) return;
        // Require two matching reads in a row to avoid misreads.
        if (code === lastRead) readCount++; else { lastRead = code; readCount = 1; }
        if (readCount < 2) return;
        if (navigator.vibrate) navigator.vibrate(40);
        stopScan().then(function () { lookup(code); });
      },
      function () { /* per-frame "not found" — ignore */ }
    ).then(function () {
      scanHint('Line up the barcode inside the frame. Hold steady.');
      var v = document.querySelector('#reader video');
      if (v) { v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.muted = true; }
    }).catch(function (err) {
      scanning = false;
      showCameraError(cameraErrorMessage(err));
    });
  }

  function stopScan() {
    if (!scanner || !scanning) { scanning = false; return Promise.resolve(); }
    scanning = false;
    return scanner.stop().then(function () { try { scanner.clear(); } catch (e) { /* ignore */ } })
      .catch(function () { /* already stopped */ });
  }

  function showCameraError(m) {
    show('status');
    views.status.innerHTML =
      '<div class="card status-card error-card" role="alert">' +
        '<h2>' + esc(m.title) + '</h2><p>' + m.body + '</p>' +
        '<div class="actions">' +
          '<button type="button" class="btn btn-secondary" data-act="retry-scan">Try the camera again</button>' +
          '<button type="button" class="btn btn-outline" data-act="home">Type the barcode</button>' +
        '</div></div>';
  }

  // ------------------------------------------------------------ Open Food Facts
  function fetchProduct(code) {
    var url = OFF + encodeURIComponent(code) + '.json?fields=' + FIELDS;
    var opts = { headers: { 'User-Agent': UA, 'Accept': 'application/json' } };
    // Browsers may silently drop User-Agent; OFF allows it in CORS either way.
    return fetch(url, opts).catch(function () { return fetch(url); }).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('Open Food Facts returned ' + res.status);
      return res.json();
    }).then(function (data) {
      if (!data || data.status !== 1 || !data.product) return null;
      return data.product;
    });
  }

  function lookup(raw) {
    var candidates = R.barcodeCandidates(raw);
    if (!candidates.length) return;
    show('status');
    views.status.innerHTML = '<div class="card status-card"><div class="spinner" aria-hidden="true"></div><h2>Looking it up…</h2><p>Barcode ' + esc(candidates[0]) + '</p></div>';

    var i = 0;
    (function next() {
      if (i >= candidates.length) return notFound(candidates[0]);
      var c = candidates[i++];
      fetchProduct(c).then(function (p) {
        if (p) renderProduct(normalizeProduct(p, c)); else next();
      }).catch(function (err) {
        show('status');
        views.status.innerHTML =
          '<div class="card status-card error-card" role="alert"><h2>Couldn’t reach Open Food Facts</h2>' +
          '<p>' + (navigator.onLine === false ? 'You look offline. Lookups need a connection.' : 'The lookup failed (' + esc(err.message) + ').') + ' You can try again, or paste the ingredients from the package.</p>' +
          '<div class="actions"><button type="button" class="btn btn-secondary" data-act="lookup" data-code="' + esc(candidates[0]) + '">Try again</button>' +
          '<button type="button" class="btn btn-outline" data-act="paste-blank" data-code="' + esc(candidates[0]) + '">Paste ingredients</button></div></div>';
      });
    })();
  }

  function normalizeProduct(p, code) {
    var ing = '', lang = null;
    if (p.ingredients_text_en && p.ingredients_text_en.trim()) { ing = p.ingredients_text_en; lang = 'en'; }
    else if (p.ingredients_text && p.ingredients_text.trim()) { ing = p.ingredients_text; lang = 'default'; }
    else if (p.ingredients_text_fr && p.ingredients_text_fr.trim()) { ing = p.ingredients_text_fr; lang = 'fr'; }
    var n = p.nutriments || {};
    return {
      code: p.code || code,
      name: (p.product_name || p.product_name_en || '').trim() || 'Unnamed product',
      brand: (p.brands || '').split(',')[0].trim(),
      quantity: p.quantity || '',
      image: p.image_front_small_url || p.image_front_url || '',
      ingredients: ing.trim(),
      ingredientsLang: lang,
      source: 'off',
      novaGroup: p.nova_group || null,
      sugars100g: n.sugars_100g != null ? n.sugars_100g : null,
      labels: p.labels || '',
      labelsTags: p.labels_tags || []
    };
  }

  function notFound(code) {
    lastProduct = { code: code, name: 'Not in Open Food Facts', brand: '', ingredients: '', source: 'none', labels: '', labelsTags: [] };
    show('status');
    views.status.innerHTML =
      '<div class="card status-card"><h2>We couldn’t find this one</h2>' +
      '<p>Barcode <strong>' + esc(code) + '</strong> isn’t in Open Food Facts yet. You can still grade it: type or paste the ingredient list from the package.</p></div>' +
      pasteBox(code, '');
    bindPaste();
  }

  function pasteBox(code, existing) {
    return '<form class="card paste" id="pasteForm" data-code="' + esc(code || '') + '">' +
      '<label class="label" for="pasteText">Ingredients from the label</label>' +
      '<textarea id="pasteText" rows="6" placeholder="Copy the ingredient list exactly, commas and all.">' + esc(existing || '') + '</textarea>' +
      '<label class="label" for="pasteName" style="margin-top:4px">Product name (optional)</label>' +
      '<input id="pasteName" type="text" style="font-size:18px" placeholder="e.g. Organic tortilla chips">' +
      '<p class="help">Tip: on iPhone you can use Live Text — point the Camera at the label, tap the text icon, then copy and paste here. Include any “Organic” or “Non-GMO” claim on the front so the GMO check can see it.</p>' +
      '<button type="submit" class="btn btn-secondary">Grade these ingredients</button></form>';
  }

  function bindPaste() {
    var f = $('pasteForm');
    if (!f) return;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = $('pasteText').value.trim();
      if (!text) { $('pasteText').focus(); return; }
      var base = lastProduct || {};
      var name = $('pasteName') ? $('pasteName').value.trim() : '';
      renderProduct({
        code: f.dataset.code || base.code || '',
        name: name || (base.source === 'off' ? base.name : 'Label you pasted'),
        brand: base.source === 'off' ? base.brand : '',
        quantity: base.quantity || '',
        image: base.source === 'off' ? base.image : '',
        ingredients: text,
        ingredientsLang: 'pasted',
        source: 'pasted',
        novaGroup: base.source === 'off' ? base.novaGroup : null,
        sugars100g: base.source === 'off' ? base.sugars100g : null,
        labels: [base.labels || '', name].join(' '),
        labelsTags: base.labelsTags || []
      });
    });
  }

  // ------------------------------------------------------------ result rendering
  function highlight(context, match) {
    var c = esc(context), m = esc(match);
    var idx = c.indexOf(m);
    if (!m || idx < 0) return c;
    return c.slice(0, idx) + '<mark>' + m + '</mark>' + c.slice(idx + m.length);
  }

  function productHeader(p) {
    var img = p.image
      ? '<img class="thumb" src="' + esc(p.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML=\'<div class=&quot;thumb empty&quot;>No photo</div>\'">'
      : '<div class="thumb empty">No photo</div>';
    var src = p.source === 'off' ? 'Open Food Facts' : p.source === 'pasted' ? 'Ingredients you pasted' : '';
    return '<div class="card product">' + img + '<div>' +
      '<h2>' + esc(p.name) + '</h2>' +
      (p.brand || p.quantity ? '<p class="brand-line">' + esc([p.brand, p.quantity].filter(Boolean).join(' · ')) + '</p>' : '') +
      (p.code ? '<p class="code">' + esc(p.code) + '</p>' : '') +
      (src ? '<span class="source-tag">' + esc(src) + '</span>' : '') +
      '</div></div>';
  }

  function renderProduct(p) {
    lastProduct = p;
    show('result');
    if (!p.ingredients) {
      views.result.innerHTML = productHeader(p) +
        '<div class="notice" role="status"><strong>No ingredient list on Open Food Facts</strong>We found the product but not its ingredients, so we can’t grade it yet. Paste them from the package below.</div>' +
        pasteBox(p.code, '');
      bindPaste();
      return;
    }

    var g = R.grade(p.ingredients, { novaGroup: p.novaGroup, sugars100g: p.sugars100g, productName: p.name, labels: p.labels, labelsTags: p.labelsTags });
    saveRecent(p, g);

    var sosCats = g.sos.categories;
    var sosHtml =
      '<div class="verdict ' + (g.sos.pass ? 'v-pass' : 'v-fail') + '">' +
        '<p class="kicker">Seed Oil Safe-style check</p>' +
        '<p class="big">' + (g.sos.pass ? 'PASS' : 'FAIL') + '</p>' +
        '<p style="margin:0;font-weight:600">' + (g.sos.pass ? 'Nothing on the published Seed Oil Safe list found in these ingredients.' :
          sosCats.filter(function (c) { return c.failed; }).length + ' of ' + sosCats.length + ' categories hit.') + '</p>' +
        '<ul class="checklist">' + sosCats.map(function (c) {
          return '<li><span class="mark ' + (c.failed ? 'bad' : 'ok') + '" aria-hidden="true">' + (c.failed ? '✕' : '✓') + '</span>' +
            '<span>' + esc(c.name) + '<span class="visually-hidden">: ' + (c.failed ? 'found' : 'not found') + '</span></span></li>';
        }).join('') +
        '<li class="sep">Tortuga Scan check (not on the SOS list)</li>' +
        '<li><span class="mark ' + (g.gmo.status === 'gmo' ? 'bad' : g.gmo.status === 'possible' ? 'warn' : 'ok') + '" aria-hidden="true">' +
          (g.gmo.status === 'gmo' ? '✕' : g.gmo.status === 'possible' ? '!' : '✓') + '</span><span>GMO: ' + esc(g.gmo.label) + '</span></li>' +
        '</ul>' +
        '<p class="fine">Our implementation of Seed Oil Scout’s published Seed Oil Safe guidelines. Not an official certification or badge. We can’t check manufacturing processes.</p>' +
      '</div>';

    var gmoClass = g.gmo.status === 'gmo' ? 'v-fail' : g.gmo.status === 'possible' ? 'v-caution' : g.gmo.status === 'non-gmo' ? 'v-pass' : 'v-neutral';
    var gmoText = {
      gmo: 'The label or Open Food Facts data says GMO, genetically engineered, or bioengineered.',
      'non-gmo': 'Shows ' + esc(g.gmo.claims.join(' and ')) + '. Organic and Non-GMO standards don’t allow GMO ingredients.',
      possible: 'Contains conventional crops that are usually GMO in the US, with no organic or non-GMO claim we can see. This is a caution, not a confirmed GMO.',
      none: 'No GMO wording, and no high-risk GMO crops in the ingredients.'
    }[g.gmo.status];
    var gmoHtml = '<div class="verdict v-gmo ' + gmoClass + '"><p class="kicker">GMO status · Tortuga Scan check</p>' +
      '<p class="big">' + esc(g.gmo.label) + '</p><p style="margin:0">' + gmoText + '</p>' +
      (g.gmo.status === 'possible' ? '<p class="fine">Look for a USDA Organic or Non-GMO Project seal on the package. If you see one, paste the ingredients with the claim to re-grade.</p>' : '') +
      '</div>';

    var scoreClass = g.band.id === 'cleaner' ? 'v-pass' : g.band.id === 'mixed' ? 'v-caution' : 'v-fail';
    var mathHtml = '<ul class="math"><li><span>Start</span><span class="pts">100</span></li>' +
      g.deductions.map(function (d) {
        return '<li><span>' + esc(d.label) + (d.detail ? '<span class="detail">' + esc(d.detail) + '</span>' : '') + '</span><span class="pts">−' + d.points + '</span></li>';
      }).join('') +
      (100 - g.deductions.reduce(function (s, d) { return s + d.points; }, 0) < 0 ? '<li><span>Floor (score can’t go below 0)</span><span class="pts"></span></li>' : '') +
      '<li class="total"><span>Tortuga Scan clean score</span><span class="pts">' + g.score + '</span></li></ul>';
    var scoreHtml = '<div class="verdict ' + scoreClass + '"><p class="kicker">Tortuga Scan clean score</p>' +
      '<div class="score-row"><p class="big">' + g.score + '<small> / 100</small></p><span class="band ' + g.band.id + '">' + g.band.label + '</span></div>' +
      '<p class="fine" style="margin-top:0">Our own score, inspired by the categories Olive publicly describes (seed oils, additives, processing, sugar). Not an official Olive score and not based on lab tests.' +
      (g.novaGroup ? '' : ' No NOVA processing group available, so no processing deduction.') + '</p>' +
      mathHtml + '</div>';

    // Flags
    var flags = [];
    sosCats.forEach(function (c) { c.hits.forEach(function (h) { flags.push({ cat: 'Seed Oil Safe · ' + c.name, h: h, cls: '' }); }); });
    g.gmo.confirmed.forEach(function (h) { flags.push({ cat: 'GMO · Tortuga Scan check', h: h, cls: '' }); });
    g.gmo.risky.forEach(function (h) { flags.push({ cat: 'Possible GMO · caution', h: h, cls: 'f-warn' }); });
    g.additives.forEach(function (h) { flags.push({ cat: 'Other additive · score only', h: h, cls: 'f-warn' }); });
    g.sugars.forEach(function (h) { flags.push({ cat: 'Added sugar · score only', h: h, cls: 'f-warn' }); });
    var flagsHtml = '<div class="card flags"><h2>What we found</h2>' + (flags.length
      ? '<ul class="flag-list">' + flags.map(function (f) {
          return '<li class="flag ' + f.cls + '"><div class="cat">' + esc(f.cat) + '</div>' +
            '<div class="rule">' + esc(f.h.rule) + '</div>' +
            '<p class="ctx">“' + highlight(f.h.context || f.h.match, f.h.match) + '”</p>' +
            (f.h.note ? '<p class="note">' + esc(f.h.note) + '</p>' : '') + '</li>';
        }).join('') + '</ul>'
      : '<p class="no-flags">No flags. Nothing from our rules matched these ingredients.</p>') +
      (g.ignored.length ? '<p class="help">Not graded (cross-contact warning): “' + esc(g.ignored.join(' ')) + '”</p>' : '') +
      '</div>';

    var langNote = p.ingredientsLang === 'fr' ? ' Only a French ingredient list was available; our rules are written for English, so results may miss things.'
      : p.ingredientsLang === 'default' ? ' This is the main-language list on Open Food Facts; if it isn’t English, results may miss things.' : '';
    var ingHtml = '<div class="card ingredients"><h2>Ingredients</h2><p class="ing-text">' + esc(p.ingredients) + '</p>' +
      '<p class="meta">' + (p.source === 'pasted' ? 'From what you pasted.' : 'From Open Food Facts, which can be incomplete or out of date. Check the package.') + langNote + '</p>' +
      '<details class="disclosure" style="margin-top:12px"><summary>Label looks different? Fix the ingredients</summary>' + pasteBox(p.code, p.ingredients) + '</details>' +
      '</div>';

    views.result.innerHTML = productHeader(p) + sosHtml + gmoHtml + scoreHtml + flagsHtml + ingHtml +
      '<div class="result-actions"><button type="button" class="btn btn-outline btn-block" data-act="standards">How we grade</button></div>';
    bindPaste();
  }

  // ------------------------------------------------------------ recent scans
  function loadRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; } }
  function saveRecent(p, g) {
    if (!p.code || p.source !== 'off') return;
    var list = loadRecent().filter(function (r) { return r.code !== p.code; });
    list.unshift({ code: p.code, name: p.name, brand: p.brand, score: g.score, band: g.band.id, pass: g.sos.pass });
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8))); } catch (e) { /* private mode */ }
  }
  function renderRecent() {
    var list = loadRecent();
    $('recent').hidden = !list.length;
    var colors = { cleaner: 'background:#E3EDD2;color:#2F6B2A', mixed: 'background:#F7E8C4;color:#6B4600', poor: 'background:#F6E0D6;color:#A2361C' };
    $('recentList').innerHTML = list.map(function (r) {
      return '<li><button type="button" data-act="lookup" data-code="' + esc(r.code) + '"><span class="r-name">' + esc(r.name) + '</span>' +
        '<span class="r-meta" style="' + (colors[r.band] || '') + '">' + (r.pass ? 'Pass' : 'Fail') + ' · ' + r.score + '</span></button></li>';
    }).join('');
  }

  // ------------------------------------------------------------ standards panel
  function renderStandards() {
    var s = R.rulesSummary(), P = s.points;
    $('standardsBody').innerHTML =
      '<p class="callout"><strong>Tortuga Scan is not affiliated with Seed Oil Scout or Olive.</strong> We read the ingredient list (from Open Food Facts or what you paste) and apply the rules below. We don’t do lab tests and can’t see how a food was made.</p>' +
      '<h3>1. Seed Oil Safe-style check (pass / fail)</h3>' +
      '<p>Our implementation of the guidelines Seed Oil Scout publishes at <a href="https://www.seedoilscout.com/seedoilsafe" target="_blank" rel="noopener">seedoilscout.com/seedoilsafe</a>. It is not their certification or badge. A product fails if any of these appear:</p>' +
      '<ol>' +
        '<li><strong>Seed oils:</strong> canola / rapeseed, soybean / soya, corn / maize, sunflower (including high-oleic), safflower, grapeseed, cottonseed. We also flag generic “vegetable oil(s)” and “vegetable shortening”, and rice bran oil, an industrial oil often grouped with these. <em>Not</em> seed oils here: ' + s.notSeedOils.join(', ') + '. Corn, corn starch, and corn syrup are not corn oil.</li>' +
        '<li><strong>Soy:</strong> soy, soya, soybean, soy protein, soy lecithin, soy sauce, tamari, shoyu, miso, edamame, tofu, tempeh, natto, hydrolyzed or textured soy, TVP. (Soybean <em>oil</em> is counted under seed oils, not twice.)</li>' +
        '<li><strong>Artificial sweeteners:</strong> aspartame, sucralose, acesulfame potassium (Ace-K), saccharin, neotame, advantame, cyclamate. Stevia, monk fruit, erythritol, xylitol, and allulose are not flagged.</li>' +
        '<li><strong>Gums:</strong> xanthan, guar, gellan, locust bean / carob bean, gum arabic / acacia, cellulose gum (CMC), tara, karaya, tragacanth. We also group <strong>carrageenan</strong> here, a common clean-eating avoid.</li>' +
        '<li><strong>Plant lecithins:</strong> soy, sunflower, rapeseed / canola lecithin. Plain “lecithin” with no source is flagged as a likely plant lecithin; egg lecithin is not flagged.</li>' +
        '<li><strong>Natural flavors:</strong> natural flavor(s), flavour(s), flavoring(s).</li>' +
        '<li><strong>Dyes:</strong> FD&amp;C and named synthetic dyes (Red 40, Red 3, Yellow 5, Yellow 6, Blue 1, Blue 2, Green 3, Allura Red, Tartrazine, Sunset Yellow, Brilliant Blue, Erythrosine, Indigo Carmine, E102, E110, E129, E133 and similar) and “artificial color”. Paprika, turmeric, annatto, and beet juice are not flagged.</li>' +
      '</ol>' +
      '<p><strong>Skipped:</strong> Seed Oil Scout also lists “toxic manufacturing processes”. There’s no label-checkable list for that, so we don’t claim to check it. Cross-contact lines (“may contain…”, “made in a facility…”) aren’t graded.</p>' +
      '<h3>2. GMO status (Tortuga Scan check)</h3>' +
      '<p>This is our own check. It is <em>not</em> on Seed Oil Scout’s Seed Oil Safe list and doesn’t change the pass / fail above.</p>' +
      '<ul>' +
        '<li><strong>GMO / bioengineered:</strong> the ingredients, product name, or Open Food Facts labels say GMO, genetically modified or engineered, “bioengineered” (the US disclosure), or “derived from bioengineering”.</li>' +
        '<li><strong>Not GMO:</strong> USDA / certified organic, Non-GMO Project, or a clear non-GMO claim.</li>' +
        '<li><strong>Possible GMO (caution, not confirmed):</strong> no organic or non-GMO claim, and it contains conventional crops usually grown GMO in the US: soy, corn (and corn-derived dextrose / maltodextrin), canola / rapeseed, cottonseed, sugar beet, plain “sugar” not listed as cane, generic vegetable oil, papaya, alfalfa. Ingredients listed as organic (e.g. “organic corn”) don’t count.</li>' +
      '</ul>' +
      '<h3>3. Tortuga Scan clean score (0–100)</h3>' +
      '<p>Our own score, inspired by the categories Olive publicly describes (seed oils, additives, processing, sugar). It is not an official Olive score and isn’t based on lab tests. Start at 100, subtract, and stop at 0:</p>' +
      '<table class="pts-table"><tbody>' +
        '<tr><td>Seed oil present</td><td>−' + P.seedOil + '</td></tr>' +
        '<tr><td>Each other Seed Oil Safe category hit (soy, sweeteners, gums, lecithins, natural flavors, dyes)</td><td>−' + P.otherCategory + ' each</td></tr>' +
        '<tr><td>GMO / bioengineered confirmed</td><td>−' + P.gmoConfirmed + '</td></tr>' +
        '<tr><td>Possible GMO caution</td><td>−' + P.gmoPossible + '</td></tr>' +
        '<tr><td>Other additives: BHA, BHT, TBHQ, benzoates, sorbates, nitrites / nitrates, polysorbates, mono- and diglycerides, DATEM, propylene glycol, titanium dioxide, potassium bromate, azodicarbonamide, artificial flavor, MSG</td><td>−' + P.additiveEach + ' each, max −' + P.additiveCap + '</td></tr>' +
        '<tr><td>Added sugar in the ingredients (sugar, cane sugar, syrups, HFCS, dextrose, maltodextrin, honey, agave…)</td><td>−' + P.sugarBase + '</td></tr>' +
        '<tr><td>…and if sugars are ≥ ' + P.sugarHigh.at + ' g per 100 g (Open Food Facts nutrition)</td><td>−' + P.sugarHigh.extra + ' more</td></tr>' +
        '<tr><td>…or if sugars are ≥ ' + P.sugarVeryHigh.at + ' g per 100 g (instead of the line above)</td><td>−' + P.sugarVeryHigh.extra + ' more</td></tr>' +
        '<tr><td>NOVA group 4 (ultra-processed)</td><td>−' + P.nova[4] + '</td></tr>' +
        '<tr><td>NOVA group 3 (processed)</td><td>−' + P.nova[3] + '</td></tr>' +
      '</tbody></table>' +
      '<p>The high-sugar extra only applies when added sugar is listed, so fruit’s natural sugar isn’t penalized. NOVA comes from Open Food Facts; pasted labels have no NOVA deduction.</p>' +
      '<p><strong>Bands:</strong> 80–100 Cleaner · 50–79 Mixed · 0–49 Poor.</p>' +
      '<h3>Data</h3><p>Product data comes from <a href="https://world.openfoodfacts.org/" target="_blank" rel="noopener">Open Food Facts</a>, a free, volunteer-built database (ODbL). It can be incomplete or out of date, so check the package when it matters.</p>';
  }

  // ------------------------------------------------------------ events
  $('scanBtn').addEventListener('click', function () { startScan(); });
  $('stopScan').addEventListener('click', function () { stopScan().then(function () { show('home'); renderRecent(); }); });

  $('manualForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var code = $('manualCode').value.replace(/\D/g, '');
    if (code.length < 6) { $('manualCode').focus(); $('manualHelp').textContent = 'Enter at least 8 digits from under the barcode.'; return; }
    $('manualCode').blur();
    lookup(code);
  });

  $('pasteHomeForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var t = $('pasteHomeText').value.trim();
    if (!t) { $('pasteHomeText').focus(); return; }
    renderProduct({ code: '', name: 'Label you pasted', brand: '', ingredients: t, ingredientsLang: 'pasted', source: 'pasted', labels: '', labelsTags: [] });
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.dataset.act;
    if (act === 'retry-scan') startScan();
    else if (act === 'home') { show('home'); renderRecent(); $('manualCode').focus(); }
    else if (act === 'lookup') lookup(b.dataset.code);
    else if (act === 'standards') openStandards();
    else if (act === 'paste-blank') notFound(b.dataset.code);
  });

  var dlg = $('standards');
  function openStandards() {
    renderStandards();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }
  $('openStandards').addEventListener('click', openStandards);
  $('closeStandards').addEventListener('click', function () { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg && dlg.close) dlg.close(); });

  // Release the camera if the user switches apps / locks the phone.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && scanning) stopScan().then(function () { show('home'); renderRecent(); });
  });

  // Deep link: ?code=0123456789012
  var qs = new URLSearchParams(location.search);
  renderRecent();
  if (qs.get('code')) lookup(qs.get('code'));

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
