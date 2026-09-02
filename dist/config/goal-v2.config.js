"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GOAL_V2_MAXIMUM_DAYS = exports.GOAL_REWARD_MINIMUM_OCCURRENCES = exports.GOAL_REWARD_MINIMUM_DAYS = exports.GOAL_REWARD_CAP = exports.STANDARD_GOAL_REWARD_MILESTONES = void 0;
exports.STANDARD_GOAL_REWARD_MILESTONES = [
    { name: "Quarter way", points: 0.1, triggerPercentage: 25 },
    { name: "Halfway", points: 0.25, triggerPercentage: 50 },
    { name: "Three quarters", points: 0.5, triggerPercentage: 75 },
    { name: "Goal complete", points: 2, triggerPercentage: 100 },
];
exports.GOAL_REWARD_CAP = 2.85;
exports.GOAL_REWARD_MINIMUM_DAYS = 7;
exports.GOAL_REWARD_MINIMUM_OCCURRENCES = 3;
exports.GOAL_V2_MAXIMUM_DAYS = 365;
