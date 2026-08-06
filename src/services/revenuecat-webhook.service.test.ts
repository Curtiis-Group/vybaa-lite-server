import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { Env } from "../utils/env.util";
import {
  getRevenueCatWebhookUserCandidates,
  parseRevenueCatWebhook,
  verifyRevenueCatWebhookSignature,
} from "./revenuecat-webhook.service";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const TIMESTAMP = Math.floor(NOW.getTime() / 1000);

function createSignature(body: Buffer, secret: string): string {
  const value = createHmac("sha256", secret)
    .update(Buffer.from(`${TIMESTAMP}.`))
    .update(body)
    .digest("hex");
  return `t=${TIMESTAMP},v1=${value}`;
}

test("verifies current RevenueCat HMAC signatures", () => {
  const previousSecret = Env.REVENUECAT_WEBHOOK_SECRET;
  Env.REVENUECAT_WEBHOOK_SECRET = "webhook-test-secret";
  const body = Buffer.from('{"event":{"id":"evt_1","type":"RENEWAL"}}');

  assert.equal(
    verifyRevenueCatWebhookSignature({
      clientApp: "vybaa",
      now: NOW,
      rawBody: body,
      signature: createSignature(body, Env.REVENUECAT_WEBHOOK_SECRET),
    }),
    true,
  );
  Env.REVENUECAT_WEBHOOK_SECRET = previousSecret;
});

test("rejects tampered, expired, and cross-app signatures", () => {
  const previousVybaaSecret = Env.REVENUECAT_WEBHOOK_SECRET;
  const previousMyCoveSecret = Env.MYCOVE_REVENUECAT_WEBHOOK_SECRET;
  Env.REVENUECAT_WEBHOOK_SECRET = "vybaa-secret";
  Env.MYCOVE_REVENUECAT_WEBHOOK_SECRET = "mycove-secret";
  const body = Buffer.from('{"event":{"id":"evt_1","type":"RENEWAL"}}');
  const signature = createSignature(body, Env.REVENUECAT_WEBHOOK_SECRET);

  assert.equal(
    verifyRevenueCatWebhookSignature({
      clientApp: "vybaa",
      now: NOW,
      rawBody: Buffer.from("tampered"),
      signature,
    }),
    false,
  );
  assert.equal(
    verifyRevenueCatWebhookSignature({
      clientApp: "vybaa",
      now: new Date(NOW.getTime() + 301_000),
      rawBody: body,
      signature,
    }),
    false,
  );
  assert.equal(
    verifyRevenueCatWebhookSignature({
      clientApp: "mycove",
      now: NOW,
      rawBody: body,
      signature,
    }),
    false,
  );

  Env.REVENUECAT_WEBHOOK_SECRET = previousVybaaSecret;
  Env.MYCOVE_REVENUECAT_WEBHOOK_SECRET = previousMyCoveSecret;
});

test("parses webhook identity without accepting anonymous aliases", () => {
  const envelope = parseRevenueCatWebhook(
    JSON.stringify({
      event: {
        aliases: ["seed-user-zion", "$RCAnonymousID:ignored"],
        app_user_id: "$RCAnonymousID:primary",
        id: "evt_2",
        transferred_to: ["seed-user-lyra"],
        type: "TRANSFER",
      },
    }),
  );

  assert.ok(envelope);
  assert.deepEqual(getRevenueCatWebhookUserCandidates(envelope.event), [
    "seed-user-zion",
    "seed-user-lyra",
  ]);
  assert.equal(parseRevenueCatWebhook("invalid"), null);
});
