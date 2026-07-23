import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execJXA, formatSuccess, formatError } from "../applescript.ts";

export function registerCategoryTools(server: McpServer) {
  server.registerTool(
    "list_categories",
    {
      description: "List all categories in Tyme",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const script = `
const app = Application("Tyme");
const cats = app.categories();
JSON.stringify(cats.map(c => ({ id: c.id(), name: c.name() })));
`;
      try {
        const result = await execJXA(script);
        return formatSuccess(result);
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
