import { WebDkError } from "../../integrations/webdk.js";

export function logScheduleFailure(error: unknown, userId: string, expiresAt: number): void {
  if (!(error instanceof WebDkError)) return;
  // Only structured metadata: upstream messages and bodies may contain secrets.
  console.warn(error.kind === "unauthorized"
    ? "WebDk rejected authorization session before local expiry"
    : "WebDk schedule request failed; authorization retained", {
    userId,
    expiresAt,
    endpoint: error.endpoint ?? null,
    status: error.status ?? null,
    contentType: error.contentType ?? null,
    upstreamCode: error.upstreamCode ?? null,
    upstreamType: error.upstreamType ?? null,
    classification: error.kind,
    remainingLocalLifetimeSeconds: Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)),
  });
}
