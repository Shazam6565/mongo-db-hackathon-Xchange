# Xchange provider for Phoenix MCP

[`xchange_provider.py`](xchange_provider.py) is a registration adapter for the
existing `phoenix_mpc/apps/phoenix_mcp` application. It uses Phoenix's current
`ProviderRegistration`, `RemoteMCPProvider` and verified `Actor` interfaces. It
contains no credentials, grants, deployment changes or additional executor.
The [plugin guide](../../docs/mcp-plugin.md) covers the Xchange server and OpenAI
package.

The path is Codex → Phoenix MCP → Xchange `/mcp` → scoped Xchange API → MongoDB.
Deploy the Xchange HTTP endpoint first. Its target must be an operator-configured
HTTPS URL ending at `/mcp`; the model cannot choose a host or workspace.

## Register in the existing deployment

Make this module importable in Phoenix's MCP application environment. Use its
factory in that deployment's existing registration list:

```python
from xchange_provider import READ_ONLY_TOOLS, xchange_registration

registration = xchange_registration(
    configured_xchange_mcp_url,
    resolve_current_xchange_token,
    promoted_tools=READ_ONLY_TOOLS,
)
# Include registration in the existing create_app(registrations=..., store=...)
# call. Preserve the other providers and Phoenix's durable capability store.
```

`resolve_current_xchange_token(actor)` must be an async resolver implemented by
the deployment's enrollment layer. On every discovery and invocation it checks
the current enrollment for verified `(actor.subject, actor.client_id)` and
returns that installation's individual Xchange bearer token, or `None` when
absent, expired or revoked. The enrollment must record and verify the intended
Xchange actor, workspace and role. Never use email alone as the binding, forward
the Phoenix access token, or give all callers a shared owner credential.
The adapter does not cache or log tokens. Xchange still checks its credential,
scope and role for every operation.

Explicitly select additional tools from `WRITE_TOOLS` and `MEMORY_TOOLS` when the
deployment is ready for them. `ALL_TOOLS` is the reviewed 14-tool upper bound;
unrecognized names fail registration. Future upstream tools are not promoted
automatically. The adapter intentionally rejects catalogs larger than this
version's 14-tool contract instead of silently exposing a partial catalog.

## Scopes and effects

All selected tools require `mcp:tools` and `xchange:read`. These are proposed
integration scope names, not a claim that the current OAuth deployment issues
them. Configure consent for these scopes and create exact subject/client
capability grants through Phoenix's established administration flow. Scopes,
provider promotion and a successful sign-in alone confer no execution grant.

| Selection | Additional scope | Phoenix effect |
| --- | --- | --- |
| `READ_ONLY_TOOLS` (9 tools) | None | Read only |
| `MEMORY_TOOLS` (`xchange_load_memory`) | `xchange:memory` | Mutation: appends a memory-consumed audit event |
| `WRITE_TOOLS` (4 tools) | `xchange:write` | Mutation: ticket, Timeline, canvas or candidate creation |

Phoenix exposes names such as `xchange__xchange_read_canvas`. Its trusted
`read_only_tools` list excludes memory consumption even though Xchange's API
uses GET for that operation. A reader credential can consume memory when
separately authorized; domain write tools also require an Xchange writer or
evaluator credential. Publication, evaluation, rollback, credential management
and ticket status changes are absent.

The existing gateway must execute this registration with its durable store and
current capability grants. Preserve its schema/effect fingerprints, receipts,
limits and any required trusted confirmations. Do not instantiate an unaudited
gateway or relax grants to get a test call through.

## Codex write transport remains a separate gate

Phoenix requires a stable
`params._meta["phoenix/idempotency_key"]` for all five mutating tools, including
`xchange_load_memory`. Four domain writes also take an `operationId` UUID in
their Xchange input. These are separate layers: a tool argument does not supply
Phoenix transport metadata. Keep both values stable with the identical request
when an explicit retry is appropriate; read a failed or uncertain receipt
before retrying.

Phoenix's checked-in `integrations/codex/README.md` records that ordinary Codex
mutations were refused with `request_key_required` when that metadata was
missing. This adapter does not solve or bypass that host-transport limitation.
Prove the actual Codex transport supplies metadata and inspect a successful
receipt before claiming writes work from the app. Read tools can be activated
independently. Installing the OpenAI plugin or signing in does not register this
provider, issue new scopes, or create grants.

## Offline contract check

Run against Phoenix's existing MCP environment and source, without starting
services, touching a database or loading tokens:

```sh
PHOENIX_REPO=/absolute/path/to/phoenix_mpc
PYTHONDONTWRITEBYTECODE=1 \
PYTHONPATH="$PHOENIX_REPO/apps/phoenix_mcp/src:integrations/phoenix" \
  "$PHOENIX_REPO/apps/phoenix_mcp/.venv/bin/python" \
  -m unittest discover -s integrations/phoenix -p 'test_*.py' -v
```

The tests use Phoenix's real registration and gateway types with synthetic
actors and mocked upstream responses. They check exact catalog coverage,
scope separation, mutation classification, current per-client token resolution,
revocation, unsafe token rejection and target/promotion bounds. They do not
prove deployed access, OAuth consent, live grants or Codex transport support.
