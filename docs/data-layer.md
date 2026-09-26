# Data layer: projects, starting corpus, team writes and agent reads

Everything lives in the Atlas database `team_memory_harness` (collections are listed in
[MongoDB setup](../infra/mongodb/README.md)). Every record carries `teamId` and `projectId`,
and the API serves exactly one of those scopes, chosen by `TEAM_ID` and `PROJECT_ID`.

## Two projects

| Scope | Contents | Who reads it |
| --- | --- | --- |
| `xchange-team/xchange` | The team's real backlog, decisions and lessons from building Xchange | Agents working on this repository |
| `xchange-team/event-platform` | Synthetic demo world for the judged demo (DEMO-* tickets, engineer-a/b/c) | The demo run only |

Keeping them apart means agents building Xchange never load invented lessons. To run the
dashboard and API against the demo world, override the project for that shell:

```bash
PROJECT_ID=event-platform npm run dev
```

Shell variables take precedence over `.env`. To run both at once, give the second API a
different `PORT` and point a second dashboard at it with `TEAM_API_URL`.

## Starting corpus

`corpus/xchange.json` and `corpus/event-platform.json` are the starting data. Load or top up either one with:

```bash
npm run seed -- corpus/xchange.json corpus/event-platform.json
npm run seed -- corpus/event-platform.json --dry-run   # validate against empty temporary storage
```

- The loader sends every record through the API routes in-process, so it gets the same
  validation, idempotency and gate as any other client. It never writes collections directly.
- Record IDs are derived from corpus keys. Re-running is a no-op, and a record the team has
  edited since seeding is reported as `kept` and left unchanged. The loader never deletes.
- Lessons enter as candidates. With `"evaluate": true` (the default), the loader runs the existing gate
  once, and only a passing evaluation publishes. Today the gate routes only event-platform and
  frontend lessons, so real Xchange lessons stay candidates marked `needs-review` (XCH-3).
- Records reference each other by key: an activity `subject` is `{ "kind": "lesson" | "activity", "key": … }`,
  and a canvas record node's `ref` is `{ "kind": "ticket" | "lesson", "key": … }`.
- Mark synthetic evidence as synthetic. Never copy the held-out cases in `evals/triage-suite.json`
  into a corpus; `apps/api/src/seed.test.ts` fails if a corpus contains them.

To add starting data, edit a corpus file, run it with `--dry-run`, get the change reviewed, then seed.

## How the team writes

All writes go through the API, which owns the database credentials and the scope.

| Path | Use it for |
| --- | --- |
| Dashboard (`npm run dev`) | Tickets (Add ticket), activity records (New record), canvases, running Evaluate on a candidate |
| Agent skill: `node skills/team-memory/scripts/client.mjs …` | Scripted or agent writes: lesson proposals, activity records, canvases. See `skills/team-memory/SKILL.md` for the commands |
| Pi extension: `/share-lesson Title \| Lesson \| TICKET` | Proposing a lesson from inside a Pi session |
| A corpus file plus `npm run seed` | Bulk or reviewed starting data |

Every create request should carry a UUID `Idempotency-Key`. Retrying the identical request with
the same key returns the original record, and reusing a key for different content returns 409. This
applies to tickets, activity records, canvas writes and lesson proposals. Nothing written this way
becomes shared memory until the gate publishes it.

Do not write collections directly with Compass or mongosh. That bypasses validation, idempotency,
the publication gate and the audit trail.

## How agents fetch

- **Pi:** the extension fetches published lessons before every run and injects them as context.
  `/team-memory` refreshes `.team-memory/MEMORY.md`.
- **Any agent:** `node skills/team-memory/scripts/client.mjs memory` returns the scope's published
  lessons: the ten most recently updated, with no ranking for the current ticket yet (XCH-4).
- `/v1/memory` records a `memory.consumed` audit event for the caller. Use `catalog` or
  `GET /v1/lessons` to inspect data without appearing as a consumer.

Agents need only `TEAM_API_URL`, `TEAM_API_TOKEN` and `ENGINEER_ID`, never `MONGODB_URI`.

## Access for teammates

- **Today, from each teammate's machine:** run the API locally against the shared Atlas database.
  The teammate needs a `.env` with `MONGODB_URI` delivered privately (for example, through 1Password,
  never through Git or chat), `TEAM_ID=xchange-team`, the right `PROJECT_ID`, and their IP address
  allowed in Atlas Network Access.
- **Hosted:** once the hosted API is deployed (XCH-9), teammates and their agents use its HTTPS URL
  with individual grants instead of the database URI. See [frontend sharing](frontend-sharing.md).
