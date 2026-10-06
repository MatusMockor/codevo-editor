import { expect, it, vi } from "vitest";
import type { RemoteThreadMetadata } from "../domain/remoteThreadMetadata";
import {
  saveServerThreadMetadata,
  serverThreadMetadataSaveError,
  type ServerThreadMetadataChange,
} from "./serverThreadMetadataSave";

const CONFLICT = "Runner request failed (HTTP 409).";
const record = (change: Partial<RemoteThreadMetadata> = {}): RemoteThreadMetadata => ({
  taskId: "t",
  revision: 0,
  title: null,
  pinned: false,
  archived: false,
  removed: false,
  viewedAtEpochMs: null,
  snoozedUntil: null,
  settledAt: null,
  sortOrder: null,
  ...change,
});
function saving(change: ServerThreadMetadataChange, active: () => boolean = () => true) {
  const gateway = {
    getThreadMetadata: vi.fn().mockResolvedValue(record({ revision: 4 })),
    updateThreadMetadata: vi.fn().mockResolvedValue(record({ revision: 5, pinned: true })),
  };
  const save = () =>
    saveServerThreadMetadata({
      gateway,
      serverId: "s",
      taskId: "t",
      change,
      legacyChange: () => ({ archived: true }),
      active,
    });
  return { gateway, save };
}

it("returns the canonical record the server stored for a saved change", async () => {
  const { gateway, save } = saving({ pinned: true });
  const canonical = record({ revision: 5, pinned: true, title: "Server title" });
  gateway.updateThreadMetadata.mockResolvedValue(canonical);
  const result = await save();
  expect(result).toEqual({ kind: "saved", metadata: canonical });
  expect(result.kind === "saved" && result.metadata).toBe(canonical);
  expect(gateway.updateThreadMetadata).toHaveBeenCalledExactlyOnceWith({
    serverId: "s",
    taskId: "t",
    patch: { pinned: true, expectedRevision: 4 },
  });
});

it("folds legacy preferences into the first revision-zero write only", async () => {
  const { gateway, save } = saving({ pinned: true });
  gateway.getThreadMetadata.mockResolvedValue(record());
  await save();
  expect(gateway.updateThreadMetadata.mock.calls[0]?.[0].patch).toEqual({
    archived: true,
    pinned: true,
    expectedRevision: 0,
  });
});

it("reports a read marker the server already holds as current without writing", async () => {
  const { gateway, save } = saving({ viewedAtEpochMs: 40 });
  gateway.getThreadMetadata.mockResolvedValue(record({ revision: 4, viewedAtEpochMs: 40 }));
  expect(await save()).toEqual({ kind: "current" });
  expect(gateway.updateThreadMetadata).not.toHaveBeenCalled();
});

it("returns the record of the rebased write when a read marker conflicts once", async () => {
  const { gateway, save } = saving({ viewedAtEpochMs: 40 });
  const rebased = record({ revision: 6, viewedAtEpochMs: 40, pinned: true });
  gateway.getThreadMetadata
    .mockResolvedValueOnce(record({ revision: 4 }))
    .mockResolvedValueOnce(record({ revision: 5, pinned: true }));
  gateway.updateThreadMetadata.mockRejectedValueOnce(CONFLICT).mockResolvedValueOnce(rebased);
  expect(await save()).toEqual({ kind: "saved", metadata: rebased });
  expect(gateway.updateThreadMetadata.mock.calls.map(([request]) => request.patch)).toEqual([
    { viewedAtEpochMs: 40, expectedRevision: 4 },
    { viewedAtEpochMs: 40, expectedRevision: 5 },
  ]);
});

it("keeps compare-and-swap for an explicit change and bounds read-marker retries", async () => {
  const explicit = saving({ archived: true });
  explicit.gateway.updateThreadMetadata.mockRejectedValue(CONFLICT);
  await expect(explicit.save()).rejects.toBe(CONFLICT);
  expect(explicit.gateway.updateThreadMetadata).toHaveBeenCalledTimes(1);

  const viewed = saving({ viewedAtEpochMs: 40 });
  viewed.gateway.updateThreadMetadata.mockRejectedValue(CONFLICT);
  await expect(viewed.save()).rejects.toBe(CONFLICT);
  expect(viewed.gateway.updateThreadMetadata).toHaveBeenCalledTimes(3);
});

it.each([
  ["before the read", 0],
  ["after the read", 1],
  ["after the write", 2],
])("discards the outcome when the owner is revoked %s", async (_name, allowed) => {
  let checks = 0;
  const { gateway, save } = saving({ pinned: true }, () => checks++ < allowed);
  expect(await save()).toEqual({ kind: "stale" });
  expect(gateway.getThreadMetadata).toHaveBeenCalledTimes(Math.min(allowed, 1));
  expect(gateway.updateThreadMetadata).toHaveBeenCalledTimes(allowed === 2 ? 1 : 0);
});

it.each([
  ["Runner request failed (HTTP 409).", "changed on another device"],
  ["Runner request failed (HTTP 429).", "a server limit was reached"],
  ["Runner request failed (HTTP 503).", "temporarily unavailable"],
  ["Runner request failed (HTTP 404).", "no longer available on the server"],
  ["Runner request failed (HTTP 400).", "rejected by the server"],
  [
    "The server runner rejected this request as invalid (HTTP 400). If it is older than this editor, update the runner on the server.",
    "rejected by the server",
  ],
])("presents the known server failure without exposing a raw payload: %s", (error, expected) => {
  for (const viewed of [false, true]) {
    expect(serverThreadMetadataSaveError(error, viewed)).toContain(expected);
    expect(serverThreadMetadataSaveError(new Error(error), viewed)).toContain(expected);
  }
});

it.each([undefined, { error: "conflict" }, "private path HTTP 400 rejected"])(
  "keeps unknown failures generic and distinguishes automatic read status: %j",
  (error) => {
    expect(serverThreadMetadataSaveError(error, false)).toBe(
      "The conversation change could not be saved on the server. Refresh and try again.",
    );
    expect(serverThreadMetadataSaveError(error, true)).toBe(
      "The conversation read status could not be saved on the server. Refresh and try again.",
    );
  },
);
