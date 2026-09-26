import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { XchangeClient, XchangeError } from "./client.js";
import { loadStdioConfig } from "./config.js";
import { createXchangeMcpServer } from "./tools.js";

try {
  const client = new XchangeClient(loadStdioConfig(process.env));
  const access = await client.verifyAccess();
  const server = createXchangeMcpServer(client, access);
  await server.connect(new StdioServerTransport());
} catch (error) {
  // stdout belongs exclusively to the MCP protocol. Never log headers or raw errors.
  process.stderr.write(`Xchange MCP: ${error instanceof XchangeError ? error.message : "Could not start the scoped MCP connection."}\n`);
  process.exitCode = 1;
}
