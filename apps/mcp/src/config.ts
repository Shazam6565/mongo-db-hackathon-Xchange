import { ScopeSchema } from "../../../packages/contracts/src/index.js";
import { XchangeError, validateApiOrigin, type XchangeClientOptions } from "./client.js";

export function loadStdioConfig(env: NodeJS.ProcessEnv): XchangeClientOptions {
  const scope = ScopeSchema.safeParse({ teamId: env.TEAM_EXPECTED_TEAM_ID, projectId: env.TEAM_EXPECTED_PROJECT_ID });
  if (!scope.success || !env.TEAM_API_URL || !env.TEAM_API_TOKEN) {
    throw new XchangeError("configuration", "Configure TEAM_API_URL, TEAM_API_TOKEN, TEAM_EXPECTED_TEAM_ID and TEAM_EXPECTED_PROJECT_ID privately in the MCP host.");
  }
  const origin = validateApiOrigin(env.TEAM_API_URL);
  const local = env.XCHANGE_ALLOW_LOCAL_OWNER === "1";
  if (local && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) {
    throw new XchangeError("configuration", "Local owner mode is allowed only for an explicitly configured loopback API.");
  }
  return { origin, token: env.TEAM_API_TOKEN, expectedScope: scope.data,
    expectedMode: local ? "local" : "team", engineerId: local ? env.ENGINEER_ID : undefined };
}
