import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "./security-config.util";
import logger from "./logger.util";

function getRefreshSecret(): string {
  const value = process.env.JWT_REFRESH_SECRET?.trim();
  if (!value || value === "your-refresh-secret-key-change-in-production") {
    throw new Error("JWT_REFRESH_SECRET must be configured with a secure value");
  }
  return value;
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";

// JWT Token Generation
export function generateAccessToken(userId: string): string {
  return jwt.sign({ userId }, getJwtSecret(), { expiresIn: "24h" });
}

export function generateRefreshToken(userId: string): string {
  return jwt.sign({ userId }, getRefreshSecret(), { expiresIn: "7d" });
}

export function verifyAccessToken(token: string): { userId: string } | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as { userId: string };
    return decoded;
  } catch (error) {
    return null;
  }
}

export function verifyRefreshToken(token: string): { userId: string } | null {
  try {
    const decoded = jwt.verify(token, getRefreshSecret()) as { userId: string };
    return decoded;
  } catch (error) {
    return null;
  }
}

// Password Hashing
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

// Google OAuth Verification
export async function verifyGoogleToken(token: string): Promise<{
  email: string;
  name: string;
  picture?: string;
  sub: string;
} | null> {
  try {
    const client = new OAuth2Client(GOOGLE_CLIENT_ID);

     const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const payload = await response.json();
    if (!payload) return null;

    return {
      email: payload.email!,
      name: payload.name || "",
      picture: payload.picture || "",
      sub: payload.sub,
    };
    } catch (error) {
      logger.error("Google token verification error:", { error });
      return null;
    }
}

// OTP Generation
export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function isOTPExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return true;
  return new Date() > expiresAt;
}
