import { hostedFetch } from "../../api/src/hosted.js";
import { ScopeSchema } from "../../../packages/contracts/src/index.js";
import { createMcpHttpHandler } from "./http.js";

// Reuse the API's authentication, role checks, validation, repository and receipts.
// This fetch adapter stays inside the function; it makes no outbound loopback call.
const apiFetch: typeof globalThis.fetch = async (input, init) => hostedFetch(new Request(input, init));

export async function hostedMcpFetch(request: Request): Promise<Response> {
  const expectedScope = ScopeSchema.parse({ teamId: process.env.TEAM_ID, projectId: process.env.PROJECT_ID });
  if (!process.env.TEAM_PUBLIC_ORIGIN) throw new Error("The MCP public origin must be configured.");
  const handler = createMcpHttpHandler({ apiOrigin: "http://127.0.0.1", publicOrigin: process.env.TEAM_PUBLIC_ORIGIN,
    expectedScope, fetch: apiFetch });
  return handler(request);
}
