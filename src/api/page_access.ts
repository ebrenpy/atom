import type { FastifyCorsOptions } from "@fastify/cors";
import type { FastifyRequest } from "fastify";

export const ATOM_SEARCH_MOTION_PAGES_ORIGIN = "https://pages.eiaserinnys.me";

const PAGE_READ_PATHS = new Set([
  "/api/auth/providers",
  "/api/auth/status",
  "/search",
]);
const ALL_API_METHODS = ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"];

function isPagesReadRequest(request: FastifyRequest): boolean {
  const method = request.method === "OPTIONS"
    ? request.headers["access-control-request-method"]
    : request.method;
  if (method !== "GET" && method !== "HEAD") return false;

  const pathname = request.url.split("?")[0] ?? request.url;
  return PAGE_READ_PATHS.has(pathname) || /^\/cards\/[^/]+$/.test(pathname);
}

export function createPageAccessCorsOptions(frontendUrl: string | undefined): FastifyCorsOptions {
  return {
    delegator: async (request: FastifyRequest) => {
      if (request.headers.origin === ATOM_SEARCH_MOTION_PAGES_ORIGIN) {
        if (!isPagesReadRequest(request)) return { origin: false };

        return {
          origin: ATOM_SEARCH_MOTION_PAGES_ORIGIN,
          credentials: true,
          methods: ["GET", "HEAD"],
        };
      }

      return {
        origin: frontendUrl ? [frontendUrl] : true,
        credentials: true,
        methods: ALL_API_METHODS,
      };
    },
  };
}
