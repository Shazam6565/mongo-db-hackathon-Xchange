# Shared canvas and MongoDB

Catalog, Canvas and Timeline use the existing React/Vite dashboard and authenticated Fastify API. The browser does not connect to MongoDB or receive database credentials. MongoDB stores lesson, ticket, activity and canvas documents; the API validates scoped records before the fixed React renderers display them.

A canvas is a bounded JSON document: notes, ticket/lesson references, positions, approved color tokens and labeled connections. References resolve current catalog content at read time rather than copying record descriptions. Removing a placement does not delete a source record. Connections express authored relationships, not independently verified derivation or causality. Activity references, freehand strokes, nested containers and runtime execution are outside this first canvas pass.

## Use the UI

Open `http://127.0.0.1:5173/?view=canvas`. Choose a canvas or create one, add notes or records, and save. Drag a placement to move it. Drag blank space, use middle drag, or hold Space while dragging to pan. Arrow keys move a focused placement; Shift moves farther. Escape cancels an active gesture. Zoom and Fit affect only the view; saved positions do not change.

The contextual inspector edits note text, color and position, or adds/removes labeled connections. Catalog descriptions are read-only here. Names and note text render as plain text; records cannot supply components, HTML, JavaScript, CSS, network resources or event handlers.

Saves include an expected revision and an operation UUID. The API performs an atomic comparison before updating. Concurrent writers cannot silently overwrite each other. An identical retry of the latest operation returns the prior result; a stale save returns 409. The browser retains its draft and can download it before the user discards, refreshes and merges. An unsaved draft is held in the current page, not a durable offline queue. There is no automatic merge or live collaboration stream; use Refresh for new agent edits.

## Give agents the same capability

Read [the portable team-memory skill](../skills/team-memory/SKILL.md). It is discoverable in this repository through `.agents/skills/team-memory`; Pi supports that Agent Skills location. Other harnesses can load the skill by absolute path or install its directory. Keep its `scripts` directory with it. This supplies instructions and a small API client, not a new agent runtime.

The existing Pi extension refreshes published lessons before each agent start and removes older memory snapshots. Other agents call the skill's `memory` command and decide applicability against their task. Candidate submission does not publish a lesson. Activity records can document observations, decisions, application and outcomes without entering shared published memory.

For this repo's local owner environment, Node can load the private configuration without displaying it:

```sh
node --env-file=.env skills/team-memory/scripts/client.mjs memory
node --env-file=.env skills/team-memory/scripts/client.mjs canvases
node --env-file=.env skills/team-memory/scripts/client.mjs canvas CANVAS_UUID
node --env-file=.env skills/team-memory/scripts/client.mjs write-canvas CANVAS_UUID ./drawing.json OPERATION_UUID
```

For another agent environment provide only `TEAM_API_URL`, `TEAM_API_TOKEN` and an optional self-reported `ENGINEER_ID`. Do not distribute `MONGODB_URI`. The current owner API binds to loopback; remote team use needs a separately hosted authenticated API. Publishing the static preview does not provide that API. A fetched lesson is not evidence of use or improved performance; track those separately.

## Database configuration

Server-only `.env` is ignored by Git and should be readable only by its owner. Set `STORAGE_MODE=mongodb`, `MONGODB_URI`, `MONGODB_DATABASE`, a safe `MONGODB_LABEL`, and shared team/project scope. An explicitly requested MongoDB mode fails startup if configuration or connection fails; it never falls back to fixtures. `/health` performs a real database ping and returns only a safe display label and status. Connection pools and waits are bounded. No `VITE_` credential variables are used.

On 26 September the owner-authorized Atlas Sandbox was connected with database `team_memory_harness` and scope `xchange-team / xchange`. The agent client saved the editable **Shared learning loop** guide. Its six notes and six connections survived an API process restart unchanged and rendered in the browser. The guide describes intended flow; it is not a learned lesson or a claim that an agent improved.

## Verification

- Strict schema rejects executable/unknown fields, invalid coordinates, duplicate IDs and missing/self edge endpoints.
- API tests exercise authentication, scoped references, safe retries, stale revisions and sanitized connection failures.
- Real local MongoDB tests exercise concurrent writers, idempotent retries and reconnection using isolated disposable databases.
- Browser checks covered note/reference/connection editing, plain-text rendering, save, agent-versus-browser conflict retention, 50% zoom drag coordinates, keyboard movement, panning without dirtying, narrow-screen overflow and the Team Memory favicon.
- Actual Atlas check covered authenticated skill access, health, saved canvas rendering and process-restart persistence. Automated test databases remained local; no existing Sandbox data was imported or used as fixtures.
