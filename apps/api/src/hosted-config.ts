import { ScopeSchema } from "@team-memory/contracts";
import { validateTeamAuthConfig } from "./auth.js";
import { loadConfig } from "./config.js";

// Hosted requests must never inherit the local demo token or an in-memory fallback.
export function loadHostedConfig(env: NodeJS.ProcessEnv) {
  if (env.STORAGE_MODE && env.STORAGE_MODE !== "mongodb") throw new Error("Hosted storage must be MongoDB.");
  if (!env.MONGODB_DATABASE || !env.TEAM_ID || !env.PROJECT_ID) throw new Error("Hosted database and scope must be explicit.");
  ScopeSchema.parse({ teamId: env.TEAM_ID, projectId: env.PROJECT_ID });
  let grants: unknown;
  try { grants = JSON.parse(env.TEAM_ACCESS_GRANTS ?? ""); }
  catch { throw new Error("TEAM_ACCESS_GRANTS must be configured as a JSON array."); }
  const teamAuth = validateTeamAuthConfig({ grants, sessionSecret: env.TEAM_SESSION_SECRET, publicOrigin: env.TEAM_PUBLIC_ORIGIN });
  const settings = loadConfig({ ...env, STORAGE_MODE: "mongodb", TEAM_API_TOKEN: "", HOST: "127.0.0.1" });
  return { settings, teamAuth };
}
