"use client";

import { useCallback, useEffect, useState } from "react";

import { Check } from "@/components/ui/Icons";

import {
  planPrice,
  useCurrency,
} from "@/components/plans/PlanCards";


// ==========================================
// PLAN
// ==========================================
//
// What you are on and what you could move to, in
// one place. Prices and features come from the
// server, which is also what enforces them.
//

type Plan = "free" | "team";

type Offer = {
  plan: Plan;
  label: string;
  blurb: string;
  features: string[];
};

const RANK: Record<Plan, number> = {
  free: 0,
  team: 1,
};

type ProjectPlan = {
  plan: Plan;
  planLabel: string;
  owner: string | null;
  youOwn: boolean;
  trial?: boolean;
};


// Razorpay's checkout is a script it drops a global
// onto; loaded once, on demand, so it costs nothing
// until someone actually upgrades.

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => {
      open: () => void;
    };
  }
}

function loadRazorpay(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (
      typeof window !== "undefined" &&
      window.Razorpay
    ) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src =
      "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Could not load checkout."));
    document.body.appendChild(script);
  });
}


export default function PlanSection({
  projectId,
}: {
  projectId: string | null;
}) {
  const [plan, setPlan] = useState<Plan | null>(
    null
  );

  const [renews, setRenews] = useState<
    string | null
  >(null);

  const { currency } = useCurrency();

  const [offers, setOffers] = useState<Offer[]>(
    []
  );

  const [busy, setBusy] = useState<Plan | null>(
    null
  );

  // Said under the card that was clicked, so the
  // answer lands where the question was asked.

  const [notice, setNotice] = useState<{
    plan: Plan;
    text: string;
  } | null>(null);

  const [error, setError] = useState("");

  const [project, setProject] =
    useState<ProjectPlan | null>(null);

  const [today, setToday] = useState<{
    used: number;
    limit: number;
  } | null>(null);


  const load = useCallback(async () => {
    try {
      const response = await fetch(
        projectId
          ? `/api/billing?projectId=${projectId}`
          : "/api/billing",
        { cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not load your plan."
        );
      }

      setPlan(data.plan);
      setRenews(data.renews ?? null);
      setOffers(data.offers ?? []);
      setProject(data.project ?? null);
      setToday(data.today ?? null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load your plan."
      );
    }
  }, [projectId]);


  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);


  async function upgrade(target: Plan) {
    if (!projectId) {
      setNotice({
        plan: target,
        text: "Open the project you want to upgrade first.",
      });
      return;
    }

    setBusy(target);
    setNotice(null);

    const fail = (text: string) => {
      setNotice({ plan: target, text });
      setBusy(null);
    };

    try {
      // Create the order for this project, at the
      // price the server decides.
      const response = await fetch(
        "/api/billing/checkout",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ projectId, currency }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        fail(
          data.error ||
            "Could not start checkout. Nothing has been charged."
        );
        return;
      }

      await loadRazorpay();

      const checkout = new window.Razorpay({
        key: data.keyId,
        order_id: data.orderId,
        amount: data.amount,
        currency: data.currency,
        name: "Teamski",
        description: "Team plan — one month",

        // Razorpay calls this when the payment goes
        // through; we confirm it server-side, then
        // refresh the plan on screen.
        handler: async (resp: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const verify = await fetch(
              "/api/billing/verify",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  orderId: resp.razorpay_order_id,
                  paymentId: resp.razorpay_payment_id,
                  signature: resp.razorpay_signature,
                }),
              }
            );

            if (!verify.ok) {
              setNotice({
                plan: target,
                text: "Payment received — it will show as upgraded in a moment.",
              });
            }
          } finally {
            // Either way, re-read: the webhook is the
            // backstop if the check above did not land.
            await load();
            setBusy(null);
          }
        },

        modal: {
          ondismiss: () => setBusy(null),
        },

        theme: { color: "#c96442" },
      });

      checkout.open();
    } catch {
      fail(
        "Could not start checkout. Nothing has been charged."
      );
    }
  }


  if (error) {
    return (
      <p className="rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-[12px] leading-relaxed text-red-200">
        {error}
      </p>
    );
  }

  if (!plan) {
    return (
      <p className="text-[12px] text-[var(--text-faint)]">
        Loading…
      </p>
    );
  }

  const current = offers.find(
    (offer) => offer.plan === plan
  );


  return (
    <div>
      {/* THIS PROJECT */}
      {/*                                  */}
      {/* What you actually get here comes */}
      {/* from whoever owns the project.   */}

      {project && !project.youOwn && (
        <div className="mb-5">
          <p className="mb-1.5 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
            This project
          </p>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="text-[14px] font-medium text-[var(--text)]">
                {project.planLabel}
              </span>

              <span className="ml-auto text-[11px] text-[var(--text-faint)]">
                Paid by {project.owner ?? "the owner"}
              </span>
            </div>

            <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
              Everyone in a project gets its
              owner&apos;s plan. Joining is always
              free.
            </p>
          </div>
        </div>
      )}

      {today && (
        <p className="mb-5 flex items-baseline gap-2 text-[11.5px] text-[var(--text-muted)]">
          <span className="min-w-0 flex-1">
            Built-in AI messages today
          </span>

          <span className="shrink-0 text-[var(--text)] tabular-nums">
            {Math.min(today.used, today.limit)} /{" "}
            {today.limit}
          </span>
        </p>
      )}

      {/* WHERE YOU ARE */}

      <p className="mb-1.5 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
        Your plan
      </p>

      <div className="mb-5 flex items-baseline gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2.5">
        <span className="text-[14px] font-medium text-[var(--text)]">
          {project?.trial
            ? `${current?.label ?? plan} · Free trial`
            : (current?.label ?? plan)}
        </span>

        <span className="ml-auto text-[11px] text-[var(--text-faint)]">
          {plan === "free"
            ? "Free forever"
            : renews
              ? `${
                  project?.trial
                    ? "Trial ends"
                    : "Renews"
                } ${new Date(
                  renews
                ).toLocaleDateString()}`
              : "Active"}
        </span>
      </div>


      {/* WHERE YOU COULD BE */}

      <p className="mb-1.5 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
        Plans
      </p>

      <div className="space-y-2">
        {offers.map((offer) => {
          const isCurrent = offer.plan === plan;

          const higher =
            RANK[offer.plan] > RANK[plan];

          return (
            <div
              key={offer.plan}
              className={`rounded-lg border px-3 py-3 ${
                isCurrent
                  ? "border-[var(--accent)] bg-[var(--bg-raised)]"
                  : "border-[var(--border)] bg-[var(--bg-raised)]"
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-medium text-[var(--text)]">
                  {offer.label}
                </span>

                {isCurrent && (
                  <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
                    Current
                  </span>
                )}

                <span className="ml-auto text-[13px] text-[var(--text)] tabular-nums">
                  {planPrice(offer.plan, currency).big}
                </span>
              </div>

              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="min-w-0 flex-1 text-[11.5px] text-[var(--text-faint)]">
                  {offer.blurb}
                </span>

                <span className="shrink-0 text-[10.5px] text-[var(--text-faint)]">
                  {planPrice(offer.plan, currency).per}
                </span>
              </div>

              {planPrice(offer.plan, currency).note && (
                <p className="mt-0.5 text-[10.5px] text-[var(--text-faint)]">
                  {planPrice(offer.plan, currency).note}
                </p>
              )}

              {planPrice(offer.plan, currency).charge && (
                <p className="mt-0.5 text-[10.5px] text-[var(--text-faint)]">
                  {planPrice(offer.plan, currency).charge}
                </p>
              )}

              <ul className="mt-2 space-y-1">
                {offer.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-1.5 text-[12px] leading-relaxed text-[var(--text-muted)]"
                  >
                    <Check className="mt-[3px] h-3 w-3 shrink-0 text-emerald-400" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {higher && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => upgrade(offer.plan)}
                  className="mt-3 w-full rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-40"
                >
                  {busy === offer.plan
                    ? "Starting checkout…"
                    : `Upgrade to ${offer.label}`}
                </button>
              )}

              {notice?.plan === offer.plan && (
                <p className="mt-2 rounded-md border border-amber-900/40 bg-amber-950/20 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-amber-200">
                  {notice.text}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
        A plan covers every project you own and
        everyone in them. Messages on your own or
        a shared API key do not count toward the
        daily allowance.
      </p>
    </div>
  );
}
