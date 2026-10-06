import { describe, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway } from "../domain/remoteRunner";
import type { RemoteThreadMetadata } from "../domain/remoteThreadMetadata";
import {
  loadRemoteThreadMetadata,
  MAX_UNCONFIRMED_THREAD_METADATA,
  mergeLoadedThreadMetadata,
  publishedRemoteThreadMetadata,
} from "./remoteThreadMetadataInventory";
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
describe("published thread metadata", () => {
  const descriptor = {
    protocolVersion: 1 as const,
    runnerId: "runner",
    name: "Runner",
    capabilities: { taskExecution: true, eventReplay: true, threadManagement: true },
  };
  const task = (id: string, conversationId?: string) => ({
    id,
    runnerId: "runner",
    sequence: 1,
    provider: "codex" as const,
    status: "succeeded" as const,
    parts: [],
    createdAt: "2026-09-13T00:00:00Z",
    ...(conversationId === undefined ? {} : { conversationId }),
  });
  const at = (taskId: string, revision: number, pinned = false) => ({
    ...row(taskId),
    revision,
    pinned,
  });
  const index = (...items: RemoteThreadMetadata[]) =>
    new Map(items.map((item) => [item.taskId, item]));

  it("applies a record for a known conversation without mutating its inputs", () => {
    const threadMetadata = index(at("a", 1));
    const unconfirmed = index(at("a", 1));
    const snapshot = { descriptor, tasks: [task("a"), task("turn", "b")], threadMetadata };
    const first = at("b", 1, true);
    const published = publishedRemoteThreadMetadata(snapshot, unconfirmed, first);
    expect(published).toEqual({
      kind: "applied",
      threadMetadata: index(at("a", 1), first),
      unconfirmed: index(at("a", 1), first),
    });
    expect(threadMetadata.size).toBe(1);
    expect(unconfirmed.size).toBe(1);
    expect(
      publishedRemoteThreadMetadata({ descriptor, tasks: [task("a")] }, undefined, at("a", 0)),
    ).toEqual({
      kind: "applied",
      threadMetadata: index(at("a", 0)),
      unconfirmed: index(at("a", 0)),
    });
  });
  it("applies a higher revision and reports an equal or lower one as already current", () => {
    const snapshot = { descriptor, tasks: [task("a")], threadMetadata: index(at("a", 3)) };
    expect(publishedRemoteThreadMetadata(snapshot, index(at("a", 3)), at("a", 4, true))).toEqual({
      kind: "applied",
      threadMetadata: index(at("a", 4, true)),
      unconfirmed: index(at("a", 4, true)),
    });
    expect(publishedRemoteThreadMetadata(snapshot, undefined, at("a", 3, true))).toEqual({
      kind: "current",
    });
    expect(publishedRemoteThreadMetadata(snapshot, undefined, at("a", 2, true))).toEqual({
      kind: "current",
    });
  });
  it("reports a record for an unknown conversation or an unidentified runner as unknown", () => {
    const threadMetadata = index(at("a", 1), at("foreign", 1));
    expect(
      publishedRemoteThreadMetadata(
        { descriptor, tasks: [task("a")], threadMetadata },
        undefined,
        at("foreign", 9),
      ),
    ).toEqual({ kind: "unknown" });
    expect(
      publishedRemoteThreadMetadata(
        { descriptor, tasks: [task("a")], threadMetadata },
        undefined,
        at("foreign", 1),
      ),
    ).toEqual({ kind: "unknown" });
    expect(
      publishedRemoteThreadMetadata(
        { descriptor, tasks: [task("turn", "b")], threadMetadata },
        undefined,
        at("turn", 9),
      ),
    ).toEqual({ kind: "unknown" });
    expect(
      publishedRemoteThreadMetadata(
        { descriptor: null, tasks: [task("a")], threadMetadata },
        undefined,
        at("a", 9),
      ),
    ).toEqual({ kind: "unknown" });
  });
  it("refuses a new conversation when every unconfirmed slot is taken and evicts nothing", () => {
    const tracked = Array.from({ length: MAX_UNCONFIRMED_THREAD_METADATA }, (_, item) =>
      at(`task-${item}`, 1),
    );
    const unconfirmed = index(...tracked);
    const snapshot = {
      descriptor,
      tasks: [...tracked.map((item) => task(item.taskId)), task("extra")],
      threadMetadata: index(...tracked),
    };
    expect(publishedRemoteThreadMetadata(snapshot, unconfirmed, at("extra", 1, true))).toEqual({
      kind: "full",
    });
    expect([...unconfirmed.values()]).toEqual(tracked);
    expect(snapshot.threadMetadata.has("extra")).toBe(false);

    const oneFree = index(...tracked.slice(1));
    const admitted = publishedRemoteThreadMetadata(snapshot, oneFree, at("extra", 1, true));
    expect(admitted.kind === "applied" && admitted.unconfirmed.size).toBe(
      MAX_UNCONFIRMED_THREAD_METADATA,
    );
    expect(admitted.kind === "applied" && admitted.unconfirmed.has("task-1")).toBe(true);
  });
  it("still replaces the entry of a tracked conversation when every unconfirmed slot is taken", () => {
    const tracked = Array.from({ length: MAX_UNCONFIRMED_THREAD_METADATA }, (_, item) =>
      at(`task-${item}`, 1),
    );
    const snapshot = {
      descriptor,
      tasks: tracked.map((item) => task(item.taskId)),
      threadMetadata: index(...tracked),
    };
    const newer = at("task-0", 2, true);
    const published = publishedRemoteThreadMetadata(snapshot, index(...tracked), newer);
    expect(published.kind).toBe("applied");
    expect(published.kind === "applied" && published.unconfirmed.size).toBe(
      MAX_UNCONFIRMED_THREAD_METADATA,
    );
    expect(published.kind === "applied" && published.unconfirmed.get("task-0")).toBe(newer);
    expect(published.kind === "applied" && published.threadMetadata.get("task-0")).toBe(newer);
    expect(publishedRemoteThreadMetadata(snapshot, index(...tracked), at("task-0", 1))).toEqual({
      kind: "current",
    });
  });

  it("takes the loaded metadata as is when no published record awaits confirmation", () => {
    const loaded = index(at("a", 1));
    expect(mergeLoadedThreadMetadata(loaded, undefined).threadMetadata).toBe(loaded);
    expect(mergeLoadedThreadMetadata(loaded, new Map())).toEqual({
      threadMetadata: loaded,
      unconfirmed: new Map(),
    });
    expect(mergeLoadedThreadMetadata(undefined, undefined).threadMetadata).toBeUndefined();
  });
  it("keeps a published record over an older loaded revision until the server lists it", () => {
    const published = at("a", 2, true);
    const loaded = index(at("a", 1), at("b", 1), at("c", 4));
    const merged = mergeLoadedThreadMetadata(loaded, index(published));
    expect([...(merged.threadMetadata ?? [])]).toEqual([
      ["a", published],
      ["b", at("b", 1)],
      ["c", at("c", 4)],
    ]);
    expect([...merged.unconfirmed]).toEqual([["a", published]]);
    expect(loaded.get("a")).toEqual(at("a", 1));
    const again = mergeLoadedThreadMetadata(index(at("a", 1)), merged.unconfirmed);
    expect(again.threadMetadata?.get("a")).toBe(published);
    expect(again.unconfirmed.get("a")).toBe(published);
  });
  it("keeps a first published record that the loaded listing does not contain yet", () => {
    const published = at("new", 1, true);
    const merged = mergeLoadedThreadMetadata(index(at("a", 1)), index(published));
    expect(merged.threadMetadata?.get("new")).toBe(published);
    expect(merged.unconfirmed.get("new")).toBe(published);
    expect(mergeLoadedThreadMetadata(undefined, index(published)).threadMetadata?.get("new")).toBe(
      published,
    );
  });
  it("confirms a published record once the server lists the same or a newer revision", () => {
    const same = index(at("a", 2), at("b", 2));
    const merged = mergeLoadedThreadMetadata(same, index(at("a", 2, true), at("b", 1, true)));
    expect(merged.threadMetadata).toBe(same);
    expect(merged.unconfirmed.size).toBe(0);
    const partial = mergeLoadedThreadMetadata(
      index(at("a", 3), at("b", 1)),
      index(at("a", 2, true), at("b", 2, true)),
    );
    expect(partial.threadMetadata?.get("a")).toEqual(at("a", 3));
    expect(partial.threadMetadata?.get("b")).toEqual(at("b", 2, true));
    expect([...partial.unconfirmed.keys()]).toEqual(["b"]);
  });
  it("takes every record that is not awaiting confirmation from the server listing", () => {
    const loaded = index(at("a", 1), at("lower", 3));
    const merged = mergeLoadedThreadMetadata(loaded, index(at("a", 2)));
    expect([...(merged.threadMetadata ?? [])]).toEqual([
      ["a", at("a", 2)],
      ["lower", at("lower", 3)],
    ]);
  });
});
