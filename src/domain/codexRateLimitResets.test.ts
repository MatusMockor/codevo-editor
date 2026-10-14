import { describe, expect, it } from "vitest";
import {
  parseCodexRateLimitResetSnapshot,
  parseCodexRateLimitResetConsumeRequest,
  parseCodexRateLimitResetPreparation,
  parseCodexRateLimitResetReceipt,
} from "./codexRateLimitResets";

const snapshot = {
  accountIdentity: "account",
  availableCount: 2,
  history: [{ operationId: "operation", usedAtEpochMs: 100 }],
  historyTruncated: false,
  pendingOperationId: null,
};

describe("Codex reset boundary", () => {
  it("freezes validated account data and preserves unsupported counts", () => {
    const parsed = parseCodexRateLimitResetSnapshot(snapshot);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.history)).toBe(true);
    expect(Object.isFrozen(parsed.history[0])).toBe(true);
    expect(
      parseCodexRateLimitResetSnapshot({ ...snapshot, availableCount: null }).availableCount,
    ).toBeNull();
  });
  it.each([
    { ...snapshot, extra: true },
    { ...snapshot, availableCount: -1 },
    { ...snapshot, availableCount: 1.5 },
    { ...snapshot, availableCount: Number.MAX_SAFE_INTEGER + 1 },
    { ...snapshot, accountIdentity: "a\n" },
    { ...snapshot, accountIdentity: null },
    {
      ...snapshot,
      history: Array.from({ length: 101 }, (_, i) => ({ operationId: `${i}`, usedAtEpochMs: i })),
    },
    { ...snapshot, history: [snapshot.history[0], snapshot.history[0]] },
    { ...snapshot, history: [{ ...snapshot.history[0], extra: true }] },
    {
      ...snapshot,
      history: [{ operationId: "operation", usedAtEpochMs: Number.MAX_SAFE_INTEGER }],
    },
  ])("rejects malformed/oversized/foreign data %j", (value) => {
    expect(() => parseCodexRateLimitResetSnapshot(value)).toThrow(TypeError);
  });
  it("rejects unknown outcomes and capabilities", () => {
    expect(() => parseCodexRateLimitResetReceipt({ outcome: "probablyReset" })).toThrow();
    expect(() =>
      parseCodexRateLimitResetPreparation({ confirmationToken: "token", account: "secret" }),
    ).toThrow();
    expect(() =>
      parseCodexRateLimitResetConsumeRequest({
        providerGeneration: 1,
        confirmationToken: "token",
        idempotencyKey: "",
      }),
    ).toThrow();
  });
});
