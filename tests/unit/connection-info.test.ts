import {
  resolveMcpUrl,
  buildConnectionInfo,
  MCP_HEADER_NAME,
} from "../../src/api/config/connection.js";

describe("connection info", () => {
  it("prefers PUBLIC_MCP_URL verbatim (trailing slash stripped)", () => {
    expect(
      resolveMcpUrl({
        publicMcpUrl: "https://x.example/mcp/",
        frontendUrl: "https://f.example",
        requestOrigin: "http://o",
      })
    ).toBe("https://x.example/mcp");
  });

  it("falls back to FRONTEND_URL + /mcp", () => {
    expect(
      resolveMcpUrl({ frontendUrl: "https://atom.nine-lives.dev/", requestOrigin: "http://o" })
    ).toBe("https://atom.nine-lives.dev/mcp");
  });

  it("falls back to request origin + /mcp", () => {
    expect(resolveMcpUrl({ requestOrigin: "http://localhost:4200" })).toBe(
      "http://localhost:4200/mcp"
    );
  });

  it("falls back to relative /mcp when nothing is known", () => {
    expect(resolveMcpUrl({})).toBe("/mcp");
  });

  it("buildConnectionInfo returns the resolved url and x-api-key header", () => {
    expect(buildConnectionInfo({ frontendUrl: "https://a" })).toEqual({
      mcpUrl: "https://a/mcp",
      headerName: "x-api-key",
    });
    expect(MCP_HEADER_NAME).toBe("x-api-key");
  });
});
