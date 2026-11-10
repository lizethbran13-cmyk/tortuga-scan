/* Tortuga Scan — app logic. Plain JS, no build step. */
(function () {
  'use strict';

  var R = window.ScoutRules;
  var UA = 'TortugaScan/0.3 (personal clean-eating scanner)';
  var OFF = 'https://world.openfoodfacts.org/api/v2/product/';
  var FIELDS = ['code', 'product_name', 'product_name_en', 'brands', 'image_front_url', 'image_front_small_url',
    'ingredients_text', 'ingredients_text_en', 'ingredients_text_fr', 'nova_group', 'nutriments', 'labels',
    'labels_tags', 'quantity'].join(',');
  var RECENT_KEY = 'tortuga.recent.v1';
  var MINE_KEY = 'tortuga.mine.v1';
  var PLACES_KEY = 'tortuga.places.v1';
  var REPORTS_KEY = 'tortuga.reports.v1';
  var MENU_KEY = 'tortuga.menu.v1';
  var Places = window.TortugaPlaces;
  var GROK_BOT = 'grokbot://app/v1/agent?id=a4483b75-73bb-47ac-8893-938cbf85736a';
  var PHOTO_DB = 'tortuga-photos';
  var PHOTO_STORE = 'photos';

  var $ = function (id) { return document.getElementById(id); };
  var views = {
    home: $('view-home'), scan: $('view-scan'), status: $('view-status'), result: $('view-result'),
    catalog: $('view-catalog'), store: $('view-store'), book: $('view-book'), brand: $('view-brand'), more: $('view-more'),
    map: $('view-map'), place: $('view-place'), report: $('view-report'), addplace: $('view-add-place'), menu: $('view-menu'),
    placemenu: $('view-place-menu'), placeitem: $('view-place-item')
  };
  var scanner = null, scanning = false, lastProduct = null, currentTab = 'scan';
  var catalog = [], catalogByCode = {}, household = [], householdByCode = {}, labTests = [], newsReports = [];
  var websites = {};
  var catalogFilter = { q: '', kind: '', band: '', brand: '' };
  var storeFilter = { q: '', kind: '' };
  var bookFilter = { q: '', color: '' };
  var bookCache = null;
  var pendingAddPhoto = null;
  var activePhotoUrl = '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function baseDir() {
    var fromDom = document.documentElement.dataset.base;
    if (fromDom) return fromDom;
    return './';
  }
  function setTabCurrent(name) {
    var tab = name === 'home' || name === 'result' || name === 'brand' || name === 'bookDetail' ? 'scan' : name;
    if (name === 'catalog') tab = 'catalog';
    if (name === 'store') tab = 'store';
    if (name === 'book') tab = 'more';
    if (name === 'more') tab = 'more';
    if (name === 'map' || name === 'place' || name === 'report' || name === 'addplace' || name === 'menu' || name === 'placemenu' || name === 'placeitem') tab = 'map';
    if (name === 'brand' || name === 'result') {
      tab = currentTab === 'store' || currentTab === 'catalog' || currentTab === 'more' || currentTab === 'map' ? currentTab : 'scan';
      if (currentTab === 'book') tab = 'more';
    }
    document.querySelectorAll('.tabbar button').forEach(function (b) {
      if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }
  function showView(name) {
    Object.keys(views).forEach(function (k) { if (views[k]) views[k].hidden = k !== name; });
    document.body.classList.toggle('scanning', name === 'scan');
    window.scrollTo(0, 0);
    var main = $('main');
    if (main) main.focus({ preventScroll: true });
  }
  function writeUrl(path, replace) {
    var next = path || baseDir();
    if (next === location.pathname + location.search + location.hash) return;
    if (replace) history.replaceState(null, '', next);
    else history.pushState(null, '', next);
  }
  function productPath(code) { return baseDir() + 'product/' + encodeURIComponent(code); }
  function brandPath(slug) { return baseDir() + 'brand/' + encodeURIComponent(slug); }
  function ingredientPath(slug) { return baseDir() + 'ingredient/' + encodeURIComponent(slug); }
  function placePath(id) { return baseDir() + 'place/' + encodeURIComponent(id); }
  function tabPath(tab) {
    if (!tab || tab === 'scan' || tab === 'home') return baseDir();
    if (tab === 'store') return baseDir() + 'store';
    return baseDir() + '?tab=' + encodeURIComponent(tab);
  }

  function validGtin(code) {
    if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
    var digits = code.split('').map(Number), check = digits.pop(), sum = 0;
    digits.reverse().forEach(function (d, i) { sum += d * (i % 2 === 0 ? 3 : 1); });
    return (10 - (sum % 10)) % 10 === check;
  }
  function todayISO() {
    var d = new Date();
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function loadMine() { try { return JSON.parse(localStorage.getItem(MINE_KEY)) || []; } catch (e) { return []; } }
  function writeMine(list) { try { localStorage.setItem(MINE_KEY, JSON.stringify(list)); } catch (e) { /* private mode */ } }
  function certPickerHtml(inputName, items, selected) {
    var on = {};
    (selected || []).forEach(function (id) { on[id] = 1; });
    return items.map(function (c) {
      return '<label class="cert"><input type="checkbox" name="' + esc(inputName) + '" value="' + esc(c.id) + '"' +
        (on[c.id] ? ' checked' : '') + '> <span>' + esc(c.name) + '</span></label>';
    }).join('');
  }
  function certEffectText(items) {
    return items.map(function (c) { return c.name + ': ' + c.effect; }).join(' ');
  }
  function readCertIds(form, inputName) {
    if (!form) return [];
    return Array.prototype.map.call(form.querySelectorAll('input[name="' + inputName + '"]:checked'), function (el) { return el.value; });
  }
  function mountCertPickers() {
    var food = R.foodCertifications || [];
    var home = R.householdClaims || [];
    var foodHelp = 'Mark what is printed on the package. These are not lab results, and they are not a badge we issue. ' + certEffectText(food);
    if ($('pasteHomeCerts')) $('pasteHomeCerts').innerHTML = certPickerHtml('homeCert', food, []);
    if ($('addFoodCerts')) $('addFoodCerts').innerHTML = certPickerHtml('addCert', food, []);
    if ($('addHouseholdClaims')) $('addHouseholdClaims').innerHTML = certPickerHtml('addClaim', home, []);
    if ($('pasteHomeCertHelp')) $('pasteHomeCertHelp').textContent = foodHelp + ' Words already in the name or brand, such as Organic, still count.';
    if ($('addFoodCertHelp')) $('addFoodCertHelp').textContent = foodHelp;
    if ($('addHouseholdHelp')) $('addHouseholdHelp').textContent = certEffectText(home);
  }
  function saveMine(entry) {
    var list = loadMine().filter(function (p) {
      if (entry.barcode && p.barcode && String(p.barcode) === String(entry.barcode) && p.kind === entry.kind) return false;
      if (!entry.barcode && entry.id && p.id === entry.id) return false;
      return true;
    });
    if (!entry.id) entry.id = 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    if (!entry.added) entry.added = todayISO();
    list.unshift(entry);
    writeMine(list.slice(0, 200));
    return entry;
  }
  function removeMine(id) {
    writeMine(loadMine().filter(function (p) { return p.id !== id; }));
    idbDelete(photoKey({ id: id }));
    renderMine();
    showHome();
  }
  function findMine(raw) {
    var wanted = {};
    R.barcodeCandidates(raw).forEach(function (c) { wanted[c] = 1; });
    var list = loadMine();
    for (var i = 0; i < list.length; i++) {
      var code = String(list[i].barcode || '');
      if (!code) continue;
      if (wanted[code]) return list[i];
      var alts = R.barcodeCandidates(code);
      for (var j = 0; j < alts.length; j++) if (wanted[alts[j]]) return list[i];
    }
    return null;
  }
  function fromMine(entry) {
    var food = entry.kind !== 'household';
    return {
      id: entry.id,
      code: entry.barcode || '',
      name: entry.name || (food ? 'Product you added' : 'Household product you added'),
      brand: entry.brand || '',
      quantity: entry.quantity || '',
      image: '',
      ingredients: entry.ingredients || '',
      ingredientsLang: 'pasted',
      source: 'device',
      kind: food ? 'food' : 'household',
      category: entry.category || '',
      novaGroup: entry.nova || null,
      sugars100g: entry.nutriments && entry.nutriments.sugars100g != null ? entry.nutriments.sugars100g : null,
      labels: entry.labels || '',
      labelsTags: entry.labelsTags || [],
      added: entry.added || '',
      sourceName: 'Added on this phone',
      sourceUrl: '',
      shadowed: !!entry.shadowed
    };
  }
  function storedFromForm(kind, fields, certIds) {
    var merged = R.mergeCertifications('', [], certIds, kind === 'household' ? 'household' : 'food');
    var code = String(fields.code || '').replace(/\D/g, '');
    return {
      kind: kind === 'household' ? 'household' : 'food',
      barcode: code,
      name: fields.name,
      brand: fields.brand || '',
      category: fields.category || '',
      ingredients: fields.ingredients,
      ingredientsLang: 'en',
      labels: merged.labels,
      labelsTags: merged.labelsTags,
      nova: null,
      nutriments: {},
      added: todayISO(),
      shadowed: !!(code && (findCatalog(code) || findHousehold(code)))
    };
  }

  function photoKey(p) {
    if (p && p.id) return 'id:' + p.id;
    if (p && p.code) return 'code:' + String(p.code);
    return '';
  }
  function openPhotoDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error('no idb'));
      var req = indexedDB.open(PHOTO_DB, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(PHOTO_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbPut(key, blob) {
    if (!key || !blob) return Promise.resolve();
    return openPhotoDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PHOTO_STORE, 'readwrite');
        tx.objectStore(PHOTO_STORE).put(blob, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function idbGet(key) {
    if (!key) return Promise.resolve(null);
    return openPhotoDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(PHOTO_STORE, 'readonly');
        var req = tx.objectStore(PHOTO_STORE).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }
  function idbDelete(key) {
    if (!key) return;
    openPhotoDb().then(function (db) {
      var tx = db.transaction(PHOTO_STORE, 'readwrite');
      tx.objectStore(PHOTO_STORE).delete(key);
    }).catch(function () {});
  }
  function fileToPhoto(file) {
    return new Promise(function (resolve) {
      if (!file) return resolve(null);
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var max = 1280;
        var scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round((img.width || 1) * scale));
        canvas.height = Math.max(1, Math.round((img.height || 1) * scale));
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FCF5E3';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) { resolve(blob || file); }, 'image/jpeg', 0.84);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }
  function biggerImage(url) {
    return String(url || '').replace(/\.(\d+)\.jpg(\?.*)?$/, '.400.jpg$2');
  }
  function placeholderHtml(label) {
    return '<div class="pack-empty"><svg viewBox="0 0 80 48" aria-hidden="true"><path d="M8 30c0-10 10-18 24-18 8 0 14 3 18 8 6-1 14 3 16 10" fill="none" stroke="#8FA86A" stroke-width="3" stroke-linecap="round"/><path d="M6 32h68" stroke="#3B5323" stroke-width="3" stroke-linecap="round"/><circle cx="62" cy="22" r="1.4" fill="#1C2416"/></svg><strong>' + esc(label || 'No package photo yet') + '</strong><p>Take one of the front of the box. It stays on this phone.</p></div>';
  }

  var logo = $('logoImg');
  function logoFail() { if (logo) logo.hidden = true; var f = $('logoFallback'); if (f) f.hidden = false; }
  if (logo) {
    logo.addEventListener('error', logoFail);
    if (logo.complete && logo.naturalWidth === 0) logoFail();
  }

  function scanHint(msg) { if ($('scanHint')) $('scanHint').textContent = msg; }
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
    showView('scan');
    currentTab = 'scan';
    setTabCurrent('scan');
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
        if (code === lastRead) readCount++; else { lastRead = code; readCount = 1; }
        if (readCount < 2) return;
        if (navigator.vibrate) navigator.vibrate(40);
        stopScan().then(function () { openCode(code, true); });
      },
      function () {}
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
    return scanner.stop().then(function () { try { scanner.clear(); } catch (e) {} })
      .catch(function () {});
  }
  function showCameraError(m) {
    showView('status');
    views.status.innerHTML =
      '<div class="card status-card error-card" role="alert">' +
        '<h2>' + esc(m.title) + '</h2><p>' + m.body + '</p>' +
        '<div class="actions">' +
          '<button type="button" class="btn btn-secondary" data-act="retry-scan">Try the camera again</button>' +
          '<button type="button" class="btn btn-outline" data-act="home">Type the barcode</button>' +
        '</div></div>';
  }

  function fetchProduct(code) {
    var url = OFF + encodeURIComponent(code) + '.json?fields=' + FIELDS;
    var opts = { headers: { 'User-Agent': UA, 'Accept': 'application/json' } };
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
    for (var i = 0; i < candidates.length; i++) if (catalogByCode[candidates[i]]) return catalogByCode[candidates[i]];
    return null;
  }
  function findHousehold(raw) {
    var candidates = R.barcodeCandidates(raw);
    for (var i = 0; i < candidates.length; i++) if (householdByCode[candidates[i]]) return householdByCode[candidates[i]];
    return null;
  }
  function fromHousehold(entry) {
    return {
      code: entry.barcode, name: entry.name, brand: entry.brand || '', quantity: entry.quantity || '',
      image: entry.image || '', ingredients: entry.ingredients || '', source: 'household', kind: 'household',
      category: entry.category || '', sourceName: entry.sourceName || 'Open Beauty Facts',
      sourceUrl: entry.sourceUrl || '', added: entry.added || '', labels: entry.labels || '', labelsTags: entry.labelsTags || []
    };
  }
  function fromCatalog(entry) {
    var nuts = entry.nutriments || {};
    return {
      code: entry.barcode, name: entry.name, brand: entry.brand || '', quantity: entry.quantity || '',
      image: entry.image || '', ingredients: entry.ingredients || '', ingredientsLang: entry.ingredientsLang || 'en',
      source: 'catalog', kind: 'food', novaGroup: entry.nova || null,
      sugars100g: nuts.sugars100g != null ? nuts.sugars100g : null,
      labels: entry.labels || '', labelsTags: entry.labelsTags || [], added: entry.added || '',
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
    var homeHit = findHousehold(raw);
    if (homeHit) { renderProduct(fromHousehold(homeHit)); return; }
    var mineHit = findMine(raw);
    if (mineHit) { renderProduct(fromMine(mineHit)); return; }
    var candidates = R.barcodeCandidates(raw);
    if (!candidates.length) return;
    showView('status');
    views.status.innerHTML = '<div class="card status-card"><div class="spinner" aria-hidden="true"></div><h2>Looking it up…</h2><p>Barcode ' + esc(candidates[0]) + '</p></div>';
    var i = 0;
    (function next() {
      if (i >= candidates.length) return notFound(candidates[0]);
      var c = candidates[i++];
      fetchProduct(c).then(function (p) {
        if (p) renderProduct(normalizeProduct(p, c)); else next();
      }).catch(function (err) {
        showView('status');
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
      image: p.image_front_url || p.image_front_small_url || '',
      ingredients: ing.trim(),
      ingredientsLang: lang,
      source: 'off',
      kind: 'food',
      novaGroup: p.nova_group || null,
      sugars100g: n.sugars_100g != null ? n.sugars_100g : null,
      labels: p.labels || '',
      labelsTags: p.labels_tags || []
    };
  }
  function notFound(code) {
    lastProduct = { code: code, name: 'Not in Open Food Facts', brand: '', ingredients: '', source: 'none', kind: 'food', labels: '', labelsTags: [] };
    showView('status');
    views.status.innerHTML =
      '<div class="card status-card"><h2>We couldn’t find this one</h2>' +
      '<p>Barcode <strong>' + esc(code) + '</strong> isn’t in Open Food Facts yet, and it isn’t in a catalog on this phone. Grade it from the package.</p></div>' +
      pasteBox({ code: code, ingredients: '', name: '', brand: '', labels: '', labelsTags: [] });
    bindPaste();
  }
  function pasteBox(p) {
    p = p || {};
    var selected = R.certificationsPresent({
      productName: p.name, brand: p.brand, labels: p.labels, labelsTags: p.labelsTags
    }).map(function (c) { return c.id; });
    return '<form class="card paste" id="pasteForm" data-code="' + esc(p.code || '') + '">' +
      '<label class="label" for="pasteName">Product name</label>' +
      '<input id="pasteName" type="text" autocomplete="off" placeholder="Rolled oats" value="' + esc(p.name && p.name !== 'Not in Open Food Facts' && p.name !== 'Unnamed product' ? p.name : '') + '">' +
      '<label class="label" for="pasteBrand">Brand</label>' +
      '<input id="pasteBrand" type="text" autocomplete="off" placeholder="Optional" value="' + esc(p.brand || '') + '">' +
      '<fieldset class="certs"><legend class="label">Certifications on the package</legend>' +
      '<div class="cert-grid">' + certPickerHtml('pasteCert', R.foodCertifications, selected) + '</div>' +
      '<p class="help">Mark what is printed on the package. Organic, Non-GMO, grass-fed, and pasture-raised change the score and the ingredient colors. Words already in the name or brand still count. This is not a lab test.</p></fieldset>' +
      '<label class="label" for="pasteText">Ingredients from the label</label>' +
      '<textarea id="pasteText" rows="6" placeholder="Copy the ingredient list exactly, commas and all.">' + esc(p.ingredients || '') + '</textarea>' +
      '<label class="save-line" for="pasteSave"><input type="checkbox" id="pasteSave"> Save this food on this phone</label>' +
      '<button type="submit" class="btn btn-secondary">Grade these ingredients</button></form>';
  }
  function bindPaste() {
    var f = $('pasteForm');
    if (!f || f.dataset.bound) return;
    f.dataset.bound = '1';
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = $('pasteText').value.trim();
      if (!text) { $('pasteText').focus(); return; }
      var base = lastProduct || {};
      var keepOff = base.source === 'off' || base.source === 'catalog';
      var name = $('pasteName') ? $('pasteName').value.trim() : '';
      var brand = $('pasteBrand') ? $('pasteBrand').value.trim() : '';
      var ids = readCertIds(f, 'pasteCert');
      var merged = R.mergeCertifications(base.labels || '', base.labelsTags || [], ids, 'food');
      var product = {
        code: f.dataset.code || base.code || '',
        name: name || (keepOff ? base.name : 'Label you pasted'),
        brand: brand || (keepOff ? base.brand : ''),
        quantity: base.quantity || '',
        image: keepOff ? base.image : '',
        ingredients: text,
        ingredientsLang: 'pasted',
        source: 'pasted',
        kind: 'food',
        novaGroup: keepOff ? base.novaGroup : null,
        sugars100g: keepOff ? base.sugars100g : null,
        labels: merged.labels,
        labelsTags: merged.labelsTags,
        added: base.added || '',
        offUrl: base.offUrl || ''
      };
      if ($('pasteSave') && $('pasteSave').checked) {
        var stored = storedFromForm('food', { code: product.code, name: product.name, brand: product.brand, ingredients: text }, ids);
        stored.labels = merged.labels;
        stored.labelsTags = merged.labelsTags;
        stored.nova = product.novaGroup;
        if (product.sugars100g != null) stored.nutriments = { sugars100g: product.sugars100g };
        product = fromMine(saveMine(stored));
        renderMine();
      }
      renderProduct(product);
    });
  }

  function formatDate(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return months[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
  }
  function highlight(context, match) {
    var c = esc(context), m = esc(match);
    var idx = c.indexOf(m);
    if (!m || idx < 0) return c;
    return c.slice(0, idx) + '<mark>' + m + '</mark>' + c.slice(idx + m.length);
  }
  function websiteFor(brand) {
    var slug = R.brandSlug(brand || '');
    return websites[slug] || '';
  }
  function grokHref(name) {
    var q = encodeURIComponent(String(name || '').slice(0, 140));
    return GROK_BOT + (q ? '&q=' + q : '');
  }
  function buyHtml(p, score) {
    var site = websiteFor(p.brand);
    var buttons = '<a class="btn btn-secondary" href="' + esc(grokHref(p.name)) + '">Buy with Grok Bot</a>';
    if (site) buttons += '<a class="btn btn-outline" href="' + esc(site) + '" target="_blank" rel="noopener">Go to website</a>';
    var note = '<p class="help">Buy with Grok Bot is a Grok Bot app link' + (score >= 60 ? '' : '') + '. This page cannot check out or charge a card. ' +
      (site ? 'Go to website opens the brand’s site.' : 'No official product website is on file for this brand, so there is no website button.') + '</p>';
    if (score < 60) {
      return '<div class="card"><h2 class="small-title">Not on the approved shelf</h2><p>The store lists products that score 60 or more. You can still open Grok Bot with this name.</p><div class="buy-row">' + buttons + '</div>' + note + '</div>';
    }
    return '<div class="card"><h2 class="small-title">Get it</h2><div class="buy-row">' + buttons + '</div>' + note + '</div>';
  }
  function meterHtml(score) {
    var meter = R.meterFor(score);
    function pt(deg, r) {
      var rad = deg * Math.PI / 180;
      return [(160 + r * Math.cos(rad)).toFixed(1), (148 - r * Math.sin(rad)).toFixed(1)];
    }
    function arc(fromScore, toScore) {
      var a0 = 180 - (fromScore / 100) * 180;
      var a1 = 180 - (toScore / 100) * 180;
      var p0 = pt(a0, 104), p1 = pt(a1, 104);
      return 'M ' + p0[0] + ' ' + p0[1] + ' A 104 104 0 0 1 ' + p1[0] + ' ' + p1[1];
    }
    var label = 'Score ' + meter.score + ' out of 100. ' + meter.verdict + '. ' + meter.band.label + '.';
    return '<section class="meter-panel" role="img" aria-label="' + esc(label) + '">' +
      '<svg class="meter-svg" viewBox="0 0 320 168" aria-hidden="true">' +
        '<path d="' + arc(0, 44) + '" fill="none" stroke="#C4533A" stroke-width="18" stroke-linecap="butt"/>' +
        '<path d="' + arc(45, 59) + '" fill="none" stroke="#E0A83A" stroke-width="18" stroke-linecap="butt"/>' +
        '<path d="' + arc(60, 100) + '" fill="none" stroke="#6E9A4E" stroke-width="18" stroke-linecap="round"/>' +
        '<g class="needle" data-score="' + meter.score + '" transform="rotate(-90 160 148)">' +
          '<line x1="160" y1="148" x2="160" y2="58" stroke="#243516" stroke-width="4" stroke-linecap="round"/>' +
          '<circle cx="160" cy="148" r="7" fill="#243516"/>' +
        '</g>' +
      '</svg>' +
      '<div class="meter-words"><span class="w-avoid">Avoid</span><span class="w-limit">Limit</span><span class="w-eat">Eat as you like</span></div>' +
      '<div class="meter-score"><span class="num">' + meter.score + '</span><span class="of">/ 100</span>' +
        '<span class="verdict-word ' + (meter.pass ? 'pass' : 'fail') + '">' + meter.verdict + '</span></div>' +
      '</section>';
  }
  function animateNeedles(root) {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    Array.prototype.forEach.call((root || document).querySelectorAll('.needle'), function (el) {
      var score = Number(el.getAttribute('data-score')) || 0;
      var target = score * 1.8 - 90;
      if (reduce) { el.setAttribute('transform', 'rotate(' + target + ' 160 148)'); return; }
      var start = null;
      function frame(now) {
        if (start === null) start = now;
        var t = Math.min(1, (now - start) / 720);
        var e = 1 - Math.pow(1 - t, 3);
        el.setAttribute('transform', 'rotate(' + (-90 + (target + 90) * e) + ' 160 148)');
        if (t < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }
  function attachPhoto(p, frame) {
    var key = photoKey(p);
    var remote = p.image || '';
    function showRemote() {
      if (!remote) { frame.innerHTML = placeholderHtml(); return; }
      var big = biggerImage(remote);
      frame.innerHTML = '<img alt="Front of the ' + esc(p.name) + ' package" src="' + esc(big) + '" decoding="async">';
      var img = frame.querySelector('img');
      img.addEventListener('error', function () {
        if (img.src.indexOf(remote) === -1 && remote !== big) { img.src = remote; return; }
        frame.innerHTML = placeholderHtml('Photo didn’t load');
      });
    }
    idbGet(key).then(function (blob) {
      if (activePhotoUrl) { URL.revokeObjectURL(activePhotoUrl); activePhotoUrl = ''; }
      if (blob) {
        activePhotoUrl = URL.createObjectURL(blob);
        frame.innerHTML = '<img alt="Package photo saved on this phone" src="' + activePhotoUrl + '">';
      } else showRemote();
    });
  }
  function photoButtons(p) {
    return '<div class="photo-actions">' +
      '<label class="btn btn-outline file-btn">Take a photo<input class="shot" data-shot="camera" data-key="' + esc(photoKey(p)) + '" type="file" accept="image/*" capture="environment"></label>' +
      '<label class="btn btn-outline file-btn">Choose a photo<input class="shot" data-shot="file" data-key="' + esc(photoKey(p)) + '" type="file" accept="image/*"></label>' +
      '</div><p class="help">A photo you take overrides the catalog picture on this phone only. It is stored in IndexedDB, not uploaded.</p>';
  }
  function renderIngList(items, link) {
    return '<ul class="ing-list">' + items.map(function (it) {
      var word = { green: 'OK', yellow: 'Limit', red: 'Avoid', none: 'Note' }[it.color] || '';
      var why = (it.color === 'yellow' || it.color === 'red') && it.reasons && it.reasons.length
        ? '<span class="why">' + esc(it.reasons.slice(0, 2).map(function (r) { return r.label; }).join(' · ')) + '</span>' : '';
      var dot = it.color === 'none' ? '' : '<span class="dot ' + it.color + '" aria-hidden="true"></span>';
      var kids = it.children && it.children.length ? renderIngList(it.children, link) : '';
      var name = link && it.color !== 'none'
        ? '<button type="button" class="ing-link" data-act="ingredient" data-name="' + esc(it.text) + '">' + esc(it.text) + '</button>'
        : esc(it.text);
      return '<li class="ing-item ' + it.color + '"><div class="ing-main">' + dot +
        '<span class="name"><span class="visually-hidden">' + word + '. </span>' + name + why + '</span></div>' + kids + '</li>';
    }).join('') + '</ul>';
  }
  function shortFlags(deductions) {
    return (deductions || []).map(function (d) { return d.label; }).slice(0, 3);
  }
  function claimNames(p) {
    var kind = (p.kind === 'household' || p.source === 'household') ? 'household' : 'food';
    return R.certificationsPresent({
      productName: p.name, brand: p.brand, labels: p.labels, labelsTags: p.labelsTags,
      ingredients: kind === 'household' ? p.ingredients : ''
    }, kind).map(function (c) { return c.name; });
  }
  function tortyHtml(p, grade) {
    var flags = shortFlags(grade.deductions);
    var line = R.tortySays({
      name: p.name,
      kind: (p.kind === 'household' || p.source === 'household') ? 'household' : 'food',
      score: grade.score,
      flags: flags,
      certifications: claimNames(p),
      mainstream: !!(grade.mainstream),
      hasIngredients: grade.hasIngredients !== false && !!(p.ingredients)
    });
    return '<div class="card torty-card"><img src="icons/torty-portrait.png" alt="Torty, a smiling tortoise" width="280" height="200">' +
      '<div class="speech"><span class="who">Torty thinks</span><p>' + esc(line) + '</p></div></div>';
  }
  function headerBlock(p) {
    var kind = (p.kind === 'household' || p.source === 'household') ? 'household' : 'food';
    var src = '', srcClass = '';
    if (p.source === 'catalog') { src = 'In the Tortuga catalog'; srcClass = ' catalog'; }
    else if (p.source === 'household') { src = 'In the Tortuga household catalog'; srcClass = ' catalog'; }
    else if (p.source === 'device') { src = 'Saved on this phone'; srcClass = ' catalog'; }
    else if (p.source === 'off') { src = 'Live Open Food Facts'; srcClass = ' live'; }
    else if (p.source === 'pasted') { src = 'Ingredients you pasted'; }
    var note = '';
    if (p.source === 'catalog') note = '<p class="catalog-note">Added ' + esc(formatDate(p.added)) + '. Ingredients copied from <a href="' + esc(p.offUrl) + '" target="_blank" rel="noopener">Open Food Facts</a>.</p>';
    else if (p.source === 'household') note = '<p class="catalog-note">Added ' + esc(formatDate(p.added)) + '. Ingredients copied from <a href="' + esc(p.sourceUrl) + '" target="_blank" rel="noopener">' + esc(p.sourceName || 'the source') + '</a>.</p>';
    else if (p.source === 'device') note = '<p class="catalog-note">Saved on this phone ' + esc(formatDate(p.added)) + '. Not uploaded.</p>';
    var brandBtn = p.brand
      ? '<button type="button" class="brand-link" data-act="brand" data-brand="' + esc(R.brandSlug(p.brand)) + '">' + esc(p.brand) + '</button>'
      : '';
    var claims = claimNames(p);
    return '<div class="hero-photo"><div class="pack-frame" id="packFrame">' + (p.image ? '' : placeholderHtml()) + '</div>' + photoButtons(p) + '</div>' +
      '<div class="product-head"><p class="back-row"><button type="button" class="btn btn-outline back-btn" data-act="back">Back</button></p>' +
      '<h2>' + esc(p.name) + '</h2>' +
      (brandBtn || p.quantity ? '<p class="brand-line">' + brandBtn + (p.quantity ? (brandBtn ? ' · ' : '') + esc(p.quantity) : '') + '</p>' : '') +
      (p.code ? '<p class="code">' + esc(p.code) + '</p>' : '') +
      (src ? '<span class="source-tag' + srcClass + '">' + esc(src) + (kind === 'household' ? ' · Household' : '') + '</span>' : '') +
      (claims.length ? '<p class="claim-row">' + claims.map(function (c) { return '<span class="pill claim">' + esc(c) + '</span>'; }).join('') + '</p><p class="claim-note">These package claims are part of this grade.</p>' : '') +
      note + '</div>';
  }
  function mathHtml(grade, title) {
    return '<ul class="math"><li><span>Start</span><span class="pts">100</span></li>' +
      (grade.deductions || []).map(function (d) {
        return '<li><span>' + esc(d.label) + (d.detail ? '<span class="detail">' + esc(d.detail) + '</span>' : '') + '</span><span class="pts">−' + d.points + '</span></li>';
      }).join('') +
      '<li class="total"><span>' + esc(title) + '</span><span class="pts">' + grade.score + '</span></li></ul>';
  }
  function publishBlock(p, grade) {
    if (p.source !== 'device') return '';
    var entry = p.kind === 'household' ? {
      barcode: p.code || '', name: p.name, brand: p.brand || '', category: p.category || '',
      ingredients: p.ingredients, labels: p.labels || '', sourceName: 'Added on this phone', added: p.added || todayISO(),
      grade: { pass: grade.pass, score: grade.score, band: grade.band.id, bandLabel: grade.band.label }
    } : {
      barcode: p.code || '', name: p.name, brand: p.brand || '', ingredients: p.ingredients, ingredientsLang: 'en',
      labels: p.labels || '', labelsTags: p.labelsTags || [], nova: p.novaGroup || null,
      nutriments: p.sugars100g != null ? { sugars100g: p.sugars100g } : {}, added: p.added || todayISO(),
      grade: {
        pass: grade.pass, avoidPass: grade.sos.pass, gmoStatus: grade.gmo.status, gmoLabel: grade.gmo.label,
        score: grade.score, band: grade.band.id, bandLabel: grade.band.label
      }
    };
    return '<details class="card disclosure"><summary>Copy for the shared catalog</summary>' +
      '<p class="help">Paste this into <code>data/' + (p.kind === 'household' ? 'household' : 'catalog') + '.json</code> when you publish it. Add a real source URL first. Don’t invent ingredients.</p>' +
      '<textarea class="json-out" readonly>' + esc(JSON.stringify(entry, null, 2)) + '</textarea></details>' +
      '<button type="button" class="btn btn-outline btn-block" data-act="remove-mine" data-id="' + esc(p.id) + '">Remove from this phone</button>';
  }

  function renderProduct(p) {
    lastProduct = p;
    if (p.code) writeUrl(productPath(p.code), true);
    showView('result');
    setTabCurrent('result');
    var householdKind = p.source === 'household' || p.kind === 'household';
    if (!p.ingredients) {
      views.result.innerHTML = headerBlock(p) +
        '<div class="notice" role="status"><strong>No ingredient list yet</strong>Paste the list from the package and mark any certifications.</div>' +
        pasteBox(p);
      attachPhoto(p, $('packFrame'));
      bindPaste();
      return;
    }
    if (householdKind) return renderHousehold(p);
    var gradeOpts = { novaGroup: p.novaGroup, sugars100g: p.sugars100g, productName: p.name, brand: p.brand, labels: p.labels, labelsTags: p.labelsTags };
    var g = R.grade(p.ingredients, gradeOpts);
    saveRecent(p, g);
    var light = R.classifyIngredients(p.ingredients, gradeOpts);
    var flags = [];
    g.sos.categories.forEach(function (c) {
      c.hits.forEach(function (h) { flags.push({ cat: 'Tortuga rule · ' + c.name, h: h }); });
    });
    g.gmo.confirmed.forEach(function (h) { flags.push({ cat: 'GMO', h: h }); });
    g.gmo.risky.forEach(function (h) { flags.push({ cat: 'Possible GMO', h: h, cls: 'f-warn' }); });
    (g.glyphosate.hits || []).forEach(function (h) { flags.push({ cat: 'Glyphosate-prone crop', h: h }); });
    g.additives.forEach(function (h) { flags.push({ cat: 'Additive', h: h, cls: 'f-warn' }); });
    g.sugars.forEach(function (h) { flags.push({ cat: 'Added sugar', h: h, cls: 'f-warn' }); });
    var flagsHtml = '<section class="card flags"><h2>Flags</h2>' + (flags.length
      ? '<ul class="flag-list">' + flags.map(function (f) {
          return '<li class="flag ' + (f.cls || '') + '"><div class="cat">' + esc(f.cat) + '</div><div class="rule">' + esc(f.h.rule) + '</div>' +
            '<p class="ctx">“' + highlight(f.h.context || f.h.match, f.h.match) + '”</p></li>';
        }).join('') + '</ul>'
      : '<p class="no-flags">No ingredient flags on this list.</p>') + '</section>';
    var counts = light.counts || { red: 0, yellow: 0, green: 0 };
    var nut = p.sugars100g != null ? '<p class="help">Sugars ' + esc(String(p.sugars100g)) + ' g / 100 g, from the source nutrition.</p>' : '';
    var gmoLine = '<p><strong>GMO status.</strong> ' + esc(g.gmo.label) + '. Tortuga’s own check, not a lab test.</p>';
    var glyLine = '<p><strong>Glyphosate-prone crops.</strong> ' + esc(g.glyphosate.pass ? (g.glyphosate.cleared ? 'Cleared because the product is organic.' : 'None found.') : (g.glyphosate.status === 'limit' ? 'Non-GMO, not organic.' : 'Conventional crop on the list.')) + '</p>';
    var more = '<section class="card more-panel"><h2>More</h2>' +
      '<div class="legend"><span><i class="dot green"></i> Green</span><span><i class="dot yellow"></i> Yellow</span><span><i class="dot red"></i> Red</span></div>' +
      '<p class="help">' + counts.red + ' to avoid · ' + counts.yellow + ' to limit · ' + counts.green + ' with no flag. Tap an ingredient for the book.</p>' +
      renderIngList(light.items, true) + nut + gmoLine + glyLine +
      (p.novaGroup ? '<p><strong>NOVA group.</strong> ' + esc(String(p.novaGroup)) + ', from Open Food Facts.</p>' : '<p>No NOVA group on this record, so processing was not deducted from that field.</p>') +
      (p.offUrl ? '<p><a href="' + esc(p.offUrl) + '" target="_blank" rel="noopener">Open Food Facts source</a></p>' : '') +
      '<details class="disclosure"><summary>Original ingredient text</summary><p class="help">' + esc(p.ingredients) + '</p></details>' +
      mathHtml(g, 'Tortuga score') +
      '</section>';
    var labs = labsForProduct(p);
    var labHtml = labs.length ? labs.map(labCard).join('') : '';
    views.result.innerHTML = headerBlock(p) + meterHtml(g.score) + tortyHtml(p, g) + flagsHtml + more + buyHtml(p, g.score) + labHtml + publishBlock(p, g) +
      '<div class="link-row"><button type="button" class="btn btn-secondary" data-act="start-scan">Scan another</button></div>';
    animateNeedles(views.result);
    attachPhoto(p, $('packFrame'));
    bindPaste();
  }
  function renderHousehold(p) {
    var g = R.gradeHousehold(p.ingredients);
    var light = R.classifyHousehold(p.ingredients);
    var flags = (g.deductions || []).filter(function (d) { return d.level !== 'stack'; });
    var flagsHtml = '<section class="card flags"><h2>Flags</h2>' + (flags.length
      ? flags.map(function (d) {
          return '<div class="flag ' + (d.level === 'yellow' ? 'f-warn' : '') + '"><div class="cat">Tortuga household rule</div><div class="rule">' + esc(d.label) + '</div><p class="ctx">' + esc(d.detail || '') + '</p></div>';
        }).join('')
      : '<p class="no-flags">No fragrance, preservative, color, brightener, seed-oil, or flavor flag on this list.</p>') + '</section>';
    var more = '<section class="card more-panel"><h2>More</h2>' +
      '<div class="legend"><span><i class="dot green"></i> Green</span><span><i class="dot yellow"></i> Yellow</span><span><i class="dot red"></i> Red</span></div>' +
      renderIngList(light.items, true) +
      (p.sourceUrl ? '<p><a href="' + esc(p.sourceUrl) + '" target="_blank" rel="noopener">' + esc(p.sourceName || 'Source') + '</a></p>' : '') +
      '<p class="help">' + esc(g.standard) + '</p>' +
      '<details class="disclosure"><summary>Original ingredient text</summary><p class="help">' + esc(p.ingredients) + '</p></details>' +
      mathHtml(g, 'Tortuga household score') +
      '</section>';
    views.result.innerHTML = headerBlock(p) + meterHtml(g.score) + tortyHtml(p, g) + flagsHtml + more + buyHtml(p, g.score) + publishBlock(p, g) +
      '<div class="link-row"><button type="button" class="btn btn-secondary" data-act="start-scan">Scan another</button></div>';
    animateNeedles(views.result);
    attachPhoto(p, $('packFrame'));
  }

  function loadRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; } }
  function saveRecent(p, g) {
    if (!p.code || (p.source !== 'off' && p.source !== 'catalog' && p.source !== 'device')) return;
    var list = loadRecent().filter(function (r) { return r.code !== p.code; });
    list.unshift({ code: p.code, name: p.name, brand: p.brand, score: g.score, band: g.band.id, pass: g.pass });
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8))); } catch (e) {}
  }
  function mineGrade(entry) {
    if (entry.kind === 'household') return R.gradeHousehold(entry.ingredients);
    return R.grade(entry.ingredients, { productName: entry.name, brand: entry.brand, labels: entry.labels, labelsTags: entry.labelsTags, novaGroup: entry.nova });
  }
  function mineListHtml(entries) {
    return entries.map(function (p) {
      var g = mineGrade(p);
      return '<li><button type="button" data-act="open-mine" data-id="' + esc(p.id) + '"><span class="r-name">' + esc(p.name) + '</span>' +
        '<span class="r-meta">' + (g.pass ? 'Pass' : 'Fail') + ' · ' + g.score + '</span></button></li>';
    }).join('');
  }
  function renderMine() {
    var list = loadMine();
    var card = $('mineCard');
    if (card) { card.hidden = !list.length; $('mineList').innerHTML = mineListHtml(list); }
    var food = list.filter(function (p) { return p.kind !== 'household'; });
    if ($('catalogMine')) {
      $('catalogMine').innerHTML = food.length
        ? '<div class="card"><h2 class="small-title">My products</h2><ul class="recent">' + mineListHtml(food) + '</ul></div>'
        : '';
    }
  }
  function renderRecent() {
    renderMine();
    var list = loadRecent();
    if (!$('recent')) return;
    $('recent').hidden = !list.length;
    $('recentList').innerHTML = list.map(function (r) {
      return '<li><button type="button" data-act="lookup" data-code="' + esc(r.code) + '"><span class="r-name">' + esc(r.name) + '</span>' +
        '<span class="r-meta">' + (r.pass ? 'Pass' : 'Fail') + ' · ' + r.score + '</span></button></li>';
    }).join('');
  }

  function cardHtml(p, kind) {
    var g = p.grade || {};
    var img = p.image
      ? '<img src="' + esc(biggerImage(p.image)) + '" alt="" loading="lazy" data-fallback="' + esc(p.image) + '">'
      : '<span class="thumb">No photo</span>';
    var band = g.band || '';
    var pass = g.pass ? 'Pass' : 'Fail';
    return '<button type="button" class="cat-card" data-act="lookup" data-code="' + esc(p.barcode) + '">' + img +
      '<span><span class="name">' + esc(p.name) + '</span>' +
      '<span class="brand">' + esc(p.brand || '') + (kind === 'household' ? ' · Household' : '') + '</span>' +
      '<span class="pills"><span class="pill ' + (g.pass ? 'pass' : 'fail') + '">' + pass + '</span>' +
      '<span class="pill ' + esc(band) + '">' + esc(g.bandLabel || band) + '</span>' +
      '<span class="pill">' + (g.score != null ? g.score : '—') + '</span></span></span></button>';
  }
  function combined() {
    return catalog.map(function (p) { return { raw: p, kind: 'food' }; }).concat(household.map(function (p) { return { raw: p, kind: 'household' }; }));
  }
  function filteredCatalog() {
    var q = catalogFilter.q.trim().toLowerCase();
    return combined().filter(function (row) {
      var p = row.raw;
      if (catalogFilter.kind && row.kind !== catalogFilter.kind) return false;
      if (catalogFilter.band && (!p.grade || p.grade.band !== catalogFilter.band)) return false;
      if (catalogFilter.brand && R.brandSlug(p.brand) !== catalogFilter.brand && (p.brand || '') !== catalogFilter.brand) return false;
      if (!q) return true;
      return (p.name + ' ' + (p.brand || '') + ' ' + p.barcode).toLowerCase().indexOf(q) >= 0;
    });
  }
  function renderCatalog() {
    renderMine();
    var list = filteredCatalog();
    $('catalogMeta').textContent = (catalog.length + household.length)
      ? (list.length + ' of ' + (catalog.length + household.length))
      : 'Catalog is still loading.';
    $('catalogList').innerHTML = list.length
      ? list.map(function (row) { return cardHtml(row.raw, row.kind); }).join('')
      : '<div class="card"><p>' + (catalog.length ? 'Nothing matches those filters.' : 'The catalog didn’t load.') + '</p></div>';
    bindBrokenThumbs($('catalogList'));
  }
  function bindBrokenThumbs(root) {
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll('img[data-fallback]'), function (img) {
      img.addEventListener('error', function () {
        if (img.dataset.tried) { img.outerHTML = '<span class="thumb">No photo</span>'; return; }
        img.dataset.tried = '1';
        img.src = img.dataset.fallback;
      });
    });
  }
  function fillBrandSelect() {
    var seen = {}, brands = [];
    combined().forEach(function (row) {
      var b = row.raw.brand || '';
      var slug = R.brandSlug(b);
      if (b && !seen[slug]) { seen[slug] = b; brands.push({ slug: slug, name: b }); }
    });
    brands.sort(function (a, b) { return a.name.localeCompare(b.name); });
    $('catalogBrand').innerHTML = '<option value="">All brands</option>' + brands.map(function (b) {
      return '<option value="' + esc(b.slug) + '">' + esc(b.name) + '</option>';
    }).join('');
  }
  function renderWelcome() {
    var box = $('catalogWelcome');
    if (!catalog.length || !box) return;
    var eat = catalog.filter(function (p) { return p.grade && p.grade.score >= 60; }).length;
    $('catalogWelcomeText').textContent = catalog.length + ' foods and ' + household.length + ' household products. ' + eat + ' foods land on Eat as you like.';
    var want = ['0016000275287', '041570054161', '3017624010701', '049000006346'];
    var picked = [];
    want.forEach(function (code) { var hit = findCatalog(code); if (hit) picked.push(hit); });
    catalog.forEach(function (p) {
      if (picked.length >= 4) return;
      if (p.grade && p.grade.score >= 90 && !picked.some(function (x) { return x.barcode === p.barcode; })) picked.push(p);
    });
    $('catalogWelcomeList').innerHTML = picked.slice(0, 4).map(function (p) {
      var g = p.grade || {};
      return '<li><button type="button" data-act="lookup" data-code="' + esc(p.barcode) + '"><span class="r-name">' + esc(p.name) + '</span>' +
        '<span class="r-meta">' + (g.pass ? 'Pass' : 'Fail') + ' · ' + g.score + '</span></button></li>';
    }).join('');
    box.hidden = false;
  }
  function renderStore() {
    var q = storeFilter.q.trim().toLowerCase();
    var list = combined().filter(function (row) {
      var g = row.raw.grade || {};
      if (!(g.score >= 60)) return false;
      if (storeFilter.kind && row.kind !== storeFilter.kind) return false;
      if (!q) return true;
      return (row.raw.name + ' ' + (row.raw.brand || '')).toLowerCase().indexOf(q) >= 0;
    });
    $('storeMeta').textContent = list.length + ' approved';
    $('storeList').innerHTML = list.length ? list.map(function (row) {
      var p = row.raw;
      var site = websiteFor(p.brand);
      return '<article class="card cat-card" style="cursor:default;display:block">' +
        '<button type="button" class="cat-card" data-act="lookup" data-code="' + esc(p.barcode) + '" style="border:0;box-shadow:none;padding:0;width:100%">' +
          (p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy">' : '<span class="thumb">No photo</span>') +
          '<span><span class="name">' + esc(p.name) + '</span><span class="brand">' + esc(p.brand || '') + '</span>' +
          '<span class="pills"><span class="pill eat">Eat as you like</span><span class="pill">' + p.grade.score + '</span></span></span></button>' +
        '<div class="buy-row"><a class="btn btn-secondary" href="' + esc(grokHref(p.name)) + '">Buy with Grok Bot</a>' +
          (site ? '<a class="btn btn-outline" href="' + esc(site) + '" target="_blank" rel="noopener">Go to website</a>' : '') +
          '<button type="button" class="btn btn-outline" data-act="brand" data-brand="' + esc(R.brandSlug(p.brand)) + '">Brand</button></div>' +
        '<p class="help">Grok Bot app link. This site does not check out.</p></article>';
    }).join('') : '<div class="card"><p>Nothing in the approved store matches.</p></div>';
  }

  function bookEntries() {
    if (bookCache) return bookCache;
    var seen = {};
    var list = [];
    function add(name, kind) {
      R.glossaryNames(name).forEach(function (clean) {
        var key = clean.toLowerCase();
        if (seen[key]) return;
        seen[key] = 1;
        var profile = R.ingredientProfile(clean, kind);
        if (!profile) return;
        profile.name = clean;
        profile.slug = R.brandSlug(clean);
        profile.id = key;
        list.push(profile);
      });
    }
    ['olive oil', 'avocado oil', 'canola oil', 'sunflower oil', 'oats', 'wheat flour', 'corn starch', 'sugar', 'honey', 'maple syrup', 'milk', 'eggs', 'chicken', 'xanthan gum', 'natural flavors', 'soy lecithin', 'fragrance', 'methylisothiazolinone', 'sodium benzoate', 'modified food starch', 'red 40', 'sucralose', 'filtered water', 'thiamin mononitrate', 'wheat'].forEach(function (n) {
      add(n, /fragrance|methyl|benzoate/i.test(n) ? 'household' : 'food');
    });
    catalog.forEach(function (p) {
      var tree = R.classifyIngredients(p.ingredients, { productName: p.name, brand: p.brand, labels: p.labels, labelsTags: p.labelsTags });
      (function walk(items) {
        items.forEach(function (it) {
          if (!it.children || !it.children.length) add(it.text, 'food');
          else {
            add(it.text, 'food');
            walk(it.children);
          }
        });
      })(tree.items || []);
    });
    household.forEach(function (p) {
      var tree = R.classifyHousehold(p.ingredients);
      (tree.items || []).forEach(function (it) { add(it.text, 'household'); });
    });
    list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    bookCache = list;
    return list;
  }
  function renderBook() {
    var entries = bookEntries();
    var q = bookFilter.q.trim().toLowerCase();
    var list = entries.filter(function (e) {
      if (bookFilter.color && e.color !== bookFilter.color) return false;
      if (!q) return true;
      return e.name.toLowerCase().indexOf(q) >= 0;
    }).slice(0, 80);
    $('bookMeta').textContent = list.length + ' shown · ' + entries.length + ' in the book';
    var detail = $('bookDetail');
    detail.hidden = true;
    $('bookList').hidden = false;
    $('bookList').innerHTML = list.map(function (e) {
      return '<button type="button" class="cat-card" data-act="ingredient" data-name="' + esc(e.name) + '" data-kind="' + esc(e.kind) + '">' +
        '<span class="thumb"><span class="dot ' + e.color + '"></span></span>' +
        '<span><span class="name">' + esc(e.name) + '</span><span class="brand">' + (e.color === 'red' ? 'Red · avoid' : e.color === 'yellow' ? 'Yellow · limit' : e.color === 'green' ? 'Green' : 'Note') +
        (e.kind === 'household' ? ' · household' : '') + '</span></span></button>';
    }).join('') || '<div class="card"><p>No ingredient matches.</p></div>';
  }
  function showIngredient(name, kind) {
    var cleaned = R.glossaryNames(name);
    if (!cleaned.length) { renderBook(); return; }
    var lookup = cleaned[0];
    var entries = bookEntries();
    var slug = R.brandSlug(lookup);
    var hit = entries.filter(function (e) { return e.slug === slug || e.name.toLowerCase() === lookup.toLowerCase(); })[0];
    if (!hit) hit = R.ingredientProfile(lookup, kind || 'food');
    if (!hit) { renderBook(); return; }
    if (hit && !hit.blurb) hit = R.ingredientProfile(hit.name, hit.kind);
    writeUrl(ingredientPath(R.brandSlug(hit.name)), true);
    showView('book');
    currentTab = 'book';
    setTabCurrent('book');
    $('bookList').hidden = true;
    var box = $('bookDetail');
    box.hidden = false;
    var variants = hit.variants || {};
    var extra = '';
    if (variants.organic && variants.organic !== hit.color) extra += '<p><strong>If the product is organic:</strong> ' + esc(variants.organic) + '.</p>';
    if (variants.nongmo && variants.nongmo !== hit.color) extra += '<p><strong>If the product is only non-GMO:</strong> ' + esc(variants.nongmo) + '.</p>';
    box.innerHTML = '<p class="back-row"><button type="button" class="btn btn-outline" data-act="book-list">All ingredients</button></p>' +
      '<h2>' + esc(hit.name) + '</h2>' +
      '<p class="pills"><span class="pill ' + esc(hit.color) + '">' + esc(hit.color === 'red' ? 'Red · avoid' : hit.color === 'yellow' ? 'Yellow · limit' : 'Green') + '</span></p>' +
      '<p class="blurb">' + esc(hit.blurb || '') + '</p>' + extra;
  }

  function brandProducts(slug) {
    return combined().filter(function (row) { return R.brandSlug(row.raw.brand) === slug; });
  }
  function showBrand(slug, replace) {
    var rows = brandProducts(slug);
    showView('brand');
    currentTab = 'brand';
    setTabCurrent('brand');
    writeUrl(brandPath(slug), replace !== false);
    if (!rows.length) {
      views.brand.innerHTML = '<div class="card"><h2>No products for this brand</h2><p>That name isn’t in the catalog on this phone.</p></div>';
      return;
    }
    var name = rows[0].raw.brand;
    var standing = R.brandStanding(rows.map(function (row) { return row.raw.grade ? row.raw.grade.score : 0; }));
    var badge = standing.label ? '<p><span class="badge ' + standing.id + '">' + esc(standing.label) + '</span></p>' : '';
    views.brand.innerHTML = '<div class="card"><p class="back-row"><button type="button" class="btn btn-outline" data-act="back">Back</button></p>' +
      '<h2 id="brandTitle">' + esc(name) + '</h2>' + badge +
      '<p class="caveat">' + esc(standing.caveat) + '</p>' +
      (websiteFor(name) ? '<p><a href="' + esc(websiteFor(name)) + '" target="_blank" rel="noopener">Brand website</a></p>' : '') +
      '</div><div class="catalog-list">' + rows.map(function (row) { return cardHtml(row.raw, row.kind); }).join('') + '</div>';
  }

  function renderStandards() {
    var s = R.rulesSummary(), P = s.points;
    $('standardsBody').innerHTML =
      '<p class="callout"><strong>Inspired by published Bobby Approved standards and an Olive-style meter.</strong> Not affiliated with FlavCity, Bobby Approved, Olive, or Seed Oil Scout. Not their score, badge, or lab test. The commandments are published at <a href="https://www.shopflavcity.com/pages/bobby-approved-app" target="_blank" rel="noopener">shopflavcity.com</a>. Tortuga does not copy that app’s database.</p>' +
      '<h3>The meter</h3><p>Start at 100 and subtract. The floor is 0. <strong>Fail</strong> if the score is under ' + P.passAt + '. <strong>Pass</strong> at ' + P.passAt + ' or more. The arrow lands on <strong>Avoid</strong> (0–44), <strong>Limit</strong> (' + P.passAt + '–' + (P.eatAt - 1) + '), or <strong>Eat as you like</strong> (' + P.eatAt + '–100). The word Pass or Fail is printed on the panel, so the color is not the only signal.</p>' +
      '<h3>What costs points</h3><table class="pts-table"><tbody>' +
        '<tr><td>Seed oil</td><td>−' + P.seedOil + '</td></tr>' +
        '<tr><td>Soy, artificial sweetener, gum, plant lecithin, natural flavor, or dye</td><td>−' + P.otherCategory + ' each</td></tr>' +
        '<tr><td>Confirmed GMO / possible GMO</td><td>−' + P.gmoConfirmed + ' / −' + P.gmoPossible + '</td></tr>' +
        '<tr><td>Other additives</td><td>−' + P.additiveEach + ' each, max −' + P.additiveCap + '</td></tr>' +
        '<tr><td>Added sugar, then high sugar if the list has sugar</td><td>−' + P.sugarBase + ', then −' + P.sugarHigh.extra + ' or −' + P.sugarVeryHigh.extra + '</td></tr>' +
        '<tr><td>NOVA 4 / NOVA 3</td><td>−' + P.nova[4] + ' / −' + P.nova[3] + '</td></tr>' +
        '<tr><td>Glyphosate-prone crop, conventional / non-GMO only</td><td>−' + P.glyphosate + ' / −' + P.glyphosateLimit + '</td></tr>' +
        '<tr><td>Refined starch</td><td>−' + P.refinedStarchEach + ' each, max −' + P.refinedStarchCap + '</td></tr>' +
        '<tr><td>Mainstream brand</td><td>−' + P.mainstream + '</td></tr>' +
        '<tr><td>Stacked flags, from ' + P.stackFrom + ' groups</td><td>−' + P.stackEach + ' per extra group, max −' + P.stackCap + '</td></tr>' +
      '</tbody></table>' +
      '<p>' + esc(s.mainstreamNote) + ' Organic clears a glyphosate-prone crop. Non-GMO without organic leaves the smaller ' + P.glyphosateLimit + ' point limit. Those certifications do not waive a seed oil, refined starch, or the mainstream penalty. Honey, maple syrup, and coconut sugar are not the added-sugar deduction.</p>' +
      '<h3>Household</h3><p>Fragrance, parfum, and perfume are a hard avoid (−' + P.householdFragrance + '). A named essential oil is not that umbrella. Harmful preservatives, optical brighteners, dyes, and flavors are red. Two or more red groups stack. Sodium benzoate, potassium sorbate, and phenoxyethanol are yellow limits.</p>' +
      '<h3>Brand labels</h3><p>' + esc(s.meterNote) + '</p>' +
      '<h3>Ingredient colors</h3><p>Green, yellow, and red follow Lizeth’s ingredient rules: Dirty Dozen ' + s.dirtyDozen.year + ', glyphosate-prone crops, dairy, eggs, meat, and sugars. Organic on a Dirty Dozen ingredient turns it green. A gum can be yellow and still cost points. The book writes a short Tortuga note for each ingredient. It is not a copied entry from another app.</p>' +
      '<p>Glyphosate crops follow public surveys, not a test of your box: <a href="' + s.glyphosate.sources[0].url + '" target="_blank" rel="noopener">CFIA</a>, <a href="' + s.glyphosate.sources[1].url + '" target="_blank" rel="noopener">EWG oats</a>, <a href="' + s.glyphosate.sources[2].url + '" target="_blank" rel="noopener">EPA</a>. Dirty Dozen: <a href="' + s.dirtyDozen.url + '" target="_blank" rel="noopener">' + esc(s.dirtyDozen.source) + '</a>.</p>';
    if (Places && Places.rulesSummary) {
      var placeRules = Places.rulesSummary();
      $('standardsBody').innerHTML += '<h3>Places, 0 to 10</h3><p>' + esc(placeRules.note) + '</p>' +
        '<p>The map is Tortuga’s catalog of Las Vegas and Henderson places on an OpenFreeMap basemap, which uses OpenStreetMap data. A place is Tortuga approved only at ' + placeRules.approvedAt + '.0 or higher, with at least ' + placeRules.minReportsForApproved + ' ratings that agree, and fat evidence that is not mixed or only a partial company claim. Reports stay on this phone until you copy the JSON. This is not a Seed Oil Scout map, score, or badge.</p>';
    }
  }

  function labsForProduct(p) {
    if (!p || !p.code) return [];
    var mine = {};
    R.barcodeCandidates(p.code).forEach(function (c) { mine[c] = 1; });
    return labTests.filter(function (t) {
      return t.barcode && R.barcodeCandidates(t.barcode).some(function (c) { return mine[c]; });
    });
  }
  function labCard(t) {
    var findings = (t.findings || []).map(function (f) {
      return '<li><span>' + esc(f.analyte) + '</span><span class="value">' + esc(f.value) + '</span>' +
        (f.note ? '<span class="why">' + esc(f.note) + '</span>' : '') + '</li>';
    }).join('');
    return '<article class="card lab-card" id="lab-' + esc(t.id) + '"><h3>' + esc(t.product) + '</h3><p class="scope">' + esc(t.scopeNote || '') + '</p><p>' + esc(t.summary) + '</p><ul class="findings">' + findings + '</ul>' +
      '<div class="links"><a class="btn btn-outline" href="' + esc(t.sourceUrl) + '" target="_blank" rel="noopener">' + esc(t.sourceName || 'Source') + '</a></div></article>';
  }
  function renderLabs() {
    $('labList').innerHTML = labTests.length ? labTests.map(labCard).join('') : '<div class="card"><p>Lab tests didn’t load.</p></div>';
  }
  function renderNews() {
    if (!newsReports.length) { $('newsList').innerHTML = '<div class="card"><p>News didn’t load.</p></div>'; return; }
    $('newsList').innerHTML = newsReports.map(function (report) {
      var items = (report.items || []).map(function (item) {
        return '<article class="card story"><p class="kicker-row"><span class="tag ' + esc(item.category || '') + '">' + esc(item.category || 'note') + '</span></p>' +
          '<h3>' + esc(item.headline) + '</h3><p>' + esc(item.summary) + '</p>' +
          '<div class="links"><a class="btn btn-outline" href="' + esc(item.sourceUrl) + '" target="_blank" rel="noopener">' + esc(item.sourceName || 'Source') + '</a></div></article>';
      }).join('');
      return '<article class="card intro slim"><h2>' + esc(report.title) + '</h2><p>' + esc(report.dek || '') + '</p></article>' + items;
    }).join('');
  }

  function showHome() {
    if (scanning) stopScan();
    currentTab = 'scan';
    showView('home');
    setTabCurrent('scan');
    writeUrl(tabPath('scan'), true);
    renderRecent();
  }
  function showTab(name, replace) {
    if (scanning) stopScan();
    if (name === 'household') {
      catalogFilter.kind = 'household';
      document.querySelectorAll('#catalogForm [data-kind]').forEach(function (c) { c.classList.toggle('on', c.dataset.kind === 'household'); });
      name = 'catalog';
      writeUrl(tabPath('household'), replace !== false);
    } else if (name === 'news' || name === 'labs' || name === 'about') {
      showView('more');
      currentTab = 'more';
      setTabCurrent('more');
      writeUrl(tabPath(name), replace !== false);
      renderNews();
      renderLabs();
      var anchor = document.getElementById(name === 'about' ? 'aboutAnchor' : name + 'Anchor');
      if (anchor) anchor.scrollIntoView({ block: 'start' });
      return;
    } else {
      writeUrl(tabPath(name), replace !== false);
    }
    if (name === 'scan' || name === 'home') return showHome();
    currentTab = name;
    showView(name === 'catalog' ? 'catalog' : name);
    setTabCurrent(name);
    if (name === 'catalog') renderCatalog();
    if (name === 'store') renderStore();
    if (name === 'book') { $('bookList').hidden = false; $('bookDetail').hidden = true; renderBook(); }
    if (name === 'more') { renderNews(); renderLabs(); }
    if (name === 'map') openMap();
  }
  function openCode(code, push) {
    if (push) writeUrl(productPath(code), false);
    lookup(code);
  }
  function applyLocation(replace) {
    var entry = '';
    try { entry = sessionStorage.getItem('tortuga.entry') || ''; } catch (e) {}
    if (entry) {
      try { sessionStorage.removeItem('tortuga.entry'); } catch (e2) {}
      writeUrl(baseDir().replace(/\/$/, '') + entry, true);
    }
    var route = R.parseRoute(location.pathname, location.search);
    if (route.place) {
      window.__tortugaData.then(function () {
        if (route.form === 'report') showReport(route.place, true);
        else if (route.form === 'menu') showMenu(route.place, true);
        else if (route.form === 'place-item' && route.item) showPlaceItem(route.place, route.item, true);
        else if (route.form === 'place-menu') showPlaceMenu(route.place, true);
        else showPlace(route.place, true);
      });
      return;
    }
    if (route.form === 'add-place') {
      window.__tortugaData.then(function () { showAddPlace(true); });
      return;
    }
    if (route.code) { openCode(route.code, false); return; }
    if (route.brand) { showBrand(route.brand, true); return; }
    if (route.ingredient) {
      var ready = window.__tortugaData || Promise.resolve();
      ready.then(function () { showIngredient(route.ingredient.replace(/-/g, ' ')); });
      return;
    }
    var tab = route.tab || (route.kind === 'store' ? 'store' : '');
    if (tab) showTab(tab, true);
    else showHome();
  }

  function indexCatalog(products) {
    catalog = products || [];
    catalogByCode = {};
    catalog.forEach(function (p) {
      catalogByCode[String(p.barcode)] = p;
      R.barcodeCandidates(p.barcode).forEach(function (c) { catalogByCode[c] = p; });
    });
  }
  function indexHousehold(products) {
    household = products || [];
    householdByCode = {};
    household.forEach(function (p) {
      householdByCode[String(p.barcode)] = p;
      R.barcodeCandidates(p.barcode).forEach(function (c) { householdByCode[c] = p; });
    });
    fillBrandSelect();
    renderWelcome();
    bookCache = null;
  }
  function loadJson(file) {
    return fetch(new URL(file, document.baseURI).href, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error(file + ' ' + res.status);
      return res.json();
    });
  }

  var sharedPlaces = [];
  var sharedReports = [];
  var mapFilter = { q: '', kind: '', city: '', score: '' };
  var map = null;
  var mapFitted = false;
  var dropMode = false;
  var placeSaveNotice = '';
  var dropMarker = null;
  var activePlaceId = '';
  var pendingReportPhoto = null;
  var pendingPlacePhoto = null;
  var pendingMenuPhoto = null;
  var KIND_COLOR = { restaurant: '#3B5323', cafe: '#8A5A32', grocer: '#5E7F3A', chocolatier: '#6B3E2E', shop: '#8A6A3B' };

  function loadLocalPlaces() { try { return JSON.parse(localStorage.getItem(PLACES_KEY)) || []; } catch (e) { return []; } }
  function writeLocalPlaces(list) {
    try {
      localStorage.setItem(PLACES_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }
  function loadReports() { try { return JSON.parse(localStorage.getItem(REPORTS_KEY)) || []; } catch (e) { return []; } }
  function writeReports(list) { try { localStorage.setItem(REPORTS_KEY, JSON.stringify(list)); } catch (e) {} }
  function loadMenuItems() { try { return JSON.parse(localStorage.getItem(MENU_KEY)) || []; } catch (e) { return []; } }
  function writeMenuItems(list) { try { localStorage.setItem(MENU_KEY, JSON.stringify(list)); } catch (e) {} }
  function savePhoneMenuItem(placeId, fields) {
    if (!placeId || !fields || !fields.name) return null;
    var id = fields.id || Places.slugItem(fields.name);
    var next = {
      id: id,
      placeId: placeId,
      name: String(fields.name).slice(0, 140),
      note: fields.note || '',
      ingredients: fields.ingredients || '',
      fats: fields.fats || '',
      origin: 'phone'
    };
    var list = loadMenuItems().filter(function (it) { return !(it.placeId === placeId && it.id === id); });
    list.push(next);
    writeMenuItems(list);
    return next;
  }
  function indexPlaces(file) {
    sharedPlaces = (file && file.places) || [];
    sharedReports = (file && file.reports) || [];
  }
  function allPlaces() {
    var byId = {};
    sharedPlaces.forEach(function (p) { byId[p.id] = Object.assign({ origin: 'catalog' }, p); });
    loadLocalPlaces().forEach(function (p) { byId[p.id] = Object.assign({ origin: 'phone' }, p); });
    return Object.keys(byId).map(function (id) { return byId[id]; });
  }
  function findPlace(id) {
    var list = allPlaces();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function reportsFor(id) {
    return sharedReports.filter(function (r) { return r && r.placeId === id; })
      .concat(loadReports().filter(function (r) { return r && r.placeId === id; }));
  }
  function gradedPlace(p) {
    return Places.gradePlace(p, reportsFor(p.id));
  }
  function filteredPlaces() {
    var q = mapFilter.q.trim().toLowerCase();
    return allPlaces().filter(function (p) {
      if (mapFilter.kind && p.kind !== mapFilter.kind) return false;
      if (mapFilter.city && p.city !== mapFilter.city) return false;
      if (q && (p.name + ' ' + (p.address || '') + ' ' + (p.city || '')).toLowerCase().indexOf(q) < 0) return false;
      if (mapFilter.score) {
        var g = gradedPlace(p);
        if (mapFilter.score === 'needs' && g.score != null) return false;
        if (mapFilter.score === 'scored' && g.score == null) return false;
        if (mapFilter.score === 'approved' && !g.approved) return false;
      }
      return true;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function placesGeo(list) {
    return {
      type: 'FeatureCollection',
      features: list.filter(function (p) { return typeof p.lat === 'number' && typeof p.lng === 'number'; }).map(function (p) {
        var g = gradedPlace(p);
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties: { id: p.id, name: p.name, kind: p.kind || 'shop', origin: p.origin || 'catalog', label: g.label }
        };
      })
    };
  }
  function tortyImg(alt) {
    var src = new URL('icons/torty-portrait.png', document.baseURI).href;
    return '<img src="' + esc(src) + '" alt="' + esc(alt) + '" width="280" height="200" decoding="async">';
  }
  function placeGauge(markerPct) {
    var marker = markerPct == null ? '' : '<span class="place-marker" style="left:' + markerPct + '%"></span>';
    return '<div class="place-gauge" aria-hidden="true"><div class="place-track"><span class="avoid"></span><span class="limit"></span><span class="eat"></span></div>' + marker + '</div>' +
      '<p class="place-scale" aria-hidden="true"><span>0</span><span>Avoid</span><span>Limit</span><span>Eat</span><span>10</span></p>';
  }
  function scoreBlock(p, g) {
    if (g.score == null) {
      return '<div class="place-meter unrated"><p class="place-unrated-badge">Unrated</p>' +
        placeGauge(null) +
        '<p class="place-unrated-prompt">No score yet. The scale stays empty until a report names what you ordered and which fats you saw.</p>' +
        '<button type="button" class="btn btn-secondary" data-act="report" data-place="' + esc(p.id) + '">Add the first report</button></div>';
    }
    var cls = g.approved ? 'eat' : (g.band ? g.band.id : '');
    var pos = Math.max(2, Math.min(98, Math.round(g.score * 10)));
    return '<div class="place-meter scored ' + esc(cls) + '">' + placeGauge(pos) +
      '<p class="place-num">' + esc(g.score) + '<span class="of"> / 10</span></p>' +
      '<p class="pills"><span class="pill ' + esc(cls) + '">' + esc(g.label) + '</span></p>' +
      '<p class="help">' + esc(g.headline) + '</p></div>';
  }
  function directionLinks(p) {
    var q = encodeURIComponent((p.name || '') + ', ' + (p.address || ''));
    return '<a class="btn btn-outline" href="https://maps.apple.com/?daddr=' + q + '" target="_blank" rel="noopener">Apple Maps</a>' +
      '<a class="btn btn-outline" href="https://www.google.com/maps/dir/?api=1&destination=' + q + '" target="_blank" rel="noopener">Google Maps</a>';
  }
  function listRows(items, empty) {
    if (!items.length) return '<p>' + esc(empty) + '</p>';
    return '<ul class="recent">' + items.map(function (item) {
      return '<li><span class="r-name">' + esc(item.name) + '</span><span class="why">' + esc(item.why || '') + '</span>' +
        (item.source ? ' <a href="' + esc(item.source) + '" target="_blank" rel="noopener">Source</a>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  function placePage(p) {
    var g = gradedPlace(p);
    var reports = reportsFor(p.id);
    var lists = Places.whatLists(p, reports);
    var known = (p.offerings || []).filter(function (o) { return o && !o.suggest; });
    var reportCards = reports.map(function (r) {
      var fats = Array.isArray(r.fats) ? r.fats.join(', ') : (r.fats || '');
      var extra = '';
      if (r.ingredients) {
        var line = Places.gradeMenuLine({ name: r.ordered || '', ingredients: r.ingredients });
        if (line.status === 'graded') extra = '<p class="help">Package read of the ingredients on this report: ' + line.score + ' · ' + esc(line.band && line.band.label) + '.</p>';
        else extra = '<p class="help">' + esc(line.summary) + '</p>';
      }
      return '<article class="card"><h3>' + esc(r.ordered || 'Report') + '</h3><p class="pills"><span class="pill">' + esc(r.rating) + ' / 10</span>' +
        (r.date ? '<span class="pill">' + esc(r.date) + '</span>' : '') + '</p>' +
        (fats ? '<p>Fats noted: ' + esc(fats) + '</p>' : '') +
        (r.notes ? '<p>' + esc(r.notes) + '</p>' : '') + extra +
        (String(r.id || '').indexOf('phone-') === 0 ? '<button type="button" class="btn btn-outline" data-act="remove-report" data-id="' + esc(r.id) + '">Remove from this phone</button>' : '') +
        '</article>';
    }).join('');
    var saved = '';
    if (placeSaveNotice) {
      saved = '<p class="notice" role="status">' + esc(placeSaveNotice) + '</p>';
      placeSaveNotice = '';
    }
    return saved + '<div class="card"><p class="back-row"><button type="button" class="btn btn-outline" data-tab="map">Map</button></p>' +
      '<p class="pills"><span class="pill">' + esc(p.kind || '') + '</span><span class="pill">' + esc(p.city || '') + '</span>' +
      (p.origin === 'phone' ? '<span class="pill">On this phone</span>' : '<span class="pill">Catalog</span>') + '</p>' +
      '<h2 id="placeTitle">' + esc(p.name) + '</h2>' +
      '<p>' + esc(p.address || '') + '</p>' +
      (p.phone ? '<p><a href="tel:' + esc(String(p.phone).replace(/[^\d+]/g, '')) + '">' + esc(p.phone) + '</a></p>' : '') +
      (p.website ? '<p><a href="' + esc(p.website) + '" target="_blank" rel="noopener">Official website</a></p>' : '') +
      scoreBlock(p, g) +
      '<div class="link-row">' + directionLinks(p) + '</div></div>' +
      '<div class="card torty-card torty-place">' + tortyImg('Torty, the tortoise') + '<div class="speech"><span class="who">Torty</span><p>' + esc(Places.tortyPlace(p, g)) + '</p></div></div>' +
      (g.conflicts && g.conflicts.length ? '<div class="notice"><strong>Reports disagree</strong><p>' + esc(g.conflicts.join(' ')) + '</p></div>' : '') +
      '<div class="card"><h2 class="small-title">What to get</h2>' + (lists.get.length ? listRows(lists.get, '') : '<p>Nothing is marked to get yet.</p>') +
      '<h2 class="small-title">What to skip</h2>' + (lists.skip.length ? listRows(lists.skip, '') : '<p>Nothing is marked to skip yet.</p>') +
      (lists.prompt ? '<p class="help">Snap a menu or send a report that names the dish and the fat you saw.</p>' : '') + '</div>' +
      (known.length ? '<div class="card"><h2 class="small-title">On the record</h2><p class="help">Named in a public source. Not a get or a skip, because the ingredients or the cooking fat are not established.</p>' + listRows(known.map(function (o) { return { name: o.name, why: o.note, source: o.sourceUrl }; }), '') + '</div>' : '') +
      '<div class="card"><p>' + esc(p.summary || '') + '</p>' +
      (p.hoursNote ? '<p class="help">' + esc(p.hoursNote) + '</p>' : '') +
      (p.coordinateNote ? '<p class="help">' + esc(p.coordinateNote) + '</p>' : '') +
      ((p.sourcedNotes || []).length ? '<h2 class="small-title">Sourced notes</h2>' + (p.sourcedNotes || []).map(function (n) {
        return '<p>' + esc(n.text || '') + (n.sourceUrl ? ' <a href="' + esc(n.sourceUrl) + '" target="_blank" rel="noopener">Source</a>' : '') + '</p>';
      }).join('') : '') +
      '<div class="link-row"><button type="button" class="btn btn-secondary" data-act="place-menu" data-place="' + esc(p.id) + '">Menu and products</button>' +
      '<button type="button" class="btn btn-outline" data-act="report" data-place="' + esc(p.id) + '">Submit a report</button>' +
      '<button type="button" class="btn btn-outline" data-act="menu" data-place="' + esc(p.id) + '">Snap a menu</button></div>' +
      (p.origin === 'phone' ? '<div class="link-row"><button type="button" class="btn btn-outline" data-act="remove-place" data-id="' + esc(p.id) + '">Remove this place from this phone</button></div>' : '') +
      '</div>' +
      '<div class="card" id="placePhoto" hidden></div>' +
      '<div class="card"><h2 class="small-title">Reports</h2>' + (reportCards || '<p>No reports yet. Yours stay on this phone and change the score here right away.</p>') + '</div>' +
      '<div class="card"><h2 class="small-title">Sources</h2><ul class="recent">' + (p.sources || []).map(function (s) {
        return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title || s.url) + '</a>' + (s.note ? '<span class="why">' + esc(s.note) + '</span>' : '') + '</li>';
      }).join('') + '</ul><p class="help"><button type="button" class="btn btn-outline" data-act="standards">How place scores work</button></p></div>';
  }
  function showPlace(id, replace) {
    if (scanning) stopScan();
    activePlaceId = id;
    var p = findPlace(id);
    showView('place');
    currentTab = 'map';
    setTabCurrent('place');
    writeUrl(placePath(id), replace !== false);
    if (!p) {
      views.place.innerHTML = '<div class="card"><h2 id="placeTitle">That place isn’t on this phone</h2><p><button type="button" class="btn btn-outline" data-tab="map">Back to the map</button></p></div>';
      return;
    }
    views.place.innerHTML = placePage(p);
    var frame = $('placePhoto');
    if (frame) {
      idbGet('place:' + p.id).then(function (blob) {
        if (!blob) { frame.hidden = true; return; }
        var url = URL.createObjectURL(blob);
        frame.hidden = false;
        frame.innerHTML = '<img src="' + url + '" alt="Photo saved on this phone">';
      });
    }
  }
  function orderButtons(place, itemName) {
    var choice = Places.orderChoices(place);
    var bits = [];
    if (choice.grok && itemName) {
      bits.push('<a class="btn btn-secondary" href="' + esc(grokHref(itemName)) + '">Buy with Grok Bot</a>');
    }
    if (choice.orderUrl) {
      bits.push('<a class="btn btn-outline" href="' + esc(choice.orderUrl) + '" target="_blank" rel="noopener">Order on their website</a>');
    }
    if (!bits.length) return '<p class="order-note">View only. There is no checkout here, and this place has no verified order page on file.</p>';
    var note = '<p class="order-note">';
    if (choice.grok) note += 'Buy with Grok Bot opens the Grok Bot app with this name. This page cannot check out. ';
    if (choice.orderUrl) note += 'Order on their website opens a page on the restaurant or shop’s own site.';
    note += '</p>';
    return '<div class="link-row">' + bits.join('') + '</div>' + note;
  }
  function showPlaceMenu(id, replace) {
    if (scanning) stopScan();
    activePlaceId = id;
    var p = findPlace(id);
    showView('placemenu');
    currentTab = 'map';
    setTabCurrent('placemenu');
    writeUrl(baseDir() + '?tab=map&form=place-menu&place=' + encodeURIComponent(id), replace !== false);
    if (!p || !views.placemenu) return;
    var items = Places.mergeMenu(p, loadMenuItems());
    var choice = Places.orderChoices(p);
    var list = items.length ? items.map(function (it) {
      var grade = Places.gradeMenuLine(it);
      var pill = grade.status === 'graded' ? (grade.score + ' · ' + (grade.band ? grade.band.label : '')) : 'Needs ingredients';
      return '<button type="button" class="cat-card" data-act="place-item" data-place="' + esc(p.id) + '" data-item="' + esc(it.id) + '">' +
        '<span class="thumb">' + (it.origin === 'phone' ? 'Phone' : 'Menu') + '</span>' +
        '<span><span class="name">' + esc(it.name) + '</span><span class="brand">' + (it.origin === 'phone' ? 'On this phone' : 'From a public source') + '</span>' +
        '<span class="pills"><span class="pill">' + esc(pill) + '</span></span></span></button>';
    }).join('') : '<p class="menu-empty">Nothing is listed yet. Snap a menu or send a report, and the items stay on this phone.</p>';
    views.placemenu.innerHTML = '<div class="card"><p class="back-row"><button type="button" class="btn btn-outline" data-act="place" data-place="' + esc(p.id) + '">Back to the place</button></p>' +
      '<h2 id="placeMenuTitle">' + esc(p.name) + '</h2><p class="help">Menu and products. A dish name is not graded until ingredients are known.</p>' +
      (choice.orderUrl ? '<div class="link-row"><a class="btn btn-outline" href="' + esc(choice.orderUrl) + '" target="_blank" rel="noopener">Order on their website</a></div><p class="order-note">That link is a page on their own site. This app does not check out.</p>' : '') +
      '</div><div class="catalog-list">' + list + '</div>' +
      '<div class="link-row"><button type="button" class="btn btn-secondary" data-act="menu" data-place="' + esc(p.id) + '">Snap a menu</button>' +
      '<button type="button" class="btn btn-outline" data-act="report" data-place="' + esc(p.id) + '">Submit a report</button></div>';
  }
  function showPlaceItem(placeId, itemId, replace) {
    if (scanning) stopScan();
    activePlaceId = placeId;
    var p = findPlace(placeId);
    showView('placeitem');
    currentTab = 'map';
    setTabCurrent('placeitem');
    writeUrl(baseDir() + '?tab=map&form=place-item&place=' + encodeURIComponent(placeId) + '&item=' + encodeURIComponent(itemId), replace !== false);
    if (!p || !views.placeitem) return;
    var item = Places.mergeMenu(p, loadMenuItems()).filter(function (it) { return it.id === itemId; })[0];
    if (!item) {
      views.placeitem.innerHTML = '<div class="card"><h2 id="placeItemTitle">That item isn’t on this menu</h2><p><button type="button" class="btn btn-outline" data-act="place-menu" data-place="' + esc(placeId) + '">Back to the menu</button></p></div>';
      return;
    }
    var grade = Places.gradeMenuLine(item);
    var gradeHtml = grade.status === 'graded'
      ? '<p class="place-num">' + grade.score + '<span class="of"> / 100</span></p><p class="pills"><span class="pill ' + esc(grade.band && grade.band.id) + '">' + esc(grade.band ? grade.band.label : '') + '</span><span class="pill">' + (grade.pass ? 'Pass' : 'Fail') + '</span></p><p>' + esc(grade.summary) + '</p>'
      : '<p class="place-unrated-badge">Needs ingredients</p><p>' + esc(grade.summary) + '</p>';
    var fats = Array.isArray(item.fats) ? item.fats.filter(Boolean).join(', ') : String(item.fats || '');
    views.placeitem.innerHTML = '<div class="card"><p class="back-row"><button type="button" class="btn btn-outline" data-act="place-menu" data-place="' + esc(p.id) + '">Menu</button></p>' +
      '<p class="pills"><span class="pill">' + (item.origin === 'phone' ? 'On this phone' : 'Public source') + '</span></p>' +
      '<h2 id="placeItemTitle">' + esc(item.name) + '</h2>' +
      (item.note ? '<p>' + esc(item.note) + '</p>' : '<p class="help">No description is on file. A dish name is not a description of the ingredients.</p>') +
      (item.ingredients ? '<h3 class="small-title">Ingredients</h3><p>' + esc(item.ingredients) + '</p>' : '<p class="help">Ingredients are not on file.</p>') +
      (fats ? '<p class="help">Fats named with this item: ' + esc(fats) + '</p>' : '') +
      (item.sourceUrl ? '<p><a href="' + esc(item.sourceUrl) + '" target="_blank" rel="noopener">Source</a></p>' : '') +
      gradeHtml + orderButtons(p, item.name) + '</div>' +
      '<div class="card torty-card torty-place">' + tortyImg('Torty, the tortoise') +
      '<div class="speech"><span class="who">Torty</span><p>' + esc(grade.status === 'graded'
        ? 'I can grade ' + item.name + ' only from the ingredients on file. The package score is ' + grade.score + ', ' + (grade.band ? grade.band.label : '') + '. That is not a place score, and it is not a Yelp or Seed Oil Scout score.'
        : 'I can’t grade ' + item.name + ' yet. I have the name, and I don’t have an ingredient list. I won’t guess the cooking fat from the name.') + '</p></div></div>';
  }
  function showReport(id, replace) {
    if (scanning) stopScan();
    activePlaceId = id;
    var p = findPlace(id);
    showView('report');
    currentTab = 'map';
    setTabCurrent('report');
    writeUrl(baseDir() + '?tab=map&form=report&place=' + encodeURIComponent(id), replace !== false);
    if ($('reportForm')) $('reportForm').dataset.place = id;
    if ($('reportPlaceName')) $('reportPlaceName').textContent = p ? p.name : 'This place';
    if ($('reportDate') && !$('reportDate').value) $('reportDate').value = todayISO();
    if ($('reportPhotoNote')) $('reportPhotoNote').textContent = pendingReportPhoto ? 'Photo ready. It stays on this phone.' : 'Optional. The photo stays on this phone. A picture of food does not show a hidden cooking oil.';
  }
  function showMenu(id, replace) {
    if (scanning) stopScan();
    activePlaceId = id;
    var p = findPlace(id);
    showView('menu');
    currentTab = 'map';
    setTabCurrent('menu');
    writeUrl(baseDir() + '?tab=map&form=menu&place=' + encodeURIComponent(id), replace !== false);
    if ($('menuPlaceName')) $('menuPlaceName').textContent = p ? p.name : '';
    if ($('menuForm')) $('menuForm').dataset.place = id;
  }
  function showAddPlace(replace) {
    if (scanning) stopScan();
    dropMode = false;
    showView('addplace');
    currentTab = 'map';
    setTabCurrent('addplace');
    writeUrl(baseDir() + '?tab=map&form=add-place', replace !== false);
  }
  function renderMapList() {
    var list = filteredPlaces();
    if ($('mapMeta')) $('mapMeta').textContent = list.length + ' places';
    if (!$('mapList')) return;
    $('mapList').innerHTML = list.map(function (p) {
      var g = gradedPlace(p);
      var pill = g.score == null ? 'Unrated' : (g.score + ' · ' + g.label);
      return '<button type="button" class="cat-card" data-act="place" data-place="' + esc(p.id) + '">' +
        '<span class="thumb"><span class="dot ' + esc(p.kind || 'shop') + (p.origin === 'phone' ? ' origin-phone' : '') + '"></span></span>' +
        '<span><span class="name">' + esc(p.name) + '</span><span class="brand">' + esc(p.city || '') + ' · ' + esc(p.kind || '') +
        (p.origin === 'phone' ? ' · On this phone' : '') + '</span>' +
        '<span class="pills"><span class="pill ' + esc(g.band ? g.band.id : '') + '">' + esc(pill) + '</span></span></span></button>';
    }).join('') || '<div class="card"><p>No places match.</p></div>';
  }
  function showPeek(id) {
    var p = findPlace(id);
    var box = $('mapPeek');
    if (!p || !box) return;
    var g = gradedPlace(p);
    box.hidden = false;
    box.innerHTML = '<h2 class="small-title">' + esc(p.name) + '</h2><p>' + esc(p.city || '') + ' · ' + esc(p.kind || '') +
      (p.origin === 'phone' ? ' · On this phone' : '') + '</p><p class="help">' + esc(g.score == null ? g.label : (g.score + ' / 10 · ' + g.label)) + '</p>' +
      '<button type="button" class="btn btn-secondary" data-act="place" data-place="' + esc(p.id) + '">Open</button>';
  }
  function loadMapLibre() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (!document.getElementById('maplibre-css')) {
      var link = document.createElement('link');
      link.id = 'maplibre-css';
      link.rel = 'stylesheet';
      link.href = new URL('vendor/maplibre-gl.css', document.baseURI).href;
      document.head.appendChild(link);
    }
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = new URL('vendor/maplibre-gl.js', document.baseURI).href;
      s.onload = function () { resolve(window.maplibregl); };
      s.onerror = function () { reject(new Error('map')); };
      document.head.appendChild(s);
    });
  }
  function addPlaceLayers() {
    if (map.getSource('places')) return;
    map.addSource('places', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterRadius: 46,
      clusterMaxZoom: 13
    });
    map.addLayer({
      id: 'places-cluster',
      type: 'circle',
      source: 'places',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#E7EBD4',
        'circle-stroke-color': '#3B5323',
        'circle-stroke-width': 2,
        'circle-radius': ['step', ['get', 'point_count'], 16, 8, 20, 16, 24]
      }
    });
    map.addLayer({
      id: 'places-count',
      type: 'symbol',
      source: 'places',
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 13 },
      paint: { 'text-color': '#243516' }
    });
    map.addLayer({
      id: 'places-point',
      type: 'circle',
      source: 'places',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': 8,
        'circle-color': ['match', ['get', 'kind'], 'restaurant', KIND_COLOR.restaurant, 'cafe', KIND_COLOR.cafe, 'grocer', KIND_COLOR.grocer, 'chocolatier', KIND_COLOR.chocolatier, 'shop', KIND_COLOR.shop, '#3B5323'],
        'circle-stroke-width': ['case', ['==', ['get', 'origin'], 'phone'], 4, 2],
        'circle-stroke-color': '#FCF5E3'
      }
    });
    map.addLayer({
      id: 'places-label',
      type: 'symbol',
      source: 'places',
      minzoom: 12,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-offset': [0, 1.15],
        'text-anchor': 'top',
        'text-max-width': 12
      },
      paint: { 'text-color': '#243516', 'text-halo-color': '#FCF5E3', 'text-halo-width': 1.4 }
    });
    map.on('click', function (e) {
      if (dropMode) {
        setDroppedPin(e.lngLat);
        return;
      }
      var cluster = map.queryRenderedFeatures(e.point, { layers: ['places-cluster'] });
      if (cluster.length) {
        var cid = cluster[0].properties.cluster_id;
        map.getSource('places').getClusterExpansionZoom(cid, function (err, zoom) {
          if (!err) map.easeTo({ center: cluster[0].geometry.coordinates, zoom: zoom });
        });
        return;
      }
      var hit = map.queryRenderedFeatures(e.point, { layers: ['places-point'] });
      if (hit.length) showPeek(hit[0].properties.id);
    });
    map.on('mouseenter', 'places-point', function () { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'places-point', function () { map.getCanvas().style.cursor = ''; });
  }
  function fitPlaces(list) {
    if (!map || !list.length) return;
    var bounds = new maplibregl.LngLatBounds();
    list.forEach(function (p) { if (typeof p.lng === 'number') bounds.extend([p.lng, p.lat]); });
    map.fitBounds(bounds, { padding: 42, maxZoom: 12, duration: 0 });
  }
  function syncMap() {
    renderMapList();
    if (!map || !map.getSource('places')) return;
    var list = filteredPlaces();
    map.getSource('places').setData(placesGeo(list));
    if (!mapFitted) {
      mapFitted = true;
      fitPlaces(list);
    }
  }
  function ensureMap() {
    var node = $('foodMap');
    if (!node) return Promise.resolve();
    return loadMapLibre().then(function (ml) {
      if (map) return map;
      map = new ml.Map({
        container: 'foodMap',
        style: new URL('data/map-style.json', document.baseURI).href,
        center: [-115.14, 36.08],
        zoom: 10.4,
        attributionControl: false,
        fadeDuration: 0
      });
      map.addControl(new ml.AttributionControl({ compact: false, customAttribution: 'Tortuga catalog' }), 'bottom-left');
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new ml.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
        showUserLocation: true
      }), 'top-right');
      map.on('load', function () {
        addPlaceLayers();
        syncMap();
      });
      return map;
    });
  }
  function openMap() {
    showView('map');
    currentTab = 'map';
    setTabCurrent('map');
    renderMapList();
    refreshExport();
    ensureMap().then(function () {
      syncMap();
      setTimeout(function () { if (map) map.resize(); }, 80);
    }).catch(function () {
      if ($('mapStatus')) $('mapStatus').textContent = 'The map couldn’t start in this browser. The list below is the same catalog.';
    });
  }
  function setDroppedPin(lngLat) {
    if ($('addPlaceLat')) $('addPlaceLat').value = Number(lngLat.lat).toFixed(6);
    if ($('addPlaceLng')) $('addPlaceLng').value = Number(lngLat.lng).toFixed(6);
    if (dropMarker) dropMarker.setLngLat(lngLat);
    else if (window.maplibregl) {
      dropMarker = new maplibregl.Marker({ color: '#3B5323' }).setLngLat(lngLat).addTo(map);
    }
    if ($('mapBanner')) {
      $('mapBanner').hidden = false;
      $('mapBanner').textContent = 'Pin set. ';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary';
      btn.dataset.act = 'use-pin';
      btn.textContent = 'Use this pin';
      $('mapBanner').appendChild(btn);
    }
  }
  function finishDropPin() {
    dropMode = false;
    if ($('mapBanner')) $('mapBanner').hidden = true;
    var lat = $('addPlaceLat') && $('addPlaceLat').value;
    var lng = $('addPlaceLng') && $('addPlaceLng').value;
    showAddPlace(false);
    setAddPlaceStatus(lat && lng ? ('Pin set at ' + lat + ', ' + lng + '. Tap Save place on this phone.') : 'Drop a pin on the map, then come back and save.');
  }
  function exportPayload() {
    return { kind: 'tortuga-places-export', version: 1, exported: new Date().toISOString(), places: loadLocalPlaces(), reports: loadReports(), menuItems: loadMenuItems() };
  }
  function refreshExport() {
    if ($('placeExport')) $('placeExport').value = JSON.stringify(exportPayload(), null, 2);
  }
  function exportPlaces() {
    var text = JSON.stringify(exportPayload(), null, 2);
    refreshExport();
    var done = function () { if ($('mapStatus')) $('mapStatus').textContent = 'Copied the places and reports from this phone.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(function () { done(); });
    else done();
  }
  function removeReport(id) {
    writeReports(loadReports().filter(function (r) { return r.id !== id; }));
    idbDelete('report:' + id);
    if (activePlaceId) showPlace(activePlaceId, true);
    syncMap();
  }
  function removeLocalPlace(id) {
    if (!window.confirm('Remove this place from this phone?')) return;
    writeLocalPlaces(loadLocalPlaces().filter(function (p) { return p.id !== id; }));
    writeReports(loadReports().filter(function (r) { return r.placeId !== id; }));
    writeMenuItems(loadMenuItems().filter(function (it) { return it.placeId !== id; }));
    idbDelete('place:' + id);
    openMap();
    writeUrl(tabPath('map'), false);
  }
  function placeIdFromName(name) {
    var slug = String(name || 'place').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'place';
    return 'phone-' + slug.slice(0, 36) + '-' + Date.now().toString(36);
  }
  function watchBlob(inputId, setter, noteId, readyText) {
    var input = $(inputId);
    if (!input) return;
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      fileToPhoto(file).then(function (blob) {
        setter(blob);
        if ($(noteId)) $(noteId).textContent = blob ? readyText : 'Optional. The photo stays on this phone.';
        if (inputId === 'menuCam' || inputId === 'menuFile') {
          var img = $('menuPreview');
          if (img && blob) {
            img.hidden = false;
            img.src = URL.createObjectURL(blob);
            img.alt = 'Menu photo on this phone';
          }
        }
      });
    });
  }

  if ($('scanBtn')) $('scanBtn').addEventListener('click', function () { startScan(); });
  if ($('stopScan')) $('stopScan').addEventListener('click', function () { stopScan().then(showHome); });
  $('manualForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var code = $('manualCode').value.replace(/\D/g, '');
    if (code.length < 6) { $('manualCode').focus(); return; }
    openCode(code, true);
  });
  $('pasteHomeForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var t = $('pasteHomeText').value.trim();
    if (!t) { $('pasteHomeText').focus(); return; }
    var name = $('pasteHomeName').value.trim();
    var brand = $('pasteHomeBrand').value.trim();
    var code = $('pasteHomeCode').value.replace(/\D/g, '');
    var ids = readCertIds($('pasteHomeForm'), 'homeCert');
    var merged = R.mergeCertifications('', [], ids, 'food');
    var product = { code: code, name: name || 'Label you pasted', brand: brand, ingredients: t, ingredientsLang: 'pasted', source: 'pasted', kind: 'food', labels: merged.labels, labelsTags: merged.labelsTags };
    if ($('pasteHomeSave').checked) product = fromMine(saveMine(storedFromForm('food', { code: code, name: product.name, brand: brand, ingredients: t }, ids)));
    renderMine();
    renderProduct(product);
  });
  document.querySelectorAll('#addProductForm input[name="addKind"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      var isHome = radio.value === 'household' && radio.checked;
      $('addFoodBlock').hidden = isHome;
      $('addHouseholdBlock').hidden = !isHome;
    });
  });
  function watchPhotoInput(id) {
    var input = $(id);
    if (!input) return;
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      fileToPhoto(file).then(function (blob) {
        pendingAddPhoto = blob;
        if ($('addPhotoNote')) $('addPhotoNote').textContent = blob ? 'Photo ready. It will be saved on this phone with the product.' : 'Optional. The photo stays on this phone.';
      });
    });
  }
  watchPhotoInput('addCam');
  watchPhotoInput('addFile');
  $('addProductForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var kind = ($('addProductForm').querySelector('input[name="addKind"]:checked') || {}).value || 'food';
    var name = $('addName').value.trim();
    var ingredients = $('addIngredients').value.trim();
    if (!name || !ingredients) return;
    var ids = readCertIds($('addProductForm'), kind === 'household' ? 'addClaim' : 'addCert');
    var stored = saveMine(storedFromForm(kind, {
      code: $('addCode').value, name: name, brand: $('addBrand').value.trim(),
      category: $('addCategory').value.trim(), ingredients: ingredients
    }, ids));
    var photo = pendingAddPhoto;
    pendingAddPhoto = null;
    var product = fromMine(stored);
    var done = photo ? idbPut(photoKey(product), photo) : Promise.resolve();
    done.then(function () { renderMine(); renderProduct(product); });
  });

  document.addEventListener('change', function (e) {
    var input = e.target.closest && e.target.closest('input.shot');
    if (!input || !input.files || !input.files[0]) return;
    var key = input.dataset.key;
    fileToPhoto(input.files[0]).then(function (blob) {
      return idbPut(key, blob);
    }).then(function () {
      if (lastProduct && photoKey(lastProduct) === key) attachPhoto(lastProduct, $('packFrame'));
    });
  });

  document.addEventListener('click', function (e) {
    var tabBtn = e.target.closest('[data-tab]');
    var b = e.target.closest('[data-act]');
    if (tabBtn) {
      if (tabBtn.tagName === 'A') e.preventDefault();
      showTab(tabBtn.dataset.tab, false);
      return;
    }
    if (!b) return;
    var act = b.dataset.act;
    if (act === 'retry-scan' || act === 'start-scan') startScan();
    else if (act === 'home') showHome();
    else if (act === 'back') { if (history.length > 1) history.back(); else showHome(); }
    else if (act === 'lookup') openCode(b.dataset.code, true);
    else if (act === 'standards') openStandards();
    else if (act === 'paste-blank') notFound(b.dataset.code);
    else if (act === 'open-mine') {
      var mine = loadMine().filter(function (p) { return p.id === b.dataset.id; })[0];
      if (mine) renderProduct(fromMine(mine));
    } else if (act === 'remove-mine') {
      if (b.dataset.id && window.confirm('Remove this product from this phone?')) removeMine(b.dataset.id);
    } else if (act === 'brand') {
      showBrand(b.dataset.brand, false);
    } else if (act === 'ingredient') {
      writeUrl(ingredientPath(R.brandSlug(b.dataset.name)), false);
      showIngredient(b.dataset.name, b.dataset.kind || 'food');
    }     else if (act === 'book-list') {
      writeUrl(tabPath('book'), false);
      $('bookList').hidden = false;
      $('bookDetail').hidden = true;
      renderBook();
    } else if (act === 'place') showPlace(b.dataset.place, false);
    else if (act === 'add-place') showAddPlace(false);
    else if (act === 'report') showReport(b.dataset.place, false);
    else if (act === 'menu') showMenu(b.dataset.place, false);
    else if (act === 'place-menu') showPlaceMenu(b.dataset.place || activePlaceId, false);
    else if (act === 'place-item') showPlaceItem(b.dataset.place || activePlaceId, b.dataset.item, false);
    else if (act === 'back-place') { if (activePlaceId) showPlace(activePlaceId, false); else openMap(); }
    else if (act === 'export-places') exportPlaces();
    else if (act === 'remove-report') removeReport(b.dataset.id);
    else if (act === 'remove-place') removeLocalPlace(b.dataset.id);
    else if (act === 'use-pin') finishDropPin();
  });

  if ($('mapQ')) $('mapQ').addEventListener('input', function () { mapFilter.q = $('mapQ').value; syncMap(); });
  if ($('mapForm')) $('mapForm').addEventListener('submit', function (e) { e.preventDefault(); });
  document.querySelectorAll('#mapForm [data-map-kind]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      mapFilter.kind = chip.dataset.mapKind;
      document.querySelectorAll('#mapForm [data-map-kind]').forEach(function (c) { c.classList.toggle('on', c === chip); });
      syncMap();
    });
  });
  document.querySelectorAll('#mapForm [data-map-city]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      mapFilter.city = chip.dataset.mapCity;
      document.querySelectorAll('#mapForm [data-map-city]').forEach(function (c) { c.classList.toggle('on', c === chip); });
      syncMap();
    });
  });
  document.querySelectorAll('#mapForm [data-map-score]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      mapFilter.score = chip.dataset.mapScore;
      document.querySelectorAll('#mapForm [data-map-score]').forEach(function (c) { c.classList.toggle('on', c === chip); });
      syncMap();
    });
  });
  if ($('reportForm')) $('reportForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var id = $('reportForm').dataset.place;
    var ordered = $('reportOrdered').value.trim();
    var rating = Number($('reportRating').value);
    if (!id || !ordered || rating !== rating || rating < 0 || rating > 10) return;
    var report = {
      id: 'phone-report-' + Date.now().toString(36),
      placeId: id,
      date: $('reportDate').value || todayISO(),
      ordered: ordered,
      fats: $('reportFats').value.trim(),
      ingredients: $('reportIngredients').value.trim(),
      rating: Math.round(rating * 10) / 10,
      notes: $('reportNotes').value.trim(),
      source: 'this-phone'
    };
    var list = loadReports();
    list.push(report);
    writeReports(list);
    if ($('reportAddMenu') && $('reportAddMenu').checked) {
      savePhoneMenuItem(id, { name: ordered, ingredients: report.ingredients, fats: report.fats, note: 'Added from a report on this phone.' });
    }
    var photo = pendingReportPhoto;
    pendingReportPhoto = null;
    var done = photo ? idbPut('report:' + report.id, photo) : Promise.resolve();
    done.then(function () { showPlace(id, false); syncMap(); });
  });
  watchBlob('reportCam', function (blob) { pendingReportPhoto = blob; }, 'reportPhotoNote', 'Photo ready. It stays on this phone.');
  watchBlob('reportFile', function (blob) { pendingReportPhoto = blob; }, 'reportPhotoNote', 'Photo ready. It stays on this phone.');
  function setAddPlaceStatus(message, field) {
    var el = $('addPlaceStatus');
    if (el) {
      el.textContent = message || '';
      el.hidden = !message;
    }
    if ($('addPlaceGeoNote') && message) $('addPlaceGeoNote').textContent = message;
    var target = field || el;
    if (target && target.focus) {
      try { target.focus(); } catch (e) {}
    }
    if (target && target.scrollIntoView) target.scrollIntoView({ block: 'center' });
  }
  function fillAddPlaceCoords(lat, lng, message) {
    $('addPlaceLat').value = Number(lat).toFixed(6);
    $('addPlaceLng').value = Number(lng).toFixed(6);
    setAddPlaceStatus(message);
  }
  if ($('useMyLocation')) $('useMyLocation').addEventListener('click', function () {
    if (!navigator.geolocation) {
      setAddPlaceStatus('This browser has no location. Type the address and save, or drop a pin.', $('useMyLocation'));
      return;
    }
    setAddPlaceStatus('Asking for where you are…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      fillAddPlaceCoords(pos.coords.latitude, pos.coords.longitude, 'Using where you are: ' + pos.coords.latitude.toFixed(5) + ', ' + pos.coords.longitude.toFixed(5) + '. Tap Save place on this phone.');
    }, function () {
      setAddPlaceStatus('Location stayed off. Type the address and save to look it up, or drop a pin.', $('addPlaceAddress'));
    }, { enableHighAccuracy: true, timeout: 8000 });
  });
  if ($('dropPin')) $('dropPin').addEventListener('click', function () {
    dropMode = true;
    openMap();
    writeUrl(baseDir() + '?tab=map&form=add-place', false);
    if ($('mapBanner')) {
      $('mapBanner').hidden = false;
      $('mapBanner').textContent = 'Tap the map to drop a pin.';
    }
    if (map) setTimeout(function () { map.resize(); }, 80);
  });
  function addPlaceField(name) {
    if (name === 'name') return $('addPlaceName');
    if (name === 'address') return $('addPlaceAddress');
    if (name === 'website') return $('addPlaceWeb');
    return $('addPlaceLat');
  }
  function geocodeAddress(address, city) {
    var q = Places.nominatimQuery(address, city);
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(q);
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (res) {
      if (!res.ok) throw new Error('geocode');
      return res.json();
    }).then(function (rows) { return Places.geocodeHit(rows); });
  }
  function storeNewPlace(draft, lat, lng, fromLookup) {
    var place = {
      id: placeIdFromName(draft.name),
      name: draft.name,
      kind: $('addPlaceKind').value,
      city: $('addPlaceCity').value,
      address: draft.address,
      lat: lat,
      lng: lng,
      website: draft.website,
      summary: $('addPlaceNotes').value.trim() || 'Added on this phone. Not in the shared catalog.',
      notes: $('addPlaceNotes').value.trim(),
      offerings: [],
      sourcedNotes: [],
      sources: [{
        title: 'Added on this phone',
        url: 'https://www.openstreetmap.org/copyright',
        note: fromLookup ? 'Coordinates from one OpenStreetMap Nominatim lookup of the address typed on this phone.' : 'Coordinates came from the pin or the location entered on this phone.',
        accessed: todayISO()
      }],
      origin: 'phone'
    };
    var stored = false;
    try {
      var list = loadLocalPlaces().filter(function (p) { return p.id !== place.id; });
      list.push(place);
      stored = writeLocalPlaces(list);
    } catch (err) {
      stored = false;
    }
    if (!stored) {
      setAddPlaceStatus('Could not save on this phone. Storage may be full, or private mode is blocking it.', $('addPlaceStatus'));
      return;
    }
    var photo = pendingPlacePhoto;
    pendingPlacePhoto = null;
    var photoFailed = false;
    var done = photo ? idbPut('place:' + place.id, photo).catch(function () { photoFailed = true; }) : Promise.resolve();
    done.then(function () {
      placeSaveNotice = photoFailed ? 'Saved on this phone. The photo could not be stored.' : 'Saved on this phone.';
      showPlace(place.id, false);
    });
  }
  if ($('addPlaceForm')) $('addPlaceForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var draft = Places.preparePlaceDraft({
      name: $('addPlaceName').value,
      address: $('addPlaceAddress').value,
      website: $('addPlaceWeb').value,
      lat: $('addPlaceLat').value,
      lng: $('addPlaceLng').value,
      city: $('addPlaceCity').value
    });
    if (!draft.ok) {
      setAddPlaceStatus(draft.message, addPlaceField(draft.field));
      return;
    }
    if (draft.website) $('addPlaceWeb').value = draft.website;
    if (!draft.needsGeocode) {
      storeNewPlace(draft, draft.lat, draft.lng, false);
      return;
    }
    setAddPlaceStatus('Looking up that address once on OpenStreetMap…', $('addPlaceStatus'));
    geocodeAddress(draft.address, draft.city).then(function (hit) {
      if (!hit) {
        setAddPlaceStatus('OpenStreetMap did not find that address. Tap Use where I am or Drop a pin, then save again.', $('addPlaceAddress'));
        return;
      }
      $('addPlaceLat').value = hit.lat;
      $('addPlaceLng').value = hit.lng;
      storeNewPlace(draft, hit.lat, hit.lng, true);
    }).catch(function () {
      setAddPlaceStatus('The address lookup did not answer. Tap Use where I am or Drop a pin, then save again.', $('addPlaceStatus'));
    });
  });
  watchBlob('addPlaceCam', function (blob) { pendingPlacePhoto = blob; }, 'addPlacePhotoNote', 'Photo ready. It stays on this phone.');
  watchBlob('addPlaceFile', function (blob) { pendingPlacePhoto = blob; }, 'addPlacePhotoNote', 'Photo ready. It stays on this phone.');
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.onload = function () { resolve(window.Tesseract); };
      s.onerror = function () { reject(new Error('ocr')); };
      document.head.appendChild(s);
    });
  }
  if ($('readMenu')) $('readMenu').addEventListener('click', function () {
    var status = $('menuOcr');
    if (!pendingMenuPhoto) { if (status) status.textContent = 'Choose a photo first, or type the lines.'; return; }
    if (status) status.textContent = 'Loading the reader…';
    loadTesseract().then(function (T) {
      return T.recognize(pendingMenuPhoto, 'eng', {
        logger: function (m) {
          if (!status || !m) return;
          var pct = m.progress ? ' ' + Math.round(m.progress * 100) + '%' : '';
          status.textContent = (m.status || 'Reading') + pct;
        }
      });
    }).then(function (res) {
      var text = (res && res.data && res.data.text || '').trim();
      if ($('menuLines')) $('menuLines').value = text;
      if (status) status.textContent = text ? 'Check the lines and fix anything wrong, then grade.' : 'No words came back. Type the lines.';
    }).catch(function () {
      if (status) status.textContent = 'The reader didn’t load. Type the lines instead.';
    });
  });
  watchBlob('menuCam', function (blob) { pendingMenuPhoto = blob; }, 'menuOcr', 'Photo ready. Read it, or type the lines.');
  watchBlob('menuFile', function (blob) { pendingMenuPhoto = blob; }, 'menuOcr', 'Photo ready. Read it, or type the lines.');
  function renderMenuDraft(lines) {
    $('menuItems').innerHTML = lines.map(function (line, i) {
      return '<article class="card menu-line"><h3>' + esc(line) + '</h3>' +
        '<label class="label" for="ing-' + i + '">Ingredients you know</label>' +
        '<textarea id="ing-' + i + '" class="menu-ing" data-name="' + esc(line) + '" rows="2" placeholder="Leave this blank if you only have the dish name."></textarea>' +
        '<p class="menu-result help" id="ing-result-' + i + '">Not graded yet.</p></article>';
    }).join('') + '<div class="link-row"><button type="button" class="btn btn-secondary" id="gradeMenuIngredients">Grade with these ingredients</button>' +
      '<button type="button" class="btn btn-outline" id="menuToReport">Put this in a report</button>' +
      '<button type="button" class="btn btn-outline" id="menuSaveItems">Save on this phone’s menu</button></div>';
    $('gradeMenuIngredients').addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.menu-ing'), function (box, i) {
        var result = Places.gradeMenuLine({ name: box.getAttribute('data-name'), ingredients: box.value });
        var el = $('ing-result-' + i);
        if (!el) return;
        if (result.status !== 'graded') el.textContent = result.summary;
        else el.textContent = result.summary + ' Score ' + result.score + ' · ' + (result.band ? result.band.label : '') + (result.pass ? ' · Pass.' : ' · Fail.');
      });
    });
    $('menuToReport').addEventListener('click', function () {
      var bits = [];
      Array.prototype.forEach.call(document.querySelectorAll('.menu-ing'), function (box) {
        var result = Places.gradeMenuLine({ name: box.getAttribute('data-name'), ingredients: box.value });
        bits.push(result.name + (result.status === 'graded' ? ' — package score ' + result.score : ' — needs ingredients'));
      });
      pendingReportPhoto = pendingMenuPhoto;
      showReport(activePlaceId, false);
      if ($('reportNotes')) $('reportNotes').value = bits.join('\n');
      if ($('reportOrdered') && bits[0]) $('reportOrdered').value = (document.querySelector('.menu-ing').getAttribute('data-name') || '').slice(0, 80);
    });
    $('menuSaveItems').addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.menu-ing'), function (box) {
        savePhoneMenuItem(activePlaceId, {
          name: box.getAttribute('data-name'),
          ingredients: box.value.trim(),
          note: 'Added from a menu photo on this phone.'
        });
      });
      if ($('menuOcr')) $('menuOcr').textContent = 'Saved on this phone’s menu for this place. Nothing was uploaded.';
      showPlaceMenu(activePlaceId, false);
    });
  }
  if ($('menuForm')) $('menuForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var lines = $('menuLines').value.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!lines.length) { $('menuLines').focus(); return; }
    renderMenuDraft(lines);
  });
  if ($('placeImportForm')) $('placeImportForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var note = $('placeImportNote');
    var data;
    try { data = JSON.parse($('placeImportText').value); } catch (err) { if (note) note.textContent = 'That was not JSON.'; return; }
    var placesIn = data.places || [];
    var reportsIn = data.reports || [];
    var menuIn = data.menuItems || [];
    if (!Array.isArray(placesIn) || !Array.isArray(reportsIn) || !Array.isArray(menuIn)) { if (note) note.textContent = 'Need places and reports arrays.'; return; }
    function merge(current, incoming) {
      var byId = {};
      current.forEach(function (x) { if (x && x.id) byId[x.id] = x; });
      incoming.forEach(function (x) { if (x && x.id) byId[x.id] = x; });
      return Object.keys(byId).map(function (k) { return byId[k]; });
    }
    writeLocalPlaces(merge(loadLocalPlaces(), placesIn));
    writeReports(merge(loadReports(), reportsIn));
    writeMenuItems(merge(loadMenuItems(), menuIn));
    if (note) note.textContent = 'Saved on this phone. Nothing was uploaded.';
    refreshExport();
    syncMap();
  });
  refreshExport();

  $('catalogQ').addEventListener('input', function () { catalogFilter.q = $('catalogQ').value; renderCatalog(); });
  $('catalogForm').addEventListener('submit', function (e) { e.preventDefault(); });
  document.querySelectorAll('#catalogForm [data-kind]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      catalogFilter.kind = chip.dataset.kind;
      document.querySelectorAll('#catalogForm [data-kind]').forEach(function (c) { c.classList.toggle('on', c === chip); });
      renderCatalog();
    });
  });
  document.querySelectorAll('#catalogForm [data-band]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      catalogFilter.band = chip.dataset.band;
      document.querySelectorAll('#catalogForm [data-band]').forEach(function (c) { c.classList.toggle('on', c === chip); });
      renderCatalog();
    });
  });
  $('catalogBrand').addEventListener('change', function () { catalogFilter.brand = $('catalogBrand').value; renderCatalog(); });
  $('storeQ').addEventListener('input', function () { storeFilter.q = $('storeQ').value; renderStore(); });
  $('storeForm').addEventListener('submit', function (e) { e.preventDefault(); });
  document.querySelectorAll('#storeForm [data-store-kind]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      storeFilter.kind = chip.dataset.storeKind;
      document.querySelectorAll('#storeForm [data-store-kind]').forEach(function (c) { c.classList.toggle('on', c === chip); });
      renderStore();
    });
  });
  $('bookQ').addEventListener('input', function () { bookFilter.q = $('bookQ').value; renderBook(); });
  $('bookForm').addEventListener('submit', function (e) { e.preventDefault(); });
  document.querySelectorAll('#bookForm [data-color]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      bookFilter.color = chip.dataset.color;
      document.querySelectorAll('#bookForm [data-color]').forEach(function (c) { c.classList.toggle('on', c === chip); });
      renderBook();
    });
  });

  var dlg = $('standards');
  function openStandards() {
    renderStandards();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }
  mountCertPickers();
  $('openStandards').addEventListener('click', openStandards);
  $('closeStandards').addEventListener('click', function () { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg && dlg.close) dlg.close(); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && scanning) stopScan().then(showHome);
  });
  window.addEventListener('popstate', function () { applyLocation(true); });

  renderRecent();
  window.__tortugaData = Promise.all([
    loadJson('data/catalog.json').catch(function () { return { products: [] }; }),
    loadJson('data/lab-tests.json').catch(function () { return { tests: [] }; }),
    loadJson('data/news.json').catch(function () { return { reports: [] }; }),
    loadJson('data/household.json').catch(function () { return { products: [] }; }),
    loadJson('data/websites.json').catch(function () { return { sites: {} }; }),
    loadJson('data/places.json').catch(function () { return { places: [], reports: [] }; })
  ]).then(function (all) {
    indexCatalog((all[0] && all[0].products) || []);
    labTests = (all[1] && all[1].tests) || [];
    newsReports = (all[2] && all[2].reports) || [];
    websites = (all[4] && all[4].sites) || {};
    indexHousehold((all[3] && all[3].products) || []);
    indexPlaces(all[5] || {});
  });
  window.__tortugaData.then(function () { applyLocation(true); });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
