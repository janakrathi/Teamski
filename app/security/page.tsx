import type { Metadata } from "next";

import Link from "next/link";

import { H2, LegalPage, List } from "@/components/legal/LegalPage";

import { DAILY_MESSAGES } from "@/lib/plans";

import ContactUs from "@/components/landing/ContactUs";

export const metadata: Metadata = {
  title: "Security & your data",
  description:
    "How Teamski handles your data: no model training, encryption, retention, permissions, integrations, agent reliability, export, and what the free plan's AI really is.",
  alternates: { canonical: "/security" },
};


// The questions a careful team asks before trusting a
// tool with its work, answered from what the code does.
// Where something is not done yet, it says so - a trust
// page that overclaims is worse than none.

const linkClass = "text-[var(--text)] underline underline-offset-2";


export default function SecurityPage() {
  return (
    <LegalPage title="Security & your data">
      <p>
        Plain answers to the questions teams ask before they trust a tool
        with their work. Where something isn&apos;t in place yet, we say so.
        Questions we haven&apos;t covered? Use our{" "}
        <ContactUs label="contact form" className={linkClass} />.
      </p>


      <H2>Does Teamski train AI on my data?</H2>

      <p>
        <strong>No.</strong> We don&apos;t train or fine-tune any model on
        your messages, files or your agents&apos; memory.
      </p>

      <p>
        To answer, the relevant part of the conversation is sent to the model
        that answers it - a built-in model, or a provider whose key you or
        your team added - and that provider handles it under its own terms.
        OpenAI, Anthropic and Google&apos;s paid API say they don&apos;t
        train on API requests by default. Google&apos;s <em>free</em> Gemini
        API tier may use requests to improve Google&apos;s products, so use a
        paid key for sensitive work. Check each provider&apos;s policy for
        the details.
      </p>


      <H2>How long do you keep it?</H2>

      <List>
        <li>
          Messages, files and agent memory stay until you delete them, or
          until the project or your account is deleted.
        </li>
        <li>
          You can delete messages, connected accounts and keys at any time.
        </li>
        <li>
          Deleting your account (Settings → Account) removes your profile,
          sign-in, keys, connected accounts, the messages you wrote, and any
          project only you were in. Projects shared with others are handed to
          another member, so the team keeps its work.
        </li>
        <li>
          Copies can remain in backups and logs for a limited time. See the{" "}
          <Link href="/privacy" className={linkClass}>
            Privacy Policy
          </Link>
          .
        </li>
      </List>


      <H2>How is it protected?</H2>

      <List>
        <li>
          <strong>In transit:</strong> HTTPS everywhere, with browsers told
          never to use an unencrypted connection (HSTS).
        </li>
        <li>
          <strong>At rest:</strong> the database and uploaded attachments are
          hosted on Supabase, which encrypts stored data (AES-256).
        </li>
        <li>
          <strong>A second layer for the sensitive parts:</strong> API keys,
          tokens for connected accounts (Google, GitHub and apps) and your
          agents&apos; memory are encrypted again with AES-256-GCM, using a key
          only our server holds.
        </li>
        <li>
          <strong>Who can see what:</strong> every table is protected by
          row-level security, so people only ever see projects they belong
          to.
        </li>
        <li>
          Files that agents create in a project are stored on our application
          server.
        </li>
        <li>
          Messages and files are <strong>not end-to-end encrypted</strong> -
          the AI has to read them to help you.
        </li>
        <li>
          <strong>Certifications:</strong> we don&apos;t have SOC 2 or ISO
          27001 yet. If your company needs a security review, use Contact sales
          on the{" "}
          <Link href="/welcome#plans" className={linkClass}>
            Enterprise plan
          </Link>{" "}
          and we&apos;ll answer your questionnaire honestly.
        </li>
      </List>


      <H2>Permissions and oversight</H2>

      <List>
        <li>
          <strong>Three roles per project.</strong> Owner: everything,
          including billing, deleting the project and handing it over. Admin:
          members, settings, connections and schedules. Member: uses the
          project.
        </li>
        <li>
          <strong>Agents ask first.</strong> Deleting files, writing to Google
          Sheets, opening GitHub issues, and any connected-app action that can
          change something wait for a person to approve them. Background tasks
          can&apos;t do those at all.
        </li>
        <li>
          <strong>An activity trail for every agent task</strong> - what it
          did, step by step, visible in the project.
        </li>
        <li>
          <strong>A spend report</strong> on the Team plan: who used the
          project&apos;s shared key, and roughly what it cost.
        </li>
        <li>
          <strong>Not yet:</strong> per-channel permissions (everyone in a
          project can see all of its channels) and a full audit log of admin
          actions. If you need these, talk to us about Enterprise.
        </li>
      </List>


      <H2>What it connects to</H2>

      <List>
        <li>
          <strong>Built in, on every plan:</strong> web search and reading web
          pages, the project&apos;s own files, Google Sheets (read, and add
          rows), GitHub (read files, search code, list and open issues), and
          image generation.
        </li>
        <li>
          <strong>Connected apps, on Team:</strong> Notion, Linear, Jira &amp;
          Confluence, Asana, Sentry, Stripe, Canva, Hugging Face and DeepWiki,
          through each app&apos;s official MCP server - plus any other MCP
          server by its address. Agents can use whatever the app&apos;s server
          offers; anything that changes data waits for approval.
        </li>
        <li>
          <strong>AI models:</strong> the built-in models on every plan, a
          free Google Gemini key on any plan, and on Team your own or a shared
          key for Anthropic (Claude), OpenAI, xAI (Grok), Groq, Cerebras,
          NVIDIA, DeepSeek, Mistral, OpenRouter, Together AI, or a model server
          you run yourself.
        </li>
      </List>


      <H2>How reliable are long-running agent tasks?</H2>

      <List>
        <li>
          Background tasks run on a separate worker, not in your browser -
          close the tab and they keep going. You&apos;re notified when one
          finishes or fails.
        </li>
        <li>
          If our server restarts mid-task, the task is picked back up from the
          step it had reached, not started over.
        </li>
        <li>You can pause or stop a task at any time, even mid-step.</li>
        <li>
          If a connected tool fails, the step is retried without it rather
          than failing the whole task.
        </li>
        <li>
          <strong>The limit to know:</strong> a single task works in up to
          eight steps, and the last step always writes up a result. For bigger
          jobs, split the work into several tasks, or put it on a schedule.
        </li>
        <li>
          A scheduled agent that is still busy with its previous task waits up
          to two hours, then skips that run instead of piling up.
        </li>
      </List>


      <H2>Can I take my data with me?</H2>

      <p>
        Yes. A project&apos;s owner or admins can export the whole project
        from <strong>Settings → People → Export</strong>: one file with its
        members, channels, every message, what the agents remember,
        schedules, and the files the agents wrote. Attachments are listed in
        the export and can be downloaded from the chat. You can delete your
        account at any time from Settings → Account.
      </p>


      <H2>How good is the AI on the free plan?</H2>

      <List>
        <li>
          <strong>Free:</strong> GPT-OSS 120B - OpenAI&apos;s open-weight
          model - served by Groq, with {DAILY_MESSAGES.free} built-in AI
          messages per person per day.
        </li>
        <li>
          When the shared free capacity is busy, it steps down to GPT-OSS 20B,
          then Qwen3 27B, and the reply says when a different model answered.
          If all of those are busy, a small model on our own server answers.
        </li>
        <li>
          <strong>Team:</strong> {DAILY_MESSAGES.team} built-in messages per
          person per day, plus your own or a shared key for Claude, GPT,
          Gemini and others. Messages on a key are billed by that provider and
          don&apos;t count toward the daily allowance.
        </li>
        <li>
          For heavy or sensitive work, adding a paid key of your own is the
          surest way to get consistent quality.
        </li>
      </List>
    </LegalPage>
  );
}
