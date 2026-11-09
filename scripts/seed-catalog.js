#!/usr/bin/env node
/**
 * Build data/catalog.json from live Open Food Facts products.
 * Needs a network. Overwrites data/catalog.json.
 * Run: node scripts/seed-catalog.js
 *
 * Grades are computed with rules.js. Re-run this only when you want a fresh
 * seed; day-to-day product adds can be hand-edited (see README).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const R = require('../rules.js');

const UA = 'TortugaScan/0.2 (personal clean-eating scanner; catalog seed)';
const ADDED = '2026-11-09';
const SEARCH = 'https://search.openfoodfacts.org/search';
const PRODUCT = 'https://world.openfoodfacts.org/api/v2/product/';
const FIELDS = ['code', 'product_name', 'product_name_en', 'brands', 'image_front_url', 'image_front_small_url',
  'ingredients_text', 'ingredients_text_en', 'nova_group', 'nutriments', 'labels', 'labels_tags', 'quantity'].join(',');

const REQUIRED = ['041570054161', '0016000275287', '3017624010701', '049000006346'];
const PINNED = REQUIRED.concat(['0041570054161', '016000275287', '0049000006346', '0688474302754']);

const BRANDS = [
  'siete', 'chosen foods', 'primal kitchen', 'simple mills', 'hu', 'rxbar', 'larabar', "justin's",
  'siggi', 'chobani', 'organic valley', 'applegate', 'lundberg', "bob's red mill", 'califia', 'oatly',
  'silk', 'kerrygold', "amy's", "annie's", "nature's path", 'late july', "dave's killer bread",
  'food for life', 'banza', "rao's", 'muir glen', 'bragg', 'nutiva', 'california olive ranch',
  'wild planet', 'lesserevil', 'purely elizabeth', 'magic spoon', 'olipop', 'spindrift', 'zevia',
  'stonyfield', 'fage', 'horizon organic', "mary's gone crackers", "lily's", 'alter eco', 'ghirardelli',
  'vital farms', 'kettle & fire', 'once upon a farm', 'serenity kids', 'elmhurst', 'malk', 'ripple',
  'enjoy life', 'kind', 'clif', 'chomps', 'epic', 'safe catch', 'bonne maman', 'jovial',
  '365 whole foods', "trader joe's", 'simple truth', 'good & gather', 'cheerios', "kellogg's",
  'general mills', 'quaker', 'oreo', "lay's", 'doritos', 'tostitos', 'fritos', 'cheetos', 'pringles',
  'ritz', "hershey's", "reese's", 'heinz', "hellmann's", 'hidden valley', 'coca-cola', 'pepsi',
  'gatorade', 'barilla', "campbell's", 'progresso', 'jif', 'skippy', "smucker's", 'yoplait', 'dannon',
  "land o lakes", 'philadelphia', 'oscar mayer', 'johnsonville', "ben & jerry's", 'haagen-dazs',
  'mission', 'pepperidge farm', "nature's own", 'pillsbury', 'betty crocker', 'crisco', 'mazola',
  'splenda', 'coffee-mate', 'lactaid', 'fairlife', 'tropicana', "ocean spray", "mott's", 'la croix',
  'monster', 'celsius', 'vlasic', 'tabasco', "frank's redhot", 'huy fong', 'kikkoman', 'mccormick',
  'swanson', 'green giant', "birds eye", 'starkist', 'chicken of the sea', 'bumble bee', 'nutella',
  'pop-tarts', 'eggo', 'special k', 'lucky charms', 'froot loops', 'cinnamon toast crunch',
  'honey bunches of oats', 'kashi', 'nature valley', 'goldfish', 'cheez-it', 'wheat thins', 'triscuit',
  "m&m's", 'skittles', 'snickers', 'diGiorno', 'hot pockets', 'lean cuisine', 'sabra', 'tillamook',
  'sargento', "eggland's best", 'country crock', 'pearl milling', 'log cabin', "newman's own",
  'old el paso', 'maruchan', 'spam', 'gerber', 'capri sun', 'minute maid', 'lipton', 'bodyarmor',
  'premier protein', 'almond breeze', 'blue diamond', 'so delicious', 'planet oat', 'thai kitchen',
  'great value', 'kirkland', 'cascadian farm', 'applegate', 'horizon', 'chobani', 'fage',
  'rxbar', 'kind', 'clif bar', 'larabar', 'annies', 'amys', 'siete family foods', 'chosen foods',
  'primal kitchen', 'simple mills', 'hu kitchen', 'eat hu', 'lesser evil', "mary's gone crackers",
  'dave’s killer bread', 'food for life', 'ezekiel', 'lundberg family farms', 'bobs red mill',
  'califia farms', 'oatly', 'silk', 'kerrygold', 'organic valley', 'stonyfield', 'maple hill',
  'siggis', 'icelandic provisions', 'noosa', 'wallaby', 'ratio', 'two good', 'oikos',
  'applegate', 'aidells', 'bilinski', 'niman ranch', 'pederson', 'vital farms', 'pete and gerrys',
  'once again', 'santa cruz organic', "justin’s", 'barney butter', 'spread the love',
  'nutiva', 'spectrum', 'chosen foods', 'primal kitchen', 'marianne', 'calpure',
  'bragg', 'coconut secret', 'san-j', 'kikkoman', 'lee kum kee',
  'pacific foods', 'imagine', 'kettle and fire', 'bonafide provisions', 'swanson',
  'rao', 'victoria', 'michaels of brooklyn', 'classico', 'prego', 'ragu',
  'muir glen', 'cent', 'bianco dinapoli', 'jovial', 'bionaturae', 'de cecco', 'ronzoni', 'barilla',
  'banza', 'explore cuisine', 'toleran', 'chickapea',
  'late july', 'siete', 'cape cod', 'boulder canyon', "jackson's", 'kettle brand', "cape cod",
  'popchips', 'skinny pop', 'lesser evil', 'boom chicka pop', "orville redenbacher",
  'simple mills', 'marys gone crackers', 'hu', 'partake', 'made good', "that's it", 'solely',
  'gomacro', 'perfect bar', 'aloha', 'rise bar', 'rxbar', 'larabar',
  'olipop', 'poppi', 'spindrift', 'zevia', 'hint', 'liquid death', 'lacroix', 'bubly',
  'health-ade', 'gts', 'kombucha', 'brew dr',
  'wild planet', 'safe catch', 'crown prince', 'king oscar', 'season brand',
  'gerber', 'serenity kids', 'once upon a farm', 'happy family', 'plum organics',
  'taza', 'endangered species', 'alter eco', 'unreal', 'lilys', 'ghirardelli', 'lindt', 'dove',
  'haagen dazs', 'ben jerry', 'so delicious', 'cocojune', 'siggi',
  'tillamook', 'cabot', 'kerrygold', 'organic valley', 'rumiano',
  'fairlife', 'horizon', 'organic valley', 'a2', 'lactaid', 'ripple', 'malk', 'elmhurst', 'three trees',
  'almond breeze', 'blue diamond', 'califia', 'silk', 'planet oat', 'oatly', 'chobani',
  'native forest', 'thai kitchen', 'aroy-d', '365',
  'bushs', "bush's", 'eden', 'goya', 'amy',
  'heinz', 'primal kitchen', 'sir kensington', 'dukes', 'best foods', 'hellmanns',
  'frenchs', 'grey poupon', 'annies',
  'franks', 'cholula', 'tabasco', 'texas pete',
  'hidden valley', 'wish-bone', 'kens steak house', 'newmans own', 'briannas',
  'motts', 'santa cruz', 'rw knudsen', 'lakewood',
  'quaker', 'bobs red mill', 'purely elizabeth', 'bear naked', 'nature valley', 'kind',
  'cheerios', 'kashi', 'cascadian farm', 'barbaras', 'natures path', 'magic spoon', 'three wishes',
  'eggo', 'kodiak', 'pearl milling', 'log cabin', 'aunt jemima',
  'oreo', 'chips ahoy', 'tates', 'simple mills', 'partake',
  'jif', 'skippy', 'justins', 'santa cruz',
  'nutella', 'ferrero',
  'coca cola', 'pepsi', 'sprite', 'dr pepper', 'mountain dew', 'fanta',
  'gatorade', 'powerade', 'bodyarmor', 'vitaminwater',
  'yoplait', 'dannon', 'activia', 'chobani', 'fage', 'stonyfield',
  'kraft', 'velveeta', 'annies', 'horizon',
  'oscar mayer', 'hebrew national', 'ball park', 'applegate',
  'diGiorno', 'totinos', 'amy', 'caulipower',
  'campbells', 'progresso', 'amys', 'pacific',
  'barilla', 'ronzoni', 'de cecco', 'banza',
  'mission', 'guerrero', 'siete', 'la tortilla factory',
  'pepperidge farm', 'daves killer bread', 'natures own', 'sara lee', 'oroweat', 'thomas', 'arnold',
  'minute rice', 'bens original', 'success', 'lundberg',
  'pillsbury', 'betty crocker', 'duncan hines', 'king arthur', 'gold medal',
  'crisco', 'wesson', 'mazola', 'pam',
  'land o lakes', 'challenge', 'kerrygold', 'plugra',
  'splenda', 'truvia', 'equal', 'sweet n low', 'stevia in the raw',
  'mccormick', 'simply organic', 'frontier', 'spice hunter',
  'gerber', 'beech nut'
];

const PHRASES = [
  'avocado oil', 'olive oil', 'coconut oil', 'ghee', 'almond butter', 'peanut butter',
  'almond milk', 'oat milk', 'greek yogurt', 'cottage cheese', 'bone broth', 'kombucha',
  'sourdough bread', 'potato chips', 'tortilla chips', 'granola', 'protein bar',
  'pasta sauce', 'black beans', 'canned tuna', 'maple syrup', 'dark chocolate',
  'sparkling water', 'applesauce', 'frozen pizza', 'macaroni and cheese', 'salsa', 'hummus',
  'chicken broth', 'baby food', 'cheddar cheese', 'bacon'
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getJson(url, tries) {
  tries = tries || 0;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  } catch (e) {
    if (tries < 5) { await sleep(600 * (tries + 1)); return getJson(url, tries + 1); }
    throw e;
  }
  if ((res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503) && tries < 2) {
    await sleep(500 * (tries + 1));
    return getJson(url, tries + 1);
  }
  if (!res.ok) throw new Error(res.status + ' ' + url.slice(0, 160));
  return res.json();
}

async function searchCodes(q, size) {
  const url = SEARCH + '?page_size=' + size + '&q=' + encodeURIComponent(q);
  try {
    const data = await getJson(url);
    return (data.hits || []).map(h => String(h.code || '')).filter(Boolean);
  } catch (e) {
    console.warn('  search failed:', e.message);
    return [];
  }
}

function looksEnglish(t) {
  const s = t.toLowerCase();
  const words = ['water', 'salt', 'sugar', 'oil', 'flour', 'milk', 'organic', 'wheat', 'rice', 'corn', 'soy',
    'starch', 'natural', 'acid', 'vitamin', 'juice', 'powder', 'extract', 'syrup', 'butter', 'cream', 'cheese',
    'yeast', 'spice', 'garlic', 'onion', 'pepper', 'vinegar', 'seed', 'bean', 'protein', 'cocoa', 'chocolate',
    'almond', 'oat', 'honey', 'cane', 'coconut', 'olive', 'citric', 'sodium', 'flavor', 'flavour', 'lecithin',
    'gum', 'sauce', 'tomato', 'chicken', 'beef', 'egg', 'peanut', 'sesame', 'sunflower', 'vegetable', 'enriched',
    'contains', 'cultured', 'sea', 'paste', 'nuts', 'fruit', 'apple', 'vanilla', 'cocoa', 'cacao', 'starch'];
  let n = 0;
  for (const w of words) if (s.includes(w)) n++;
  return n >= 2;
}

function round3(n) {
  const x = typeof n === 'string' ? parseFloat(n) : n;
  if (typeof x !== 'number' || !isFinite(x)) return null;
  return Math.round(x * 1000) / 1000;
}

function nutriments(n) {
  n = n || {};
  const pick = {
    energyKcal100g: n['energy-kcal_100g'],
    fat100g: n.fat_100g,
    saturatedFat100g: n['saturated-fat_100g'],
    carbohydrates100g: n.carbohydrates_100g,
    sugars100g: n.sugars_100g,
    fiber100g: n.fiber_100g,
    proteins100g: n.proteins_100g,
    salt100g: n.salt_100g,
    sodium100g: n.sodium_100g
  };
  const out = {};
  Object.keys(pick).forEach(k => {
    const v = round3(pick[k]);
    if (v !== null) out[k] = v;
  });
  return out;
}

function humanLabels(p) {
  if (p.labels && String(p.labels).trim()) return String(p.labels).trim().slice(0, 400);
  return (p.labels_tags || []).map(t => String(t).replace(/^[a-z]{2}:/, '').replace(/-/g, ' ')).slice(0, 12).join(', ');
}

function codeKey(code) {
  return String(code || '').replace(/\D/g, '').replace(/^0+/, '');
}

function pickIngredients(p) {
  const en = (p.ingredients_text_en || '').trim();
  const main = (p.ingredients_text || '').trim();
  if (en.length >= 20) return { text: en, lang: 'en' };
  if (main.length >= 20 && looksEnglish(main)) return { text: main, lang: 'en' };
  return null;
}

function toEntry(p) {
  const ing = pickIngredients(p);
  if (!ing) return null;
  const mainName = ((p.product_name || '') + '').trim();
  const enName = ((p.product_name_en || '') + '').trim();
  // Prefer the original name. The English field is sometimes a bad edit
  // (Cheerios was "My Bff") while product_name is the real label.
  const name = (looksEnglish(enName) && !looksEnglish(mainName) ? enName : (mainName || enName));
  if (name.length < 2) return null;
  if (/\b(dog food|cat food|pet food|shampoo|conditioner|laundry|detergent)\b/i.test(name + ' ' + ing.text)) return null;
  const barcode = String(p.code || '').replace(/\D/g, '');
  if (barcode.length < 8 || barcode.length > 14) return null;
  const brand = ((p.brands || '').split(',')[0] || '').trim();
  const nova = Number(p.nova_group);
  const nuts = nutriments(p.nutriments);
  const gradeInput = {
    novaGroup: nova >= 1 && nova <= 4 ? nova : null,
    sugars100g: nuts.sugars100g != null ? nuts.sugars100g : null,
    productName: name,
    labels: humanLabels(p),
    labelsTags: p.labels_tags || []
  };
  const g = R.grade(ing.text, gradeInput);
  const entry = {
    barcode: barcode,
    name: name,
    brand: brand,
    image: p.image_front_small_url || p.image_front_url || null,
    ingredients: ing.text.slice(0, 5000),
    ingredientsLang: ing.lang,
    labels: humanLabels(p),
    labelsTags: (p.labels_tags || []).slice(0, 24),
    nova: nova >= 1 && nova <= 4 ? nova : null,
    nutriments: nuts,
    offUrl: 'https://world.openfoodfacts.org/product/' + barcode,
    added: ADDED,
    grade: {
      sosPass: g.sos.pass,
      gmoStatus: g.gmo.status,
      gmoLabel: g.gmo.label,
      score: g.score,
      band: g.band.id,
      bandLabel: g.band.label
    }
  };
  if (p.quantity) entry.quantity = String(p.quantity).slice(0, 80);
  return entry;
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return out;
}

async function main() {
  const codes = [];
  const seen = new Set();
  function addCodes(list) {
    for (const c of list) {
      const digits = String(c).replace(/\D/g, '');
      const key = codeKey(digits);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      codes.push(digits);
    }
  }
  addCodes(PINNED);

  const brandList = [
    'siete', 'chosen foods', 'primal kitchen', 'simple mills', 'rxbar', 'larabar', 'chobani',
    'organic valley', 'applegate', 'lundberg', 'califia farms', 'oatly', 'silk', 'kerrygold',
    'amy\'s', 'annie\'s', 'nature\'s path', 'late july', 'food for life', 'banza', 'muir glen',
    'bragg', 'nutiva', 'wild planet', 'olipop', 'spindrift', 'zevia', 'stonyfield', 'fage',
    'ghirardelli', 'vital farms', 'enjoy life', 'kind', 'clif', 'cheerios', 'quaker', 'oreo',
    'doritos', 'tostitos', 'fritos', 'cheetos', 'pringles', 'ritz', 'heinz', 'coca-cola', 'pepsi',
    'gatorade', 'barilla', 'campbell\'s', 'progresso', 'jif', 'skippy', 'yoplait', 'dannon',
    'oscar mayer', 'haagen-dazs', 'mission', 'pepperidge farm', 'pillsbury', 'crisco', 'mazola',
    'fairlife', 'tropicana', 'la croix', 'kikkoman', 'mccormick', 'swanson', 'green giant',
    'starKist', 'nutella', 'pop-tarts', 'eggo', 'special k', 'kashi', 'nature valley', 'goldfish',
    'cheez-it', 'wheat thins', 'triscuit', 'skittles', 'snickers', 'sabra', 'tillamook', 'sargento',
    'newmans own', 'old el paso', 'maruchan', 'spam', 'gerber', 'capri sun', 'minute maid',
    'almond breeze', 'blue diamond', 'great value', 'kirkland signature', 'cascadian farm',
    'horizon organic', 'siggis', 'magic spoon', 'lesser evil', 'bob\'s red mill', 'dave\'s killer bread',
    'raos', 'california olive ranch', 'bonne maman', 'taza', 'alter eco', 'lily\'s', 'chomps',
    'kettle and fire', 'pacific foods', 'classico', 'prego', 'hidden valley', 'hellmanns',
    'land o lakes', 'philadelphia', 'ben and jerry', 'nature\'s own', 'kraft', 'velveeta',
    'hebrew national', 'johnsonville', 'birds eye', 'chicken of the sea', 'bumble bee',
    'bodyarmor', 'celsius', 'monster', 'vlasic', 'tabasco', 'french\'s', 'grey poupon',
    'log cabin', 'smucker', 'motts', 'ocean spray', 'so delicious', 'planet oat', 'thai kitchen',
    'bush\'s', 'goya', 'eden foods', 'de cecco', 'ronzoni', 'guerrero', 'thomas', 'arnold',
    'betty crocker', 'duncan hines', 'king arthur', 'wesson', 'splenda', 'truvia',
    'simply organic', 'happy family', 'plum organics', 'once upon a farm', 'serenity kids',
    'purely elizabeth', 'bear naked', 'kodiak', 'cape cod', 'kettle brand', 'skinny pop',
    'made good', 'gomacro', 'perfect bar', 'poppi', 'health-ade', 'crown prince',
    'endangered species', 'lindt', 'dove', 'cabot', 'elmhurst', 'ripple', 'native forest',
    'sir kensington', 'dukes', 'cholula', 'annie\'s homegrown', 'cascadian', 'barbara\'s',
    'three wishes', 'simple truth', 'good and gather', '365', 'trader joe', 'member\'s mark'
  ];
  console.log('Searching brands…', brandList.length);
  let n = 0;
  for (const brand of brandList) {
    n++;
    const safe = brand.replace(/'/g, '');
    const q = 'countries_tags:"en:united-states" AND states_tags:"en:ingredients-completed" AND brands:"' + safe + '"';
    const found = await searchCodes(q, 8);
    addCodes(found);
    if (n % 15 === 0) console.log('  brands', n + '/' + brandList.length, 'codes', codes.length);
    await sleep(160);
  }
  console.log('Unique codes before cap:', codes.length);
  const pinnedKeys = new Set(PINNED.map(codeKey));
  const pinnedCodes = codes.filter(c => pinnedKeys.has(codeKey(c)));
  const rest = codes.filter(c => !pinnedKeys.has(codeKey(c))).slice(0, 640);
  codes.length = 0;
  pinnedCodes.concat(rest).forEach(c => codes.push(c));
  console.log('Unique codes to fetch:', codes.length);

  let done = 0;
  const entries = [];
  await mapPool(codes, 3, async (code) => {
    try {
      const data = await getJson(PRODUCT + encodeURIComponent(code) + '.json?fields=' + FIELDS);
      if (data && data.status === 1 && data.product) {
        const entry = toEntry(data.product);
        if (entry) entries.push(entry);
      }
    } catch (e) {
      // skip missing / temporary errors
    }
    done++;
    if (done % 40 === 0) console.log('  fetched', done + '/' + codes.length, 'kept', entries.length);
    await sleep(30);
  });

  const byKey = new Map();
  for (const e of entries) {
    const key = codeKey(e.barcode);
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, e);
    else if (REQUIRED.some(r => codeKey(r) === key) && e.ingredients.length > prev.ingredients.length) byKey.set(key, e);
  }
  let products = Array.from(byKey.values());

  const brandCount = {};
  products.forEach(p => {
    const b = (p.brand || 'unknown').toLowerCase();
    brandCount[b] = (brandCount[b] || 0) + 1;
  });
  const capped = [];
  const brandUsed = {};
  const requiredKeys = new Set(REQUIRED.map(codeKey));
  for (const p of products) {
    const b = (p.brand || 'unknown').toLowerCase();
    const key = codeKey(p.barcode);
    const cap = requiredKeys.has(key) ? 99 : 8;
    brandUsed[b] = brandUsed[b] || 0;
    if (brandUsed[b] >= cap) continue;
    brandUsed[b]++;
    capped.push(p);
  }
  products = capped;

  products.sort((a, b) => (a.brand || '').localeCompare(b.brand || '') || a.name.localeCompare(b.name) || a.barcode.localeCompare(b.barcode));

  const missing = REQUIRED.filter(code => !products.some(p => codeKey(p.barcode) === codeKey(code)));
  if (missing.length) {
    console.error('Missing required barcodes:', missing.join(', '));
    process.exit(1);
  }
  if (products.length < 250) {
    console.error('Only kept ' + products.length + ' products; wanted at least 250.');
    process.exit(1);
  }

  const doc = {
    schemaVersion: 1,
    updated: ADDED,
    about: 'Tortuga Scan catalog, seeded from Open Food Facts. How to add a product: README.md. Grades come from rules.js in this repo, not from Olive or Seed Oil Scout, and they are not lab results.',
    source: 'Open Food Facts (Open Database License). Ingredient lists copied from each product page on the date in "added".',
    license: 'Product data © Open Food Facts contributors, ODbL. https://world.openfoodfacts.org/',
    count: products.length,
    products: products
  };
  const out = path.join(__dirname, '..', 'data', 'catalog.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  const passes = products.filter(p => p.grade.sosPass).length;
  console.log('Wrote', products.length, 'products (' + passes + ' SOS-style pass) to', out);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
