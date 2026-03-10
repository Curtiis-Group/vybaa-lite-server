/**
 * Single source of truth for Play Points awarded for milestones
 * All points are accumulated in GoalPendingPoints and released to User.points on goal completion
 */

export interface MilestonePointsConfig {
  milestone: number;
  points: number;
}

/**
 * Streak milestone points (per goal)
 * Points are awarded when user reaches these streak milestones
 */
export const STREAK_MILESTONE_POINTS: MilestonePointsConfig[] = [
  { milestone: 3, points: .10 },   // Rising Star
  { milestone: 7, points: .25 },   // Week Warrior
  { milestone: 14, points: .50 },  // Fortnight Fighter
  { milestone: 21, points: 1.00 }, // Habit Hero
  { milestone: 30, points: 2.00 }, // Month Master
  { milestone: 50, points: 3.50 }, // Legendary Streaker
  { milestone: 100, points: 5.0 }, // Century Champion
  { milestone: 365, points: 10.0 }, // Immortal Achiever
];

/**
 * Get points for a specific streak milestone
 */
export function getStreakMilestonePoints(day: number): number {
  const config = STREAK_MILESTONE_POINTS.find((m) => m.milestone === day);
  return config?.points || 0;
}

/**
 * Get all streak milestone days that award points
 */
export function getStreakMilestoneDays(): number[] {
  return STREAK_MILESTONE_POINTS.map((m) => m.milestone);
}

/**
 * Check if a day is a streak milestone that awards points
 */
export function isStreakMilestoneWithPoints(day: number): boolean {
  return STREAK_MILESTONE_POINTS.some((m) => m.milestone === day);
}

/**
 * Get all milestone points configurations (for reference/display)
 */
export function getAllMilestonePoints(): MilestonePointsConfig[] {
  return [...STREAK_MILESTONE_POINTS];
}
