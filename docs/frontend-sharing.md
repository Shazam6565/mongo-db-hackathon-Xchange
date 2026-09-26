# Share the live workspace

The Vercel target now builds the real `apps/dashboard` Catalog, Canvas and Timeline,
plus `api/index.ts` for the same-origin team API. Catalog is the default screen.
Do not replace it with a generated landing page or deploy `dist-preview` as the live app.
The separate synthetic preview is still available for offline design review.

Use [team access and onboarding](team-access.md) for credential issuance, teammate
sign-in, agent setup, role boundaries, rotation and revocation. `npm run access:issue`
prepares private credential files; enrollment still requires applying the grant to
the intended hosted environment and verifying the deployed API.

## Current evidence — 26 September 2026

| Boundary | Evidence | Status |
| --- | --- | --- |
| Local app → configured Atlas Sandbox | `/api/health` returned `storage=mongodb`, label `MongoDB Sandbox`, checked at `2026-09-26T16:26:23.685Z`; earlier guide write survived restart (see shared-canvas.md) | Reachable; historical persistence evidence |
| Hosted API code → MongoDB | Two distinct synthetic grants wrote/read tickets, activity and a shared canvas using a disposable local Mongo replica; a fresh runtime retained the records; competing edits returned 200/409; foreign project returned404 | App/recovery checks passed locally |
| Browser session | Valid/invalid login, sign-out, expired session, API outage/retry, local mode and narrow screen exercised in an isolated synthetic browser fixture | Passed locally |
| Actual Vercel deployment → Atlas | Signed-in Vercel Resources lists five static assets and no API function; project Environment Variables reports none added | Disconnected: static synthetic preview only |

The signed-in project is `xavier-barrios-projects/mongo-db-hackathon-xchange`, ID
`prj_aMImW06QMy5JmRGmuCckxp0c8GqH`, connected to `xavugabla/mongo-db-hackathon-Xchange`
on `main`. Its production URL is https://mongo-db-hackathon-xchange.vercel.app.
Deployment `8PeNxiKaESCYG8PGWR7u23QVSw45` serves commit `cd97068` and was completed
at `2026-09-26T16:11:19Z`. Direct browser inspection shows the sample Catalog,
Canvas and Timeline with a read-only preview banner. The supplied v0 chat also
identifies this deployment. An initially opened automation tab was signed out;
the existing signed-in app tab provided access, so no new login is needed.

## Deployment configuration

Use the existing intended Vercel project, repository root as Root Directory, Vite
as framework and Node 22. `vercel.json` builds `npm run build`, serves
`apps/dashboard/dist`, and routes `/api/*`, `/v1/*` and `/health` to the server
function before the SPA fallback. `/v1/*` keeps the portable agent clients compatible.
The evaluator fixture is a static JSON import so it can be packaged with the function.

Configure these server-only variables in the correct Vercel project/environment:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Existing approved Atlas application connection, supplied privately |
| `MONGODB_DATABASE` | Explicit intended database (local Sandbox currently `team_memory_harness`) |
| `TEAM_ID`, `PROJECT_ID` | Explicit fixed scope (local Sandbox currently `xchange-team`, `xchange`) |
| `TEAM_PUBLIC_ORIGIN` | Exact canonical HTTPS app origin; other aliases cannot establish browser sessions |
| `TEAM_SESSION_SECRET` | Privately generated random session signing secret, at least 32 characters |
| `TEAM_ACCESS_GRANTS` | JSON array of `{ "actorId": "member-name", "tokenHash": "<sha256 hex>", "role": "writer" }` |
| `TEAM_GUEST_READ` | Optional. Exactly `true` lets anyone with the link read the workspace without a token; writes, memory and `/v1/access` still need one |
| `MONGODB_LABEL` | Optional safe display label, e.g. `MongoDB Sandbox` |

Hosted storage always requires MongoDB. Missing configuration returns a redacted 503;
there is no fixture fallback or local default token. Never use `VITE_` for credentials.
Use cryptographically random, individually issued tokens of at least 32 characters.
The server stores their SHA256 hashes; agents receive only their own bearer token.
Do not share the MongoDB URI with teammates' agents. Grant configuration is limited
to 100 entries for this small team slice, not an identity-management service.

Readers can retrieve scoped records and memory (retrieval writes its audit event).
Writers can add tickets, activity, candidates and edit canvases. Evaluators also run
the fixed-suite publication endpoint. Activity/canvas/memory actor identity and
candidate authors are derived from the authenticated grant. Ticket records retain
their existing schema without an author field. Stored free text is never authority.

Browser login exchanges a member token for a 30-day Secure, HttpOnly,
SameSite=Strict cookie. Cookie writes require the exact configured Origin. Tokens
are not persisted in browser storage. Removing a grant and redeploying invalidates
its tokens and sessions on the updated deployment; retire older deployments if
their URLs remain reachable. Keep evaluator credentials out of ordinary agents.

The API caches one startup promise and four bounded Mongo pools per warm function
instance (up to 5 data connections each, plus driver monitoring connections).
Budget connections across all active instances and confirm the approved Atlas
network route from Vercel. Do not open every IP or disable TLS as a connectivity fix.
This function does not host a persistent background agent or evaluation worker.

## Acceptance before calling the team connected

1. Inspect the existing Vercel project's Git repository, production branch, root,
   build command and deployed SHA; it must include this implementation. Check the
   actual function build, including workspace TypeScript dependency tracing.
2. Confirm the canonical URL opens Catalog (read-only when `TEAM_GUEST_READ=true`,
   otherwise the compact team sign-in), and that **Sign in** unlocks writes; exercise
   Canvas and Timeline deep links. No hero or preview banner.
3. Check `/health` reports MongoDB. Anonymous `/v1/access` and anonymous writes must
   return 401; anonymous `/v1/activity` returns 200 only with guest reading on. No
   endpoint should return HTML. A homepage alone proves no database connection.
4. Use two separately issued writer tokens on two clients. One creates a clearly
   marked connection-check ticket; the other reads it. Reverse roles for an activity
   observation, then create/edit/read a canvas from both. Retry identical UUID
   operations; submit competing expected revisions and confirm one 409.
5. Read the records from a fresh function instance/deployment using the same scope.
   Check a reader cannot write and a writer cannot publish. Confirm each real team
   member can authenticate before claiming the whole team is enrolled.
6. Record deployed SHA, canonical URL, timestamp, safe record IDs and results in
   the Timeline. Never include tokens, connection strings or private environment output.

`npm run check` verifies code and frontend. With the existing local test replica,
`MONGODB_GATE_URI='mongodb://127.0.0.1:27419/?directConnection=true' npm test` also
runs disposable Mongo tests. Neither command proves Vercel deployment.

The current Labs identity check is `profile=none (explicit neutral boundary)`.
Deployment requires access explicitly scoped to the intended Vercel project; do
not use an unrelated cached account. A Git push alone does not prove live deployment
or member enrollment; verify the deployed project and API separately.
Before a production change, retain the current Vercel deployment ID. Roll back by
promoting that known prior deployment; database schema is unchanged by this slice.
If that prior deployment is the static preview, it restores read-only availability,
not the new authenticated API.

## Offline synthetic preview

```bash
npm exec vite -- build --config apps/dashboard/vite.preview.config.ts
npm exec vite -- preview --config apps/dashboard/vite.preview.config.ts --host 127.0.0.1 --port 5181
```

The preview renders the same views from synthetic records, with writes blocked and
zero API requests. It is separate from the live entry's mandatory session check.

References: [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite),
[Node functions](https://vercel.com/docs/functions/runtimes/node-js),
[local Vercel builds](https://vercel.com/docs/cli/build).
