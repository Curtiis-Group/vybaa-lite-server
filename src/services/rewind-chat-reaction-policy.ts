import { randomInt } from "node:crypto";

export const PARTNER_REACTION_COOLDOWN_MS = 12 * 1000;
export const ROOM_REACTION_COOLDOWN_MS = 3 * 1000;

export function getPartnerReactionDelayMs(): number {
  return randomInt(4_000, 12_001);
}

export function shouldAddPartnerReaction(params: {
  content: string;
  createdAt: Date;
  hasPartnerReaction: boolean;
  lastPartnerReactionAt: Date | null;
  lastRoomReactionAt: Date | null;
  now: Date;
  personaId: string;
  targetPersonaId: string | null;
  targetRole: string;
}): boolean {
  if (
    params.targetRole === "SYSTEM" ||
    params.targetPersonaId === params.personaId
  )
    return false;
  if (params.hasPartnerReaction) return false;
  const age = params.now.getTime() - params.createdAt.getTime();
  if (age < 0 || age > 30 * 60 * 1000) return false;
  if (
    params.lastPartnerReactionAt &&
    params.now.getTime() - params.lastPartnerReactionAt.getTime() <
      PARTNER_REACTION_COOLDOWN_MS
  )
    return false;
  if (
    params.lastRoomReactionAt &&
    params.now.getTime() - params.lastRoomReactionAt.getTime() <
      ROOM_REACTION_COOLDOWN_MS
  )
    return false;
  return Boolean(params.content.trim());
}
