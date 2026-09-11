import { render } from "@react-email/render";
import nodemailer from "nodemailer";
import { ConfirmationEmail } from "../emails/ConfirmationEmail";
import { CommunityInviteEmail } from "../emails/CommunityInviteEmail";
import { ModerationAlertEmail } from "../emails/ModerationAlertEmail";
import { PasswordResetEmail } from "../emails/PasswordResetEmail";
import logger from "../utils/logger.util";

const transport = nodemailer.createTransport({
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

  private async send(options: {
    to: string;
    subject: string;
    react: any;
    from?: string;
  }) {
    if (!this.isConfigured()) {
      logger.warn("Email transport not configured, skipping email send", {
        to: options.to,
        subject: options.subject,
      });
      return;
    }

    const html = await render(options.react);

    await transport.sendMail({
      from: `"${options?.from || process.env.APP_NAME}" <${process.env.SMTP_USER}>`,
      to: options.to,
      subject: options.subject,
      html,
    });
  }

  async sendPasswordResetEmail(params: {
    to: string;
    name: string;
    code: string;
  }) {
    await this.send({
      to: params.to,
      subject: "Reset your Vybaa password",
      react: PasswordResetEmail({ name: params.name, code: params.code }),
    });
  }

  async sendConfirmationEmail(params: {
    to: string;
    name: string;
    code: string;
  }) {
    await this.send({
      to: params.to,
      subject: "Confirm your Vybaa account",
      react: ConfirmationEmail({ name: params.name, code: params.code }),
    });
  }

  async sendCommunityInviteEmail(params: {
    to: string;
    communityName: string;
    inviteCode: string;
    inviteLink: string;
    inviterName: string;
  }) {
    await this.send({
      to: params.to,
      subject: `Join ${params.communityName} on Vybaa`,
      react: CommunityInviteEmail({
        communityName: params.communityName,
        inviteCode: params.inviteCode,
        inviteLink: params.inviteLink,
        inviterName: params.inviterName,
      }),
    });
  }

  async sendModerationAlertEmail(params: {
    reason: string;
    reportId: string;
    responseDueAt: string;
    targetType: string;
  }): Promise<void> {
    const recipient =
      process.env.MODERATION_ALERT_EMAIL ?? process.env.SMTP_USER;
    if (!recipient) {
      logger.error("Moderation alert email is not configured", {
        reportId: params.reportId,
      });
      return;
    }
    await this.send({
      to: recipient,
      subject: `[Action within 24h] Vybaa content report ${params.reportId}`,
      react: ModerationAlertEmail(params),
    });
  }
}

export const emailService = new EmailService();
