import { describe, expect, it, vi } from "vitest";
import {
  invokeWorkspaceDirectoryIpc,
  WORKSPACE_DIRECTORY_MAX_ENTRIES,
} from "./tauriWorkspaceDirectoryIpcContract";

describe("workspace directory IPC contract", () => {
  it("invokes the exact command and decodes a bounded listing", async () => {
    const invoke = vi.fn().mockResolvedValue({
      entries: [{ name: "src", relativePath: "src", kind: "directory" }],
      truncated: true,
    });
    await expect(
      invokeWorkspaceDirectoryIpc(invoke, {
        workspaceId: "ws-1",
        relativePath: "packages/app",
        maxEntries: 10,
      }),
    ).resolves.toEqual({
      entries: [{ name: "src", relativePath: "src", kind: "directory" }],
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
          entries: [{ name: "bad", relativePath: "../bad", kind: "file" }],
          truncated: false,
        }),
        { workspaceId: "ws-1", relativePath: "", maxEntries: 1 },
      ),
    ).rejects.toThrow("descendant path");
  });

  it("rejects a native result larger than the requested bound", async () => {
    await expect(
      invokeWorkspaceDirectoryIpc(
        vi.fn().mockResolvedValue({
          entries: [
            { name: "one", relativePath: "one", kind: "file" },
            { name: "two", relativePath: "two", kind: "file" },
          ],
          truncated: true,
        }),
        { workspaceId: "ws-1", relativePath: "", maxEntries: 1 },
      ),
    ).rejects.toThrow("at most 1 entries");
  });
});
