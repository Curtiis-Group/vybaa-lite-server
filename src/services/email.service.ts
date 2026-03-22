import { render } from "@react-email/render";
import nodemailer from "nodemailer";
import { ConfirmationEmail } from "../emails/ConfirmationEmail";
import { PasswordResetEmail } from "../emails/PasswordResetEmail";
import logger from "../utils/logger.util";

const {
  SMTP_USER,
  SMTP_PASSWORD,
} = process.env;

const transport = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

class EmailService {
  private async send(options: {
    to: string;
    subject: string;
    react: any;
    from?: string;
  }) {
    if (!transport) {
      logger.warn("Email transport not configured, skipping email send", {
        to: options.to,
        subject: options.subject,
      });
      return;
    }

    const html = await render(options.react);

   return await transport.sendMail({
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
    return await this.send({
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
}

export const emailService = new EmailService();

