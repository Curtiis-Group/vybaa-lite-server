import assert from "node:assert/strict";
import test from "node:test";
import {
  createSubtaskSchema,
  updateSubtaskSchema,
} from "./goal-subtask.validators";

test("subtasks reject injected ownership, empty titles and incomplete revision updates", () => {
  const valid = {
    id: "d339ef8f-2436-475f-8c61-f5817b981733",
    title: "One small step",
  };
  assert.equal(createSubtaskSchema.safeParse(valid).success, true);
  for (const input of [
    { ...valid, title: " " },
    { ...valid, title: "x".repeat(501) },
    { ...valid, goalId: "other" },
    { ...valid, userId: "other" },
    { ...valid, id: "../../" },
  ]) {
    assert.equal(createSubtaskSchema.safeParse(input).success, false);
  }
  for (const input of [
    { revision: -1, completed: true },
    { revision: 1 },
    { completed: true },
    { revision: 1, completed: true, userId: "other" },
  ]) {
    assert.equal(updateSubtaskSchema.safeParse(input).success, false);
  }
  assert.equal(
    updateSubtaskSchema.safeParse({ revision: 0, completed: false }).success,
    true,
  );
});
