import { describe, expect, it, vi } from "vitest";
import {
  invokeCreateWorkspaceTextWithContent,
  type InvokeWorkspaceMutationCommand,
} from "./tauriWorkspaceMutationIpcContract";

const REVISION = {
  device: "1",
  inode: "2",
  size: 3,
  modifiedSeconds: 4,
  modifiedNanoseconds: 5,
  contentHash: "6",
};

describe("workspace mutation IPC contract", () => {
  it("invokes the exact owner-scoped command and decodes its revision", async () => {
    const invokeCommand = vi.fn<InvokeWorkspaceMutationCommand>().mockResolvedValue({
      status: "success",
      revision: REVISION,
    });
    await expect(
      invokeCreateWorkspaceTextWithContent(invokeCommand, {
        workspaceId: "ws-a",
        relativePath: ".codevo/settings.json",
        content: "{}\n",
      }),
    ).resolves.toEqual({ status: "success", revision: REVISION });
    expect(invokeCommand).toHaveBeenCalledWith("workspace_create_text_file_with_content", {
      workspaceId: "ws-a",
      relativePath: ".codevo/settings.json",
      content: "{}\n",
    });
  });

  it.each([
    { status: "success", revision: null },
    { status: "success", revision: { ...REVISION, drift: true } },
    { status: "success", revision: { ...REVISION, device: 1 } },
    { status: "conflict", message: "exists", drift: true },
    { status: "unknown" },
  ])("rejects malformed wire results %#", async (wire) => {
    await expect(
      invokeCreateWorkspaceTextWithContent(
        vi.fn<InvokeWorkspaceMutationCommand>().mockResolvedValue(wire),
        { workspaceId: "ws-a", relativePath: "settings.json", content: "{}" },
      ),
    ).rejects.toThrow("Invalid workspace mutation IPC value");
  });

  it.each(["../settings.json", "/settings.json", "a//settings.json", "C:/settings.json"])(
    "rejects unsafe owner-relative path %s before invocation",
    async (relativePath) => {
      const invokeCommand = vi.fn<InvokeWorkspaceMutationCommand>();
      await expect(
        invokeCreateWorkspaceTextWithContent(invokeCommand, {
          workspaceId: "ws-a",
          relativePath,
          content: "{}",
        }),
      ).rejects.toThrow("workspace-relative descendant path");
      expect(invokeCommand).not.toHaveBeenCalled();
    },
  );
});
