import type { Request, Response } from "express";
import crypto from "node:crypto";
import { prisma } from "../config/db.config";
import logger from "../utils/logger.util";

// NOTE: This handler expects `req.body` to be a raw Buffer.
// We mount it with `express.raw({ type: 'application/json' })` at the app level.
export async function handlePaystackWebhook(req: Request, res: Response) {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      return res.status(500).json({ msg: "Paystack not configured" });
    }

    const signature = req.headers["x-paystack-signature"] as string | undefined;
    const rawBody = req.body as Buffer;

    if (!signature || !rawBody) {
      return res.status(400).json({ msg: "Invalid webhook payload" });
    }

    const computed = crypto
      .createHmac("sha512", secret)
      .update(rawBody)
      .digest("hex");

    if (computed !== signature) {
      logger.warn("Paystack signature mismatch", { signature, computed });
      return res.status(401).json({ msg: "Invalid signature" });
    }

    const payload = JSON.parse(rawBody.toString());

    if (payload.event === "charge.success") {
      const reference: string | undefined = payload.data?.reference;
      const amountKobo: number | undefined = payload.data?.amount;

      if (!reference) {
        logger.warn("Paystack webhook without reference", { payload });
      } else {
        const tx = await prisma.transaction.findFirst({
          where: { referenceId: reference },
          select: {
            id: true,
            recipientId: true,
            status: true,
            fiatAmount: true,
          },
        });

        if (tx && tx.status !== "COMPLETED") {
          const fiatAmount =
            tx.fiatAmount ?? (amountKobo ? amountKobo / 100 : 0);
          const credit = Math.floor(fiatAmount || 0);

          if (credit > 0) {
            await prisma.$transaction([
              prisma.transaction.update({
                where: { id: tx.id },
                data: { status: "COMPLETED" },
              }),
              prisma.user.update({
                where: { id: tx.recipientId },
                data: {
                  realPointsBalance: {
                    increment: credit,
                  },
                },
              }),
            ]);
          } else {
            await prisma.transaction.update({
              where: { id: tx.id },
              data: { status: "COMPLETED" },
            });
          }
        }
      }
    }

    return res.status(200).json({ msg: "Webhook received" });
  } catch (error) {
    logger.error("Paystack webhook handler error:", { error });
    return res.status(500).json({ msg: "Internal server error" });
  }
}

export async function handlePolarWebhook(_req: Request, res: Response) {
  // Stub: implement full signature verification + credit logic when Polar is configured
  return res.status(200).json({ msg: "Polar webhook received" });
}

