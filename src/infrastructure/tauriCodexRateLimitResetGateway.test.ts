import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriCodexRateLimitResetGateway } from "./tauriCodexRateLimitResetGateway";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const gateway = new TauriCodexRateLimitResetGateway();

describe("TauriCodexRateLimitResetGateway", () => {
  beforeEach(() => invoke.mockReset());
  it("uses closed native commands and request envelopes", async () => {
    invoke.mockResolvedValueOnce({
      accountIdentity: "a",
      availableCount: null,
      credits: null,
      history: [],
      historyTruncated: false,
      pendingOperationId: null,
    });
    await gateway.read({ providerGeneration: 3 });
    expect(invoke).toHaveBeenLastCalledWith("read_codex_limit_resets", {
      request: { providerGeneration: 3 },
    });
    invoke.mockResolvedValueOnce({ confirmationToken: "token" });
    await gateway.prepare({ providerGeneration: 3, accountIdentity: "a", creditId: null });
    expect(invoke).toHaveBeenLastCalledWith("prepare_codex_limit_reset", {
      request: { providerGeneration: 3, accountIdentity: "a", creditId: null },
    });
    invoke.mockResolvedValueOnce({ confirmationToken: "token" });
    await gateway.prepare({ providerGeneration: 3, accountIdentity: "a", creditId: "credit-1" });
    expect(invoke).toHaveBeenLastCalledWith("prepare_codex_limit_reset", {
      request: { providerGeneration: 3, accountIdentity: "a", creditId: "credit-1" },
    });
    invoke.mockResolvedValueOnce({ outcome: "alreadyRedeemed" });
    await gateway.consume({
      providerGeneration: 3,
      confirmationToken: "token",
      idempotencyKey: "key",
    });
    expect(invoke).toHaveBeenLastCalledWith("consume_codex_limit_reset", {
      request: { providerGeneration: 3, confirmationToken: "token", idempotencyKey: "key" },
    });
  });
  it("validates outgoing and incoming data", async () => {
    await expect(gateway.read({ providerGeneration: -1 })).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
    await expect(
      gateway.prepare({ providerGeneration: 1, accountIdentity: "a", creditId: "" }),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockResolvedValueOnce({
      accountIdentity: "a",
      availableCount: 1,
      credits: [{ id: "c", title: null, description: null, grantedAtEpochMs: 1 }],
      history: [],
      historyTruncated: false,
      pendingOperationId: null,
    });
    await expect(gateway.read({ providerGeneration: 1 })).rejects.toThrow();
    invoke.mockResolvedValueOnce({ outcome: "success" });
    await expect(
      gateway.consume({ providerGeneration: 1, confirmationToken: "token", idempotencyKey: "key" }),
    ).rejects.toThrow();
  });
});
