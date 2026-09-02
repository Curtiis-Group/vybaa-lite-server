export const STANDARD_GOAL_REWARD_MILESTONES = [
  { name: "Quarter way", points: 0.1, triggerPercentage: 25 },
  { name: "Halfway", points: 0.25, triggerPercentage: 50 },
  { name: "Three quarters", points: 0.5, triggerPercentage: 75 },
  { name: "Goal complete", points: 2, triggerPercentage: 100 },
] as const;

export const GOAL_REWARD_CAP = 2.85;
export const GOAL_REWARD_MINIMUM_DAYS = 7;
export const GOAL_REWARD_MINIMUM_OCCURRENCES = 3;
export const GOAL_V2_MAXIMUM_DAYS = 365;
