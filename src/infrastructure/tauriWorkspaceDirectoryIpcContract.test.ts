import { describe, expect, it, vi } from "vitest";
import {
  invokeWorkspaceDirectoryIpc,
  WORKSPACE_DIRECTORY_MAX_ENTRIES,
  WORKSPACE_DIRECTORY_MAX_NAME_UTF8_BYTES,
  WORKSPACE_DIRECTORY_MAX_TOTAL_UTF8_BYTES,
} from "./tauriWorkspaceDirectoryIpcContract";

describe("workspace directory IPC contract", () => {
  it("invokes the exact command and decodes a bounded listing", async () => {
    const invoke = vi.fn().mockResolvedValue({
      entries: [
        { name: "src", relativePath: "src", kind: "directory", ignored: false },
        { name: "dist", relativePath: "dist", kind: "directory", ignored: true },
      ],
      truncated: true,
    });
    await expect(
      invokeWorkspaceDirectoryIpc(invoke, {
        workspaceId: "ws-1",
        relativePath: "packages/app",
        maxEntries: 10,
      }),
    ).resolves.toEqual({
      entries: [
        { name: "src", relativePath: "src", kind: "directory", ignored: false },
        { name: "dist", relativePath: "dist", kind: "directory", ignored: true },
      ],
      truncated: true,
    });
    expect(invoke).toHaveBeenCalledWith("workspace_read_directory_bounded", {
      workspaceId: "ws-1",
      relativePath: "packages/app",
      maxEntries: 10,
    });
  });

  it("rejects invalid caps before invoking native code", async () => {
    const invoke = vi.fn();
    await expect(
      invokeWorkspaceDirectoryIpc(invoke, {
        workspaceId: "ws-1",
        relativePath: "",
        maxEntries: 0,
      }),
    ).rejects.toThrow("positive safe integer");
    await expect(
      invokeWorkspaceDirectoryIpc(invoke, {
        workspaceId: "ws-1",
        relativePath: "",
        maxEntries: WORKSPACE_DIRECTORY_MAX_ENTRIES + 1,
      }),
    ).rejects.toThrow("no greater than");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects unknown and malformed result fields", async () => {
    await expect(
      invokeWorkspaceDirectoryIpc(
        vi.fn().mockResolvedValue({ entries: [], truncated: false, extra: true }),
        { workspaceId: "ws-1", relativePath: "", maxEntries: 1 },
      ),
    ).rejects.toThrow("no unknown field");
    await expect(
      invokeWorkspaceDirectoryIpc(
        vi.fn().mockResolvedValue({
          entries: [{ name: "bad", relativePath: "../bad", kind: "file", ignored: false }],
          truncated: false,
        }),
        { workspaceId: "ws-1", relativePath: "", maxEntries: 1 },
      ),
    ).rejects.toThrow("descendant path");
  });

  it("rejects a missing or non-boolean gitignore decoration", async () => {
    for (const entry of [
      { name: "env.ts", relativePath: "env.ts", kind: "file" },
      { name: "env.ts", relativePath: "env.ts", kind: "file", ignored: "yes" },
    ]) {
      await expect(
        invokeWorkspaceDirectoryIpc(
          vi.fn().mockResolvedValue({ entries: [entry], truncated: false }),
          {
            workspaceId: "ws-1",
            relativePath: "",
            maxEntries: 1,
          },
        ),
      ).rejects.toThrow("ignored: expected a boolean");
    }
  });

  it("rejects a native result larger than the requested bound", async () => {
    await expect(
      invokeWorkspaceDirectoryIpc(
        vi.fn().mockResolvedValue({
          entries: [
            { name: "one", relativePath: "one", kind: "file", ignored: false },
            { name: "two", relativePath: "two", kind: "file", ignored: false },
          ],
          truncated: true,
        }),
        { workspaceId: "ws-1", relativePath: "", maxEntries: 1 },
      ),
    ).rejects.toThrow("at most 1 entries");
  });

  it("rejects oversized fields before IPC and aggregate response amplification", async () => {
    const invoke = vi.fn();
    await expect(
      invokeWorkspaceDirectoryIpc(invoke, {
        workspaceId: "w".repeat(1_025),
        relativePath: "",
        maxEntries: 1,
      }),
    ).rejects.toThrow("1024 bytes");
    expect(invoke).not.toHaveBeenCalled();

    const name = "x".repeat(WORKSPACE_DIRECTORY_MAX_NAME_UTF8_BYTES / 2);
    const entryCount = Math.floor(WORKSPACE_DIRECTORY_MAX_TOTAL_UTF8_BYTES / (name.length * 2)) + 1;
    await expect(
      invokeWorkspaceDirectoryIpc(
        vi.fn().mockResolvedValue({
          entries: Array.from({ length: entryCount }, () => ({
            name,
            relativePath: name,
            kind: "file",
            ignored: false,
          })),
          truncated: true,
        }),
        {
          workspaceId: "ws-1",
          relativePath: "",
          maxEntries: entryCount,
        },
      ),
    ).rejects.toThrow("aggregate UTF-8 bytes");
  });
});
