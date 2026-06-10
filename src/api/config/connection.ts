export const MCP_HEADER_NAME = "x-api-key";

export interface ConnectionInfoInput {
  publicMcpUrl?: string;
  frontendUrl?: string;
  requestOrigin?: string;
}

export interface ConnectionInfo {
  mcpUrl: string;
  headerName: string;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function resolveMcpUrl(input: ConnectionInfoInput): string {
  const publicMcpUrl = input.publicMcpUrl?.trim();
  if (publicMcpUrl) return stripTrailingSlash(publicMcpUrl);

  const frontendUrl = input.frontendUrl?.trim();
  if (frontendUrl) return stripTrailingSlash(frontendUrl) + "/mcp";

  const requestOrigin = input.requestOrigin?.trim();
  if (requestOrigin) return stripTrailingSlash(requestOrigin) + "/mcp";

  return "/mcp";
}

export function buildConnectionInfo(input: ConnectionInfoInput): ConnectionInfo {
  return { mcpUrl: resolveMcpUrl(input), headerName: MCP_HEADER_NAME };
}
