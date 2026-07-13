"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateSequenceMilestoneAwards = calculateSequenceMilestoneAwards;
function calculateSequenceMilestoneAwards(params) {
    if (params.interval < 1 || params.currentDay <= params.previousDay) {
        return [];
    }
    const startDay = params.startDay ?? params.interval;
    const endDay = params.endDay ?? Number.POSITIVE_INFINITY;
    if (startDay < 1 || endDay < startDay) {
        return [];
    }
    const firstSequenceIndex = Math.max(0, Math.floor((params.previousDay - startDay) / params.interval) + 1);
    const lastSequenceIndex = Math.floor((Math.min(params.currentDay, endDay) - startDay) / params.interval);
    const awards = [];
    for (let sequenceIndex = firstSequenceIndex; sequenceIndex <= lastSequenceIndex; sequenceIndex++) {
        awards.push({
            pointsAwarded: params.points + sequenceIndex * params.bonusPoints,
            sequenceIndex: sequenceIndex + 1,
            sequenceValue: startDay + sequenceIndex * params.interval,
        });
    }
    return awards;
}
