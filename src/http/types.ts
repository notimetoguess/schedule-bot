import type { AuthChallengeStore } from "../auth/auth-challenges.js";
import type { AuthStore } from "../auth/auth-store.js";
import type { WebDkClient } from "../integrations/webdk.js";
import type { CredentialCrypto } from "../auth/credential-crypto.js";
import type { SlidingWindowRateLimiter } from "../shared/rate-limiter.js";
import type { ScheduleImageStore } from "../schedule/image-store.js";

export interface AuthServerOptions {
  checkReady?: () => Promise<boolean>;
  botToken: string;
  publicUrl: string;
  initDataMaxAgeSeconds: number;
  authSessionMaxAgeSeconds: number;
  authStore: AuthStore;
  challenges: AuthChallengeStore;
  requestLimiter: SlidingWindowRateLimiter;
  webDk: WebDkClient;
  credentialCrypto?: CredentialCrypto;
  scheduleImageStore?: ScheduleImageStore;
}

export interface AuthRequest {
  state: string;
  initData: string;
  email: string;
  password: string;
  rememberMe?: boolean;
}
