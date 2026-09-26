---
name: team-hosting
description: Prepare, diagnose or verify this Xchange app's Vercel frontend and API connection to Atlas. Use for project hosting requests, distinguishing a static sample preview from the authenticated live workspace.
---

# Host the live workspace

Read [the hosting runbook](../../docs/frontend-sharing.md) and inspect
[vercel.json](../../vercel.json), [the hosted loader](../../apps/api/src/hosted-config.ts)
and the current source revision. Historical URLs and checks are evidence to recheck,
not proof of the current deployed target. Respect existing authorization for the
requested deployment; a skill alone grants no provider access.

The intended build is the real `apps/dashboard` with the `api/index.ts` function
and same-origin API routing. The offline `dist-preview` build uses synthetic records
and cannot enroll teammates or persist writes. A static homepage or Git push does
not prove the API is deployed. Check which repository/branch the actual Vercel project
uses before assuming this repository's push triggers it.

Use the current environment's approved scoped provider credentials and redacted
diagnostics. Configure only server-side MongoDB credentials, explicit database and
project scope, canonical HTTPS origin, session signing secret and individual grants
listed in the runbook. No `VITE_` credentials or local default token. Use
[team-access](../team-access/SKILL.md) for enrollment. Do not widen Atlas network
access or switch to another account as a connectivity shortcut.

Run repository checks and keep the previous deployment identity for rollback.
After the authorized deploy, verify JSON `/health` reports MongoDB, anonymous
`/v1/access` returns 401, and an enrolled caller gets its intended actor/role/scope.
Sign in through the canonical frontend URL. Exercise a marked write with one actor,
read it with another and in the UI, and confirm persistence in a fresh API instance.
Check reader writes and writer publication are denied. Report local tests, remote
deployment and actual enrollment separately.

A Vercel function serves requests; it is not a persistent agent worker. Do not
claim background execution or learning effectiveness from deployment. If a rollout
fails, use the retained known deployment within the authorized rollback scope and
state whether it restores a live app or only the read-only preview. Database state
is a separate boundary; do not reset records to fix hosting.
