import { describe, expect, it, vi } from "vitest";
import { TauriRemoteRunnerGateway } from "./tauriRemoteRunnerGateway";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";

const taskId = "12345678-1234-4234-8234-123456789abc";
const metadata = {
  taskId,
  revision: 0,
  title: null,
  pinned: false,
  archived: false,
  removed: false,
  viewedAtEpochMs: null,
  snoozedUntil: null,
  settledAt: null,
  sortOrder: null,
};
describe("remote management boundaries", () => {
  it("routes repository searches to the explicitly selected server", async () => {
    const outcome = { status: "ok", repositories: [], nextPage: null, truncated: false };
    const invoke = vi.fn().mockResolvedValue(outcome);
    const request = {
      serverId: "linux",
      request: { provider: "github" as const, host: "github.com", query: "crm", page: 1 },
    };
    expect(await new TauriRemoteRunnerGateway(invoke).searchRepositories(request)).toEqual(outcome);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("remote_runner_search_repositories", {
      request,
    });
  });
  it("carries revision and explicit nullable resets to the server", async () => {
    const invoke = vi.fn().mockResolvedValue({ ...metadata, revision: 1, pinned: true });
    const request = {
      serverId: "linux",
      taskId,
      patch: { expectedRevision: 0, pinned: true, snoozedUntil: null },
    };
    expect(await new TauriRemoteRunnerGateway(invoke).updateThreadMetadata(request)).toMatchObject({
      revision: 1,
      pinned: true,
    });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("remote_runner_patch_thread_metadata", {
      request,
    });
  });
  it.each([
    { expectedRevision: -1, pinned: true },
    { expectedRevision: 0 },
    { expectedRevision: 0, title: "secret\nheader" },
    { expectedRevision: 0, title: "x".repeat(257) },
    { expectedRevision: 0, pinned: "true" },
    { expectedRevision: 0, snoozedUntil: -1 },
    { expectedRevision: 0, settledAt: Number.MAX_SAFE_INTEGER + 1 },
    { expectedRevision: 0, sortOrder: Infinity },
    { expectedRevision: 0, token: "unexpected" },
    { expectedRevision: 0, snoozedUntil: 1, settledAt: 1 },
  ])("rejects malformed mutation before IPC %j", async (patch) => {
    const invoke = vi.fn();
    const gateway = new TauriRemoteRunnerGateway(invoke);
    await expect(
      gateway.updateThreadMetadata({ serverId: "linux", taskId, patch } as Parameters<
        typeof gateway.updateThreadMetadata
      >[0]),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each([
    { ...metadata, token: "unexpected" },
    { ...metadata, revision: 0.5 },
    { ...metadata, snoozedUntil: 1, settledAt: 1 },
    { ...metadata, snoozedUntil: undefined },
    { ...metadata, taskId: "../other" },
  ])("rejects invalid authoritative metadata %j", (value) => {
    expect(() => validateRemoteRunnerValue("getThreadMetadata", "response", value)).toThrow();
  });
  it("rejects duplicated or oversized metadata pages", () => {
    for (const items of [[metadata, metadata], Array(101).fill(metadata)]) {
      expect(() =>
        validateRemoteRunnerValue("listThreadMetadata", "response", { items, nextAfter: null }),
      ).toThrow();
    }
    expect(() =>
      validateRemoteRunnerValue("listThreadMetadata", "response", {
        items: [metadata],
        nextAfter: null,
      }),
    ).not.toThrow();
  });
  it("rejects traversal and foreign children in remote directory listings", () => {
    const listing = {
      path: "/home/codex/Developer",
      parentPath: "/home/codex",
      entries: [{ name: "crm", path: "/home/codex/Developer/crm" }],
      truncated: false,
    };
    expect(() =>
      validateRemoteRunnerValue("listProjectDirectories", "response", listing),
    ).not.toThrow();
    for (const path of ["/etc/crm", "/home/codex/Developer/../crm", "file:///tmp/crm"]) {
      expect(() =>
        validateRemoteRunnerValue("listProjectDirectories", "response", {
          ...listing,
          entries: [{ name: "crm", path }],
        }),
      ).toThrow();
    }
  });
  it("requires the negotiated management flags to remain strict booleans", () => {
    const runner = {
      protocolVersion: 1,
      runnerId: taskId,
      name: "Linux",
      capabilities: { taskExecution: true, eventReplay: true },
    };
    for (const key of ["projectManagement", "threadManagement"]) {
      for (const value of [true, false])
        expect(() =>
          validateRemoteRunnerValue("getRunner", "response", {
            ...runner,
            capabilities: { ...runner.capabilities, [key]: value },
          }),
        ).not.toThrow();
      for (const value of [null, 1, "true"])
        expect(() =>
          validateRemoteRunnerValue("getRunner", "response", {
            ...runner,
            capabilities: { ...runner.capabilities, [key]: value },
          }),
        ).toThrow();
    }
  });
});
