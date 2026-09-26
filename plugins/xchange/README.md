# Xchange plugin

This package gives an agent a repeatable workspace skill and MCP tools for
Xchange. It connects through the scoped API; it contains no database credentials.

The portable entry points are `plugin.json`, `mcp.json` and
`skills/xchange-workspace/SKILL.md`. `.codex-plugin/plugin.json` and `.mcp.json`
provide the Codex compatibility layout. Node 22 or newer is required for the
bundled stdio server.

Build from the repository root before copying or installing this directory:

```sh
npm ci
npm run mcp:build
npm run plugin:check
```

The build produces `dist/stdio.mjs`, `dist/tool-catalog.json`,
`dist/openai-tools.json` and dependency notices inside the package. The catalog
contains the MCP tool contracts; `openai-tools.json` contains Responses API
function declarations with `strict: false`. Those declarations require a caller
to dispatch calls through an authenticated, scoped binding; they do not connect
to the workspace by themselves. MCP is the ready transport.

The host must privately
provide `TEAM_API_URL`, this agent installation's individual `TEAM_API_TOKEN`,
`TEAM_EXPECTED_TEAM_ID` and `TEAM_EXPECTED_PROJECT_ID` to that process. Remote
URLs require HTTPS; loopback development may use HTTP.
Do not store a token in either manifest, a skill, or a shared MCP configuration.

Portable hosts choose which environment variables to pass; environment inheritance
is not guaranteed. Supply the four variables through the host's private runtime
configuration. The Codex compatibility configuration forwards these names without
embedding their values. Installing the folder alone does not configure credentials.

After installation and runtime configuration, start a new task, call `xchange_access`, and verify the
returned actor, role and project before working. This package does not enroll
credentials or grant access. Publication and rollback remain separate evaluator
operations.

For source installation, remote HTTP use and the Phoenix MCP integration contract,
see the repository's `docs/mcp-plugin.md`.
