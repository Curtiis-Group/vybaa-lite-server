export interface BadgeDefinition {
  type: string;
  milestone: number;
  title: string;
  description: string;
  badgeIcon: string;
}

export const BADGE_DEFINITIONS: Record<string, BadgeDefinition[]> = {
  // Streak milestone badges (per goal)
  streak_milestone: [
    {
      type: "streak_milestone",
      milestone: 3,
      title: "Rising Star",
      description: "Reached 3 consecutive days",
      badgeIcon: "⭐",
    },
    {
      type: "streak_milestone",
      milestone: 7,
      title: "Week Warrior",
      description: "Completed a full week streak",
      badgeIcon: "🗡️",
    },
    {
      type: "streak_milestone",
      milestone: 14,
      title: "Fortnight Fighter",
      description: "Conquered 2 weeks straight",
      badgeIcon: "⚔️",
    },
    {
      type: "streak_milestone",
      milestone: 21,
      title: "Habit Hero",
      description: "Reached 21 days - a true habit formed",
      badgeIcon: "🦸",
    },
    {
      type: "streak_milestone",
      milestone: 30,
      title: "Month Master",
      description: "Dominated an entire month",
      badgeIcon: "👑",
    },
    {
      type: "streak_milestone",
      milestone: 50,
      title: "Legendary Streaker",
      description: "An incredible 50-day streak",
      badgeIcon: "🌟",
    },
    {
      type: "streak_milestone",
      milestone: 100,
      title: "Century Champion",
      description: "100 days of unstoppable dedication",
      badgeIcon: "🏆",
    },
    {
      type: "streak_milestone",
      milestone: 365,
      title: "Immortal Achiever",
      description: "A full year of commitment",
      badgeIcon: "💎",
    },
  ],

  // Total goals completed badges (global)
  total_goals: [
    {
      type: "total_goals",
      milestone: 3,
      title: "Goal Getter",
      description: "Completed 3 goals",
      badgeIcon: "🎯",
    },
    {
      type: "total_goals",
      milestone: 5,
      title: "Achievement Ace",
      description: "Finished 5 goals strong",
      badgeIcon: "🏅",
    },
    {
      type: "total_goals",
      milestone: 10,
      title: "Goal Grandmaster",
      description: "Mastered 10 goals",
      badgeIcon: "🔥",
    },
  ],

  // Total check-ins badges (global)
  total_checkins: [
    {
      type: "total_checkins",
      milestone: 50,
      title: "Dedication Dynamo",
      description: "50 total check-ins across all goals",
      badgeIcon: "⚡",
    },
    {
      type: "total_checkins",
      milestone: 100,
      title: "Consistency Champion",
      description: "100 total check-ins - you're unstoppable",
      badgeIcon: "👑",
    },
    {
      type: "total_checkins",
      milestone: 200,
      title: "Check-in Conqueror",
      description: "200 check-ins of pure dedication",
      badgeIcon: "💪",
    },
    {
      type: "total_checkins",
      milestone: 500,
      title: "Elite Achiever",
      description: "500 check-ins - you're in the elite club",
      badgeIcon: "🌟",
    },
  ],

  // Special achievement badges
  perfect_week: [
    {
      type: "perfect_week",
      milestone: 1,
      title: "Flawless Week",
      description: "7 consecutive check-ins without a miss",
      badgeIcon: "✨",
    },
  ],

  comeback: [
    {
      type: "comeback",
      milestone: 1,
      title: "Phoenix Rising",
      description: "Bounced back after a streak reset",
      badgeIcon: "🦅",
    },
  ],

  early_bird: [
    {
      type: "early_bird",
      milestone: 1,
      title: "Dawn Warrior",
      description: "Checked in before 9 AM",
      badgeIcon: "☀️",
    },
  ],

  night_owl: [
    {
      type: "night_owl",
      milestone: 1,
      title: "Night Guardian",
      description: "Checked in after 9 PM",
      badgeIcon: "🌙",
    },
  ],
};

/**
 * Get badge definition for a specific type and milestone
 */
export function getBadgeDefinition(
  type: string,
  milestone: number
): BadgeDefinition | null {
  const badges = BADGE_DEFINITIONS[type];
  if (!badges) return null;

  return badges.find((b) => b.milestone === milestone) || null;
}

/**
 * Get all badge definitions for a type
 */
export function getBadgesForType(type: string): BadgeDefinition[] {
  return BADGE_DEFINITIONS[type] || [];
}

/**
 * Get all streak milestone numbers
 */
export function getStreakMilestones(): number[] {
  return BADGE_DEFINITIONS.streak_milestone.map((b) => b.milestone);
}

/**
 * Check if a number is a milestone
 */
export function isStreakMilestone(day: number): boolean {
  return getStreakMilestones().includes(day);
}

/**
 * Get all badge definitions (for achievements page)
 */
export function getAllBadgeDefinitions(): BadgeDefinition[] {
  return Object.values(BADGE_DEFINITIONS).flat();
}
