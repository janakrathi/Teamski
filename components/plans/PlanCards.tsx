"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import EnterpriseCard from "@/components/plans/EnterpriseCard";

import {
  DEFAULT_CURRENCY,
  INCLUDED_MEMBERS,
  OFFERS,
  PLAN_LABELS,
  TEAM_PRICE,
  TEAM_PRICE_INR,
  countryFromZone,
  currencyForCountry,
  formatMoney,
  type Currency,
} from "@/lib/plans";


// ==========================================
// THE PLANS, IN THE VISITOR'S OWN CURRENCY
// ==========================================
//
// Each big market has its own price (lib/plans.ts).
// Which one a visitor sees is decided from where
// they are, not chosen from a menu, so nobody just
// picks the cheapest.
//


// Where the visitor is -> which currency. The
// timezone pins the country best (a phone in India
// set to US English still sits in Asia/Kolkata);
// the browser's region is the fallback; dollars if
// neither is known.

export function detectCurrency(): Currency {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const fromZone = countryFromZone(zone);

    if (fromZone) {
      return currencyForCountry(fromZone);
    }

    const region = new Intl.Locale(navigator.language).maximize().region;

    if (region) {
      return currencyForCountry(region);
    }
  } catch {
    // Fall through to the default.
  }

  return DEFAULT_CURRENCY;
}


// Same value on the server and the first client
// render, so nothing mis-hydrates; the real
// detection runs once mounted. `ready` stays false
// until then, so a price is never shown wrong for
// a frame.

export function useCurrency(): { currency: Currency; ready: boolean } {
  const [currency, setCurrency] = useState<Currency>(DEFAULT_CURRENCY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only detection, after mount
    setCurrency(detectCurrency());
    setReady(true);
  }, []);

  return { currency, ready };
}


// The price line for one plan, in a currency.

export function planPrice(plan: string, currency: Currency) {
  if (plan !== "team") {
    return {
      big: formatMoney(currency, 0),
      per: "forever",
      note: null,
      charge: null,
    };
  }

  // Payments run in rupees for now, so a visitor
  // paying in another currency is told the rupee
  // amount their card is actually charged.
  const charge =
    currency === "INR"
      ? null
      : `charged ${formatMoney(
          "INR",
          TEAM_PRICE_INR[currency].base
        )} / month`;

  return {
    big: formatMoney(currency, TEAM_PRICE[currency].base),
    per: `per month · up to ${INCLUDED_MEMBERS} people`,
    note: `+ ${formatMoney(currency, TEAM_PRICE[currency].perExtraMember)} / month for each extra teammate`,
    charge,
  };
}


export default function PlanCards() {
  const { currency, ready } = useCurrency();

  return (
    <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {OFFERS.map((offer) => {
        const highlighted = offer.plan === "team";
        const price = planPrice(offer.plan, currency);

        return (
          <div
            key={offer.plan}
            className={`flex flex-col rounded-xl border p-6 ${
              highlighted
                ? "border-[var(--text-muted)] bg-[var(--bg-raised)]"
                : "border-[var(--border)]"
            }`}
          >
            <h3 className="text-[16px] font-semibold">
              {PLAN_LABELS[offer.plan]}
            </h3>

            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              {offer.blurb}
            </p>

            <p className="mt-5 flex items-baseline gap-1.5">
              {/* Hidden until detection has run, so a
                  visitor never sees the wrong currency
                  flash to the right one. */}
              <span
                className={`text-[32px] font-semibold tracking-[-0.02em] transition-opacity ${
                  ready ? "opacity-100" : "opacity-0"
                }`}
              >
                {price.big}
              </span>

              <span className="text-[12.5px] text-[var(--text-faint)]">
                {price.per}
              </span>
            </p>

            {price.note && (
              <p
                className={`mt-1 text-[12px] text-[var(--text-faint)] transition-opacity ${
                  ready ? "opacity-100" : "opacity-0"
                }`}
              >
                {price.note}
              </p>
            )}

            {price.charge && (
              <p
                className={`mt-1 text-[11.5px] text-[var(--text-faint)] transition-opacity ${
                  ready ? "opacity-100" : "opacity-0"
                }`}
              >
                {price.charge}
              </p>
            )}

            <ul className="mt-5 flex-1 space-y-2">
              {offer.features.map((feature) => (
                <li
                  key={feature}
                  className="flex gap-2 text-[13px] leading-[1.5] text-[var(--text-muted)]"
                >
                  <span
                    aria-hidden="true"
                    className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--text-faint)]"
                  />

                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <Link
              href="/login?mode=signup"
              className={`mt-6 rounded-lg px-4 py-2 text-center text-[13.5px] font-medium transition ${
                highlighted
                  ? "bg-[var(--text)] text-[var(--bg)] hover:opacity-90"
                  : "border border-[var(--border-strong)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              Get started
            </Link>
          </div>
        );
      })}

      <EnterpriseCard />
    </div>
  );
}
