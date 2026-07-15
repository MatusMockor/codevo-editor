import { describe, expect, it, vi } from "vitest";
import {
  captureWorkspaceBeforeSwitch,
  type CaptureWorkspaceBeforeSwitchPorts,
} from "./workspaceSessionSwitchLifecycle";

const ROOT = "/workspace";

describe("workspace session switch lifecycle", () => {
  it("invalidates pending file open before persisting and caching", async () => {
    const calls: string[] = [];
    const ports = createPorts({
      invalidatePendingFileOpen: () => calls.push("invalidate"),
      persistWorkspaceSession: async (rootPath) => {
        calls.push(`persist:${rootPath}`);
      },
      cacheWorkspaceState: (rootPath) => calls.push(`cache:${rootPath}`),
    });

    const result = await captureWorkspaceBeforeSwitch(
      {
        rootPath: ROOT,
        cacheWorkspace: true,
        isRequestCurrent: () => {
          calls.push("current");
          return true;
        },
      },
      ports,
    );

    expect(result).toBe("continue");
    expect(calls).toEqual([
      "invalidate",
      `persist:${ROOT}`,
      "current",
      `cache:${ROOT}`,
    ]);
  });

  it("reports persistence failures and continues to cache a current request", async () => {
    const error = new Error("persistence failed");
    const calls: string[] = [];
    const reportPersistenceError = vi.fn(
      (rootPath: string, reportedError: unknown) => {
        expect(rootPath).toBe(ROOT);
        expect(reportedError).toBe(error);
        calls.push("report");
      },
    );
    const ports = createPorts({
      invalidatePendingFileOpen: () => calls.push("invalidate"),
      persistWorkspaceSession: async () => {
        calls.push("persist");
        throw error;
      },
      cacheWorkspaceState: () => calls.push("cache"),
      reportPersistenceError,
    });

    await expect(
      captureWorkspaceBeforeSwitch(
        {
          rootPath: ROOT,
          cacheWorkspace: true,
          isRequestCurrent: () => {
            calls.push("current");
            return true;
          },
        },
        ports,
      ),
    ).resolves.toBe("continue");

    expect(reportPersistenceError).toHaveBeenCalledOnce();
    expect(calls).toEqual([
      "invalidate",
      "persist",
      "report",
      "current",
      "cache",
    ]);
  });

  it("reports a rejected persistence request before returning stale", async () => {
    const error = new Error("persistence failed");
    let current = true;
    const ports = createPorts({
      persistWorkspaceSession: async () => {
        current = false;
        throw error;
      },
    });

    await expect(
      captureWorkspaceBeforeSwitch(
        {
          rootPath: ROOT,
          cacheWorkspace: true,
          isRequestCurrent: () => current,
        },
        ports,
      ),
    ).resolves.toBe("stale");

    expect(ports.reportPersistenceError).toHaveBeenCalledOnce();
    expect(ports.reportPersistenceError).toHaveBeenCalledWith(ROOT, error);
    expect(ports.cacheWorkspaceState).not.toHaveBeenCalled();
  });

  it("returns stale without caching when the request changes during persistence", async () => {
    let current = true;
    const ports = createPorts({
      persistWorkspaceSession: async () => {
        current = false;
      },
    });

    await expect(
      captureWorkspaceBeforeSwitch(
        {
          rootPath: ROOT,
          cacheWorkspace: true,
          isRequestCurrent: () => current,
        },
        ports,
      ),
    ).resolves.toBe("stale");

    expect(ports.cacheWorkspaceState).not.toHaveBeenCalled();
  });

  it("only invalidates when workspace caching is disabled", async () => {
    const ports = createPorts();
    const isRequestCurrent = vi.fn(() => false);

    await expect(
      captureWorkspaceBeforeSwitch(
        {
          rootPath: ROOT,
          cacheWorkspace: false,
          isRequestCurrent,
        },
        ports,
      ),
    ).resolves.toBe("continue");

    expect(ports.invalidatePendingFileOpen).toHaveBeenCalledOnce();
    expect(ports.persistWorkspaceSession).not.toHaveBeenCalled();
    expect(ports.reportPersistenceError).not.toHaveBeenCalled();
    expect(isRequestCurrent).not.toHaveBeenCalled();
    expect(ports.cacheWorkspaceState).not.toHaveBeenCalled();
  });
});

function createPorts(
  overrides: Partial<CaptureWorkspaceBeforeSwitchPorts> = {},
): CaptureWorkspaceBeforeSwitchPorts {
  return {
    invalidatePendingFileOpen: vi.fn(),
    persistWorkspaceSession: vi.fn(async () => undefined),
    cacheWorkspaceState: vi.fn(),
    reportPersistenceError: vi.fn(),
    ...overrides,
  };
}
