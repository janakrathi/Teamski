import { ANTHROPIC_MODELS } from "./providers/anthropic.ts";

import { OPENAI_MODELS } from "./providers/openai.ts";

import { unqualify } from "./providers/keys.ts";


// ==========================================
// WHAT A TURN COST
// ==========================================
//
// An estimate, and labelled as one everywhere it
// is shown. Prices here are per million tokens
// and are copied from each provider's page, so
// they go stale; the provider's own invoice is
// the truth and this is for noticing a problem
// before the invoice arrives.
//
// A model nobody has a price for - somebody's own
// server, a preset whose rates are not tracked -
// counts as zero rather than as a guess. Zero is
// wrong in a way people can see; a made-up number
// is wrong in a way they cannot.
//

const PRICED = new Map<
  string,
  { in: number; out: number }
>();

for (const model of [
  ...ANTHROPIC_MODELS,
  ...OPENAI_MODELS,
]) {
  if (
    model.costPerMTokIn !== undefined &&
    model.costPerMTokOut !== undefined
  ) {
    PRICED.set(model.id, {
      in: model.costPerMTokIn,
      out: model.costPerMTokOut,
    });
  }
}


export function costOf(
  model: string,
  promptTokens: number,
  responseTokens: number
) {
  // A qualified id carries its service, and the
  // price is against the bare model name.

  const { model: bare } = unqualify(model);

  const price = PRICED.get(bare);

  if (!price) {
    return { usd: 0, known: false };
  }

  const usd =
    (promptTokens / 1_000_000) * price.in +
    (responseTokens / 1_000_000) * price.out;

  return { usd, known: true };
}


// Small amounts are the normal case here, and
// "$0.00" for a real charge reads as free.

export function formatUsd(usd: number) {
  if (usd === 0) {
    return "$0";
  }

  if (usd < 0.01) {
    return "<$0.01";
  }

  return `$${usd.toFixed(2)}`;
}
