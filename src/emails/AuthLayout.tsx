import * as React from "react";
import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface AuthEmailLayoutProps {
  previewText: string;
  heading: string;
  children: React.ReactNode;
}

export function AuthEmailLayout({
  previewText,
  heading,
  children,
}: AuthEmailLayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={brand}>Vybaa</Text>
          </Section>
          <Section>
            <Text style={title}>{heading}</Text>
          </Section>
          <Section>{children}</Section>
          <Section style={footer}>
            <Text style={footerText}>
              You’re receiving this email because you have a Vybaa account.
            </Text>
            <Text style={footerText}>© {new Date().getFullYear()} Vybaa</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: "#020617",
  margin: 0,
  padding: "24px 0",
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
};

const container: React.CSSProperties = {
  backgroundColor: "#020617",
  color: "#f9fafb",
  padding: "32px 24px",
  borderRadius: 24,
  border: "1px solid rgba(148,163,184,0.35)",
  maxWidth: "480px",
};

const header: React.CSSProperties = {
  marginBottom: 12,
};

const brand: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  letterSpacing: 1,
};

const title: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  margin: "8px 0 16px",
};

const footer: React.CSSProperties = {
  marginTop: 24,
  borderTop: "1px solid rgba(148,163,184,0.25)",
  paddingTop: 12,
};

const footerText: React.CSSProperties = {
  fontSize: 12,
  color: "#9ca3af",
};

