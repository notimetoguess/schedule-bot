import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { readWebappAsset } from "../webapp.js";
import { AuthLoginCoordinator } from "../auth/auth-login-coordinator.js";
import { authenticate } from "./handlers/authenticate.js";
import { issueChallenge } from "./handlers/issue-challenge.js";
import { asset, json, setSecurityHeaders } from "./response.js";
import type { AuthServerOptions } from "./types.js";

export type { AuthServerOptions } from "./types.js";

export function createAuthServer(options: AuthServerOptions): Server {
  const allowedOrigin = new URL(options.publicUrl).origin;
  const loginCoordinator = new AuthLoginCoordinator();
  return createServer(async (request, response) => {
    setSecurityHeaders(response);
    try {
      const url = new URL(request.url ?? "/", allowedOrigin);
      if (request.method === "GET" && url.pathname === "/ready") {
        const ready = await options.checkReady?.().catch(() => false) ?? false;
        return json(response, ready ? 200 : 503, { ok: ready });
      }
      if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true });
      const scheduleImage = url.pathname.match(/^\/schedule-images\/([A-Za-z0-9_-]{20,})\/(\d+)\.jpg$/);
      if (request.method === "GET" && scheduleImage && options.scheduleImageStore) {
        const bundle = options.scheduleImageStore.get(scheduleImage[1]!);
        const page = bundle?.pages[Number(scheduleImage[2])];
        return page ? asset(response, "image/jpeg", page) : json(response, 404, { code: "NOT_FOUND" });
      }
      if (request.method === "GET" && [
        "/assets/inline/today-calendar.png",
        "/assets/inline/weekly-calendar.png",
        "/assets/inline/marked-calendar.png",
      ].includes(url.pathname)) {
        const image = await readFile(new URL(".." + url.pathname, import.meta.url));
        return asset(response, "image/png", image);
      }
      if (request.method === "GET" && [
        "/assets/inline/show.jpg",
        "/assets/inline/authorized.jpg",
        "/assets/inline/logout.jpg",
        "/assets/inline/need-authorize.jpg",
      ].includes(url.pathname)) {
        const image = await readFile(new URL(".." + url.pathname, import.meta.url));
        return asset(response, "image/jpeg", image);
      }
      if (request.method === "GET" && url.pathname === "/auth") {
        return asset(response, "text/html; charset=utf-8", await readWebappAsset("auth.html"));
      }
      if (request.method === "GET" && url.pathname === "/auth.css") {
        return asset(response, "text/css; charset=utf-8", await readWebappAsset("auth.css"));
      }
      if (request.method === "GET" && url.pathname === "/auth.js") {
        return asset(response, "text/javascript; charset=utf-8", await readWebappAsset("auth.js"));
      }
      if (request.method === "POST" && (url.pathname === "/api/auth" || url.pathname === "/api/challenge")) {
        if (request.headers.origin !== allowedOrigin) return json(response, 403, { code: "INVALID_SESSION" });
        if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
          return json(response, 415, { code: "INVALID_SESSION" });
        }
        if (url.pathname === "/api/challenge") return await issueChallenge(request, response, options);
        return await authenticate(request, response, options, loginCoordinator);
      }
      return json(response, 404, { code: "NOT_FOUND" });
    } catch {
      return json(response, 500, { code: "UPSTREAM_UNAVAILABLE" });
    }
  });
}
