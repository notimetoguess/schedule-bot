import type { IncomingMessage } from "node:http";
import type { AuthRequest } from "./types.js";

export function parseAuthRequest(value: string): AuthRequest {
  const body = JSON.parse(value) as Partial<AuthRequest>;
  if (typeof body.state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.state) ||
      typeof body.initData !== "string" || body.initData.length > 8192 ||
      typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
      typeof body.password !== "string" || body.password.length < 1 || body.password.length > 1024 ||
      (body.rememberMe !== undefined && typeof body.rememberMe !== "boolean")) {
    throw new Error("Invalid request");
  }
  return { state: body.state, initData: body.initData, email: body.email.trim(), password: body.password, rememberMe: body.rememberMe === true };
}

export async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += data.length;
    if (length > 16 * 1024) throw new Error("Body too large");
    chunks.push(data);
  }
  return Buffer.concat(chunks).toString("utf8");
}
