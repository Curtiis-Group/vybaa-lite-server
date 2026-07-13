"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateSequenceMilestoneAwards = calculateSequenceMilestoneAwards;
function calculateSequenceMilestoneAwards(params) {
    if (params.interval < 1 || params.currentDay <= params.previousDay) {
        return [];
    }
    const firstSequenceIndex = Math.floor(params.previousDay / params.interval) + 1;
    const lastSequenceIndex = Math.floor(params.currentDay / params.interval);
    const awards = [];
    for (let sequenceIndex = firstSequenceIndex; sequenceIndex <= lastSequenceIndex; sequenceIndex++) {
        awards.push({
            pointsAwarded: params.points + (sequenceIndex - 1) * params.bonusPoints,
            sequenceIndex,
            sequenceValue: sequenceIndex * params.interval,
        });
    }
    return awards;
}
