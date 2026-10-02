import type { Metadata } from "next";

import { H2, LegalPage, List } from "@/components/legal/LegalPage";

import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  alternates: { canonical: "/terms" },
};


// Plain terms with no promises the Service cannot
// keep: provided as it is, AI output is not
// advice, and the people using it are responsible
// for what they ask it to do.

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms are an agreement between you and {LEGAL.operator}{" "}
        (&quot;we&quot;, &quot;us&quot;) for your use of {LEGAL.service} at{" "}
        {LEGAL.site} (the &quot;Service&quot;). By creating an account or
        using the Service, you agree to these terms. If you use the Service
        for an organisation, you agree on its behalf and confirm you have
        the authority to do so. If you do not agree, do not use the
        Service.
      </p>


      <H2>1. Eligibility and accounts</H2>

      <p>
        You must be at least 18 years old. You are responsible for your
        account, for keeping your sign-in details secure, and for
        everything that happens under your account.
      </p>


      <H2>2. Acceptable use</H2>

      <p>You agree not to use the Service to:</p>

      <List>
        <li>Break any law or anyone else&apos;s rights.</li>
        <li>
          Upload or create content that is unlawful, harmful, abusive,
          infringing or deceptive.
        </li>
        <li>
          Access accounts, systems or data you are not authorised to access.
        </li>
        <li>
          Interfere with, overload, probe or attempt to bypass the
          Service&apos;s security, limits or plans.
        </li>
        <li>
          Send spam, malware, or automated traffic the Service is not
          designed for.
        </li>
        <li>
          Break the terms or usage policies of any AI provider or connected
          service you use through the Service.
        </li>
      </List>

      <p>
        We may suspend or end access for anyone we believe is breaking
        these terms, without notice.
      </p>


      <H2>3. Your content</H2>

      <p>
        You keep ownership of the content you put into the Service. You
        give us permission to store, process, copy and transmit it as
        needed to run the Service for you and your team, including sending
        it to AI models and connected services as described in our Privacy
        Policy. You are responsible for your content and for having the
        rights to use it.
      </p>


      <H2>4. AI output</H2>

      <p>
        Responses and actions produced by AI models may be incomplete,
        inaccurate, out of date or inappropriate. They are not
        professional, legal, financial, medical or other advice. You are
        responsible for reviewing output before relying on it or acting on
        it.
      </p>


      <H2>5. Agents and connected services</H2>

      <p>
        Agents can take actions in services you connect, such as reading
        or changing data in a spreadsheet, a repository or another app.
        Some actions ask for approval first. You are responsible for the
        actions you approve and for the tasks you give agents, including
        background tasks that run while you are away.
      </p>

      <p>
        Connected services and AI providers are run by third parties under
        their own terms. We do not control them and are not responsible
        for their availability, behaviour, charges or data practices.
      </p>


      <H2>6. API keys and costs</H2>

      <p>
        If you or your team add an API key for an AI provider, usage on
        that key is billed by that provider to the key&apos;s owner. Any
        spending figures or limits shown in the Service are estimates and
        may be wrong or delayed. You are responsible for all charges on
        your keys and should monitor them with the provider directly.
      </p>


      <H2>7. Plans and payment</H2>

      <p>
        Some features require a paid plan. Prices, features and usage
        limits are shown in the Service and may change. Where paid plans
        are available, fees are charged in advance for each billing period
        and, unless the law requires otherwise, are non-refundable. We may
        change or stop offering a plan, and will give reasonable notice of
        price changes that affect you.
      </p>


      <H2>8. Availability and changes</H2>

      <p>
        We may change, suspend or discontinue any part of the Service at
        any time. We do not promise that the Service will be available,
        uninterrupted, or free of errors, or that any data will be kept
        without loss. Keep your own copies of anything important.
      </p>


      <H2>9. Termination</H2>

      <p>
        You can stop using the Service at any time. We may suspend or end
        your access at any time, for any reason, including breach of these
        terms. When access ends, your right to use the Service ends, and
        we may delete your content.
      </p>


      <H2>10. No warranty</H2>

      <p>
        The Service is provided &quot;as is&quot; and &quot;as available&quot;,
        without warranties of any kind, whether express or implied,
        including warranties of merchantability, fitness for a particular
        purpose, accuracy, security, and non-infringement, to the fullest
        extent permitted by law.
      </p>


      <H2>11. Limitation of liability</H2>

      <p>
        To the fullest extent permitted by law, {LEGAL.operator} and its
        owners, employees and suppliers will not be liable for any
        indirect, incidental, special, consequential or punitive damages,
        or for any loss of data, profits, revenue, business or goodwill,
        arising from or related to the Service, AI output, agent actions,
        connected services or these terms, even if we were told such
        damages were possible.
      </p>

      <p>
        Our total liability for any claim relating to the Service is
        limited to the amount you paid us for the Service in the three
        months before the event giving rise to the claim, or ₹1,000 if you
        paid nothing.
      </p>


      <H2>12. Indemnity</H2>

      <p>
        You agree to defend and compensate {LEGAL.operator} for any claims,
        losses or costs (including reasonable legal fees) arising from your
        content, your use of the Service, actions you approve or instruct
        agents to take, or your breach of these terms or of anyone&apos;s
        rights.
      </p>


      <H2>13. Governing law</H2>

      <p>
        These terms are governed by the laws of India. Any dispute will be
        handled by the courts in {LEGAL.courtsCity}.
      </p>


      <H2>14. Changes to these terms</H2>

      <p>
        We may update these terms. When we do, we will change the date at
        the top. Continuing to use the Service after a change means you
        accept the updated terms.
      </p>


      <H2>15. Contact</H2>

      <p>
        Questions about these terms:{" "}
        <a
          href={`mailto:${LEGAL.contactEmail}`}
          className="text-[var(--text)] underline underline-offset-2"
        >
          {LEGAL.contactEmail}
        </a>
      </p>
    </LegalPage>
  );
}
