// Vercel runs this file without compiling workspace packages (their exports point at .ts sources),
// so everything it reaches imports sources by relative path; see function-imports.test.ts.
// A startup failure returns its error code as JSON instead of an opaque invocation failure.
let hosted: Promise<(request: Request) => Promise<Response>> | undefined;
let mcp: Promise<(request: Request) => Promise<Response>> | undefined;

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/mcp" || url.searchParams.get("route") === "mcp") {
        mcp ??= import("../apps/mcp/src/hosted.js").then((module) => module.hostedMcpFetch);
        return await (await mcp)(request);
      }
      hosted ??= import("../apps/api/src/hosted.js").then((module) => module.hostedFetch);
      return await (await hosted)(request);
    } catch (error) {
      hosted = undefined;
      mcp = undefined;
      const code = error instanceof Error ? ("code" in error && typeof error.code === "string" ? error.code : error.name) : "unknown";
      return Response.json({ error: "The API could not start. Check the deployment.", code }, { status: 503, headers: { "cache-control": "no-store" } });
    }
  },
};
