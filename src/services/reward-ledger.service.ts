import { TransactionType } from "@prisma/client";
import { prisma } from "../config/db.config";

interface RecordPendingRewardInput {
  amount: number;
  dedupeKey: string;
  goalId: string;
  milestoneName: string;
  milestoneDay: number;
  userId: string;
}

export async function recordPendingRewardTransaction(
  input: RecordPendingRewardInput,
): Promise<void> {
  await prisma.transaction.upsert({
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
      type: TransactionType.REWARD_POINTS,
    },
    update: {},
  });
}
