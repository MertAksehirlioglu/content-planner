import { test } from "node:test";
import assert from "node:assert/strict";
import { canReserve, DEFAULT_MONTHLY_USD, resolveMonthlyUsd, isOverBudget, remainingUsd } from "./budget.ts";

test("missing / malformed budget doc falls back to default", () => {
  assert.equal(resolveMonthlyUsd(undefined), DEFAULT_MONTHLY_USD);
  assert.equal(resolveMonthlyUsd({}), DEFAULT_MONTHLY_USD);
  assert.equal(resolveMonthlyUsd({ monthlyUsd: Number.NaN }), DEFAULT_MONTHLY_USD);
  assert.equal(resolveMonthlyUsd({ monthlyUsd: -3 }), DEFAULT_MONTHLY_USD);
});

test("explicit budget wins, including zero (a hard stop)", () => {
  assert.equal(resolveMonthlyUsd({ monthlyUsd: 20 }), 20);
  assert.equal(resolveMonthlyUsd({ monthlyUsd: 0 }), 0);
});

test("over budget when spend reaches or exceeds cap", () => {
  assert.equal(isOverBudget(10, 9.99), false);
  assert.equal(isOverBudget(10, 10), true);
  assert.equal(isOverBudget(0, 0), true); // zero budget blocks immediately
});

test("remaining never goes negative", () => {
  assert.equal(remainingUsd(10, 3), 7);
  assert.equal(remainingUsd(10, 12), 0);
});

test("a reservation must fit entirely and tolerates floating-point dust", () => {
  assert.equal(canReserve(1, 0.8, 0.1), true);
  assert.equal(canReserve(1, 0.9, 0.1), true);
  assert.equal(canReserve(1, 0.99, 0.1), false);
  assert.equal(canReserve(1, 0.9999999999999999, 0.1), false);
  assert.equal(canReserve(0, 0, 0.1), false);
});
