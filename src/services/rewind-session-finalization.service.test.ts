import assert from "node:assert/strict";
import test from "node:test";
import { RewindTurnRole } from "@prisma/client";
import { hasSubstantiveUserTurn } from "./rewind-session-finalization.service";

test("automatic Rewind completion requires a substantive user reflection", () => {
  assert.equal(
    hasSubstantiveUserTurn([
      { content: "Hi", role: RewindTurnRole.USER },
      { content: "Welcome back", role: RewindTurnRole.PARTNER },
    ]),
    false,
  );
  assert.equal(
    hasSubstantiveUserTurn([
      {
        content: "I felt calmer after I finally said no to an extra commitment.",
        role: RewindTurnRole.USER,
      },
    ]),
    true,
  );
});
