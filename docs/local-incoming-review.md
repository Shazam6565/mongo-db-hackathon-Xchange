# Local and incoming review — 26 September 2026

Reviewed local commits `939742a` (evaluation gate) and `f639332` (Catalog), plus the
integration boundaries of the ongoing Canvas/activity/preview work, against
incoming `origin/main` commit `e9c3f0b` (ticket/agent-change contracts and frontend plan).
The review is based on these revisions; it is not a blanket approval of future edits.

## Findings still requiring fixes

1. **P1 — the publication gate treats prohibited checks as completed coverage.**
   `apps/evaluator/src/compare.ts` tokenizes the entire proposal and tests word
   presence. With normal demo applicability, the lesson “Do not inspect event ID
   deduplication. Never replay the same event twice.”, repeated as its instruction
   with no verification steps, produces `decision: publish`, 2/2 covered checks,
   and no regressions. This was reproduced against the clean committed snapshot.
   The fixed-suite limitation is documented, but opposite instructions must not
   automatically enter shared published memory. Keep uncertain prose in review
   or require structured/executed checks before automatic publication; add this
   negative case to the gate tests.
2. **P2 — proposal and audit writes can partially succeed.**
   `MongoLessonRepository.propose` inserts the candidate and then independently
   inserts its audit event. A failed audit write rejects the request after the
   candidate exists. A retry generates another candidate. Fault injection against
   the committed implementation produced two distinct persisted candidates from
   two failed requests. Commit both writes atomically, and give retries a stable
   identity or an explicit reconciliation path.

No additional blocking defect was found in the committed Catalog slice during
this review. That does not establish remote hosting or live agent-learning readiness.

## Incoming alignment

The owner explicitly chose the existing `apps/dashboard` direction over any
conflicting incoming frontend plan. Preserve Catalog and the concurrent Canvas
and Timeline implementation; do not restore the old lesson-only entry point or
start a root `frontend/` migration.

| Boundary | Current implementation | Incoming proposal | Resolution |
| --- | --- | --- | --- |
| Frontend | `apps/dashboard` | Future root `frontend/` | Keep current application |
| Ticket shape | Validated `TicketRecord`, UUID ID and readable key | Smaller `Ticket` interface | Alias shared `Ticket` to the canonical record |
| Ticket repository | Implemented native storage/retry interface | Parallel key-based interface | Re-export the implemented interface |
| Ticket detail | `/v1/tickets/:id` | `/v1/tickets/:key` | Keep UUID route; document distinction |
| Reports | `/v1/activity`, lesson/activity subjects | `/v1/agent-changes`, ticket-linked events | Preserve future types, explicitly require an adapter |
| Reporter identity | Self-reported local label | Authenticated engineer ID | Do not claim per-user authentication |

API probes confirm key-based ticket lookup returns 404 while the same ticket's
UUID returns 200. `/v1/agent-changes` returns 404, and the activity schema rejects
a ticket subject. Therefore the two report contracts are not interchangeable.
The revised frontend integration document records the remaining adapter work.

Git's merge simulation found conflicts in `README.md`, `apps/dashboard/src/main.tsx`,
`docs/architecture.md`, `docs/demo.md`, `infra/mongodb/README.md`, and
`packages/contracts/src/index.ts`. Resolutions were prepared outside the checkout
to preserve the active tasks' uncommitted changes.

## Verification

- Clean committed local snapshot: 12 tests passed, 2 Mongo tests initially skipped;
  TypeScript and production build passed.
- Clean incoming snapshot: 3 tests passed; TypeScript and production build passed.
- Initial reconciled merge candidate: 12 tests passed, 2 Mongo tests skipped;
  TypeScript and production build passed.
- Current integrated local work: all 24 API/evaluator/contract tests passed against
  the existing loopback MongoDB replica, including persistence and concurrent retry
  checks. Tests created and deleted only their random disposable databases.
- Sharing preview: 3 isolation checks passed. A missing `HealthResponse` export
  exposed by the new Timeline was fixed in the preview adapter; its build passed.

The normal `tsx` CLI could not create its IPC socket in the sandbox. Running the
same tests with `node --import tsx --test` succeeded. No shared owner data or cloud
database was used for the review's database checks.
