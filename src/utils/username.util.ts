import { prisma } from "../config/db.config";

/**
 * Generate a unique username from base name
 * If username exists, appends incrementing number (e.g., john → john1 → john2)
 */
export async function generateUniqueUsername(baseName: string): Promise<string> {
  // Clean the base name: lowercase, remove spaces, special chars
  let cleanBase = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 20); // Max 20 chars for base

  if (!cleanBase) {
    // Fallback if name has no valid characters
    cleanBase = 'user';
  }

  // Try without number first
  const existingUser = await prisma.user.findUnique({
    where: { username: cleanBase },
  });

  if (!existingUser) {
    return cleanBase;
  }

  // Username exists, try with numbers
  let counter = 1;
  let username = `${cleanBase}${counter}`;
  const maxAttempts = 100;

  while (counter < maxAttempts) {
    const exists = await prisma.user.findUnique({
      where: { username },
    });

    if (!exists) {
      return username;
    }

    counter++;
    username = `${cleanBase}${counter}`;
  }

  // Fallback: use timestamp if somehow all numbers are taken
  return `${cleanBase}${Date.now().toString().slice(-6)}`;
}

/**
 * Check if user can change username (7-day cooldown)
 */
export function canChangeUsername(lastChangeDate: Date | null): { 
  canChange: boolean; 
  daysRemaining: number;
  nextAvailableDate: Date;
} {
  const COOLDOWN_DAYS = 7;

  if (!lastChangeDate) {
    // Never changed username before, allow change
    return {
      canChange: true,
      daysRemaining: 0,
      nextAvailableDate: new Date(),
    };
  }

  const now = new Date();
  const daysSinceChange = Math.floor(
    (now.getTime() - new Date(lastChangeDate).getTime()) / (1000 * 60 * 60 * 24)
  );

  const canChange = daysSinceChange >= COOLDOWN_DAYS;
  const daysRemaining = Math.max(0, COOLDOWN_DAYS - daysSinceChange);
  
  const nextAvailableDate = new Date(lastChangeDate);
  nextAvailableDate.setDate(nextAvailableDate.getDate() + COOLDOWN_DAYS);

  return {
    canChange,
    daysRemaining,
    nextAvailableDate,
  };
}

/**
 * Validate username format
 */
export function validateUsername(username: string): { valid: boolean; error?: string } {
  if (!username || username.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' };
  }

  if (username.length > 20) {
    return { valid: false, error: 'Username must be 20 characters or less' };
  }

  // Check if contains uppercase letters
  if (/[A-Z]/.test(username)) {
    return { valid: false, error: 'Username must be lowercase only' };
  }

  if (!/^[a-z0-9_]+$/.test(username)) {
    return { valid: false, error: 'Username can only contain lowercase letters, numbers, and underscores' };
  }

  if (username.startsWith('_') || username.endsWith('_')) {
    return { valid: false, error: 'Username cannot start or end with underscore' };
  }

  return { valid: true };
}

/**
 * Sanitize username input - force lowercase and clean
 */
export function sanitizeUsername(input: string): string {
  return input
    .toLowerCase()           // Force lowercase
    .replace(/[^a-z0-9_]/g, '') // Remove invalid chars
    .substring(0, 20);       // Max length
}
