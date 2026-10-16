"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSocialEncryptionConfigured = isSocialEncryptionConfigured;
exports.encryptSocialSecret = encryptSocialSecret;
exports.decryptSocialSecret = decryptSocialSecret;
exports.hashOAuthState = hashOAuthState;
const crypto_1 = require("crypto");
const env_util_1 = require("./env.util");
function getEncryptionKey() {
    const configuredKey = env_util_1.Env.X_TOKEN_ENCRYPTION_KEY?.trim();
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
function isSocialEncryptionConfigured() {
    try {
        getEncryptionKey();
        return true;
    }
    catch {
        return false;
    }
}
function encryptSocialSecret(value) {
    const iv = (0, crypto_1.randomBytes)(12);
    const cipher = (0, crypto_1.createCipheriv)("aes-256-gcm", getEncryptionKey(), iv);
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
function decryptSocialSecret(value) {
    const [encodedIv, encodedTag, encodedCiphertext] = value.split(".");
    if (!encodedIv || !encodedTag || encodedCiphertext === undefined) {
        throw new Error("Encrypted social secret is malformed");
    }
    const decipher = (0, crypto_1.createDecipheriv)("aes-256-gcm", getEncryptionKey(), Buffer.from(encodedIv, "base64url"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([
        decipher.update(Buffer.from(encodedCiphertext, "base64url")),
        decipher.final(),
    ]).toString("utf8");
}
function hashOAuthState(state) {
    return (0, crypto_1.createHash)("sha256").update(state).digest("hex");
}
