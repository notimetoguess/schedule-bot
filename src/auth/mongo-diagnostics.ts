/** Only allowlisted metadata is emitted. Error messages/stacks may contain secrets. */
export function databaseDiagnostic(error: unknown): { category: string; codes: (string | number)[] } {
  const codes = new Set<string | number>();
  const seen = new Set<unknown>();
  const names = new Set<string>();
  const allowedCodes = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ETIMEOUT", "ENETUNREACH", "EHOSTUNREACH", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID", "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR"]);
  const visit = (value: unknown, depth = 0): void => {
    if (!value || typeof value !== "object" || seen.has(value) || depth > 6) return;
    seen.add(value);
    const item = value as Record<string, unknown>;
    if (typeof item.code === "number" && Number.isSafeInteger(item.code)) codes.add(item.code);
    if (typeof item.code === "string" && allowedCodes.has(item.code)) codes.add(item.code);
    if (typeof item.name === "string") names.add(item.name);
    visit(item.cause, depth + 1); visit(item.reason, depth + 1); visit(item.error, depth + 1);
    if (item.servers instanceof Map) for (const server of item.servers.values()) visit(server, depth + 1);
  };
  visit(error);
  let category = "database";
  if (names.has("MongoServerSelectionError")) category = "server_selection";
  if (names.has("MongoNetworkError") || names.has("MongoNetworkTimeoutError")) category = "network";
  if (names.has("MongoOperationTimeoutError")) category = "operation_timeout";
  if (names.has("MongoParseError") || names.has("MongoInvalidArgumentError")) category = "configuration";
  if (["ENOTFOUND", "EAI_AGAIN", "ETIMEOUT"].some(code => codes.has(code))) category = "dns";
  if ([...codes].some(code => typeof code === "string" && /CERT|TLS|SSL|VERIFY/.test(code))) category = "tls";
  if (codes.has(18)) category = "authentication";
  if (codes.has(13)) category = "permissions";
  if (codes.has(85) || codes.has(86)) category = "index_conflict";
  return { category, codes: [...codes] };
}
