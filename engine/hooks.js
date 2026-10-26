/* Extension point for a future LLM reviewer. NOT used yet (no AI calls in the engine; GROK's skeptic owns the free quota).
 * reviewIdea is called for every candidate entry, per bot, before it is opened. Return { approve, note }.
 * To plug a model in later: make this async-call a model with { bot, market, coin, side, sig, views, stop, target }
 * and return approve:false to block; keep a hard timeout and default to approve:true on errors so the desk never stalls. */
'use strict';
async function reviewIdea(/* { bot, market, coin, side, sig, views, stop, target } */) {
  return { approve: true, note: null, reviewer: 'none' };
}
module.exports = { reviewIdea };
