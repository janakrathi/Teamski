import type { Metadata } from "next";

import { H2, LegalPage, List } from "@/components/legal/LegalPage";

import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  alternates: { canonical: "/privacy" },
};


// Written to describe what the app actually does,
// and to promise nothing it cannot keep. No
// "your data is safe", no "never leaves your
// machine". Where something depends on a choice a
// team makes, it says so.

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This policy explains what information{" "}
        {LEGAL.operator} (&quot;we&quot;, &quot;us&quot;) collects when you
        use {LEGAL.service} at {LEGAL.site} (the &quot;Service&quot;), how
        it is used, and who it is shared with. By using the Service you
        agree to this policy. If you do not agree, please do not use the
        Service.
      </p>


      <H2>1. Information we collect</H2>

      <p>
        <strong>Account information.</strong> When you sign up or sign in,
        we receive your email address and, if you sign in with Google,
        Microsoft or GitHub, the basic profile information that provider
        shares, such as your name and profile picture. You may also add a
        display name and username.
      </p>

      <p>
        <strong>Content you create.</strong> Messages in channels and direct
        messages, files you upload, files agents create, tasks you give
        agents, instructions you write for agents, and edits to any of
        these.
      </p>

      <p>
        <strong>What agents remember.</strong> The Service may keep short
        notes and summaries drawn from conversations so agents can refer
        back to them. You can turn this off in Settings. Deleting or editing
        a message removes notes that were recorded against it.
      </p>

      <p>
        <strong>Connected accounts and keys.</strong> If you connect another
        service (for example Google Sheets, GitHub, Notion or another app),
        we store the access tokens that service gives us so agents can act
        on your behalf. If you add an API key for an AI provider, we store
        that key. These are used only to carry out the actions you or your
        team ask for.
      </p>

      <p>
        <strong>Usage information.</strong> Which AI model answered, how
        many tokens a request used, how long it took, and whose key paid
        for it. This is used to show usage, apply plan limits and estimate
        costs.
      </p>

      <p>
        <strong>Technical information.</strong> Like most websites, our
        servers and hosting providers may record your IP address, browser
        type and request logs.
      </p>

      <p>
        <strong>Payment information.</strong> If you buy a paid plan,
        payment is handled by a third-party payment processor. We receive
        confirmation of payment and your plan details, not your full card
        number.
      </p>


      <H2>2. How we use information</H2>

      <List>
        <li>To provide, operate and maintain the Service.</li>
        <li>
          To send your messages, files and instructions to the AI model
          chosen for your workspace so it can respond, and to carry out
          actions you approve in connected services.
        </li>
        <li>To show usage, apply plan limits and process payments.</li>
        <li>To respond to support requests and send service notices.</li>
        <li>To investigate misuse and to comply with legal obligations.</li>
      </List>

      <p>
        We do not sell your personal information, and we do not use your
        content to show advertising.
      </p>


      <H2>3. AI models and third parties</H2>

      <p>
        To answer a request, the content of that request (including
        relevant earlier messages, attached files and notes) is sent to an
        AI model. Which model depends on the choices made in your workspace:
      </p>

      <List>
        <li>
          <strong>Built-in models</strong> run on servers we operate or
          rent.
        </li>
        <li>
          <strong>Models on your own or your team&apos;s key</strong> (for
          example Anthropic, OpenAI, Google, NVIDIA, xAI, Groq, DeepSeek, Mistral,
          OpenRouter or Together) receive that content directly and handle
          it under their own terms and privacy policies.
        </li>
      </List>

      <p>We also rely on other providers to run the Service, including:</p>

      <List>
        <li>Supabase, for our database, file storage and sign-in.</li>
        <li>Our server hosting provider.</li>
        <li>
          Google, Microsoft and GitHub, if you choose to sign in with them.
        </li>
        <li>
          Web search providers (such as Brave Search or DuckDuckGo), which
          receive search queries when an agent searches the web.
        </li>
        <li>
          Apps you connect, such as Google Sheets, GitHub, Notion, Linear,
          Atlassian, Asana, Sentry, Stripe, Canva or Hugging Face, which
          receive the requests an agent makes on your behalf.
        </li>
        <li>
          An email provider (Resend), which sends invitations to the
          addresses people enter, and account emails such as reminders
          about your plan or your account.
        </li>
        <li>
          Meta (Facebook and Instagram), which measures visits and signups
          that come from our ads. See section 6.
        </li>
        <li>
          Google Sheets, where we keep the details you send if you contact
          us about an Enterprise plan, so we can follow up.
        </li>
        <li>A payment processor, once paid plans are available.</li>
      </List>

      <p>
        Each of these handles information under its own terms. We are not
        responsible for their practices.
      </p>


      <H2>4. Google user data</H2>

      <p>
        If you connect a Google account, the Service requests access to
        Google Sheets only. It reads a spreadsheet when you give an agent
        its link, and adds rows to a spreadsheet only when you approve that
        action. This data is used only to carry out those requests and is
        not used for advertising.
      </p>

      <p>
        {LEGAL.service}&apos;s use and transfer of information received from
        Google APIs will adhere to the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          className="text-[var(--text)] underline underline-offset-2"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>


      <H2>5. Who can see your content</H2>

      <p>
        Content in a project is visible to the members of that project.
        Direct messages are visible to the people in that conversation. On
        plans that include it, members of a project can see who used the
        project&apos;s shared key and an estimate of what they spent. Background agents act using the connected
        accounts of the person who started them.
      </p>


      <H2>6. Cookies and local storage</H2>

      <p>
        We use cookies that are needed to keep you signed in and to protect
        sign-in flows. Your browser also stores some of your settings
        locally.
      </p>

      <p>
        We also use the Meta Pixel, an advertising tool from Meta, to learn
        whether our ads on Facebook and Instagram bring people to Teamski.
        It sets a cookie and tells Meta which pages of our site you visit,
        along with your browser, device and IP address, and when you sign
        up or send us an Enterprise enquiry. It does not receive your
        messages, files, projects or anything else inside your workspace,
        and it is never loaded on password-reset or sign-in links. Meta
        handles this information under its own{" "}
        <a
          href="https://www.facebook.com/privacy/policy/"
          className="text-[var(--text)] underline underline-offset-2"
        >
          privacy policy
        </a>
        .
      </p>

      <p>
        When you sign up, or send us an Enterprise enquiry, our server also
        tells Meta about it directly, through Meta&apos;s Conversions API.
        That message includes a hashed (one-way scrambled) copy of your
        email address and account ID, which Meta uses to match the signup to
        an ad, along with your IP address and browser. It is sent once per
        signup or enquiry, and it is sent even if your browser blocks the
        pixel.
      </p>

      <p>
        You can limit how Meta uses this through your{" "}
        <a
          href="https://www.facebook.com/adpreferences/"
          className="text-[var(--text)] underline underline-offset-2"
        >
          Meta ad preferences
        </a>
        . Blocking third-party cookies or using an ad blocker stops the
        pixel in your browser - Teamski works the same either way.
      </p>


      <H2>7. Keeping and deleting information</H2>

      <p>
        We keep information for as long as your account is active or as
        needed to provide the Service. You can delete messages,
        connections and keys in the app, and delete your whole account in
        Settings → Account. Projects other people are in are handed to
        another member rather than deleted. Some information may remain in backups or
        logs for a period, or where we are required to keep it by law.
      </p>


      <H2>8. Security</H2>

      <p>
        We take reasonable steps to protect information, but no method of
        storing or sending data over the internet is completely secure. We
        cannot guarantee the security of any information, and you use the
        Service at your own risk.
      </p>


      <H2>9. Your choices and rights</H2>

      <p>
        Depending on where you live, including under India&apos;s Digital
        Personal Data Protection Act, 2023, you may have the right to
        access, correct or delete your personal information, or to withdraw
        consent. To make a request, email us. We may need to confirm your
        identity first.
      </p>


      <H2>10. Children</H2>

      <p>
        The Service is not intended for anyone under 18. If you believe a
        child has given us personal information, contact us and we will
        take steps to delete it.
      </p>


      <H2>11. Transfers</H2>

      <p>
        Our providers may process information in countries other than
        yours, including outside India.
      </p>


      <H2>12. Changes</H2>

      <p>
        We may update this policy. When we do, we will change the date at
        the top. Continuing to use the Service after a change means you
        accept the updated policy.
      </p>


      <H2>13. Contact</H2>

      <p>
        Questions or requests:{" "}
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
