# Frontend and agent-event integration

Reconciled 26 September 2026 with the owner's direction: retain the application in
`apps/dashboard`. The incoming proposal to replace it with a root `frontend/` app
is superseded. Catalog, Canvas, Timeline and activity tracking are implemented in the current
application and retain their existing behavior.

## Canonical tickets

`packages/contracts/src/tickets.ts` defines the validated `TicketRecord` and create
input. The `Ticket` export in the shared package aliases `TicketRecord`; it is not
a second, smaller schema. `apps/api/src/integrations/tickets.ts` re-exports the
implemented repository contract from `apps/api/src/tickets.ts`.

| Route | Current behavior |
| --- | --- |
| `GET /v1/tickets` | Scoped recent records in `{ scope, tickets }` |
| `GET /v1/tickets/:id` | A ticket by UUID, including outside the recent window |
| `POST /v1/tickets` | Validated native ticket creation; UUID `Idempotency-Key` required |

`key` is a human-readable reference, not the HTTP detail identifier. No ticket PATCH
route exists. A browser consumes the API; MongoDB credentials stay on the server.

## Agent reports and activity

The incoming `AgentChangeInput`, `AgentChange` and `AgentChangeRepository` are
preserved as future ingestion contracts. `/v1/agent-changes`, key-based ticket
lookups and `agent_changes` persistence are not implemented. Do not point a client
at these proposed routes or treat the TypeScript interfaces as runtime validation.

The concurrent activity implementation uses `/v1/activity`, `activity_records`,
UUID idempotency headers, and observation/decision/application/outcome/correction
kinds. Its subjects currently reference a lesson version or another activity,
not a ticket. Its `actorLabel` is self-reported under the local shared token;
it is not the authenticated engineer identity envisaged by `AgentChange`.

Before connecting automatic ticket reports, implement an explicit adapter or
extend the canonical activity schema to preserve ticket identity, event ID,
agent/session attribution, observation time, before/after fields and evidence.
Do not silently rename event kinds or claim that a reported proposal changed a
ticket. Add scope, retry and ticket-history acceptance checks for that integration.

## Shared invariants

- Derive project scope on the server and validate referenced records within it.
- Preserve source attribution, immutable history and retry identity.
- Distinguish observations, proposals, applications and measured outcomes.
- A log entry cannot publish a lesson or authorize a ticket change.
- Keep raw private conversations and credentials out of records.

Publication and memory retrieval continue through the existing lesson API and
fixed-suite gate. Model-based evaluation, remote user authentication and automatic
agent observation capture remain separate work.
