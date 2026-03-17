import { Response } from "express";
import crypto from "node:crypto";
import { prisma } from "../config/db.config";
import { AuthRequest } from "../middleware/auth.middleware";
import logger from "../utils/logger.util";
import { $polar } from "../utils/polar.util";

/**
 * Get wallet balances:
 * - mainWalletBalance: "real points" (fundable later via Paystack/Polar)
 * - playWalletBalance: existing Play Points (kept as-is)
 *
 * Feature-flagged via FeatureFlag table (global).
 */
export async function getWallet(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;

    const flag = await (prisma as any).featureFlag.findUnique({
      where: { key: "REAL_WALLET" },
      select: { enabled: true },
    });
    const realWalletEnabled = flag?.enabled ?? false;

    const user = (await (prisma as any).user.findUnique({
      where: { id: userId },
      select: {
        points: true,
        realPointsBalance: true,
      },
    })) as { points?: number | null; realPointsBalance: number } | null;

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    res.json({
      msg: "Wallet retrieved successfully",
      data: {
        realWalletEnabled,
        mainWalletBalance: user.realPointsBalance,
        playWalletBalance: user.points ?? 0,
      },
    });
  } catch (error) {
    logger.error("Get wallet error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Initialize Paystack funding for the main wallet.
 * Expects: { amount: number } in body (amount in Naira or smallest fiat unit you choose).
 * Returns: { authorizationUrl, reference }
 */
export async function initPaystackFunding(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { amount } = req.body as { amount?: number };

    if (!amount || amount <= 0) {
      return res.status(400).json({ msg: "Amount must be greater than zero" });
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecret) {
      return res.status(500).json({ msg: "Paystack not configured" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user || !user.email) {
      return res.status(400).json({ msg: "User email is required for Paystack" });
    }

    const reference = `PSK_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;

    // Paystack expects amount in kobo for NGN (x100). Adjust for your currency as needed.
    const payload = {
      email: user.email,
      amount: amount * 100,
      reference,
      metadata: {
        userId,
        source: "vybaa-main-wallet",
      },
    };

    const resp = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.error("Paystack initialize error", { status: resp.status, body: text });
      return res.status(502).json({ msg: "Failed to initialize Paystack payment" });
    }

    const data = (await resp.json()) as any;
    const authorizationUrl = data?.data?.authorization_url;

    if (!authorizationUrl) {
      return res.status(502).json({ msg: "Invalid response from Paystack" });
    }

    // Record pending transaction for audit
    try {
      await (prisma as any).transaction.create({
        data: {
          type: "BUY_POINTS",
          amount: 0, // real points credited on webhook later
          fiatAmount: amount,
          recipientId: userId,
          referenceId: reference,
          metadata: JSON.stringify({ provider: "PAYSTACK" }),
          status: "PENDING",
        },
      });
    } catch (error) {
      logger.error("Failed to record Paystack transaction", { error, userId, reference });
    }

    res.json({
      msg: "Paystack funding initialized",
      data: {
        authorizationUrl,
        reference,
      },
    });
  } catch (error) {
    logger.error("Init Paystack funding error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Initialize Polar.sh funding for the main wallet.
 * For now, we assume a pre-configured checkout URL in env.
 */
export async function initPolarFunding(_req: AuthRequest, res: Response) {
  try {
    const accessToken = process.env.POLAR_ACCESS_TOKEN;
    const successUrl = process.env.POLAR_SUCCESS_URL;
    const productId = process.env.POLAR_PRODUCT_ID;

    if (!accessToken || !successUrl || !productId) {
      return res.status(500).json({ msg: "Polar.sh not configured" });
    }

    // Lazy-load Polar SDK to avoid hard dependency issues in some environments
    // eslint-disable-next-line @typescript-eslint/no-var-requires

    const polar = new $polar({ server: 'sandbox', accessToken });

    const checkout = await polar.checkouts.create({
      products: [productId],
      successUrl,
    });

    res.json({
      msg: "Polar funding initialized",
      data: {
        checkoutUrl: checkout.url,
        id: checkout.id,
      },
    });
  } catch (error) {
    logger.error("Init Polar funding error:", { error });
    res.status(500).json({ msg: "Internal server error" });
  }
}


