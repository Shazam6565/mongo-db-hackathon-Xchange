# Catalog verification — 26 September 2026

Implemented after the other session committed evaluation work in `939742a`. Replaced the landing
page with a React/Vite Catalog and kept fixed-suite evaluation in lesson details. Ticket contracts,
storage/routes and UI live in separate modules; shared API changes are registration and lifecycle
wiring. No runtime, evaluator or Pi-extension changes; no new dependencies.

## Automated checks

- `npm run check`: tests, TypeScript and production build passed.
- `MONGODB_GATE_URI='mongodb://127.0.0.1:27419/?directConnection=true' npm test`: all 14 tests passed,
  no skips, against the existing local replica set. Each database test uses and deletes only its
  randomly named disposable test database.
- New checks cover unauthorized and invalid ticket requests; server-assigned scope/status; exact
  description preservation; idempotent retries; duplicate references; scoped list/detail; separation
  from published memory; MongoDB reconnect persistence and concurrent retries.
- Catalog model checks exercise mixed types, OR statuses and AND facets, evidence search, filtering
  across 25 tickets before pagination, non-mutating sort, and malformed column preferences.

## Browser checks

Actual pointer/keyboard interactions on the loopback preview:
- Created `UI-SMOKE-001`, an explicitly synthetic ticket. Verified the exact multiline description
  and literal `<script>` text in the inspector; reloaded its URL and reopened the same record.
- Combined ticket and text filters; applied a conflicting status to obtain the empty state; added
  Open alongside Published to check OR behavior; reload retained URL filters.
- Enabled Description, moved it before Updated, changed width to 380px, disabled wrapping and
  reloaded. Visibility, order, width and wrap persisted. Reset test preferences afterwards.
- Submitted a duplicate reference. The 409 message appeared and retained all draft fields. Cancel
  closed the form without creating a second ticket. Initial focus is on Summary.
- Inspected the existing lesson's evidence, proposed instructions, verification steps and evaluation
  section. The existing Evaluate action is preserved in the component; publication/rejection was
  tested by the existing API suite, not exercised manually from this browser session.
- Checked the normal viewport and a narrow viewport override. The rendered page stayed within the
  viewport while the table retained its own horizontal scroll; ticket details remained readable.
  Restored the default viewport. Browser logs contained no warnings or errors.

## Repairs and limits

The first test pass skipped MongoDB checks because no URI was set; the real local database run
resolved that gap. The first Docker inspection was sandbox-denied; approved local inspection located
the existing loopback replica. Browser review found initial dialog focus on Close rather than Summary;
explicit focus repaired it. Column slider steps were aligned with defaults and menus now dismiss on
outside click or Escape. The initial Blitz claim used its default repository set and failed; subsequent
claims use the task-specific `BLITZ_TARGET_REPOS` environment setting, without changing machine config.

The preview uses synthetic in-memory data, including the UI smoke ticket. Configured MongoDB
persistence is verified separately. Search is intentionally limited to the recent 100 items per type.
There is no ticket editing, Jira sync, Canvas, Timeline or automatic ticket-to-lesson linkage in this
pass. Existing single-owner local token authentication does not distinguish human from agent callers;
there is no ticket-description replacement endpoint. No provider deployment or live user data was used.
