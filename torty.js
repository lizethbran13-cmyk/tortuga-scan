/*
 * Torty chat. On-device only. She can read a product you already opened,
 * a few catalog hits the app passes in, saved report notes, and the
 * scoring rules. She does not call a model, and she cannot reach Scout.
 *
 * Works in the browser (window.TortugaChat) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else root.TortugaChat = factory(root.ScoutRules);
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  function fresh() {
    return {
      messages: [{ role: 'torty', text: 'Hey, I’m Torty. Ask me about something you scanned, how a score works, or say report if a label looked off.' }],
      flow: null
    };
  }

  function push(session, role, text) {
    session.messages = (session.messages || []).concat([{ role: role, text: text }]).slice(-40);
  }

  function plainProduct(ctx) {
    var p = ctx && ctx.product;
    if (!p || !p.name) return null;
    return p;
  }

  function explainGrade(ctx) {
    var p = plainProduct(ctx);
    var g = ctx && ctx.grade;
    if (!p && !g) return 'Open a product or scan one, and I’ll talk about that box. Under 45 I’d skip it. 45 to 59 I’d go easy. 60 and up looks like a solid one to me.';
    var name = (p && p.name) || 'this one';
    if (!g || g.score == null) return 'I have ' + name + ' here, but I don’t have a score yet. If you can paste the ingredient list, I’ll take a look.';
    var band = g.band && g.band.label ? g.band.label : '';
    var flags = (g.deductions || []).map(function (d) { return d.label; }).slice(0, 3);
    var line = R.tortySays({
      name: name,
      kind: p && p.kind,
      score: g.score,
      flags: flags,
      mainstream: !!(g.mainstream),
      hasIngredients: g.hasIngredients !== false,
      betterForYou: g.betterForYou || null,
      certifications: (ctx && ctx.certifications) || []
    });
    return line;
  }

  function explainRules() {
    return 'I start at 100 and take points off for what I can read. A seed oil is the big one. Under 45 is a Fail, on Avoid. 45 to 59 is Limit, still a Pass. 60 and up is Eat as you like. Better for You can add 10, 12, or 15, and it will not pull a seed oil up into Eat as you like.';
  }

  function catalogLine(ctx) {
    var hits = (ctx && ctx.hits) || [];
    if (!hits.length) return '';
    return hits.slice(0, 3).map(function (h) {
      var score = h.score != null ? h.score : 'no score';
      var band = h.band ? ' ' + h.band : '';
      return h.name + (h.brand ? ' (' + h.brand + ')' : '') + ' is ' + score + band + ' on my list.';
    }).join(' ');
  }

  function wantsReport(text) {
    return /\breports?\b|\bsomething(?:'s| is) off\b|\bwrong with\b|\bflag this\b/i.test(text);
  }

  function analyzeDraft(draft) {
    draft = draft || {};
    var blob = [draft.ingredients, draft.oils, draft.certs, draft.note].filter(Boolean).join('. ');
    var bits = [];
    var oils = R.findSeedOils ? R.findSeedOils(R.normalize(blob)) : [];
    if (oils.length) {
      bits.push('I’d skip a seed oil like ' + oils[0].match + '. A Better for You bump would not move that into Eat as you like.');
    } else if (/\bolive|\bavocado|\bcoconut|\bbutter|\bghee|\btallow|\blard\b/i.test(blob)) {
      bits.push('The fats you named are the ones I treat as the better cooking fats.');
    } else if (draft.oils) {
      bits.push('I don’t have a firm read on that fat yet, so I’m just saving what you wrote.');
    }
    if (draft.ingredients && draft.ingredients.length > 12 && /,/.test(draft.ingredients)) {
      var g = R.grade(draft.ingredients, { productName: draft.productName || '' });
      bits.push('If I grade that list as written, my take is ' + g.score + ', ' + g.band.label + '.');
    } else {
      bits.push('I don’t have a full ingredient list, so this stays a note.');
    }
    if (/^(y|yes|yeah|yep)\b/i.test(draft.better || '')) {
      bits.push('I’ll save that you want a Better for You look. Asking does not change the shared score by itself.');
    }
    return bits.join(' ');
  }

  function nextReportStep(session, text) {
    var flow = session.flow;
    var draft = flow.draft;
    var reply;
    if (flow.step === 'ingredients') {
      draft.ingredients = text;
      flow.step = 'oils';
      reply = 'Got it. Any oils or fats on the label? Olive, avocado, canola, or not sure is fine.';
    } else if (flow.step === 'oils') {
      draft.oils = text;
      flow.step = 'certs';
      reply = 'Any certifications printed on there? Organic, non-GMO, grass-fed, or none.';
    } else if (flow.step === 'certs') {
      draft.certs = text;
      flow.step = 'better';
      reply = 'Want me to mark a Better for You request? Yes or no. That’s a Tortuga badge someone can review, not a score I change tonight.';
    } else if (flow.step === 'better') {
      draft.better = text;
      flow.step = 'note';
      reply = 'Anything else Scout should see? A short note is enough. Say skip if you’re done.';
    } else {
      draft.note = /^skip$/i.test(text) ? '' : text;
      var analysis = analyzeDraft(draft);
      session.flow = null;
      reply = analysis + ' I saved that on this phone. I can pack a copy for Scout whenever you want. I don’t have Scout in this chat. Say send and I’ll get the package ready.';
      return { reply: reply, action: { type: 'save-report', report: draft, analysis: analysis } };
    }
    return { reply: reply, action: null };
  }

  function respond(session, text, ctx) {
    session = session || fresh();
    if (!session.messages) session = fresh();
    ctx = ctx || {};
    var raw = String(text || '').trim();
    if (!raw) return { session: session, replies: ['I’m here. Say report, ask about the open product, or ask how a score works.'], action: null };
    push(session, 'user', raw);
    var reply = '';
    var action = null;
    var lower = raw.toLowerCase();

    if (session.flow && session.flow.kind === 'report') {
      if (/^cancel$|^never mind$|^nevermind$|^stop$/i.test(raw)) {
        session.flow = null;
        reply = 'No worries. We can leave the report. I’m still here.';
      } else {
        var step = nextReportStep(session, raw);
        reply = step.reply;
        action = step.action;
      }
    } else if (/^send$|send (it|this|to scout)|pack (it|this)/i.test(lower)) {
      reply = 'Okay. I’ll put a copy and a short summary on the screen. You can share it, or open a GitHub issue for Scout. I can’t deliver it myself.';
      action = { type: 'send' };
    } else if (wantsReport(lower)) {
      var product = plainProduct(ctx);
      session.flow = {
        kind: 'report',
        step: 'ingredients',
        draft: {
          productName: product ? product.name : '',
          productCode: product ? (product.code || '') : '',
          brand: product ? (product.brand || '') : '',
          kind: product ? (product.kind || 'food') : 'food'
        }
      };
      reply = 'Okay. We’ll do this one step at a time' + (product ? ' for ' + product.name : '') + '. What ingredients did you notice? Paste a list if you have it, or say you’re not sure.';
    } else if (/how (do|does) (the |a )?score|what do the (bands|colors)|avoid or limit|eat as you like/i.test(lower)) {
      reply = explainRules();
    } else if (/better for you|super clean/i.test(lower)) {
      reply = 'Better for You is my badge for a cleaner swap, like a puff that stands in for a much junkier cheese curl. It adds 10 to 15 points, and a seed oil still can’t ride that bump into Eat as you like. Super Clean Brand is for a whole brand I feel good about, not one jar. Both are mine. They aren’t a certification.';
    } else if (/seed oil|canola|sunflower oil/i.test(lower)) {
      reply = 'Seed oils are the ones I skip: canola, soy, sunflower, safflower, the generic vegetable oil, and that family. Olive, avocado, coconut, butter, ghee, tallow, and lard are not in that group.';
    } else if (plainProduct(ctx) && /this (one|product)|what do you think|should i (eat|buy|skip)|tell me about/i.test(lower)) {
      reply = explainGrade(ctx);
    } else if (plainProduct(ctx) && /score|grade|flag/i.test(lower)) {
      reply = explainGrade(ctx);
    } else if ((ctx.hits || []).length && raw.length > 2) {
      reply = catalogLine(ctx) + ' Want me to walk through one of those?';
    } else if (/^(hi|hey|hello|yo|howdy)\b/i.test(lower)) {
      reply = 'Hey. I’m around. Scan something, or tell me what you’re looking at.';
    } else if (/who are you|what are you/i.test(lower)) {
      reply = 'I’m Torty, the tortoise on this app. I read ingredient lists with you. I live on this phone. There’s no one else hiding in the chat.';
    } else if (plainProduct(ctx)) {
      reply = explainGrade(ctx) + ' If something on the package looks off, say report.';
    } else {
      reply = 'I can talk through a score, a product you’ve opened, or a report. Try “how does a score work,” or say report.';
    }

    push(session, 'torty', reply);
    return { session: session, replies: [reply], action: action };
  }

  return { fresh: fresh, respond: respond, analyzeDraft: analyzeDraft };
});
