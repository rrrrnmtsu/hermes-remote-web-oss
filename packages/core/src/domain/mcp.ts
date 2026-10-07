/**
 * MCP server domain types.
 */

export interface McpServer {
  name: string;
  enabled: boolean;
  type?: string | undefined;
  tools?: number | undefined;
}

export function toMcpServer(raw: Record<string, unknown>): McpServer {
  return {
    name: String(raw.name ?? raw.id ?? 'MCP Server'),
    enabled: raw.enabled === true || raw.active === true,
    type: typeof raw.type === 'string' ? raw.type : undefined,
    tools: typeof raw.tools === 'number' ? raw.tools : undefined,
  };
}
