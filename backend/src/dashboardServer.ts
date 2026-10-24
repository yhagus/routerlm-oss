import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";

// Same prefixes the Vite dev/preview proxy forwards to the backend.
const API_PREFIXES = ["/api", "/v1", "/v1beta", "/responses", "/codex"];

export function isApiPath(pathname: string): boolean {
  return API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Serves the built dashboard (frontend/dist) and hands API paths to the
 * gateway app in-process. Unknown paths fall back to index.html so the Vue
 * router can resolve them.
 */
export function createDashboardFetch(distDir: string, appFetch: (request: Request) => Response | Promise<Response>) {
  const root = normalize(distDir);
  const indexPath = join(root, "index.html");
  if (!existsSync(indexPath)) throw new Error(`Dashboard build not found: ${indexPath}`);

  return (request: Request): Response | Promise<Response> => {
    const { pathname } = new URL(request.url);
    if (isApiPath(pathname)) return appFetch(request);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405 });

    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }
    const filePath = normalize(join(root, decoded));
    if (filePath !== root && !filePath.startsWith(root + sep)) return new Response("Not Found", { status: 404 });

    if (existsSync(filePath) && statSync(filePath).isFile()) {
      // Vite fingerprints everything under /assets, so it can be cached for good.
      const cacheControl = decoded.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
      return new Response(Bun.file(filePath), { headers: { "Cache-Control": cacheControl } });
    }
    return new Response(Bun.file(indexPath), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
  };
}
