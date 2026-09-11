import { Text } from "@react-email/components";
import * as React from "react";
import { AuthEmailLayout } from "./AuthLayout";

export interface ModerationAlertEmailProps {
  reason: string;
  reportId: string;
  responseDueAt: string;
  targetType: string;
}

export function ModerationAlertEmail({
  reason,
  reportId,
  responseDueAt,
  targetType,
}: ModerationAlertEmailProps) {
  return (
    <AuthEmailLayout
      heading="Content report needs review"
      previewText="A Vybaa safety report needs action within 24 hours."
    >
      <Text style={paragraph}>Report: {reportId}</Text>
      <Text style={paragraph}>Target: {targetType}</Text>
      <Text style={paragraph}>Reason: {reason}</Text>
      <Text style={paragraph}>Review deadline: {responseDueAt}</Text>
      <Text style={warning}>
        Review the evidence, remove violating content, and suspend the offending
        account when required by the community standards.
      </Text>
    </AuthEmailLayout>
  );
}

const paragraph: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  margin: "4px 0 8px",
};

const warning: React.CSSProperties = {
  backgroundColor: "#422006",
  borderRadius: 12,
  color: "#fef3c7",
  fontSize: 14,
  lineHeight: 1.6,
  marginTop: 16,
  padding: 16,
};
