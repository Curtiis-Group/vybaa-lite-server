import * as React from "react";
import { AuthEmailLayout } from "./AuthLayout";
import { Text } from "@react-email/components";

export interface PasswordResetEmailProps {
  name: string;
  code: string;
}

export function PasswordResetEmail({ name, code }: PasswordResetEmailProps) {
  return (
    <AuthEmailLayout
      previewText="Use this code to reset your Vybaa password."
      heading="Reset your password"
    >
      <Text style={paragraph}>Hey {name},</Text>
      <Text style={paragraph}>
        We received a request to reset your Vybaa password. Use the code below
        to complete the reset. It expires in 10 minutes.
      </Text>
      <Text style={codeBlock}>{code}</Text>
      <Text style={paragraph}>
        If you didn’t request this, you can safely ignore this email.
      </Text>
    </AuthEmailLayout>
  );
}

const paragraph: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  margin: "4px 0 8px",
};

const codeBlock: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  letterSpacing: 8,
  textAlign: "center",
  padding: "12px 16px",
  borderRadius: 999,
  background:
    "linear-gradient(135deg, rgba(248,250,252,0.12), rgba(248,250,252,0.04))",
  border: "1px solid rgba(148,163,184,0.45)",
  margin: "16px 0 8px",
};

