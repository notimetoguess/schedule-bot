import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { EncryptedCredentials } from "../types.js";

export interface Credentials { email: string; password: string; }

/** Encrypts credentials with a deployment-held AES-256-GCM key. */
export class CredentialCrypto {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("AUTH_CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes");
  }
  encrypt(userId: string, credentials: Credentials): EncryptedCredentials {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(userId, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
    return { version: 1, nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
  }
  decrypt(userId: string, encrypted: EncryptedCredentials): Credentials {
    if (encrypted.version !== 1) throw new Error("Unsupported credential version");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(encrypted.nonce, "base64"));
    decipher.setAAD(Buffer.from(userId, "utf8"));
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
    const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]).toString("utf8")) as Credentials;
    if (!value || typeof value.email !== "string" || typeof value.password !== "string") throw new Error("Malformed credential payload");
    return value;
  }
}
