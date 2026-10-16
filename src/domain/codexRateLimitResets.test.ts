import { describe, expect, it } from "vitest";
import {
  MAX_CODEX_RESET_CREDITS,
  parseCodexRateLimitResetSnapshot,
  parseCodexRateLimitResetConsumeRequest,
  parseCodexRateLimitResetPreparation,
  parseCodexRateLimitResetPrepareRequest,
  parseCodexRateLimitResetReceipt,
} from "./codexRateLimitResets";

const credit = {
  id: "credit-1",
  title: "Full reset",
  description: null,
  grantedAtEpochMs: 1_000,
  expiresAtEpochMs: null,
};
const snapshot = {
  accountIdentity: "account",
  availableCount: 2,
  credits: [credit],
  history: [{ operationId: "operation", usedAtEpochMs: 100, creditTitle: null }],
  historyTruncated: false,
  pendingOperationId: null,
};
const { title: _title, ...creditWithoutTitle } = credit;
const { creditTitle: _creditTitle, ...historyWithoutTitle } = snapshot.history[0];
const { credits: _credits, ...snapshotWithoutCredits } = snapshot;

describe("Codex reset boundary", () => {
  it("freezes validated account data and preserves unsupported counts", () => {
    const parsed = parseCodexRateLimitResetSnapshot(snapshot);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.history)).toBe(true);
    expect(Object.isFrozen(parsed.history[0])).toBe(true);
    expect(Object.isFrozen(parsed.credits)).toBe(true);
    expect(Object.isFrozen(parsed.credits?.[0])).toBe(true);
    expect(parsed.credits).toEqual([credit]);
    expect(
      parseCodexRateLimitResetSnapshot({ ...snapshot, availableCount: null }).availableCount,
    ).toBeNull();
  });
  it("distinguishes unknown credit details from an empty list and keeps bounded details", () => {
    expect(parseCodexRateLimitResetSnapshot({ ...snapshot, credits: null }).credits).toBeNull();
    expect(parseCodexRateLimitResetSnapshot({ ...snapshot, credits: [] }).credits).toEqual([]);
    const detailed = {
      ...credit,
      title: "t".repeat(200),
      description: "d".repeat(1000),
      expiresAtEpochMs: 8_640_000_000_000_000,
    };
    expect(
      parseCodexRateLimitResetSnapshot({
        ...snapshot,
        credits: [detailed],
        history: [{ ...snapshot.history[0], creditTitle: "Full reset" }],
      }),
    ).toMatchObject({ credits: [detailed], history: [{ creditTitle: "Full reset" }] });
    expect(
      parseCodexRateLimitResetSnapshot({
        ...snapshot,
        credits: Array.from({ length: MAX_CODEX_RESET_CREDITS }, (_, i) => ({
          ...credit,
          id: `c-${i}`,
        })),
      }).credits,
    ).toHaveLength(MAX_CODEX_RESET_CREDITS);
  });
  it.each([
    { ...snapshot, extra: true },
    snapshotWithoutCredits,
    { ...snapshot, availableCount: -1 },
    { ...snapshot, availableCount: 1.5 },
    { ...snapshot, availableCount: Number.MAX_SAFE_INTEGER + 1 },
    { ...snapshot, accountIdentity: "a\n" },
    { ...snapshot, accountIdentity: null },
    {
      ...snapshot,
      history: Array.from({ length: 101 }, (_, i) => ({
        operationId: `${i}`,
        usedAtEpochMs: i,
        creditTitle: null,
      })),
    },
    { ...snapshot, history: [snapshot.history[0], snapshot.history[0]] },
    { ...snapshot, history: [{ ...snapshot.history[0], extra: true }] },
    { ...snapshot, history: [historyWithoutTitle] },
    { ...snapshot, history: [{ ...snapshot.history[0], creditTitle: "t".repeat(201) }] },
    { ...snapshot, history: [{ ...snapshot.history[0], creditTitle: "" }] },
    { ...snapshot, history: [{ ...snapshot.history[0], creditTitle: 1 }] },
    {
      ...snapshot,
      history: [
        { operationId: "operation", usedAtEpochMs: Number.MAX_SAFE_INTEGER, creditTitle: null },
      ],
    },
    { ...snapshot, credits: {} },
    { ...snapshot, credits: [credit, credit] },
    { ...snapshot, credits: [{ ...credit, extra: true }] },
    { ...snapshot, credits: [creditWithoutTitle] },
    { ...snapshot, credits: [{ ...credit, id: "" }] },
    { ...snapshot, credits: [{ ...credit, id: " padded" }] },
    { ...snapshot, credits: [{ ...credit, id: "x".repeat(257) }] },
    { ...snapshot, credits: [{ ...credit, title: "a\u0007" }] },
    { ...snapshot, credits: [{ ...credit, title: "t".repeat(201) }] },
    { ...snapshot, credits: [{ ...credit, description: "d".repeat(1001) }] },
    { ...snapshot, credits: [{ ...credit, grantedAtEpochMs: -1 }] },
    { ...snapshot, credits: [{ ...credit, grantedAtEpochMs: null }] },
    { ...snapshot, credits: [{ ...credit, expiresAtEpochMs: 1.5 }] },
    { ...snapshot, credits: [{ ...credit, expiresAtEpochMs: 8_640_000_000_000_001 }] },
    {
      ...snapshot,
      credits: Array.from({ length: MAX_CODEX_RESET_CREDITS + 1 }, (_, i) => ({
        ...credit,
        id: `c-${i}`,
      })),
    },
  ])("rejects malformed/oversized/foreign data %j", (value) => {
    expect(() => parseCodexRateLimitResetSnapshot(value)).toThrow(TypeError);
  });
  it("accepts only a closed prepare request with an optional bounded credit", () => {
    const request = { providerGeneration: 1, accountIdentity: "account", creditId: null };
    expect(parseCodexRateLimitResetPrepareRequest(request)).toEqual(request);
    expect(parseCodexRateLimitResetPrepareRequest({ ...request, creditId: "credit-1" })).toEqual({
      ...request,
      creditId: "credit-1",
    });
    expect(() =>
      parseCodexRateLimitResetPrepareRequest({ providerGeneration: 1, accountIdentity: "a" }),
    ).toThrow(TypeError);
    for (const creditId of ["", " c", "x".repeat(257), 7]) {
      expect(() => parseCodexRateLimitResetPrepareRequest({ ...request, creditId })).toThrow(
        TypeError,
      );
    }
    expect(() => parseCodexRateLimitResetPrepareRequest({ ...request, extra: true })).toThrow(
      TypeError,
    );
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
