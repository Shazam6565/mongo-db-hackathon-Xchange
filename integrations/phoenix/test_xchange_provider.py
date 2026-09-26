"""Offline contract checks against Phoenix's real registration and gateway types."""

from __future__ import annotations

import re
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import AsyncMock

from gateway import Gateway
from identity import Actor
from mcp import types
from xchange_provider import ALL_TOOLS, MEMORY_TOOLS, READ_ONLY_TOOLS, WRITE_TOOLS, xchange_registration

TARGET = "https://xchange.example.test/mcp"
READER = Actor("member-1", "member@example.test", frozenset({"mcp:tools", "xchange:read"}), "codex-1")


class RegistrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_live_per_actor_resolution_and_revocation(self) -> None:
        other = replace(READER, client_id="codex-2")
        tokens = {(READER.subject, READER.client_id): "synthetic-first-token"}

        async def resolve(actor: Actor) -> str | None:
            return tokens.get((actor.subject, actor.client_id))

        registration = xchange_registration(TARGET, resolve, promoted_tools=READ_ONLY_TOOLS)
        credentials = registration.provider.credentials
        self.assertEqual(await credentials(READER), {"Authorization": "Bearer synthetic-first-token"})
        self.assertIsNone(await credentials(other))
        tokens[(READER.subject, READER.client_id)] = "synthetic-rotated-token"
        self.assertEqual(await credentials(READER), {"Authorization": "Bearer synthetic-rotated-token"})
        tokens.clear()
        self.assertIsNone(await credentials(READER))

    async def test_invalid_tokens_fail_closed(self) -> None:
        for token in [None, "", " token", "token\r\nX-Actor: other", "tokén", "x" * 1025]:
            with self.subTest(token_type=type(token).__name__):
                registration = xchange_registration(
                    TARGET, AsyncMock(return_value=token), promoted_tools=READ_ONLY_TOOLS,
                )
                self.assertIsNone(await registration.provider.credentials(READER))

    async def test_exact_promotions_and_scopes(self) -> None:
        registration = xchange_registration(TARGET, AsyncMock(return_value=None), promoted_tools=ALL_TOOLS)
        # The upstream's annotations are not trusted for effect classification.
        upstream = [types.Tool(name=name, input_schema={"type": "object"},
                               annotations=types.ToolAnnotations(read_only_hint=True))
                    for name in sorted(ALL_TOOLS | {"xchange_new_unreviewed_tool"})]
        registration.provider.list_tools = AsyncMock(return_value=upstream)
        gateway = Gateway([registration])

        async def names(actor: Actor) -> set[str]:
            return {tool.name for tool in (await gateway.list_tools(actor)).tools}

        self.assertEqual(await names(READER), {f"xchange__{name}" for name in READ_ONLY_TOOLS})
        writer = replace(READER, scopes=READER.scopes | {"xchange:write"})
        self.assertEqual(await names(writer), {f"xchange__{name}" for name in READ_ONLY_TOOLS | WRITE_TOOLS})
        memory_reader = replace(READER, scopes=READER.scopes | {"xchange:memory"})
        self.assertEqual(await names(memory_reader), {f"xchange__{name}" for name in READ_ONLY_TOOLS | MEMORY_TOOLS})
        self.assertEqual(await names(replace(READER, scopes=frozenset({"mcp:tools"}))), set())
        for tool in upstream:
            if tool.name in ALL_TOOLS:
                self.assertEqual(Gateway.definition(registration, tool).mutates, tool.name not in READ_ONLY_TOOLS)

    def test_operator_target_and_promotion_are_bounded(self) -> None:
        for target in ["http://xchange.example.test/mcp", "https://user:pass@xchange.example.test/mcp",
                       TARGET + "?token=bad", TARGET + "#fragment", "https://xchange.example.test/v1/tickets"]:
            with self.subTest(target=target), self.assertRaises(ValueError):
                xchange_registration(target, AsyncMock(), promoted_tools=READ_ONLY_TOOLS)
        for promoted in [frozenset(), ALL_TOOLS | {"xchange_publish_lesson"}]:
            with self.assertRaises(ValueError):
                xchange_registration(TARGET, AsyncMock(), promoted_tools=promoted)

    def test_allowlist_matches_checked_in_mcp_definitions(self) -> None:
        source = Path(__file__).resolve().parents[2] / "apps/mcp/src/tools.ts"
        names = set(re.findall(r'definition\(\{ name: "(xchange_[a-z_]+)"', source.read_text()))
        self.assertEqual(ALL_TOOLS, names)
        self.assertEqual(len(ALL_TOOLS), 14)


if __name__ == "__main__":
    unittest.main()
