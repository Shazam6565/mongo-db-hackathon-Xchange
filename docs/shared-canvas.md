# Shared canvas and MongoDB

Catalog, Canvas and Timeline use the existing React/Vite dashboard and authenticated Fastify API. The browser does not connect to MongoDB or receive database credentials. MongoDB stores lesson, ticket, activity and canvas documents; the API validates scoped records before the fixed React renderers display them.

A canvas is a bounded JSON document: notes, ticket/lesson references, positions, approved color tokens and labeled connections. References resolve current catalog content at read time rather than copying record descriptions. Removing a placement does not delete a source record. Connections express authored relationships, not independently verified derivation or causality. Activity references, freehand strokes, nested containers and runtime execution are outside this first canvas pass.

## Use the UI

Open `http://127.0.0.1:5173/?view=canvas`. The Canvas home lists **Start here** guides first, in order, then the team's working canvases and any new canvases that exist only in this browser. Open one, add notes or catalog records, and save. Drag a placement to move it; a movement under a few pixels counts as a click and changes nothing. Drag blank space, use middle drag, or hold Space while dragging to pan. Arrow keys move a focused placement; Shift moves farther. Escape cancels an active gesture. Ctrl+S (⌘S on a Mac) saves. Zoom and Fit affect only the view; a canvas opens fitted to its content.

The contextual inspector edits note text, color and position, or adds/removes labeled connections. Catalog descriptions are read-only here. Names and note text render as plain text; records cannot supply components, HTML, JavaScript, CSS, network resources or event handlers. Readers see a view-only canvas: they can pan, zoom and read every card, but the editing controls are not offered, matching the API's role check.

### Saving, leaving and conflicts

The shared copy changes only on Save. Until then, edits are kept in this browser (local storage, per project and canvas), so leaving the canvas, following a record link or closing the tab never loses them and never asks first. Reopening the canvas restores the draft and says so; Discard, offered only while there are unsaved changes, asks once, then returns to the saved revision and removes the kept copy. The status next to the title says whether the canvas is saved, unsaved and kept, or unsaved and at risk. If this browser cannot keep drafts (for example storage is blocked), leaving asks whether to save, stay or leave without saving.

Saves include an expected revision and an operation UUID. The API performs an atomic comparison before updating, so concurrent writers cannot silently overwrite each other, and an identical retry of the latest operation returns the prior result. When a save loses that race (409), the browser loads the latest revision and combines both sets of changes by node and connection ID:

- A change made on only one side is kept.
- When both sides changed the same item differently, the draft's version is kept and the item is named in a notice.
- An item one side removed and the other edited is kept, so nobody's edit disappears; connections whose placements are gone are dropped.

If nothing overlapped, the combined canvas is saved immediately as the next revision. Otherwise it stays as a draft for review. Refresh, in the footer, uses the same combination instead of refusing while there are unsaved changes. A network failure, timeout or storage outage keeps the draft and offers Save again; a 403 switches the canvas to view-only and keeps the draft in the browser. Validation runs before sending and names the problem, highlighting the card that needs a title or refers to a record that is no longer in the project. Download JSON exports the draft in the agent `write-canvas` format. There is still no live collaboration stream; use Refresh to see new agent edits.

## Writing canvases

Canvases are read by people and by agents, so they follow one set of house rules. The **Writing canvases** guide in the Canvas home shows them as a canvas.

- **One canvas, one question.** The title says what it maps; the description says who it is for and how to read it.
- **Layout.** Place cards on a 320 × 240 grid (cards are 240 × 160). Flow runs left to right, then down. Number steps when order matters.
- **Colors carry meaning.** `blue`: people, tickets and inputs. `amber`: agents and their evidence. `neutral`: the system and its rules. `sage`: verified, published or measured outcomes.
- **Notes explain, records point.** Keep titles to one line and notes under 150 characters so the whole note shows on the card. Place catalog records instead of copying their text; a record card reads its current title and status from the catalog.
- **Lines are claims.** Label every connection with a verb or an audience (`informs`, `blocks`, `agents`). A connection is an authored claim, not proof of causality. Call a hypothesis a hypothesis, and point to the test, commit or evaluation behind a claim.
- **Guides and boards.** `kind: "guide"` with an `order` lists a curated canvas under Start here; everything else is a working board. Guides are reviewed like code: author them in `corpus/xchange.json`, check them with `npm run seed -- corpus/xchange.json --dry-run`, then seed. Once seeded, edits made in the app are kept; the loader never overwrites them.

The starting guides are **Start here: join the workspace**, **How the system works**, **A lesson's life**, **Writing canvases** and **What works and what is next**. They describe the platform and its intended flow; they are not learned lessons or evidence that an agent improved.

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

For another agent environment provide only `TEAM_API_URL` and that agent's individual `TEAM_API_TOKEN`. Do not distribute `MONGODB_URI`. Local owner mode accepts an optional self-reported `ENGINEER_ID`; hosted mode derives identity from the configured grant and overrides that label. The owner API binds to loopback; the new Vercel server entry supports remote authentication but still needs deployment verification and member enrollment. See [live hosting](frontend-sharing.md). Publishing the synthetic preview does not provide that API. A fetched lesson is not evidence of use or improved performance; track those separately.

## Database configuration

Server-only `.env` is ignored by Git and should be readable only by its owner. Set `STORAGE_MODE=mongodb`, `MONGODB_URI`, `MONGODB_DATABASE`, a safe `MONGODB_LABEL`, and shared team/project scope. An explicitly requested MongoDB mode fails startup if configuration or connection fails; it never falls back to fixtures. `/health` performs a real database ping and returns only a safe display label and status. Connection pools and waits are bounded. No `VITE_` credential variables are used.

On 26 September the owner-authorized Atlas Sandbox was connected with database `team_memory_harness` and scope `xchange-team / xchange`. The agent client saved the editable **Shared learning loop** guide. Its six notes and six connections survived an API process restart unchanged and rendered in the browser. The guide describes intended flow; it is not a learned lesson or a claim that an agent improved. Later that day, with the owner's approval, `npm run seed -- corpus/xchange.json` created the five Start here guides in the same scope (every other corpus record reported `exists`). Each is revision 1 by `team-guides`, and the six ticket cards in **What works and what is next** resolved against the Atlas tickets.

## Verification

- Strict schema rejects executable/unknown fields, invalid coordinates, duplicate IDs and missing/self edge endpoints.
- API tests exercise authentication, scoped references, safe retries, stale revisions and sanitized connection failures.
- Real local MongoDB tests exercise concurrent writers, idempotent retries and reconnection using isolated disposable databases.
- Browser checks covered note/reference/connection editing, plain-text rendering, save, agent-versus-browser conflict retention, 50% zoom drag coordinates, keyboard movement, panning without dirtying, narrow-screen overflow and the Team Memory favicon.
- `packages/contracts/src/canvas-merge.test.ts` covers combining non-overlapping changes, draft-wins conflicts, edit-versus-removal and dangling connections. Browser checks on temporary storage covered leaving an unsaved canvas and restoring it, Ctrl/⌘S, an agent write during a browser edit (combined and saved automatically), a same-note conflict (kept for review), a stopped API (draft kept, Save again) and a missing note title (card highlighted).
- Actual Atlas check covered authenticated skill access, health, saved canvas rendering and process-restart persistence. Automated test databases remained local; no existing Sandbox data was imported or used as fixtures.
