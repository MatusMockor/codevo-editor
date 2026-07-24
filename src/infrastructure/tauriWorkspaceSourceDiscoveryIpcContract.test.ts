import { describe, expect, it, vi } from "vitest";
import {
  decodeBoundedWorkspaceSourceRead,
  decodeWorkspaceSourceEnumeration,
  invokeWorkspaceSourceBoundedReadIpc,
  invokeWorkspaceSourceEnumerationIpc,
  type InvokeWorkspaceSourceDiscoveryCommand,
} from "./tauriWorkspaceSourceDiscoveryIpcContract";

describe("workspace source discovery IPC contract", () => {
  it("invokes and decodes enumeration and every bounded-read status", async () => {
    const invokeCommand = vi
      .fn<InvokeWorkspaceSourceDiscoveryCommand>()
      .mockResolvedValueOnce({ files: ["apps/api/src/a.ts"], truncated: true, visited: 50_000 })
      .mockResolvedValueOnce({ status: "ok", content: "router.get('/a', handler);" })
      .mockResolvedValueOnce({ status: "tooLarge" })
      .mockResolvedValueOnce({ status: "changed" });

    await expect(
      invokeWorkspaceSourceEnumerationIpc(invokeCommand, {
        workspaceId: "ws-1",
        maxFiles: 2_000,
        maxVisited: 50_000,
      }),
    ).resolves.toEqual({ files: ["apps/api/src/a.ts"], truncated: true, visited: 50_000 });
    await expect(
      invokeWorkspaceSourceBoundedReadIpc(invokeCommand, {
        workspaceId: "ws-1",
        relativePath: "apps/api/src/a.ts",
        maxBytes: 2_097_152,
      }),
    ).resolves.toEqual({ status: "ok", content: "router.get('/a', handler);" });
    await expect(
      invokeWorkspaceSourceBoundedReadIpc(invokeCommand, {
        workspaceId: "ws-1",
        relativePath: "apps/api/src/b.ts",
        maxBytes: 2_097_152,
      }),
    ).resolves.toEqual({ status: "tooLarge" });
    await expect(
      invokeWorkspaceSourceBoundedReadIpc(invokeCommand, {
        workspaceId: "ws-1",
        relativePath: "apps/api/src/c.ts",
        maxBytes: 2_097_152,
      }),
    ).resolves.toEqual({ status: "changed" });
  });

  it.each([
    { files: ["../escape.ts"], truncated: false, visited: 1 },
    { files: ["/absolute.ts"], truncated: false, visited: 1 },
    { files: ["src//a.ts"], truncated: false, visited: 1 },
    { files: [], truncated: "false", visited: 1 },
    { files: [], truncated: false, visited: -1 },
    { files: [], truncated: false, visited: 1, drift: true },
  ])("rejects malformed enumeration %#", (wire) => {
    expect(() => decodeWorkspaceSourceEnumeration(wire)).toThrow(
      "Invalid workspace source discovery IPC value",
    );
  });

  it.each([
    { status: "ok", content: 42 },
    { status: "tooLarge", content: "drift" },
    { status: "changed", content: "drift" },
    { status: "missing" },
  ])("rejects malformed bounded read %#", (wire) => {
    expect(() => decodeBoundedWorkspaceSourceRead(wire)).toThrow(
      "Invalid workspace source discovery IPC value",
    );
  });

  it("rejects unsafe outbound args before invoke", async () => {
    const invokeCommand = vi.fn<InvokeWorkspaceSourceDiscoveryCommand>();
    await expect(
      invokeWorkspaceSourceBoundedReadIpc(invokeCommand, {
        workspaceId: "ws-1",
        relativePath: "../escape.ts",
        maxBytes: 10,
      }),
    ).rejects.toThrow("workspace-relative descendant path");
    await expect(
      invokeWorkspaceSourceEnumerationIpc(invokeCommand, {
        workspaceId: "",
        maxFiles: 1,
        maxVisited: 1,
      }),
    ).rejects.toThrow("non-empty string");
    await expect(
      invokeWorkspaceSourceEnumerationIpc(invokeCommand, {
        workspaceId: "ws-1",
        maxFiles: 0,
        maxVisited: 1,
      }),
    ).rejects.toThrow("positive safe integer");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects responses that exceed the requested discovery bounds", async () => {
    const invokeCommand = vi
      .fn<InvokeWorkspaceSourceDiscoveryCommand>()
      .mockResolvedValueOnce({
        files: ["src/a.ts", "src/b.ts"],
        truncated: true,
        visited: 2,
      })
      .mockResolvedValueOnce({ files: [], truncated: true, visited: 3 })
      .mockResolvedValueOnce({ status: "ok", content: "éé" });

    await expect(
      invokeWorkspaceSourceEnumerationIpc(invokeCommand, {
        workspaceId: "ws-1",
        maxFiles: 1,
        maxVisited: 2,
      }),
    ).rejects.toThrow("at most 1 entries");
    await expect(
      invokeWorkspaceSourceEnumerationIpc(invokeCommand, {
        workspaceId: "ws-1",
        maxFiles: 1,
        maxVisited: 2,
      }),
    ).rejects.toThrow("at most 2");
    await expect(
      invokeWorkspaceSourceBoundedReadIpc(invokeCommand, {
        workspaceId: "ws-1",
        relativePath: "src/a.ts",
        maxBytes: 3,
      }),
    ).rejects.toThrow("at most 3 UTF-8 bytes");
  });
});
