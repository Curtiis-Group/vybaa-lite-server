"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailService = void 0;
const render_1 = require("@react-email/render");
const nodemailer_1 = __importDefault(require("nodemailer"));
const ConfirmationEmail_1 = require("../emails/ConfirmationEmail");
const CommunityInviteEmail_1 = require("../emails/CommunityInviteEmail");
const ModerationAlertEmail_1 = require("../emails/ModerationAlertEmail");
const PasswordResetEmail_1 = require("../emails/PasswordResetEmail");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const transport = nodemailer_1.default.createTransport({
    service: "gmail",
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
    },
});
class EmailService {
    isConfigured() {
        return Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD);
    }
    async send(options) {
        if (!this.isConfigured()) {
            logger_util_1.default.warn("Email transport not configured, skipping email send", {
                to: options.to,
                subject: options.subject,
            });
            return;
        }
        const html = await (0, render_1.render)(options.react);
        await transport.sendMail({
            from: `"${options?.from || process.env.APP_NAME}" <${process.env.SMTP_USER}>`,
            to: options.to,
            subject: options.subject,
            html,
        });
    }
    async sendPasswordResetEmail(params) {
        await this.send({
            to: params.to,
            subject: "Reset your Vybaa password",
            react: (0, PasswordResetEmail_1.PasswordResetEmail)({ name: params.name, code: params.code }),
        });
    }
    async sendConfirmationEmail(params) {
        await this.send({
            to: params.to,
            subject: "Confirm your Vybaa account",
            react: (0, ConfirmationEmail_1.ConfirmationEmail)({ name: params.name, code: params.code }),
        });
    }
    async sendCommunityInviteEmail(params) {
        await this.send({
            to: params.to,
            subject: `Join ${params.communityName} on Vybaa`,
            react: (0, CommunityInviteEmail_1.CommunityInviteEmail)({
                communityName: params.communityName,
                inviteCode: params.inviteCode,
                inviteLink: params.inviteLink,
                inviterName: params.inviterName,
            }),
        });
    }
    async sendModerationAlertEmail(params) {
        const recipient = process.env.MODERATION_ALERT_EMAIL ?? process.env.SMTP_USER;
        if (!recipient) {
            logger_util_1.default.error("Moderation alert email is not configured", {
                reportId: params.reportId,
            });
            return;
        }
        await this.send({
            to: recipient,
            subject: `[Action within 24h] Vybaa content report ${params.reportId}`,
            react: (0, ModerationAlertEmail_1.ModerationAlertEmail)(params),
        });
    }
}
exports.emailService = new EmailService();
