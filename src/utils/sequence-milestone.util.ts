export type SequenceMilestoneAward = {
  pointsAwarded: number;
  sequenceIndex: number;
  sequenceValue: number;
};

export function calculateSequenceMilestoneAwards(params: {
  bonusPoints: number;
  currentDay: number;
  interval: number;
  points: number;
  previousDay: number;
}): SequenceMilestoneAward[] {
  if (params.interval < 1 || params.currentDay <= params.previousDay) {
    return [];
  }

  const firstSequenceIndex =
    Math.floor(params.previousDay / params.interval) + 1;
  const lastSequenceIndex = Math.floor(params.currentDay / params.interval);
  const awards: SequenceMilestoneAward[] = [];

  for (
    let sequenceIndex = firstSequenceIndex;
    sequenceIndex <= lastSequenceIndex;
    sequenceIndex++
  ) {
    awards.push({
      pointsAwarded:
        params.points + (sequenceIndex - 1) * params.bonusPoints,
      sequenceIndex,
      sequenceValue: sequenceIndex * params.interval,
    });
  }

  return awards;
}
