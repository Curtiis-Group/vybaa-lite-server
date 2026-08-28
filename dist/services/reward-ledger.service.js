"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordPendingRewardTransaction = recordPendingRewardTransaction;
const client_1 = require("@prisma/client");
const db_config_1 = require("../config/db.config");
async function recordPendingRewardTransaction(input) {
    await db_config_1.prisma.transaction.upsert({
        where: { dedupeKey: input.dedupeKey },
        create: {
            amount: input.amount,
            dedupeKey: input.dedupeKey,
            metadata: JSON.stringify({
                goalId: input.goalId,
                milestoneDay: input.milestoneDay,
                milestoneName: input.milestoneName,
                state: "pending",
            }),
            recipientId: input.userId,
            referenceId: input.goalId,
            status: "PENDING",
            type: client_1.TransactionType.REWARD_POINTS,
        },
        update: {},
    });
}
