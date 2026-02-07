import Ably from "ably";
import { Env } from "../utils/env.util";
let ablyClient: Ably.Realtime | null = null;

export function getAblyClient(): Ably.Realtime {
  if (!ablyClient) {
    const ablyApiKey = Env.ABLY_API_KEY
    if (!ablyApiKey) {
      throw new Error("ABLY_API_KEY is not configured");
    }
    ablyClient = new Ably.Realtime(ablyApiKey);
  }
  return ablyClient;
}

// Generate token for client authentication
export function generateAblyToken(userId: string): Promise<Ably.TokenDetails> {
  const client = getAblyClient();
  return client.auth.createTokenRequest({
    clientId: userId,
  }) as Promise<any>;
}
