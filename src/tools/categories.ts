import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execJXA, formatSuccess, formatError } from "../applescript.ts";

export function registerCategoryTools(server: McpServer) {
  server.tool(
    "list_categories",
    "List all categories in Tyme",
    {},
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
