import { describe, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway } from "../domain/remoteRunner";
import type { RemoteThreadMetadata } from "../domain/remoteThreadMetadata";
import { loadRemoteThreadMetadata } from "./remoteThreadMetadataInventory";
const row = (taskId: string): RemoteThreadMetadata => ({
  taskId,
  revision: 1,
  title: null,
  pinned: false,
  archived: false,
  removed: false,
  viewedAtEpochMs: null,
  snoozedUntil: null,
  settledAt: null,
  sortOrder: null,
});
const gateway = (listThreadMetadata: NonNullable<RemoteRunnerGateway["listThreadMetadata"]>) =>
  ({ listThreadMetadata }) as RemoteRunnerGateway;
describe("remote metadata inventory", () => {
  it("refreshes all pages with exact cursor and retains archived preferences", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ ...row("a"), archived: true }], nextAfter: "a" })
      .mockResolvedValueOnce({ items: [row("b")], nextAfter: null });
    const result = await loadRemoteThreadMetadata(gateway(list), "server", () => undefined);
    expect(result.get("a")?.archived).toBe(true);
    expect(result.size).toBe(2);
    expect(list.mock.calls).toEqual([
      [{ serverId: "server" }],
      [{ serverId: "server", after: "a" }],
    ]);
  });
  it("rejects repeated pages instead of replacing authoritative metadata", async () => {
    const list = vi.fn().mockResolvedValue({ items: [row("a")], nextAfter: "a" });
    await expect(
      loadRemoteThreadMetadata(gateway(list), "server", () => undefined),
    ).rejects.toThrow("duplicate");
    expect(list).toHaveBeenCalledTimes(2);
  });
  it("does not continue pagination after the owner changes during an awaited response", async () => {
    let active = true;
    const list = vi.fn(async () => {
      active = false;
      return { items: [row("a")], nextAfter: "a" };
    });
    await expect(
      loadRemoteThreadMetadata(gateway(list), "server", () => {
        if (!active) throw new Error("revoked");
      }),
    ).rejects.toThrow("revoked");
    expect(list).toHaveBeenCalledTimes(1);
  });
  it("rejects cursors not corresponding to the returned page", async () => {
    const list = vi.fn().mockResolvedValue({ items: [row("a")], nextAfter: "different" });
    await expect(
      loadRemoteThreadMetadata(gateway(list), "server", () => undefined),
    ).rejects.toThrow("cursor");
  });
});
