import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteRunnerDescriptor } from "../domain/remoteRunner";
import type { RemoteRunnerMcpDeviceSyncReport } from "../domain/remoteRunnerMcpDeviceSync";
import {
  createRemoteDeviceMcpNoticeMemory,
  REMOTE_DEVICE_MCP_NOTICE_MEMORY_LIMIT,
} from "./remoteDeviceMcpNoticeMemory";
import {
  REMOTE_DEVICE_MCP_SYNC_TIMEOUT_MS,
  syncRemoteDeviceMcpServers,
  type RemoteDeviceMcpSyncInput,
} from "./syncRemoteDeviceMcpServers";

const target = { serverId: "linux", runnerId: "runner", projectId: "p" } as const;
const source = { rootPath: "/Users/dev/p", projectKind: "git" } as const;
const descriptor: RemoteRunnerDescriptor = {
  protocolVersion: 1,
  runnerId: "runner",
  name: "Linux",
  capabilities: { taskExecution: true, eventReplay: true, mcpDeviceSync: true },
};
const added: RemoteRunnerMcpDeviceSyncReport = {
  version: 1,
  results: [{ name: "files", transport: "stdio", outcome: "added", hints: [] }],
  omitted: 0,
};

function input(overrides: Partial<RemoteDeviceMcpSyncInput> = {}): RemoteDeviceMcpSyncInput {
  return {
    gateway: { syncDeviceMcpServers: vi.fn().mockResolvedValue(added) },
    descriptor,
    target,
    provider: "claude",
    resolveSource: () => source,
    valid: () => true,
    memory: createRemoteDeviceMcpNoticeMemory(),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("syncRemoteDeviceMcpServers", () => {
  it("sends the exact owner and local source and returns the change notice", async () => {
    const sync = vi.fn().mockResolvedValue(added);
    await expect(
      syncRemoteDeviceMcpServers(input({ gateway: { syncDeviceMcpServers: sync } })),
    ).resolves.toBe("Synced MCP servers from this Mac to the server: files.");
    expect(sync).toHaveBeenCalledWith({ ...target, ...source });
  });

  it("returns null when nothing changed", async () => {
    const unchanged = { ...added, results: [{ ...added.results[0]!, outcome: "unchanged" }] };
    await expect(
      syncRemoteDeviceMcpServers(
        input({ gateway: { syncDeviceMcpServers: vi.fn().mockResolvedValue(unchanged) } }),
      ),
    ).resolves.toBeNull();
  });

  it.each([
    ["Codex", { provider: "codex" as const }],
    [
      "a runner without the capability",
      { descriptor: { ...descriptor, capabilities: { taskExecution: true, eventReplay: true } } },
    ],
    ["another runner", { descriptor: { ...descriptor, runnerId: "other" } }],
    ["a gateway without the method", { gateway: {} }],
    ["no source resolver", { resolveSource: undefined }],
    ["no local source", { resolveSource: () => null }],
    ["a revoked owner", { valid: () => false }],
  ])("does nothing for %s", async (_label, overrides) => {
    const sync = vi.fn().mockResolvedValue(added);
    const result = await syncRemoteDeviceMcpServers(
      input({ gateway: { syncDeviceMcpServers: sync }, ...overrides }),
    );
    expect(result).toBeNull();
    expect(sync).not.toHaveBeenCalled();
  });

  it("turns a refusal into a bounded notice without throwing", async () => {
    const sync = vi.fn().mockRejectedValue("Too many local MCP servers to sync.");
    await expect(
      syncRemoteDeviceMcpServers(input({ gateway: { syncDeviceMcpServers: sync } })),
    ).resolves.toBe(
      "MCP servers from this Mac could not be synced to the server. Too many local MCP servers to sync. The conversation starts with the server's current MCP servers.",
    );
  });

  it("does not throw when the source resolver or gateway throws synchronously", async () => {
    await expect(
      syncRemoteDeviceMcpServers(
        input({
          resolveSource: () => {
            throw new Error("boom");
          },
        }),
      ),
    ).resolves.toBeNull();
    const sync = vi.fn(() => {
      throw new Error("sync boom");
    });
    await expect(
      syncRemoteDeviceMcpServers(input({ gateway: { syncDeviceMcpServers: sync } })),
    ).resolves.toContain("sync boom.");
  });

  it("stops waiting after the timeout and reports it", async () => {
    vi.useFakeTimers();
    const sync = vi.fn(() => new Promise<RemoteRunnerMcpDeviceSyncReport>(() => undefined));
    const pending = syncRemoteDeviceMcpServers(input({ gateway: { syncDeviceMcpServers: sync } }));
    await vi.advanceTimersByTimeAsync(REMOTE_DEVICE_MCP_SYNC_TIMEOUT_MS);
    await expect(pending).resolves.toBe(
      "MCP server sync from this Mac did not finish within 20 seconds. The conversation starts with the server's current MCP servers.",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timer after an early answer", async () => {
    vi.useFakeTimers();
    await syncRemoteDeviceMcpServers(input());
    expect(vi.getTimerCount()).toBe(0);
  });

  it("publishes nothing when the owner changes during the sync", async () => {
    let current = true;
    let finish!: (report: RemoteRunnerMcpDeviceSyncReport) => void;
    const sync = vi.fn(
      () =>
        new Promise<RemoteRunnerMcpDeviceSyncReport>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = syncRemoteDeviceMcpServers(
      input({ gateway: { syncDeviceMcpServers: sync }, valid: () => current }),
    );
    await vi.waitFor(() => expect(sync).toHaveBeenCalled());
    current = false;
    finish(added);
    await expect(pending).resolves.toBeNull();
  });

  it("suppresses repeated persistent states and shows them again when they change", async () => {
    const memory = createRemoteDeviceMcpNoticeMemory();
    const persistentReport = (
      results: RemoteRunnerMcpDeviceSyncReport["results"],
      omitted = 0,
    ): RemoteRunnerMcpDeviceSyncReport => ({ version: 1, results, omitted });
    const missing = {
      name: "tool",
      transport: "stdio",
      outcome: "commandMissing",
      hints: [],
    } as const;
    const run = (
      report: RemoteRunnerMcpDeviceSyncReport,
      owner: RemoteDeviceMcpSyncInput["target"] = target,
    ) =>
      syncRemoteDeviceMcpServers(
        input({
          memory,
          target: owner,
          gateway: { syncDeviceMcpServers: vi.fn().mockResolvedValue(report) },
        }),
      );
    const missingNotice = "Not installed because the command is missing on the server: tool.";
    await expect(run(persistentReport([missing]))).resolves.toBe(missingNotice);
    await expect(run(persistentReport([missing]))).resolves.toBeNull();
    await expect(run(persistentReport([missing, added.results[0]!]))).resolves.toBe(
      "Synced MCP servers from this Mac to the server: files.",
    );
    await expect(
      run(persistentReport([missing, { ...added.results[0]!, outcome: "failed" }])),
    ).resolves.toBe("Could not install on the server: files.");
    await expect(run(persistentReport([missing], 1))).resolves.toBe(
      `${missingNotice} The name of 1 more MCP server could not be shown.`,
    );
    await expect(run(persistentReport([missing], 1))).resolves.toBeNull();
    await expect(run(persistentReport([missing], 1), { ...target, projectId: "q" })).resolves.toBe(
      `${missingNotice} The name of 1 more MCP server could not be shown.`,
    );
    await expect(run(persistentReport([]))).resolves.toBeNull();
    await expect(run(persistentReport([missing], 1))).resolves.toBe(
      `${missingNotice} The name of 1 more MCP server could not be shown.`,
    );
  });

  it("does not remember persistent states after a failure or an owner change", async () => {
    const memory = createRemoteDeviceMcpNoticeMemory();
    const kept: RemoteRunnerMcpDeviceSyncReport = {
      version: 1,
      results: [{ name: "mine", transport: "http", outcome: "keptServerEntry", hints: [] }],
      omitted: 0,
    };
    await syncRemoteDeviceMcpServers(
      input({
        memory,
        valid: vi.fn().mockReturnValueOnce(true).mockReturnValue(false),
        gateway: { syncDeviceMcpServers: vi.fn().mockResolvedValue(kept) },
      }),
    );
    await expect(
      syncRemoteDeviceMcpServers(
        input({ memory, gateway: { syncDeviceMcpServers: vi.fn().mockResolvedValue(kept) } }),
      ),
    ).resolves.toBe("Kept the server's own settings for: mine.");
  });
});

describe("remote device MCP notice memory", () => {
  it("evicts the least recently remembered owner deterministically", () => {
    const memory = createRemoteDeviceMcpNoticeMemory(2);
    const owner = (projectId: string) => ({ ...target, projectId });
    memory.remember(owner("a"), "1");
    memory.remember(owner("b"), "1");
    memory.remember(owner("a"), "2");
    memory.remember(owner("c"), "1");
    expect(memory.shown(owner("a"), "2")).toBe(true);
    expect(memory.shown(owner("b"), "1")).toBe(false);
    expect(memory.shown(owner("c"), "1")).toBe(true);
    memory.remember(owner("c"), null);
    expect(memory.shown(owner("c"), "1")).toBe(false);
    expect(REMOTE_DEVICE_MCP_NOTICE_MEMORY_LIMIT).toBe(64);
  });
});
