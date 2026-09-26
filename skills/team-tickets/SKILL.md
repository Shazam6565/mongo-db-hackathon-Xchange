---
name: team-tickets
description: Inspect Xchange catalog records or create a workspace ticket through the scoped API. Use for backlog intake and ticket references, not external issue synchronization or agent execution.
---

# Workspace tickets

Use the shared client from the repository root, with privately injected
`TEAM_API_URL` and the caller's individual `TEAM_API_TOKEN`. Verify `access` at
initial connection or after credentials change. Readers inspect; writers create.

```sh
node skills/team-memory/scripts/client.mjs catalog
node skills/team-memory/scripts/client.mjs ticket TICKET_UUID
node skills/team-memory/scripts/client.mjs create-ticket ./ticket.json OPERATION_UUID
```

Read [the ticket contract](../../packages/contracts/src/tickets.ts) when building
a request. Required `summary` is 1–160 characters; optional inputs are `key`,
`description`, `component` and `acceptanceCriteria`. The server supplies identity,
team/project scope, open status and timestamps. Preserve the user's description
verbatim when supplied; do not turn a human description into an agent summary.

Generate and retain an operation UUID before creating a ticket. Retry uncertain
responses with identical content and UUID. A reused key with different content or
an existing conflicting reference returns 409: inspect and reconcile instead of
creating duplicates with new keys. Read the returned record to verify its scope
and content, and give its ID or `/?item=ticket:ID` link to the user.

The catalog shows the latest 100 tickets and lessons per type, not a complete
database search. An older known ID can be retrieved directly. There is currently
no general ticket-update/delete route, Jira sync, status transition or automatic
agent launch; do not invent one or bypass the API with a database write. See
[frontend integration](../../docs/frontend-integration.md) before implementing
any missing workflow.

For evidence learned while working the ticket, use
[team-activity](../team-activity/SKILL.md) and reference the ticket in evidence.
For reusable knowledge, submit a candidate through
[team-memory](../team-memory/SKILL.md); ticket creation does not publish a lesson.
