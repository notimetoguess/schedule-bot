import { WebDkError } from "../../integrations/webdk.js";

export function logScheduleFailure(error: unknown, userId: string, expiresAt: number): void {
  if (!(error instanceof WebDkError)) return;
  // Only structured metadata: upstream messages and bodies may contain secrets.
  console.warn(error.kind === "unauthorized"
    ? "WebDk rejected authorization session before local expiry"
    : "WebDk schedule request failed; authorization retained", {
    userId,
    expiresAt,
    status: error.status ?? null,
    upstreamCode: error.upstreamCode ?? null,
    classification: error.kind,
    remainingLocalLifetimeSeconds: Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)),
  });
}
