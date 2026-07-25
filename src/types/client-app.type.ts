export const CLIENT_APPS = ["vybaa", "mycove"] as const;

export type ClientApp = (typeof CLIENT_APPS)[number];

export function isClientApp(value: unknown): value is ClientApp {
  return typeof value === "string" && CLIENT_APPS.includes(value as ClientApp);
}

export function toPrismaClientApp(clientApp: ClientApp): "VYBAA" | "MYCOVE" {
  return clientApp === "mycove" ? "MYCOVE" : "VYBAA";
}

export function fromPrismaClientApp(clientApp: "VYBAA" | "MYCOVE"): ClientApp {
  return clientApp === "MYCOVE" ? "mycove" : "vybaa";
}
