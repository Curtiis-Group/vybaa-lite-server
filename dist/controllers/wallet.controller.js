"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWallet = getWallet;
exports.initPaystackFunding = initPaystackFunding;
exports.initPolarFunding = initPolarFunding;
const node_crypto_1 = __importDefault(require("node:crypto"));
const db_config_1 = require("../config/db.config");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const polar_util_1 = require("../utils/polar.util");
/**
 * Get wallet balances:
 * - mainWalletBalance: "real points" (fundable later via Paystack/Polar)
 * - playWalletBalance: existing Play Points (kept as-is)
 *
 * Feature-flagged via FeatureFlag table (global).
 */
async function getWallet(req, res) {
    try {
        const userId = req.userId;
        const flag = await db_config_1.prisma.featureFlag.findUnique({
            where: { key: "REAL_WALLET" },
            select: { enabled: true },
        });
        const realWalletEnabled = flag?.enabled ?? false;
        const user = (await db_config_1.prisma.user.findUnique({
            where: { id: userId },
            select: {
                points: true,
                realPointsBalance: true,
            },
        }));
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
    }
    catch (error) {
        logger_util_1.default.error("Get wallet error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Initialize Paystack funding for the main wallet.
 * Expects: { amount: number } in body (amount in Naira or smallest fiat unit you choose).
 * Returns: { authorizationUrl, reference }
 */
async function initPaystackFunding(req, res) {
    try {
        const userId = req.userId;
        const { amount } = req.body;
        if (!amount || amount <= 0) {
            return res.status(400).json({ msg: "Amount must be greater than zero" });
        }
        const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
        if (!paystackSecret) {
            return res.status(500).json({ msg: "Paystack not configured" });
        }
        const user = await db_config_1.prisma.user.findUnique({
            where: { id: userId },
            select: { email: true },
        });
        if (!user || !user.email) {
            return res.status(400).json({ msg: "User email is required for Paystack" });
        }
        const reference = `PSK_${Date.now()}_${node_crypto_1.default.randomBytes(6).toString("hex")}`;
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
            logger_util_1.default.error("Paystack initialize error", { status: resp.status, body: text });
            return res.status(502).json({ msg: "Failed to initialize Paystack payment" });
        }
        const data = (await resp.json());
        const authorizationUrl = data?.data?.authorization_url;
        if (!authorizationUrl) {
            return res.status(502).json({ msg: "Invalid response from Paystack" });
        }
        // Record pending transaction for audit
        try {
            await db_config_1.prisma.transaction.create({
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
        }
        catch (error) {
            logger_util_1.default.error("Failed to record Paystack transaction", { error, userId, reference });
        }
        res.json({
            msg: "Paystack funding initialized",
            data: {
                authorizationUrl,
                reference,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Init Paystack funding error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Initialize Polar.sh funding for the main wallet.
 * For now, we assume a pre-configured checkout URL in env.
 */
async function initPolarFunding(_req, res) {
    try {
        const accessToken = process.env.POLAR_ACCESS_TOKEN;
        const successUrl = process.env.POLAR_SUCCESS_URL;
        const productId = process.env.POLAR_PRODUCT_ID;
        if (!accessToken || !successUrl || !productId) {
            return res.status(500).json({ msg: "Polar.sh not configured" });
        }
        // Lazy-load Polar SDK to avoid hard dependency issues in some environments
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const polar = new polar_util_1.$polar({ server: 'sandbox', accessToken });
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
    }
    catch (error) {
        logger_util_1.default.error("Init Polar funding error:", { error });
        res.status(500).json({ msg: "Internal server error" });
    }
}
