# Repository skillset

These maintained skills ship with the repository. Their canonical source is
`skills/<name>/`; tracked relative symlinks expose each one through both
`.agents/skills/` and `.claude/skills/`. A fresh clone needs no personal home-directory
skills. Harnesses that accept explicit skill paths can open the canonical `SKILL.md`.
Keep this repository together: operating skills reference its docs, client and
contracts. Copying one `SKILL.md` alone is not an installation.

| Skill | When to use |
| --- | --- |
| [team-access](team-access/SKILL.md) | Enroll, inspect, rotate or revoke teammate and agent access |
| [team-memory](team-memory/SKILL.md) | Read shared memory, propose lessons and load published lesson skills |
| [team-tickets](team-tickets/SKILL.md) | Inspect the catalog and create scoped, retry-safe workspace tickets |
| [team-activity](team-activity/SKILL.md) | Record observations, decisions, applications, outcomes and corrections |
| [team-canvas](team-canvas/SKILL.md) | Read, draw and revise shared canvases through validated records |
| [team-harness](team-harness/SKILL.md) | Inspect versions, evaluate candidates, roll back lessons and refresh derived skills |
| [team-corpus](team-corpus/SKILL.md) | Validate and seed reviewed starting records and onboarding guides |
| [team-hosting](team-hosting/SKILL.md) | Configure, diagnose and verify this app's Vercel/Atlas deployment |

This bundle contains project operating procedures. The owner's personal foundation
build skills are not dependencies. Current code, scoped task and owner direction
decide what work is needed. Provider-specific connectors/plugins remain environment
capabilities; these files do not install them, grant credentials, or authorize
external changes. Review and commit maintained skill changes like application code.

## Shared lessons are a separate layer

`team-memory/scripts/client.mjs sync-skills` materializes the API's active published
lessons as `team-lesson-*` skills. Those are project-specific, gitignored caches and
can change after publication/rollback. They supplement the maintained skillset;
they do not replace it or modify its permissions. See [team-memory](team-memory/SKILL.md).

## Verify packaging

Run `npm run skills:check`. It checks the canonical skill metadata, both discovery
links, local Markdown references, and absence of personal absolute paths. It runs
as part of `npm run check`. On systems that do not preserve Git symlinks, enable
symlink support or use the canonical paths; a text file containing a symlink target
is not a discovered skill.

When adding a maintained skill, put its files under `skills/`, add both relative
discovery links, and update this table. Keep substantial optional guidance in
referenced files. Verify helper behavior and current API contracts instead of
inventing endpoints. Generated lesson skills must keep the `team-lesson-` prefix
and must not be added to this maintained catalog.
