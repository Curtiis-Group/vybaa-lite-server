import * as React from "react";
import { Text } from "@react-email/components";
import { AuthEmailLayout } from "./AuthLayout";

export interface CommunityInviteEmailProps {
  communityName: string;
  inviteCode: string;
  inviteLink: string;
  inviterName: string;
}

export function CommunityInviteEmail({
  communityName,
  inviteCode,
  inviteLink,
  inviterName,
}: CommunityInviteEmailProps) {
  return (
    <AuthEmailLayout
      previewText={`${inviterName} invited you to join ${communityName} on Vybaa.`}
      heading="Community invite"
    >
      <Text style={paragraph}>Hey,</Text>
      <Text style={paragraph}>
        {inviterName} invited you to join {communityName} on Vybaa.
      </Text>
      <Text style={codeBlock}>{inviteCode}</Text>
      <Text style={paragraph}>
        Open this invite link on your phone. If you do not have an account yet,
        Vybaa will take you through signup and continue the invite after you log in:
        {inviteLink}
      </Text>
      <Text style={paragraph}>
        If you were not expecting this invite, you can ignore this email.
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
