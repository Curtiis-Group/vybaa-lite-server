import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";

import type { ClientApp } from "../types/client-app.type";
import logger from "./logger.util";
import { getJwtSecret } from "./security-config.util";

type GoogleUser = {
  email: string;
  name: string;
  picture?: string;
  sub: string;
};

function getRefreshSecret(): string {
  const value = process.env.JWT_REFRESH_SECRET?.trim();
  if (!value || value === "your-refresh-secret-key-change-in-production") {
    throw new Error(
      "JWT_REFRESH_SECRET must be configured with a secure value",
    );
  }
  return value;
}

function getGoogleClientId(clientApp: ClientApp): string {
  if (clientApp === "mycove") {
    return (
      process.env.MYCOVE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || ""
    );
  }
  return process.env.GOOGLE_CLIENT_ID || "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isGoogleIdToken(token: string): boolean {
  return token.split(".").length === 3;
}

function getGoogleUserFromProfile(profile: unknown): GoogleUser | null {
  if (!isRecord(profile)) return null;
  if (typeof profile.email !== "string" || typeof profile.id !== "string") {
    return null;
  }

  return {
    email: profile.email,
    name: typeof profile.name === "string" ? profile.name : "",
    picture: typeof profile.picture === "string" ? profile.picture : undefined,
    sub: profile.id,
  };
}

export function generateAccessToken(userId: string): string {
  return jwt.sign({ userId }, getJwtSecret(), { expiresIn: "24h" });
}

export function generateRefreshToken(userId: string): string {
  return jwt.sign({ userId }, getRefreshSecret(), { expiresIn: "7d" });
}

export function verifyAccessToken(token: string): { userId: string } | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (!isRecord(decoded) || typeof decoded.userId !== "string") return null;
    return { userId: decoded.userId };
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): { userId: string } | null {
  try {
    const decoded = jwt.verify(token, getRefreshSecret());
    if (!isRecord(decoded) || typeof decoded.userId !== "string") return null;
    return { userId: decoded.userId };
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(
  password: string,
  hashedPassword: string,
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

export async function verifyGoogleToken(
  token: string,
  clientApp: ClientApp = "vybaa",
): Promise<GoogleUser | null> {
  try {
    const clientId = getGoogleClientId(clientApp);
    if (!clientId) {
      throw new Error(
        `${clientApp === "mycove" ? "MYCOVE_" : ""}GOOGLE_CLIENT_ID is not configured`,
      );
    }

    if (isGoogleIdToken(token)) {
      const ticket = await new OAuth2Client(clientId).verifyIdToken({
        audience: clientId,
        idToken: token,
      });
      const payload = ticket.getPayload();
      if (!payload?.email || !payload.sub) return null;

      return {
        email: payload.email,
        name: payload.name || "",
        picture: payload.picture,
        sub: payload.sub,
      };
    }

    const response = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) return null;

    return getGoogleUserFromProfile(await response.json());
  } catch (error) {
    logger.error("Google token verification error", {
      clientApp,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return null;
  }
}

export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function isOTPExpired(expiresAt: Date | null): boolean {
  return !expiresAt || new Date() > expiresAt;
}
