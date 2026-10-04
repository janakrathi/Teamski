import { test } from "node:test";

import assert from "node:assert/strict";

import { cleanName, parseRepoUrl, parseSkill, skillsPrompt } from "../lib/ai/skills.ts";

import { can, channelAccess, postRefusal } from "../lib/plans.ts";


test("a SKILL.md's front matter gives its name and description", () => {
  const skill = parseSkill(
    [
      "---",
      "name: Landing Page UI",
      'description: "Build landing pages in our house style."',
      "---",
      "",
      "# Landing pages",
      "",
      "Use a dark hero.",
    ].join("\n"),
    "folder"
  );

  assert.equal(skill.name, "landing-page-ui");
  assert.equal(skill.description, "Build landing pages in our house style.");
  assert.match(skill.body, /^# Landing pages/);
});

test("a folded description and Windows line endings are read", () => {
  const skill = parseSkill(
    "---\r\nname: deck\r\ndescription: >-\r\n  Slides for clients,\r\n  one idea per slide.\r\n---\r\nBody",
    "x"
  );

  assert.equal(skill.description, "Slides for clients, one idea per slide.");
  assert.equal(skill.body, "Body");
});

test("without front matter, the folder names it and the first paragraph describes it", () => {
  const skill = parseSkill("# Title\n\nWrites release notes.\n\nMore.", "Release Notes");

  assert.equal(skill.name, "release-notes");
  assert.equal(skill.description, "Writes release notes.");
});

test("GitHub links of every shape are understood", () => {
  assert.deepEqual(parseRepoUrl("https://github.com/acme/skills"), {
    owner: "acme",
    repo: "skills",
    ref: null,
    path: "",
  });

  assert.deepEqual(parseRepoUrl("github.com/acme/skills/tree/main/web/landing"), {
    owner: "acme",
    repo: "skills",
    ref: "main",
    path: "web/landing",
  });

  assert.deepEqual(parseRepoUrl("https://github.com/acme/skills/blob/dev/landing/SKILL.md"), {
    owner: "acme",
    repo: "skills",
    ref: "dev",
    path: "landing",
  });

  assert.deepEqual(parseRepoUrl("acme/skills.git"), {
    owner: "acme",
    repo: "skills",
    ref: null,
    path: "",
  });

  assert.equal(parseRepoUrl("https://gitlab.com/acme/skills"), null);
});

test("the prompt lists skills only when there are some", () => {
  assert.equal(skillsPrompt([]), "");
  assert.match(skillsPrompt([{ name: "deck", description: "Slides" }]), /- deck: Slides/);
  assert.equal(cleanName("  My Skill!! "), "my-skill");
});


// ------------------------------------------
// VIEWERS
// ------------------------------------------

function fakeDb(role: string | null, channelProject: string | null) {
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data:
            table === "project_members"
              ? role
                ? { role }
                : null
              : channelProject
                ? { project_id: channelProject }
                : null,
        }),
      };

      return chain;
    },
  } as never;
}

test("a viewer can see but not post; a member can do both", async () => {
  assert.equal(can("viewer", "view"), true);
  assert.equal(can("viewer", "use"), false);
  assert.equal(can("viewer", "manage_members"), false);

  const viewer = await channelAccess(fakeDb("viewer", "p1"), "p1", "c1", "u1");

  assert.deepEqual(viewer, { role: "viewer", view: true, post: false });
  assert.match(postRefusal(viewer), /Viewers/);

  const member = await channelAccess(fakeDb("member", "p1"), "p1", "c1", "u1");

  assert.deepEqual(member, { role: "member", view: true, post: true });
});

test("a channel you cannot see, or in another project, refuses", async () => {
  const hidden = await channelAccess(fakeDb("member", null), "p1", "c1", "u1");

  assert.equal(hidden.post, false);
  assert.match(postRefusal(hidden), /access to this channel/);

  const elsewhere = await channelAccess(fakeDb("member", "p2"), "p1", "c1", "u1");

  assert.equal(elsewhere.view, false);

  const outsider = await channelAccess(fakeDb(null, "p1"), "p1", "c1", "u1");

  assert.match(postRefusal(outsider), /not a member/);
});
