# Teammate and agent access

Use one identity for each person and a separate identity for each agent installation.
The frontend and agents use the same scoped API. Only the API holds the MongoDB
connection string. This guide is the onboarding and offboarding contract; see
[live hosting](frontend-sharing.md) for deployment variables and connection evidence.

## How access works

| Who | Can do | Needs |
| --- | --- | --- |
| Anyone with the link | Browse Catalog, Canvas, Timeline and Harness, read-only | Nothing: open https://mongo-db-hackathon-xchange.vercel.app |
| Teammate | Add tickets and activity, edit canvases | A personal `writer` token, pasted once into **Sign in**; the browser stays signed in for 30 days |
| Evaluation operator | Also publish through the fixed-suite gate and roll back lessons | A personal `evaluator` token |
| Agent installation | Read and write through the same API, with server-derived attribution | Its own token as `TEAM_API_TOKEN` |

Read-only guests exist only when the deployment sets `TEAM_GUEST_READ=true`, which
the live deployment does. Guests cannot write, load memory (`/v1/memory`,
`/v1/harness/active`) or call `/v1/access`, so they never appear as a lesson
consumer. A request that presents a wrong or revoked token gets 401, not guest
access, so a misconfigured agent fails loudly instead of silently reading.

## Identities and permissions

| Identity | Credential | Allowed use |
| --- | --- | --- |
| Teammate, e.g. `teammate.alex` | Individual team token, exchanged for a browser session | View or edit the workspace according to the assigned role |
| Agent installation, e.g. `agent.alex.pi` | Its own team bearer token | Call the same API, with server-derived attribution |
| Evaluation operator, e.g. `evaluator.review` | Separate evaluator token | Run the fixed-suite evaluation/publication gate |
| Application backend | MongoDB database user | Read/write only the intended application database and cluster |
| Infrastructure operator | Atlas project access or an Atlas service account | Manage infrastructure and access configuration when authorized |

Actor names are stable labels, not email verification or identity-provider accounts.
Keep an owner-maintained private roster mapping each actor to its human owner,
purpose, role, issuance date and revocation status. Each token is independently
revocable. Tokens have no built-in expiry; set a rotation date in that roster.
The current deployment has one fixed `TEAM_ID` / `PROJECT_ID` scope and up to 100 grants.
All enrolled actors can read that scope; there are no per-record private permissions.

| Role | Read records and memory | Add tickets/activity/candidates; edit canvases | Evaluate/publish |
| --- | --- | --- | --- |
| guest (no token, when enabled) | Records only, not memory | No | No |
| `reader` | Yes | No | No |
| `writer` | Yes | Yes | No |
| `evaluator` | Yes | Yes | Through the fixed-suite gate only |

Use `reader` for inspection and `writer` for ordinary teammates and working agents.
Keep evaluator credentials with the evaluation operator. Memory retrieval records an
audit event even for a reader. Activity, canvas changes, candidate authors and memory
consumption derive identity from the authenticated grant. Ticket records currently
have no author field. `ENGINEER_ID` cannot impersonate another hosted actor.

An Atlas service account accesses the Administration API, which does not read/write
cluster documents. Give the backend a database user with `readWrite` on the intended
database, restricted to the intended cluster, and an approved network route. Use a
separate database user for any direct human Compass access. Do not give teammates'
agents the backend URI. Sources: [Atlas administration authentication](https://www.mongodb.com/docs/atlas/configure-api-access/)
and [database users](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/).

## Owner: prepare and enroll a credential

From the repository root after `npm ci`, run the issuer once per identity. Choose an
existing private parent directory outside all Git checkouts. The final directory
must not exist. Replace the example origin with the canonical deployed HTTPS origin.

```sh
npm run access:issue -- --actor teammate.alex --role writer --origin https://your-app.example --out /absolute/private/teammate-alex
npm run access:issue -- --actor agent.alex.pi --role writer --origin https://your-app.example --out /absolute/private/agent-alex-pi
```

The issuer defaults to `reader`, generates 32 random bytes per token, and creates a
directory with mode `0700` containing two files with mode `0600`:

- `credential.env`: the canonical `TEAM_API_URL` and that identity's `TEAM_API_TOKEN`.
- `grant.json`: `{ actorId, tokenHash, role }`; the token is represented by its SHA256 hash.

No token is printed, no existing output is overwritten, and paths inside this
repository (including symlink targets) are rejected. Keep output outside other
checkouts too. Preparation does not activate access or contact MongoDB/Vercel.

1. Add the generated grant object to the existing server-only `TEAM_ACCESS_GRANTS`
   JSON array in the correct Vercel project/environment. Preserve other members' grants.
2. Configure the remaining server variables from [live hosting](frontend-sharing.md),
   including an independently generated `TEAM_SESSION_SECRET` and exact `TEAM_PUBLIC_ORIGIN`.
3. Deploy the live API revision. Updating environment settings alone does not update
   already running deployments. The synthetic preview cannot accept these credentials.
4. Transfer only the intended recipient's token or `credential.env` through your
   approved private secret-sharing channel. Retain grant metadata with the owner;
   keep tokens out of Git, chat, command arguments, screenshots and shared memory.
5. Verify access as below before recording that member as enrolled.

## Teammate: use the frontend

Open the canonical app URL; the workspace opens read-only. To make changes, choose
**Sign in** in the top bar and paste your personal token. Sign-in establishes a
30-day Secure, HttpOnly cookie; the app does not persist the token in browser storage.
Sign in at the canonical URL: other deployment addresses show the workspace but refuse
sign-in. On a Mac, copy your token from its private file without displaying it:

```sh
grep '^TEAM_API_TOKEN=' /absolute/private/you/credential.env | cut -d= -f2- | tr -d '\n' | pbcopy
```

Writers can use **Add ticket** and save canvas edits. Readers can inspect records;
the API rejects writes even if a UI control is visible. Refresh after an agent writes
to see its records. A local owner dashboard does not verify personal hosted access.
Sign out on shared machines. Signing out clears that browser's session; it does not
revoke the bearer token.

## Agent: connect and read/write

Load [the team-memory skill](../skills/team-memory/SKILL.md), keeping its `scripts`
directory. The owner supplies only that agent's `TEAM_API_URL` and `TEAM_API_TOKEN`.
Inject them using your approved secret store, or the private file from enrollment:

```sh
node --env-file=/absolute/private/agent-alex-pi/credential.env skills/team-memory/scripts/client.mjs access
node --env-file=/absolute/private/agent-alex-pi/credential.env skills/team-memory/scripts/client.mjs catalog
node --env-file=/absolute/private/agent-alex-pi/credential.env skills/team-memory/scripts/client.mjs memory
```

A person's own machine can instead keep the file at `~/.team-memory/credential.env`
(mode `0600`). The client and the Pi extension read it when the variables are not set,
and default to the hosted workspace. Claude Code and Codex can connect to the hosted
`/mcp` endpoint with no local install; see
[Work on the hosted workspace](../README.md#work-on-the-hosted-workspace).

`access` must return `mode: "team"`, the expected `actorId`, role, and team/project
scope. It performs no record writes. A 401 means an absent/invalid/revoked token;
403 means insufficient role; 503 means the API or storage is unavailable. HTML or a
sample banner means the deployment is not serving the live API. Never switch to the
owner token or an unrelated database to make a check pass.

For writes, generate and retain an operation UUID, then call one of:

```sh
node skills/team-memory/scripts/client.mjs create-ticket ./ticket.json OPERATION_UUID
node skills/team-memory/scripts/client.mjs record-activity ./activity.json OPERATION_UUID
node skills/team-memory/scripts/client.mjs write-canvas CANVAS_UUID ./drawing.json OPERATION_UUID
node skills/team-memory/scripts/client.mjs propose ./candidate.json OPERATION_UUID
```

These commands assume the same two environment variables were privately injected;
use the same `--env-file` option when working with the private file. A minimal ticket
is `{ "summary": "Connection check", "description": "Synthetic onboarding record" }`.
Read the skill for canvas/activity schemas and [the candidate example](../examples/lesson-candidate.json).
Reuse the exact payload and operation UUID after an uncertain write result. A 409
requires reconciliation; a canvas edit also needs the current `expectedRevision`.
For legacy proposals without a UUID, inspect the catalog before retrying.

For Pi, inject the agent variables into the Pi process and load
`packages/pi-extension/src/index.ts` by absolute path. `ENGINEER_ID` is only a local
owner-mode label; hosted attribution comes from the token. `/team-memory` reads
published lessons. The `share_lesson` tool and `/share-lesson` publish immediately (writer tokens only). Other
harnesses can use the portable client without installing Pi.

## Verify, rotate and revoke

Before declaring shared access ready, check `/health` returns JSON with
`storage: "mongodb"`, anonymous `/v1/access` returns 401, and anonymous writes return
401 (anonymous record reads return 200 only when guest reading is on). Verify two separate
writer identities: create a marked ticket with one, read it with the other and in
the frontend, then reverse roles for an activity record. Confirm the activity has
the authenticated actor. Verify reader writes and writer publication return 403,
and records survive a fresh API instance. Do not call these live checks complete
based only on unit tests or a successful frontend build.

To rotate, prepare a new credential for the same actor in a new directory, replace
the old hash in server grants, redeploy, and distribute the replacement privately.
If a controlled overlap is needed, add the new hash temporarily and then remove the
old one. Keep the actor ID stable to retain attribution. Changing a role likewise
requires updated grants and a redeployment.

To revoke a person or installation, remove all relevant grant hashes and redeploy.
Their bearer tokens and existing sessions then fail on the updated deployment.
Retire or protect older deployments that still contain the old grants; revocation
does not rewrite their configuration. Verify the revoked token no longer works
without printing it. Revoking an agent leaves its teammate's separate token intact.

The owner is responsible for granting/revoking access; agents cannot enroll
themselves, increase roles, change network access, or publish by writing MongoDB
directly. Local owner mode remains a single-machine development capability and
must stay on loopback.

## Verification evidence — 26 September 2026

`MONGODB_GATE_URI='mongodb://127.0.0.1:27419/?directConnection=true' npm run check`
passed all 45 tests with no skips, TypeScript validation, and the frontend build.
The database checks used disposable local test databases. Credential issuance,
browser/bearer identities, denied operations, revocation, retry behavior, and the
discoverable skill entry were checked. These results do not enroll real members
or establish the Vercel-to-Atlas connection.
