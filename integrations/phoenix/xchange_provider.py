"""Explicit Xchange promotion for the existing Phoenix MCP gateway.

Import this module inside Phoenix's phoenix_mcp environment. It does not create
grants, load credentials, or run another gateway/executor.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit

from identity import Actor
from providers.base import ProviderRegistration
from providers.remote import RemoteMCPProvider

READ_ONLY_TOOLS = frozenset({
    "xchange_access",
    "xchange_catalog",
    "xchange_read_ticket",
    "xchange_read_lesson",
    "xchange_read_activity",
    "xchange_read_canvas",
    "xchange_list_canvases",
    "xchange_list_activity",
    "xchange_inspect_harness",
})
WRITE_TOOLS = frozenset({
    "xchange_create_ticket",
    "xchange_record_activity",
    "xchange_save_canvas",
    "xchange_propose_lesson",
})
# Although the API uses GET, memory consumption appends an audit event.
MEMORY_TOOLS = frozenset({"xchange_load_memory"})
ALL_TOOLS = READ_ONLY_TOOLS | WRITE_TOOLS | MEMORY_TOOLS

# Resolve live enrollment by verified (actor.subject, actor.client_id), including
# revocation, workspace and role. Return that installation's individual Xchange
# token, or None. Never return the Phoenix access token or a shared owner token.
TokenResolver = Callable[[Actor], Awaitable[str | None]]


def xchange_registration(
    target: str,
    resolve_token: TokenResolver,
    *,
    promoted_tools: frozenset[str],
) -> ProviderRegistration:
    """Build a registration with an explicit, reviewed subset of 14 tools.

The target is operator configuration, never model input. Add the result to
Phoenix's existing create_app(registrations=..., store=...) deployment so calls
retain current grants and the durable executor. No grants are implied here.
"""
    if urlsplit(target).path != "/mcp":
        raise ValueError("Xchange target must use the configured /mcp endpoint")
    promoted = frozenset(promoted_tools)
    if not promoted or promoted - ALL_TOOLS:
        raise ValueError("Explicit promotion must select known Xchange tools")

    async def credentials(actor: Actor) -> dict[str, str] | None:
        if not actor.subject or not actor.client_id:
            return None
        token = await resolve_token(actor)
        if (
            not isinstance(token, str)
            or not 1 <= len(token) <= 1024
            or not token.isascii()
            or any(character.isspace() or ord(character) < 33 or ord(character) == 127 for character in token)
        ):
            return None
        return {"Authorization": f"Bearer {token}"}

    scopes = {name: frozenset({"xchange:write"}) for name in promoted & WRITE_TOOLS}
    scopes.update({name: frozenset({"xchange:memory"}) for name in promoted & MEMORY_TOOLS})
    return ProviderRegistration(
        provider=RemoteMCPProvider(
            "xchange", target, credentials,
            max_pages=1, max_tools=len(ALL_TOOLS), max_response_bytes=1_048_576,
        ),
        allowed_tools=promoted,
        required_scopes=frozenset({"mcp:tools", "xchange:read"}),
        tool_scopes=scopes,
        read_only_tools=promoted & READ_ONLY_TOOLS,
    )
