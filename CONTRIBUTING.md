# Contributing to Teamski

Thanks for helping. Teamski is built by one person
right now, so a clear issue or a small, focused pull
request goes a long way.

## Reporting a bug or idea

[Open an issue](https://github.com/janakrathi/Teamski/issues)
with what you did, what you expected, and what
happened. Screenshots and log lines help.

**Security problems:** please use the Contact us
form at [teamski.in](https://teamski.in) (bottom of
the page) instead of opening a public issue.

## Making a change

1. Fork the repo and set it up with
   [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).
2. Make your change on a branch.
3. Check it:

   ```bash
   npx tsc --noEmit
   npm run lint
   npm test
   npm run build
   ```

4. Open a pull request that says what changed and
   why.

## Conventions

- **Comments explain why,** not just what. Match the
  style of the file you're in.
- **Worker-reachable files use relative `.ts`
  imports** (`../email/send.ts`), never `@/`. The
  worker runs TypeScript directly with Node, which
  can't resolve the `@/` alias.
- **Never show users a raw model or provider
  error.** Send failures through
  `friendlyModelError` in `lib/ai/errors.ts`.
- **Every API route checks membership** (and the
  role, through `can()` in `lib/plans.ts`) before
  touching a project's data.
- **Schema changes are new numbered migrations** in
  `supabase/migrations/`, added to `ALL.sql` too.
- **Add or update tests** for logic you change.
  Tests use `node:test` and live in `tests/`.

## Licence

By contributing, you agree that your contributions
are licensed under the [AGPL-3.0](LICENSE), like the
rest of the project.
