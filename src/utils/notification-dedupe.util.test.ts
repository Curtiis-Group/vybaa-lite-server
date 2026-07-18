import assert from "node:assert/strict";
import test from "node:test";
import { isNotificationDedupeConflict } from "./notification-dedupe.util";

test("recognizes only keyed notification uniqueness conflicts as duplicates", () => {
  assert.equal(
    isNotificationDedupeConflict(
      { code: "P2002" },
      "time_to_rewind:2026-07-16",
    ),
    true,
  );
  assert.equal(
    isNotificationDedupeConflict({ code: "P2002" }, undefined),
    false,
  );
  assert.equal(
    isNotificationDedupeConflict(
      { code: "P2003" },
      "time_to_rewind:2026-07-16",
    ),
    false,
  );
});
