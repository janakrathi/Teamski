import type { SupabaseClient } from "@supabase/supabase-js";


// ==========================================
// SKILLS FROM GITHUB
// ==========================================
//
// A skill is a folder with a SKILL.md: YAML front
// matter (a name and a one-line description of when to
// use it) and then the instructions - the format Claude
// skills use, and plenty of repos publish (landing page
// design, slide decks, code review checklists...).
//
// Nothing here is Claude-specific. A project adds a
// repo; Teamski keeps each SKILL.md it finds. Every turn
// the agent is told only the names and descriptions -
// a few tokens each - and calls use_skill to read the
// full instructions when a task matches one, on
// whichever model is answering. A skill's other files
// (references, templates) are fetched from the repo the
// same way, only when asked for.
//
// Worker-reachable: relative imports only.
//

export type Skill = {
  name: string;
  description: string;
  body: string;

  // The GitHub page of the SKILL.md.
  source: string;
};

export type SkillSummary = {
  name: string;
  description: string;
};

// How many skills one repo may add, and how much of one
// is kept - enough for any real SKILL.md, not a dump.
export const MAX_SKILLS_PER_REPO = 30;
export const MAX_SKILL_CHARS = 60_000;

// How much of a skill a model gets per call. The rest
// is still there: the tool says how to read on.
const SKILL_PAGE_CHARS = 14_000;


// ------------------------------------------
// READING A SKILL.md
// ------------------------------------------

export function parseSkill(markdown: string, fallbackName: string): Omit<Skill, "source"> {
  const text = markdown.replace(/^﻿/, "").replace(/\r\n/g, "\n");

  const front = /^---\n([\s\S]*?)\n---\n?/.exec(text);

  const field = (key: string) => {
    if (!front) {
      return "";
    }

    // key: value, or key: >- / | followed by indented lines.
    const lines = front[1].split("\n");
    const start = lines.findIndex((line) => new RegExp(`^${key}\\s*:`, "i").test(line));

    if (start === -1) {
      return "";
    }

    const first = lines[start].replace(new RegExp(`^${key}\\s*:\\s*`, "i"), "");

    if (/^[>|][-+]?\s*$/.test(first)) {
      const rest: string[] = [];

      for (const line of lines.slice(start + 1)) {
        if (/^\s+\S/.test(line) || line.trim() === "") {
          rest.push(line.trim());
        } else {
          break;
        }
      }

      return rest.join(" ").trim();
    }

    return first.trim().replace(/^["']|["']$/g, "");
  };

  const name = cleanName(field("name") || fallbackName);

  const body = (front ? text.slice(front[0].length) : text).trim();

  // No description in the front matter: the first
  // paragraph that is not a heading.
  const description =
    field("description") ||
    body
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .find((part) => part && !part.startsWith("#")) ||
    "";

  return {
    name,
    description: description.replace(/\s+/g, " ").slice(0, 400),
    body: body.slice(0, MAX_SKILL_CHARS),
  };
}

export function cleanName(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}


// ------------------------------------------
// WHERE ON GITHUB
// ------------------------------------------

export type RepoRef = {
  owner: string;
  repo: string;
  ref: string | null;
  path: string;
};

// github.com/owner/repo, .../tree/branch/some/path,
// .../blob/branch/some/path/SKILL.md, or owner/repo.
export function parseRepoUrl(value: string): RepoRef | null {
  const raw = value.trim().replace(/\.git$/, "").replace(/\/+$/, "");

  const match =
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/(?:tree|blob)\/([^/]+)(?:\/(.*))?)?$/i.exec(
      raw
    ) ?? /^([\w.-]+)\/([\w.-]+)$/.exec(raw);

  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2],
    ref: match[3] ?? null,
    path: (match[4] ?? "").replace(/\/?SKILL\.md$/i, ""),
  };
}

function headers(token?: string | null) {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "Teamski",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function rawUrl(ref: RepoRef & { ref: string }, file: string) {
  return `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${encodeURIComponent(
    ref.ref
  )}/${file.split("/").map(encodeURIComponent).join("/")}`;
}

function gitHubError(status: number, what: string) {
  if (status === 404) {
    return `${what} was not found. Check the link - a private repo needs your GitHub account connected in Settings.`;
  }

  if (status === 403 || status === 429) {
    return "GitHub is rate-limiting requests right now. Try again in a few minutes, or connect your GitHub account in Settings.";
  }

  return `GitHub answered ${status}.`;
}


// Every SKILL.md under a repo link, read and parsed.
export async function findSkills(
  url: string,
  token?: string | null
): Promise<{ skills: Skill[] } | { error: string }> {
  const ref = parseRepoUrl(url);

  if (!ref) {
    return { error: "That is not a GitHub repository link." };
  }

  const api = `https://api.github.com/repos/${ref.owner}/${ref.repo}`;

  let branch = ref.ref;

  if (!branch) {
    const repo = await fetch(api, { headers: headers(token) });

    if (!repo.ok) {
      return { error: gitHubError(repo.status, `${ref.owner}/${ref.repo}`) };
    }

    branch = ((await repo.json()) as { default_branch?: string }).default_branch ?? "main";
  }

  const tree = await fetch(`${api}/git/trees/${encodeURIComponent(branch)}?recursive=1`, {
    headers: headers(token),
  });

  if (!tree.ok) {
    return { error: gitHubError(tree.status, `${ref.owner}/${ref.repo}@${branch}`) };
  }

  const entries = ((await tree.json()) as { tree?: { path: string; type: string }[] }).tree ?? [];

  const prefix = ref.path ? `${ref.path}/` : "";

  const found = entries
    .filter(
      (entry) =>
        entry.type === "blob" &&
        /(^|\/)SKILL\.md$/i.test(entry.path) &&
        (entry.path.startsWith(prefix) || entry.path === `${ref.path}/SKILL.md`)
    )
    .map((entry) => entry.path)
    .slice(0, MAX_SKILLS_PER_REPO);

  if (found.length === 0) {
    return {
      error: `No SKILL.md found in ${ref.owner}/${ref.repo}${ref.path ? `/${ref.path}` : ""}. A skill is a folder with a SKILL.md in it.`,
    };
  }

  const at = { ...ref, ref: branch };

  const skills = await Promise.all(
    found.map(async (file): Promise<Skill | null> => {
      const response = await fetch(rawUrl(at, file), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        return null;
      }

      const folder = file.split("/").slice(-2, -1)[0] || ref.repo;

      const parsed = parseSkill(await response.text(), folder);

      if (!parsed.name || !parsed.body) {
        return null;
      }

      return {
        ...parsed,
        source: `https://github.com/${ref.owner}/${ref.repo}/blob/${branch}/${file}`,
      };
    })
  );

  const kept = skills.filter((skill): skill is Skill => skill !== null);

  return kept.length > 0
    ? { skills: kept }
    : { error: "The SKILL.md files could not be read." };
}


// ------------------------------------------
// USING ONE
// ------------------------------------------

// The enabled skills' names and descriptions, for the
// prompt. Empty before migration 0034, or with none.
export async function skillIndex(
  db: SupabaseClient | null | undefined,
  projectId: string | null | undefined
): Promise<SkillSummary[]> {
  if (!db || !projectId) {
    return [];
  }

  const { data, error } = await db
    .from("project_skills")
    .select("name, description")
    .eq("project_id", projectId)
    .eq("enabled", true)
    .order("name")
    .limit(40);

  if (error) {
    return [];
  }

  return (data ?? []) as SkillSummary[];
}

// The lines that go into the system prompt. Short on
// purpose: the descriptions say when, use_skill says how.
export function skillsPrompt(skills: SkillSummary[]) {
  if (skills.length === 0) {
    return "";
  }

  return [
    "Skills this project added - expert instructions for particular kinds of work.",
    "When a request matches one, call use_skill with its name first and follow what it says, before doing the work:",
    ...skills.map((skill) => `- ${skill.name}: ${skill.description.slice(0, 200)}`),
  ].join("\n");
}

// A skill's instructions, or one of its other files.
export async function readSkill(
  db: SupabaseClient | null | undefined,
  projectId: string | null | undefined,
  name: string,
  file?: string,
  page = 1
): Promise<string> {
  if (!db || !projectId) {
    return "Skills are not available here.";
  }

  const { data } = await db
    .from("project_skills")
    .select("name, body, source")
    .eq("project_id", projectId)
    .eq("enabled", true)
    .eq("name", cleanName(name))
    .maybeSingle();

  const skill = data as { name: string; body: string; source: string | null } | null;

  if (!skill) {
    const known = await skillIndex(db, projectId);

    return `There is no skill called "${name}". ${
      known.length > 0
        ? `This project has: ${known.map((entry) => entry.name).join(", ")}.`
        : "This project has no skills."
    }`;
  }

  let text = skill.body;
  let label = skill.name;

  if (file && file.trim()) {
    const fetched = await skillFile(skill.source, file.trim());

    if ("error" in fetched) {
      return fetched.error;
    }

    text = fetched.text;
    label = `${skill.name}/${file.trim()}`;
  }

  const pages = Math.max(1, Math.ceil(text.length / SKILL_PAGE_CHARS));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);

  const slice = text.slice((current - 1) * SKILL_PAGE_CHARS, current * SKILL_PAGE_CHARS);

  return [
    slice,
    pages > 1
      ? `\n[${label}: part ${current} of ${pages}. Call use_skill with page ${current + 1} for more.]`
      : "",
    !file
      ? `\n[Files this skill mentions, such as references/... or templates/..., can be read with use_skill and file set to that path.]`
      : "",
  ].join("");
}

// A file beside a skill's SKILL.md, from the repo it
// came from. Paths are relative to the skill's folder
// and may not climb out of the repository.
async function skillFile(
  source: string | null,
  file: string
): Promise<{ text: string } | { error: string }> {
  const match = source
    ? /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/blob\/([^/]+)\/(.*)$/.exec(source)
    : null;

  if (!match) {
    return { error: "This skill has no repository to read files from." };
  }

  const folder = match[4].split("/").slice(0, -1);

  const parts = [...folder];

  for (const part of file.replace(/^\.?\//, "").split("/")) {
    if (part === "" || part === ".") {
      continue;
    }

    if (part === "..") {
      if (parts.length === 0) {
        return { error: "That path is outside the repository." };
      }

      parts.pop();
      continue;
    }

    parts.push(part);
  }

  const response = await fetch(
    rawUrl({ owner: match[1], repo: match[2], ref: match[3], path: "" }, parts.join("/")),
    { signal: AbortSignal.timeout(10_000) }
  ).catch(() => null);

  if (!response || !response.ok) {
    return { error: `Could not read ${file} from the skill's repository.` };
  }

  const type = response.headers.get("content-type") ?? "";

  if (!/text|json|xml|javascript|yaml|markdown/i.test(type)) {
    return { error: `${file} is not a text file.` };
  }

  return { text: (await response.text()).slice(0, MAX_SKILL_CHARS) };
}


// ------------------------------------------
// KEEPING THEM CURRENT
// ------------------------------------------
//
// A skill is a copy of a SKILL.md, so an edit in the
// repo does not reach the agent until it is read again.
// The worker re-reads every skill about once a day, and
// Settings > Skills has a Refresh button for now.
// Each skill is re-read from the exact file it came
// from (raw.githubusercontent.com, not the rate-limited
// API). Its name is kept, so nothing that refers to it
// breaks; the description and instructions follow the
// repo.

// The SKILL.md a skill came from, read again.
export async function fetchSkillAt(
  source: string,
  token?: string | null
): Promise<Omit<Skill, "source"> | { error: string }> {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/blob\/([^/]+)\/(.*)$/.exec(source);

  if (!match) {
    return { error: "This skill has no GitHub file to read from." };
  }

  const response = await fetch(
    rawUrl({ owner: match[1], repo: match[2], ref: decodeURIComponent(match[3]), path: "" }, match[4]),
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15_000),
    }
  ).catch(() => null);

  if (!response) {
    return { error: "GitHub did not answer." };
  }

  if (!response.ok) {
    return {
      error:
        response.status === 404
          ? "The SKILL.md is no longer at that path (moved, renamed, or the repo is private)."
          : `GitHub answered ${response.status}.`,
    };
  }

  const folder = match[4].split("/").slice(-2, -1)[0] || match[2];

  return parseSkill(await response.text(), folder);
}


export type SkillSyncResult = {
  updated: string[];
  unchanged: string[];
  failed: { name: string; error: string }[];
};

// Re-read skills from GitHub. One project's (the
// Refresh button), or every project's that has not been
// checked for a while (the worker). `db` must be able to
// write project_skills: the service role.
export async function refreshSkills(
  db: SupabaseClient,
  options: {
    projectId?: string;
    olderThanMs?: number;
    limit?: number;

    // A GitHub token for whoever added a skill, so a
    // private repo still reads; null for none.
    tokenFor?: (userId: string) => Promise<string | null>;
  } = {}
): Promise<SkillSyncResult> {
  const result: SkillSyncResult = { updated: [], unchanged: [], failed: [] };

  let query = db
    .from("project_skills")
    .select("id, name, description, body, source, added_by")
    .not("source", "is", null)
    .order("updated_at", { ascending: true })
    .limit(options.limit ?? 100);

  if (options.projectId) {
    query = query.eq("project_id", options.projectId);
  }

  if (options.olderThanMs) {
    query = query.lt("updated_at", new Date(Date.now() - options.olderThanMs).toISOString());
  }

  const { data, error } = await query;

  if (error) {
    return result;
  }

  const tokens = new Map<string, string | null>();

  for (const skill of (data ?? []) as {
    id: string;
    name: string;
    description: string;
    body: string;
    source: string;
    added_by: string | null;
  }[]) {
    let token: string | null = process.env.GITHUB_TOKEN ?? null;

    if (skill.added_by && options.tokenFor) {
      if (!tokens.has(skill.added_by)) {
        tokens.set(skill.added_by, await options.tokenFor(skill.added_by).catch(() => null));
      }

      token = tokens.get(skill.added_by) ?? token;
    }

    const fresh = await fetchSkillAt(skill.source, token);

    const now = new Date().toISOString();

    if ("error" in fresh) {
      result.failed.push({ name: skill.name, error: fresh.error });

      // Checked, so the next pass moves on to others.
      await db.from("project_skills").update({ updated_at: now } as never).eq("id", skill.id);

      continue;
    }

    const changed = fresh.body !== skill.body || fresh.description !== skill.description;

    await db
      .from("project_skills")
      .update(
        (changed
          ? { body: fresh.body, description: fresh.description, updated_at: now }
          : { updated_at: now }) as never
      )
      .eq("id", skill.id);

    (changed ? result.updated : result.unchanged).push(skill.name);
  }

  return result;
}
