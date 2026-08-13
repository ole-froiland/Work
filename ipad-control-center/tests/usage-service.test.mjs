import test from "node:test";
import assert from "node:assert/strict";

import { normalizeClaudeUsage, normalizeCodexUsage, summarizeClaudeRecords } from "../server/usage-service.mjs";

test("normalizes Codex provider values without estimating", () => {
  const result = normalizeCodexUsage({
    rateLimits: {
      planType: "plus",
      primary: { usedPercent: 49, windowDurationMins: 10_080, resetsAt: 1_787_051_455 },
      secondary: null,
    },
  }, {
    summary: { lifetimeTokens: 2_982_903_466 },
    dailyUsageBuckets: [{ startDate: "2026-08-11", tokens: 77_215_858 }],
  }, "2026-08-11");

  assert.equal(result.plan, "plus");
  assert.equal(result.lifetimeTokens, 2_982_903_466);
  assert.equal(result.todayTokens, 77_215_858);
  assert.deepEqual(result.windows, [{
    key: "primary",
    label: "1 uke",
    usedPercent: 49,
    remainingPercent: 51,
    resetsAt: "2026-08-18T11:10:55.000Z",
    active: true,
  }]);
});

test("uses Claude's authoritative active-limit status", () => {
  const result = normalizeClaudeUsage({
    limits: [
      { kind: "session", percent: 0, resets_at: null, is_active: false },
      { kind: "weekly_all", percent: 2.5, resets_at: "2026-08-17T09:00:00.000Z", is_active: true },
    ],
  }, 12_345);

  assert.equal(result.todayTokens, 12_345);
  assert.equal(result.windows[0].active, false);
  assert.equal(result.windows[0].remainingPercent, 100);
  assert.equal(result.windows[1].usedPercent, 2.5);
  assert.equal(result.windows[1].remainingPercent, 97.5);
});

test("deduplicates streamed Claude messages in today's local token total", () => {
  const usage = { input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: 5, cache_read_input_tokens: 3 };
  const duplicate = { type: "assistant", timestamp: "2026-08-11T09:00:00.000Z", message: { id: "msg-1", model: "claude", usage } };
  const result = summarizeClaudeRecords([
    duplicate,
    duplicate,
    { type: "assistant", timestamp: "2026-08-11T10:00:00.000Z", message: { id: "msg-2", model: "claude", usage: { input_tokens: 4, output_tokens: 1 } } },
    { type: "assistant", timestamp: "2026-08-10T10:00:00.000Z", message: { id: "old", model: "claude", usage } },
  ], "2026-08-11");

  assert.equal(result, 25);
});
