import { AuthStoreUnavailableError } from "../../auth/auth-store.js";
import type { AuthLoginCoordinator } from "../../auth/auth-login-coordinator.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { InitDataError, validateTelegramInitData } from "../../auth/telegram-init-data.js";
import { WebDkError } from "../../integrations/webdk.js";
import { parseAuthRequest, readBody } from "../request.js";
import { json } from "../response.js";
import type { AuthRequest, AuthServerOptions } from "../types.js";

const rememberMeMaxAgeSeconds = 14 * 24 * 60 * 60;

export async function authenticate(
  request: IncomingMessage,
  response: ServerResponse,
  options: AuthServerOptions,
  loginCoordinator: AuthLoginCoordinator,
): Promise<void> {
  let body: AuthRequest;
  try { body = parseAuthRequest(await readBody(request)); }
  catch { json(response, 400, { code: "INVALID_SESSION" }); return; }

  let userId: string | undefined;
  if (body.initData) {
    try {
      userId = String(validateTelegramInitData(
        body.initData,
        options.botToken,
        options.initDataMaxAgeSeconds,
      ).id);
    } catch (error) {
      if (!(error instanceof InitDataError)) throw error;
      json(response, 401, { code: "INVALID_SESSION" });
      return;
    }
    if (!options.challenges.begin(body.state, userId)) userId = undefined;
  } else {
    // Some Telegram clients omit initData for inline Mini Apps. In that case the
    // random, short-lived, single-use URL challenge acts as the launch capability.
    userId = options.challenges.beginBound(body.state);
  }
  if (!userId) {
    json(response, 401, { code: "INVALID_SESSION" });
    return;
  }

  try {
    await loginCoordinator.run(userId, async () => {
      // Recheck after entering the per-user queue. Another request may have
      // completed login while this request was waiting.
      if (await options.authStore.get(userId)) {
        options.challenges.consume(body.state);
        json(response, 200, { ok: true });
        return;
      }

      const limit = options.requestLimiter.consume(userId);
      if (!limit.allowed) {
        options.challenges.release(body.state);
        json(response, 429, {
          code: "RATE_LIMITED",
          retryAfterSeconds: Math.max(1, Math.ceil(limit.retryAfterMs / 1000)),
        });
        return;
      }

      const result = await options.webDk.login(body.email, body.password);
      if (body.rememberMe && !options.credentialCrypto) {
        options.challenges.release(body.state);
        json(response, 503, { code: "AUTH_UNAVAILABLE" });
        return;
      }
      await options.authStore.set(userId, {
        accessToken: result.accessToken,
        expiresAt: Date.now() + (body.rememberMe ? rememberMeMaxAgeSeconds : Math.min(result.expiresIn, options.authSessionMaxAgeSeconds)) * 1000,
        authenticatedEmail: body.email.trim().toLowerCase(),
        rememberedCredentials: body.rememberMe ? options.credentialCrypto!.encrypt(userId, { email: body.email, password: body.password }) : undefined,
      });
      options.challenges.consume(body.state);
      json(response, 200, { ok: true });
    });
  } catch (error) {
    options.challenges.release(body.state);
    if (error instanceof WebDkError) {
      console.warn("Authorization upstream rejected login", { kind: error.kind, status: error.status });
    }
    if (error instanceof WebDkError && error.kind === "credentials") {
      json(response, 401, { code: "INVALID_CREDENTIALS" });
      return;
    }
    json(response, 503, { code: error instanceof AuthStoreUnavailableError ? "AUTH_UNAVAILABLE" : "UPSTREAM_UNAVAILABLE" });
  }
}
