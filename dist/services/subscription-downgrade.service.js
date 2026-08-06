"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFreeTierRoutineFrequency = getFreeTierRoutineFrequency;
exports.downgradeRewindRoutineToFreeTier = downgradeRewindRoutineToFreeTier;
const client_1 = require("@prisma/client");
const db_config_1 = require("../config/db.config");
const rewind_routine_service_1 = require("./rewind-routine.service");
function getFreeTierRoutineFrequency(times) {
    const hasEveningTime = times.some((time) => Number(time.split(":")[0]) >= 12);
    return hasEveningTime
        ? client_1.RewindFrequency.JUST_EVENINGS
        : client_1.RewindFrequency.JUST_MORNINGS;
}
async function downgradeRewindRoutineToFreeTier(userId) {
    const user = await db_config_1.prisma.user.findUnique({
        where: { id: userId },
        select: {
            rewindRoutine: true,
            timezone: true,
        },
    });
    const routine = user?.rewindRoutine;
    if (!user ||
        !routine ||
        routine.frequency === client_1.RewindFrequency.JUST_EVENINGS ||
        routine.frequency === client_1.RewindFrequency.JUST_MORNINGS) {
        return;
    }
    await (0, rewind_routine_service_1.saveRewindRoutine)({
        userId,
        input: {
            customIntent: routine.customIntent,
            frequency: getFreeTierRoutineFrequency(routine.times),
            intent: routine.intent,
            timezone: user.timezone,
        },
    });
}
