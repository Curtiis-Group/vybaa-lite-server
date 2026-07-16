import assert from "node:assert/strict";
import test from "node:test";
import { parseRewindReflection } from "./rewind-reflection.service";

const validReflection = {
  summary: "The day held a difficult conversation, then a quieter sense of relief after the user named what they needed.",
  emotionalInsight: "The user seemed worn down but more certain that protecting their energy is not selfish.",
  journalDraft: "Today I noticed that naming my boundary made the situation feel less heavy.",
  emotionalTags: ["tired", "relieved"],
  wellbeingSignals: {
    emotionalSteadiness: 64,
    energy: 42,
    clarity: 72,
    connection: 58,
    agency: 70,
  },
};

test("structured Rewind reflection requires a complete wellbeing signal set", () => {
  assert.throws(
    () =>
      parseRewindReflection({
        ...validReflection,
        wellbeingSignals: { clarity: 72 },
      }),
    /required content/i,
  );
});

test("structured Rewind reflection normalizes usable completion output", () => {
  const reflection = parseRewindReflection(validReflection);

  assert.equal(reflection.summary.includes("difficult conversation"), true);
  assert.equal(reflection.emotionalTags[0], "tired");
  assert.equal(reflection.wellbeingSignals.agency, 70);
});
