# Xchange plugin and MCP integration

The repository owns a portable plugin, its operating skill, and one MCP tool
surface with two transports. Codex can launch the bundled stdio server. Phoenix
MCP can connect to the remote Streamable HTTP endpoint and expose the same tools
through its gateway. Both paths use the scoped Xchange API; MongoDB credentials
remain in the backend.

```text
Codex + Xchange plugin → stdio MCP → Xchange API → MongoDB
Codex → Phoenix MCP → Xchange /mcp → Xchange API → MongoDB
```

The package is source-controlled capability, not a claim that a particular Codex
task or Phoenix deployment is already connected. Installation, private credential
binding, host grants and a successful connection check are separate steps.

## Package contract

`plugins/xchange/` contains:

| File | Purpose |
| --- | --- |
| `plugin.json` | Agent Plugins 1.0 identity and OpenAI presentation metadata |
| `mcp.json` | Portable stdio connection |
| `skills/xchange-workspace/SKILL.md` | Self-contained operating workflow |
| `.codex-plugin/plugin.json` | Codex compatibility manifest |
| `.mcp.json` | Codex compatibility stdio connection |
| `dist/stdio.mjs` | Generated, self-contained Node server |
| `dist/tool-catalog.json` | Generated MCP tool schemas and annotations |
| `dist/openai-tools.json` | Generated Responses API function declarations |
| `dist/THIRD_PARTY_NOTICES.txt` | Notices for bundled dependencies |

The portable manifest follows the current [OpenAI packaging format](https://developers.openai.com/plugins/build/plugins),
with presentation under `extensions.com.openai`. Skills and the MCP declaration
use the standard fixed locations. There are no fabricated registered-app IDs,
privacy pages, icons, lifecycle hooks or external skill paths.

The portable command is `node` with `${PLUGIN_ROOT}/dist/stdio.mjs` as its argument.
The [Agent Plugins MCP format](https://agent-plugins.org/plugin-authors/mcp-servers)
defines that expansion and the plugin working directory. Its headers are literal
package data and its environment fields are not a secret store. The compatibility
file instead uses `cwd: "."` with a relative bundle argument, matching
[Codex's legacy relative-cwd handling](https://github.com/openai/codex/blob/main/codex-rs/codex-mcp/src/plugin_config.rs).

## Build and check

From the repository root with Node 22 or newer:

```sh
npm ci
npm run mcp:build
npm run mcp:check
npm run plugin:check
```

Build before distributing the plugin directory so it includes `dist/stdio.mjs`.
The installed package does not need the source checkout or its `node_modules`.
When changing schemas or tool behavior, rebuild the bundle and check the package
together. Keep the portable and compatibility identity/version metadata aligned.

The generated Responses API declarations use `strict: false` to preserve the
tools' optional input fields. They describe functions but do not execute them:
an application must bind the caller's identity and scope, dispatch function
calls through the validated tool handlers, and return results to the model.
Do not treat a generated declaration as an authorization grant. MCP supplies
the implemented transport for Codex and Phoenix; the function declarations
support other callers without maintaining a separate hand-written catalog.

## Private runtime configuration

Each human or agent installation uses its own Xchange identity, as described in
[team access](team-access.md). An ordinary working agent receives a writer token;
inspection-only installations receive reader tokens. Do not distribute an owner
or evaluator token as the plugin's shared credential.

The stdio process requires:

| Variable | Value |
| --- | --- |
| `TEAM_API_URL` | Exact Xchange API origin; HTTPS remotely |
| `TEAM_API_TOKEN` | This installation's individual bearer token |
| `TEAM_EXPECTED_TEAM_ID` | Intended team from enrollment |
| `TEAM_EXPECTED_PROJECT_ID` | Intended project from enrollment |

Provide these through the host's private environment configuration. Portable
clients may sanitize ambient variables, so verify delivery rather than assuming
the desktop app inherits a terminal's environment. The legacy Codex declaration
names these variables in `env_vars`; it contains no values. The canonical
portable format deliberately has no host-specific `env_vars` property.

For a standalone local probe, use a privately prepared environment file:

```sh
node --env-file=/absolute/private/xchange-agent/credential.env plugins/xchange/dist/stdio.mjs
```

The process speaks MCP JSON-RPC on stdin/stdout; it is not an interactive shell.
An MCP client performs initialization, lists tools and then calls `xchange_access`.
The process checks the returned identity and exact expected scope before work.
Hosted access must use team authentication. Local owner mode is only a development
option with explicit `XCHANGE_ALLOW_LOCAL_OWNER=1`; the distributed manifest
does not enable it.

## Connect Claude Code or Codex to the hosted endpoint

The deployment's `/mcp` endpoint serves the same tools with no plugin build or local
process. It needs only the caller's individual bearer token; the server fixes the
team/project scope. With the token saved in `~/.team-memory/credential.env`:

```sh
claude mcp add --transport http --scope user xchange https://mongo-db-hackathon-xchange.vercel.app/mcp --header "Authorization: Bearer $(grep '^TEAM_API_TOKEN=' ~/.team-memory/credential.env | cut -d= -f2-)"
codex mcp add xchange --url https://mongo-db-hackathon-xchange.vercel.app/mcp --bearer-token-env-var TEAM_API_TOKEN
```

The token is read from the file instead of being typed. Claude Code stores the header
in its private user configuration. Codex reads `TEAM_API_TOKEN` from its own environment
at startup, for example `(set -a; . ~/.team-memory/credential.env; codex)`.
`claude mcp list` reports `✔ Connected` only when the token is accepted; this was
verified against the live deployment on 26 September 2026 with a writer agent token.

## Load in Codex

Add the built plugin directory to an installed local or repository marketplace,
using a plugin entry named `xchange` whose source is `./plugins/xchange` relative
to that marketplace root. The [OpenAI local installation guide](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually)
describes discovery. A repository marketplace normally lives at
`.agents/plugins/marketplace.json`; creating the package does not create or edit
personal marketplace settings.

Use `codex plugin marketplace list` to verify the marketplace's actual name and
root, then install `xchange@MARKETPLACE_NAME` with `codex plugin add` or from the
desktop Plugins directory. Configure the process environment privately, refresh
the installed package after changes, and start a new task so tools and skills
can be discovered. If the host cannot supply private variables to bundled stdio,
register the server as a host-managed MCP connection with private environment
configuration and disable the duplicate bundled server.

First call `xchange_access`, check the actor/role/scope, and read the catalog.
With an authorized writer, create a clearly identified test ticket with one
operation UUID, read it back, and retry the same request with the same UUID to
verify that no duplicate is created. Report the returned ID. A missing tool,
401, 403 or scope mismatch is a failed setup check, not evidence of access.

## Tool surface

All arguments use strict schemas. Identity, scope and database access cannot be
overridden by tool input.

| Tool | Input / behavior |
| --- | --- |
| `xchange_access` | Identity, role and scope |
| `xchange_catalog` | Recent tickets and lessons; up to 100 of each |
| `xchange_read_ticket` | `{ id }`, ticket UUID |
| `xchange_read_lesson` | `{ id }`, lesson ID |
| `xchange_read_activity` | `{ id }`, activity UUID |
| `xchange_read_canvas` | `{ id }`, canvas UUID and resolved references |
| `xchange_list_canvases` | Current canvas list |
| `xchange_list_activity` | Kind, root, ISO dates, cursor and limit filters |
| `xchange_inspect_harness` | Active version/history without consumption |
| `xchange_load_memory` | Active lessons; records consumption |
| `xchange_create_ticket` | `{ operationId, ticket }` |
| `xchange_record_activity` | `{ operationId, activity }` |
| `xchange_save_canvas` | `{ id, operationId, expectedRevision, canvas }` |
| `xchange_propose_lesson` | `{ operationId, candidate }`; no caller-supplied author |

The last four tools require writer access and are hidden from readers. Loading
memory is available to readers but creates a consumption audit; it is not a
side-effect-free inspection. Publication, rollback, access administration,
deployment, corpus seeding and arbitrary HTTP/database operations are absent.
Ticket lifecycle stages are still manual canvas placements: there is no native
status mutation tool.

## Connect through Phoenix MCP

Phoenix contains the native `providers.xchange` registration factory and its
[integration guide](https://github.com/xavugabla/phoenix_mcp/blob/main/integrations/xchange/README.md).
Use that factory in the existing gateway deployment; this repository also keeps
the reviewed adapter under `integrations/phoenix/` for reference and distribution.

Use Phoenix's `RemoteMCPProvider` against the deployed Xchange `/mcp` endpoint.
This is a Streamable HTTP MCP service, not a plugin manifest URL or REST OpenAPI
document. A remote Phoenix worker cannot use this machine's loopback server;
it needs the reachable HTTPS deployment. The repository's
[Phoenix provider adapter](../integrations/phoenix/README.md) defines the exact
tool allowlist and scope policy for registration.

The integration must bind the authenticated Phoenix caller to a separately
enrolled Xchange token and expected team/project scope. Retrieve that token from
Phoenix's private credential binding when establishing the upstream connection.
Do not reuse one owner token across users, accept a token from model arguments,
or equate a signed-in Phoenix session with an Xchange grant. Xchange verifies its
own role and scope on every operation. Browser sign-in is a separate capability.

The adapter supports an allowlist of 14 upstream tools and requires an explicit
reviewed subset in `promoted_tools`. Register that subset through Phoenix's
provider contract and assign explicit grants to the intended principals. Begin
with the nine inspection tools; grant the four mutations only for authorized writers. Grant
`xchange_load_memory` with awareness that it records consumption. Use the exact
names Phoenix registers, including its namespace, when defining grants.
The adapter requires `mcp:tools` and `xchange:read`; the four domain writes also
require `xchange:write`, and memory consumption requires `xchange:memory`.

All five operations that change state, including memory consumption, require
stable `phoenix/idempotency_key` request metadata. The client/gateway must carry
this in the MCP request `_meta`; the Xchange `operationId` argument does not
satisfy Phoenix's own metadata policy. For the four domain writes, retain both
keys and the exact payload across retries; they can use the same UUID. Memory
consumption has no `operationId` argument. Never weaken the gateway policy to
accommodate a client that omits metadata.

The first integration proof is a scoped catalog read followed by one ticket
create/read/retry, verified in both Catalog and Phoenix's execution receipt.
Also check that a reader sees no mutation tools and cannot write. Reconnect the
Codex task after the provider and grants are installed; adding files to this
repository alone does not make Phoenix tools callable in an already running task.

For canvas saves, the operation UUID and current `expectedRevision` solve
different problems. An identical retry uses both unchanged. A 409 requires
rereading and reconciling live changes before a new UUID and observed revision
are used. Gateway idempotency must preserve, not replace, this API contract.
