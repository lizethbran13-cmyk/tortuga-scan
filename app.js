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
  var views = {
    home: $('view-home'), scan: $('view-scan'), status: $('view-status'), result: $('view-result'),
    catalog: $('view-catalog'), labs: $('view-labs'), news: $('view-news')
  };
  var scanner = null, scanning = false, lastProduct = null, currentTab = 'scan';
  var catalog = [], catalogByCode = {}, labTests = [], newsReports = [];
  var catalogFilter = { q: '', sos: '', gmo: '', brand: '' };

  // ------------------------------------------------------------ helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function setTabCurrent(name) {
    document.querySelectorAll('.tabbar button').forEach(function (b) {
      if (b.dataset.tab === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }
  function updateUrl() {
    var params = new URLSearchParams(location.search);
    if (currentTab === 'scan') params.delete('tab');
    else params.set('tab', currentTab);
    if (!(currentTab === 'scan' && lastProduct && lastProduct.code)) params.delete('code');
    var qs = params.toString();
    var next = location.pathname + (qs ? '?' + qs : '') + location.hash;
    if (next !== location.pathname + location.search + location.hash) history.replaceState(null, '', next);
  }
  function show(name) {
    currentTab = 'scan';
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; });
    document.body.classList.toggle('scanning', name === 'scan');
    setTabCurrent('scan');
    window.scrollTo(0, 0);
    var params = new URLSearchParams(location.search);
    params.delete('tab');
    if (name === 'result' && lastProduct && lastProduct.code) params.set('code', lastProduct.code);
    else params.delete('code');
    var qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }
  function showTab(name) {
    if (name === 'lab' || name === 'lab-tests' || name === 'tests') name = 'labs';
    if (!name || name === 'home' || name === 'scan' || !views[name]) {
      if (scanning) stopScan();
      show('home');
      renderRecent();
      return;
    }
    if (scanning) stopScan();
    currentTab = name;
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; });
    document.body.classList.remove('scanning');
    setTabCurrent(name);
    window.scrollTo(0, 0);
    updateUrl();
    if (name === 'catalog') renderCatalog();
    if (name === 'labs') renderLabs();
    if (name === 'news') renderNews();
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

  function findCatalog(raw) {
    var candidates = R.barcodeCandidates(raw);
    for (var i = 0; i < candidates.length; i++) {
      if (catalogByCode[candidates[i]]) return catalogByCode[candidates[i]];
    }
    return null;
  }
  function fromCatalog(entry) {
    var nuts = entry.nutriments || {};
    return {
      code: entry.barcode,
      name: entry.name,
      brand: entry.brand || '',
      quantity: entry.quantity || '',
      image: entry.image || '',
      ingredients: entry.ingredients || '',
      ingredientsLang: entry.ingredientsLang || 'en',
      source: 'catalog',
      novaGroup: entry.nova || null,
      sugars100g: nuts.sugars100g != null ? nuts.sugars100g : null,
      labels: entry.labels || '',
      labelsTags: entry.labelsTags || [],
      added: entry.added || '',
      offUrl: entry.offUrl || ''
    };
  }
  function lookup(raw) {
    var ready = window.__tortugaData || Promise.resolve();
    ready.then(function () { lookupNow(raw); });
  }
  function lookupNow(raw) {
    var hit = findCatalog(raw);
    if (hit) { renderProduct(fromCatalog(hit)); return; }
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
    var src = '', srcClass = '';
    if (p.source === 'catalog') { src = 'In the Tortuga catalog'; srcClass = ' catalog'; }
    else if (p.source === 'off') { src = 'Not in our catalog · live Open Food Facts'; srcClass = ' live'; }
    else if (p.source === 'pasted') { src = 'Ingredients you pasted'; }
    var note = p.source === 'catalog'
      ? '<p class="catalog-note">Added ' + esc(formatDate(p.added)) + '. Ingredients copied from <a href="' + esc(p.offUrl) + '" target="_blank" rel="noopener">Open Food Facts</a>. Graded with our rules, not a lab test.</p>'
      : '';
    return '<div class="card product">' + img + '<div>' +
      '<h2>' + esc(p.name) + '</h2>' +
      (p.brand || p.quantity ? '<p class="brand-line">' + esc([p.brand, p.quantity].filter(Boolean).join(' · ')) + '</p>' : '') +
      (p.code ? '<p class="code">' + esc(p.code) + '</p>' : '') +
      (src ? '<span class="source-tag' + srcClass + '">' + esc(src) + '</span>' : '') +
      note +
      '</div></div>';
  }
  function formatDate(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return months[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
  }
  function renderIngList(items) {
    return '<ul class="ing-list">' + items.map(function (it) {
      var word = { green: 'OK', yellow: 'Limit', red: 'Avoid', none: 'Note' }[it.color] || '';
      var why = (it.color === 'yellow' || it.color === 'red') && it.reasons && it.reasons.length
        ? '<span class="why">' + esc(it.reasons.slice(0, 2).map(function (r) { return r.label; }).join(' · ')) + '</span>' : '';
      var dot = it.color === 'none' ? '' : '<span class="dot ' + it.color + '" aria-hidden="true"></span>';
      var kids = it.children && it.children.length ? renderIngList(it.children) : '';
      return '<li class="ing-item ' + it.color + '"><div class="ing-main">' + dot +
        '<span class="name"><span class="visually-hidden">' + word + '. </span>' + esc(it.text) + why + '</span></div>' + kids + '</li>';
    }).join('') + '</ul>';
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

    var gradeOpts = { novaGroup: p.novaGroup, sugars100g: p.sugars100g, productName: p.name, brand: p.brand, labels: p.labels, labelsTags: p.labelsTags };
    var g = R.grade(p.ingredients, gradeOpts);
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
        '<li><span class="mark ' + (g.glyphosate.pass ? 'ok' : 'bad') + '" aria-hidden="true">' + (g.glyphosate.pass ? '✓' : '✕') + '</span><span>Glyphosate-prone crops: ' +
          esc(g.glyphosate.pass ? (g.glyphosate.cleared ? 'Pass — organic or non-GMO' : 'None found') : 'Fail') + '</span></li>' +
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
    (g.glyphosate.hits || []).forEach(function (h) { flags.push({ cat: 'Glyphosate-prone crop · Tortuga Scan check', h: h, cls: '' }); });
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
    var light = R.classifyIngredients(p.ingredients, gradeOpts);
    var counts = light.counts || { red: 0, yellow: 0, green: 0 };
    var sourceLine = p.source === 'pasted' ? 'From what you pasted.'
      : p.source === 'catalog' ? 'From our catalog (copied from Open Food Facts). It can be out of date — check the package.'
      : 'From a live Open Food Facts lookup, which can be incomplete or out of date. Check the package.';
    var ingHtml = '<div class="card ingredients"><h2>Ingredients</h2>' +
      '<div class="legend" aria-hidden="true"><span><i class="dot green"></i> OK</span><span><i class="dot yellow"></i> Limit</span><span><i class="dot red"></i> Avoid</span></div>' +
      '<p class="legend-note">Green means that ingredient didn’t match an avoid or limit rule. Not a lab test or a certification.</p>' +
      '<p class="ing-counts"><strong>' + counts.red + '</strong> to avoid · <strong>' + counts.yellow + '</strong> to limit · <strong>' + counts.green + '</strong> OK</p>' +
      renderIngList(light.items) +
      '<p class="meta">' + sourceLine + langNote + '</p>' +
      '<details class="disclosure"><summary>Original ingredient text</summary><p class="ing-text">' + esc(p.ingredients) + '</p></details>' +
      '<details class="disclosure"><summary>Label looks different? Fix the ingredients</summary>' + pasteBox(p.code, p.ingredients) + '</details>' +
      '</div>';

    var linkedLabs = labsForProduct(p);
    var labHtml = linkedLabs.length
      ? '<h2 class="small-title">Public lab test for this barcode</h2>' + linkedLabs.map(labCard).join('') +
        '<p class="help">The published test names this barcode. It is not a test we ran.</p>'
      : '';
    views.result.innerHTML = productHeader(p) + sosHtml + gmoHtml + scoreHtml + flagsHtml + ingHtml + labHtml +
      '<div class="result-actions"><button type="button" class="btn btn-secondary btn-block" data-act="start-scan">Scan another</button>' +
      '<button type="button" class="btn btn-outline btn-block" data-act="standards">How we grade</button></div>';
    bindPaste();
  }

  // ------------------------------------------------------------ recent scans
  function loadRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; } }
  function saveRecent(p, g) {
    if (!p.code || (p.source !== 'off' && p.source !== 'catalog')) return;
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
        '<tr><td>Glyphosate-prone crop, if it isn’t organic or non-GMO (once, however many crops)</td><td>−' + P.glyphosate + '</td></tr>' +
        '<tr><td>Refined starch: corn starch, or modified food starch that isn’t a named potato, tapioca, rice, arrowroot, or cassava starch</td><td>−' + P.refinedStarchEach + ' each, max −' + P.refinedStarchCap + '</td></tr>' +
        '<tr><td>Mainstream brand (a well-known mass-market packaged-food brand)</td><td>−' + P.mainstream + '</td></tr>' +
      '</tbody></table>' +
      '<p>The high-sugar extra only applies when added sugar is listed, so fruit’s natural sugar isn’t penalized. NOVA comes from Open Food Facts; pasted labels have no NOVA deduction. A lone NOVA 4 deduction is −' + P.nova[4] + ', so ultra-processed foods don’t land in Cleaner on processing alone.</p>' +
      '<p>The mainstream deduction is flat −' + P.mainstream + ', the middle of a 3-to-5 range, once per product. It matches the brand or the product name against a list of mass-market names (General Mills, Cheerios, Kellogg’s, Nestlé, Coca-Cola, Pepsi, Kraft, Heinz, Post, and the same kind of grocery brand). It is not a guess about which company owns which brand. A simple mainstream food, such as milk or sparkling water, loses only those ' + P.mainstream + ' points.</p>' +
      '<p><strong>Bands:</strong> 80–100 Cleaner · 50–79 Mixed · 0–49 Poor.</p>' +
      '<h3>4. Glyphosate-prone crops (Tortuga Scan check)</h3>' +
      '<p>This is our own check. It does not change the Seed Oil Safe-style pass / fail, and it is not a lab test of the package in your hand. Conventional wheat, oats, barley, rye, sorghum, millet, corn, dry beans, chickpeas, lentils, peas (not snap or snow peas), soy foods, sunflower, flax, canola, cottonseed, and sugar beet have to be organic or non-GMO to pass. That claim can be on the ingredient or on the product (the name, the brand, or the labels). Otherwise the ingredient is red and the score drops −' + P.glyphosate + ' once.</p>' +
      '<p>The list follows public residue surveys and registered uses, not a measurement we made: <a href="' + s.glyphosate.sources[0].url + '" target="_blank" rel="noopener">CFIA’s 2015–2016 glyphosate survey</a> (grains, beans, peas, lentils, chickpeas, soy, wheat, barley), <a href="' + s.glyphosate.sources[1].url + '" target="_blank" rel="noopener">EWG’s 2018 oat-cereal tests</a>, and the <a href="' + s.glyphosate.sources[2].url + '" target="_blank" rel="noopener">EPA glyphosate page</a>. Rice, quinoa, buckwheat, potatoes, green beans, and snap peas are not on this list. Lecithin keeps its own color. Olive, avocado, and coconut oil are not treated as these crops.</p>' +
      '<h3>5. Ingredient colors (OK / limit / avoid)</h3>' +
      '<p>Each ingredient on the label gets a color. This is our aisle guide. It is not a Seed Oil Safe badge, not an Olive score, and not a lab test. A product can <em>pass</em> the Seed Oil Safe-style check and still have red ingredients (plain sugar, corn starch, and conventional oats are the usual ones). A gum or natural flavor is yellow here and still fails that pass/fail check.</p>' +
      '<ul>' +
        '<li><strong>Green — OK.</strong> Nothing in the avoid or limit lists matched. Olive, avocado, coconut, and animal fats, salt, water, herbs, spices, whole foods, organic or non-GMO glyphosate-prone crops, organic or non-GMO milk and eggs, and organic Dirty Dozen produce land here.</li>' +
        '<li><strong>Yellow — limit.</strong> Natural flavors and other unnamed flavors, gums (including carrageenan), plant lecithins that aren’t a soy derivative, soy foods that are organic or non-GMO (tofu, tamari), added sugars that name a source (cane, honey, maple, coconut, and organic or non-GMO sugar), sugar alcohols, organic enriched flour, caramel color, hydrogenated fat that isn’t already a seed oil, and non-organic produce from the Dirty Dozen. Milk and eggs are yellow when the ingredient and the product don’t say organic or non-GMO. That is a limit, not a score deduction. Butter and plant milks (almond, oat, soy, coconut) are not marked yellow for being milk.</li>' +
        '<li><strong>Red — avoid.</strong> Seed oils (same list as the pass/fail check, including organic canola or sunflower oil), artificial sweeteners, artificial dyes, artificial flavors, confirmed GMO or bioengineered wording, conventional corn starch, corn syrup, dextrose, and maltodextrin, modified food starch when the source isn’t named as something else, conventional sugar that doesn’t say cane (or another named non-beet source), beet sugar, refined soy derivatives (soy protein, soy flour, soy lecithin, TVP), conventional glyphosate-prone crops (wheat flour, oats, dry beans, and the rest of that list), and the other additives in the clean score (BHA, BHT, TBHQ, benzoates, sorbates, nitrites, polysorbates, mono- and diglycerides, DATEM, propylene glycol, titanium dioxide, potassium bromate, azodicarbonamide, MSG).</li>' +
      '</ul>' +
      '<p><strong>Dirty Dozen, ' + s.dirtyDozen.year + '.</strong> Non-organic ' + s.dirtyDozen.items.join('; ') + '. List published by the <a href="' + s.dirtyDozen.url + '" target="_blank" rel="noopener">' + esc(s.dirtyDozen.source) + '</a>. If that ingredient phrase says organic, we mark it green. Non-GMO alone does not — the list is about pesticide residue, not genetic engineering. We only look at the ingredient line, not the brand name, because a certified-organic product can still include a small non-organic share.</p>' +
      '<p>Organic or non-GMO on a refined corn or soy additive moves it from red to yellow. It does not make that additive green, and it does not make a seed oil okay. Added sugar stays yellow even when it says cane: we don’t call added sugar completely OK, and we don’t try to guess whether it’s a small amount. Raisins and sultanas count as grapes. Sweet potatoes, mustard (the condiment), green beans, and bell peppers are not on the ' + s.dirtyDozen.year + ' list. Potato starch counts as potatoes.</p>' +
      '<h3>Data</h3><p>Our catalog is seeded from <a href="https://world.openfoodfacts.org/" target="_blank" rel="noopener">Open Food Facts</a>, a free, volunteer-built database (ODbL). A scan checks the catalog first, then a live lookup. Either can be incomplete or out of date, so check the package when it matters. Lab tests elsewhere in the app are other organizations’ published tests.</p>';
  }

  function labsForProduct(p) {
    if (!p || !p.code) return [];
    var mine = {};
    R.barcodeCandidates(p.code).forEach(function (c) { mine[c] = 1; });
    return labTests.filter(function (t) {
      return t.barcode && R.barcodeCandidates(t.barcode).some(function (c) { return mine[c]; });
    });
  }
  function formatWhen(iso) {
    if (!iso) return '';
    if (/^\d{4}$/.test(iso)) return iso;
    return formatDate(iso) || iso;
  }
  function labCard(t) {
    var findings = (t.findings || []).map(function (f) {
      return '<li><span class="analyte">' + esc(f.analyte) + '</span><span class="value">' + esc(f.value) + '</span>' +
        (f.note ? '<span class="why">' + esc(f.note) + '</span>' : '') + '</li>';
    }).join('');
    var links = '<div class="links"><a class="btn btn-outline" href="' + esc(t.sourceUrl) + '" target="_blank" rel="noopener">' + esc(t.sourceName || 'Source') + '</a>';
    (t.alsoSee || []).forEach(function (a) {
      links += '<a class="btn btn-outline" href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.name) + '</a>';
    });
    if (t.barcode) links += '<button type="button" class="btn btn-secondary" data-act="lookup" data-code="' + esc(t.barcode) + '">Look up this barcode</button>';
    (t.brands || []).forEach(function (b) {
      links += '<button type="button" class="btn btn-outline" data-act="catalog-brand" data-brand="' + esc(b) + '">' + esc(b) + ' in the catalog</button>';
    });
    links += '</div>';
    return '<article class="card lab-card" id="lab-' + esc(t.id) + '">' +
      '<p class="kicker-row"><span class="tag lab">' + esc(t.match === 'sku' ? 'Specific product' : t.match === 'category' ? 'Category' : 'Brand or line') + '</span><span>' + esc(formatWhen(t.date)) + '</span></p>' +
      '<h3>' + esc(t.product) + '</h3>' +
      '<p class="help" style="margin:0">' + esc([t.brand, t.lab].filter(Boolean).join(' · ')) + (t.publisher ? ' · Published by ' + esc(t.publisher) : '') + '</p>' +
      '<p class="scope">' + esc(t.scopeNote || '') + '</p>' +
      '<p>' + esc(t.summary) + '</p>' +
      '<ul class="findings">' + findings + '</ul>' + links + '</article>';
  }
  function renderLabs() {
    $('labList').innerHTML = labTests.length
      ? labTests.map(labCard).join('')
      : '<div class="card"><p>Lab tests didn’t load. Check your connection and reload.</p></div>';
  }
  function renderNews() {
    if (!newsReports.length) {
      $('newsList').innerHTML = '<div class="card"><p>News didn’t load. Check your connection and reload.</p></div>';
      return;
    }
    $('newsList').innerHTML = newsReports.map(function (report) {
      var items = (report.items || []).map(function (item) {
        var more = (item.alsoSee || []).map(function (a) {
          return '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.name) + '</a>';
        }).join(' · ');
        var labBtn = item.labTestId
          ? '<button type="button" class="btn btn-outline" data-act="open-lab" data-lab="' + esc(item.labTestId) + '">Open the lab test</button>' : '';
        return '<article class="card story">' +
          '<p class="kicker-row"><span class="tag ' + esc(item.category || '') + '">' + esc(item.category || 'note') + '</span>' +
          (item.sourceDate ? '<span>' + esc(formatWhen(item.sourceDate)) + '</span>' : '') + '</p>' +
          '<h3>' + esc(item.headline) + '</h3>' +
          '<p>' + esc(item.summary) + '</p>' +
          '<div class="links"><a class="btn btn-outline" href="' + esc(item.sourceUrl) + '" target="_blank" rel="noopener">' + esc(item.sourceName || 'Source') + '</a>' + labBtn + '</div>' +
          (more ? '<p class="help">Also: ' + more + '</p>' : '') +
          '</article>';
      }).join('');
      return '<article class="card intro"><p class="kicker-row"><span>' + esc(report.timezone || 'America/Los_Angeles') + '</span></p>' +
        '<h2>' + esc(report.title) + '</h2><p>' + esc(report.dek || '') + '</p></article>' + items;
    }).join('');
  }
  function gmoPill(status) {
    if (status === 'gmo') return '<span class="pill gmo-bad">GMO</span>';
    if (status === 'possible') return '<span class="pill gmo-maybe">Possible GMO</span>';
    if (status === 'non-gmo') return '<span class="pill gmo-ok">Not GMO</span>';
    return '<span class="pill">No GMO flag</span>';
  }
  function catalogCard(p) {
    var g = p.grade || {};
    var img = p.image
      ? '<img src="' + esc(p.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
      : '<span class="thumb">No photo</span>';
    return '<button type="button" class="cat-card" data-act="lookup" data-code="' + esc(p.barcode) + '">' + img +
      '<span><span class="name">' + esc(p.name) + '</span>' +
      (p.brand ? '<span class="brand">' + esc(p.brand) + '</span>' : '') +
      '<span class="pills"><span class="pill ' + (g.sosPass ? 'pass' : 'fail') + '">' + (g.sosPass ? 'Pass' : 'Fail') + '</span>' +
      '<span class="pill">' + (g.score != null ? g.score : '—') + '</span>' + gmoPill(g.gmoStatus) + '</span></span></button>';
  }
  function filteredCatalog() {
    var q = catalogFilter.q.trim().toLowerCase();
    return catalog.filter(function (p) {
      if (catalogFilter.sos === 'pass' && !(p.grade && p.grade.sosPass)) return false;
      if (catalogFilter.sos === 'fail' && !(p.grade && p.grade.sosPass === false)) return false;
      if (catalogFilter.gmo && (!p.grade || p.grade.gmoStatus !== catalogFilter.gmo)) return false;
      if (catalogFilter.brand && (p.brand || '') !== catalogFilter.brand) return false;
      if (!q) return true;
      var blob = (p.name + ' ' + (p.brand || '') + ' ' + p.barcode).toLowerCase();
      return blob.indexOf(q) >= 0 || R.barcodeCandidates(q).some(function (c) { return p.barcode.indexOf(c) >= 0 || c.indexOf(p.barcode) >= 0; });
    });
  }
  function renderCatalog() {
    var list = filteredCatalog();
    $('catalogMeta').textContent = catalog.length
      ? (list.length + ' of ' + catalog.length + ' products')
      : 'Catalog is still loading, or it didn’t load.';
    $('catalogList').innerHTML = list.length ? list.map(catalogCard).join('')
      : '<div class="card"><p>' + (catalog.length ? 'Nothing matches those filters.' : 'The catalog file didn’t load.') + '</p></div>';
  }
  function fillBrandSelect() {
    var brands = [];
    var seen = {};
    catalog.forEach(function (p) {
      var b = p.brand || '';
      if (b && !seen[b]) { seen[b] = 1; brands.push(b); }
    });
    brands.sort(function (a, b) { return a.localeCompare(b); });
    $('catalogBrand').innerHTML = '<option value="">All brands</option>' + brands.map(function (b) {
      return '<option value="' + esc(b) + '">' + esc(b) + '</option>';
    }).join('');
  }
  function renderWelcome() {
    var box = $('catalogWelcome');
    if (!catalog.length) { box.hidden = true; return; }
    var passes = catalog.filter(function (p) { return p.grade && p.grade.sosPass; }).length;
    $('catalogWelcomeText').textContent = catalog.length + ' products and ' + labTests.length + ' public lab tests. The catalog was seeded ' + formatDate(catalog[0].added) + ' from Open Food Facts. ' + passes + ' pass our Seed Oil Safe-style check.';
    var want = ['041570054161', '0016000275287', '3017624010701', '049000006346'];
    var picked = [];
    want.forEach(function (code) {
      var hit = findCatalog(code);
      if (hit) picked.push(hit);
    });
    catalog.forEach(function (p) {
      if (picked.length >= 6) return;
      if (picked.some(function (x) { return x.barcode === p.barcode; })) return;
      if (p.grade && p.grade.sosPass && p.grade.score >= 80) picked.push(p);
    });
    $('catalogWelcomeList').innerHTML = picked.slice(0, 6).map(function (p) {
      var g = p.grade || {};
      return '<li><button type="button" data-act="lookup" data-code="' + esc(p.barcode) + '"><span class="r-name">' + esc(p.name) + '</span>' +
        '<span class="r-meta">' + (g.sosPass ? 'Pass' : 'Fail') + ' · ' + (g.score != null ? g.score : '') + '</span></button></li>';
    }).join('');
    box.hidden = false;
  }
  function indexCatalog(products) {
    catalog = products || [];
    catalogByCode = {};
    catalog.forEach(function (p) {
      catalogByCode[String(p.barcode)] = p;
      R.barcodeCandidates(p.barcode).forEach(function (c) { catalogByCode[c] = p; });
    });
    fillBrandSelect();
    renderWelcome();
  }
  function loadJson(file) {
    return fetch(new URL(file, document.baseURI).href).then(function (res) {
      if (!res.ok) throw new Error(file + ' ' + res.status);
      return res.json();
    });
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
    if (act === 'retry-scan' || act === 'start-scan') startScan();
    else if (act === 'home') { show('home'); renderRecent(); $('manualCode').focus(); }
    else if (act === 'lookup') lookup(b.dataset.code);
    else if (act === 'standards') openStandards();
    else if (act === 'paste-blank') notFound(b.dataset.code);
    else if (act === 'open-lab') {
      showTab('labs');
      var el = document.getElementById('lab-' + b.dataset.lab);
      if (el) el.scrollIntoView({ block: 'start' });
    } else if (act === 'catalog-brand') {
      catalogFilter.brand = b.dataset.brand || '';
      catalogFilter.q = '';
      $('catalogQ').value = '';
      $('catalogBrand').value = catalogFilter.brand;
      showTab('catalog');
    }
  });
  document.querySelectorAll('.tabbar button, [data-tab]').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.dataset.tab); });
  });
  $('catalogQ').addEventListener('input', function () {
    catalogFilter.q = $('catalogQ').value;
    renderCatalog();
  });
  $('catalogForm').addEventListener('submit', function (e) { e.preventDefault(); });
  document.querySelectorAll('#catalogForm [data-sos]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      catalogFilter.sos = chip.dataset.sos;
      document.querySelectorAll('#catalogForm [data-sos]').forEach(function (c) { c.classList.toggle('on', c === chip); });
      renderCatalog();
    });
  });
  $('catalogGmo').addEventListener('change', function () { catalogFilter.gmo = $('catalogGmo').value; renderCatalog(); });
  $('catalogBrand').addEventListener('change', function () { catalogFilter.brand = $('catalogBrand').value; renderCatalog(); });

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

  // Deep link: ?code=0123456789012  ?tab=news|catalog|labs
  var qs = new URLSearchParams(location.search);
  renderRecent();
  window.__tortugaData = Promise.all([
    loadJson('data/catalog.json').catch(function () { return { products: [] }; }),
    loadJson('data/lab-tests.json').catch(function () { return { tests: [] }; }),
    loadJson('data/news.json').catch(function () { return { reports: [] }; })
  ]).then(function (all) {
    indexCatalog((all[0] && all[0].products) || []);
    labTests = (all[1] && all[1].tests) || [];
    newsReports = (all[2] && all[2].reports) || [];
    renderWelcome();
    var intro = document.querySelector('#view-home .intro p');
    if (intro && catalog.length) {
      intro.insertAdjacentHTML('beforeend', ' <span id="homeCounts">' + catalog.length + ' catalog products · ' + labTests.length + ' public lab tests.</span>');
    }
  });
  window.__tortugaData.then(function () {
    if (qs.get('code')) lookup(qs.get('code'));
    else if (qs.get('tab')) showTab(qs.get('tab'));
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
