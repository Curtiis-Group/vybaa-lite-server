import { RewindFrequency } from "@prisma/client";

import { prisma } from "../config/db.config";
import { saveRewindRoutine } from "./rewind-routine.service";

export function getFreeTierRoutineFrequency(
  times: string[],
): RewindFrequency {
  const hasEveningTime = times.some((time) => Number(time.split(":")[0]) >= 12);
  return hasEveningTime
    ? RewindFrequency.JUST_EVENINGS
    : RewindFrequency.JUST_MORNINGS;
}

export async function downgradeRewindRoutineToFreeTier(
  userId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      rewindRoutine: true,
      timezone: true,
    },
  });
  const routine = user?.rewindRoutine;
  if (
    !user ||
    !routine ||
    routine.frequency === RewindFrequency.JUST_EVENINGS ||
    routine.frequency === RewindFrequency.JUST_MORNINGS
  ) {
    return;
  }

  await saveRewindRoutine({
    userId,
    input: {
      customIntent: routine.customIntent,
      frequency: getFreeTierRoutineFrequency(routine.times),
      intent: routine.intent,
      timezone: user.timezone,
    },
  });
}
