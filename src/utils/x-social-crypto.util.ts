import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

import { Env } from "./env.util";

function getEncryptionKey(): Buffer {
  const configuredKey = Env.X_TOKEN_ENCRYPTION_KEY?.trim();
  if (!configuredKey) {
    throw new Error("X_TOKEN_ENCRYPTION_KEY is not configured");
  }

  const key = /^[a-f\d]{64}$/i.test(configuredKey)
    ? Buffer.from(configuredKey, "hex")
    : Buffer.from(configuredKey, "base64");

  if (key.length !== 32) {
    throw new Error("X_TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes");
  }

  return key;
}

export function isSocialEncryptionConfigured(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSocialSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSocialSecret(value: string): string {
  const [encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (!encodedIv || !encodedTag || encodedCiphertext === undefined) {
    throw new Error("Encrypted social secret is malformed");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}
