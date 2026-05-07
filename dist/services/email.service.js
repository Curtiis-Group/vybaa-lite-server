"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailService = void 0;
const render_1 = require("@react-email/render");
const nodemailer_1 = __importDefault(require("nodemailer"));
const ConfirmationEmail_1 = require("../emails/ConfirmationEmail");
const PasswordResetEmail_1 = require("../emails/PasswordResetEmail");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const { SMTP_USER, SMTP_PASSWORD, } = process.env;
const transport = nodemailer_1.default.createTransport({
    service: "gmail",
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
    },
});
class EmailService {
    async send(options) {
        if (!transport) {
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
}
exports.emailService = new EmailService();
