import { describe, expect, it, vi } from "vitest";
import {
  invokeWorkspaceTestDiscoveryIpc,
  WORKSPACE_TEST_DISCOVERY_IPC_COMMANDS,
  type InvokeWorkspaceTestDiscoveryCommand,
} from "./tauriWorkspaceTestDiscoveryIpcContract";

describe("workspace test discovery IPC contract", () => {
  it("decodes deterministic enumeration and bounded reads", async () => {
    const invokeCommand = vi.fn<InvokeWorkspaceTestDiscoveryCommand>()
      .mockResolvedValueOnce({ files: ["a.test.js", "z.spec.ts"], truncated: true, visited: 40 })
      .mockResolvedValueOnce({ status: "tooLarge" });
    await expect(invokeWorkspaceTestDiscoveryIpc(
      invokeCommand,
      WORKSPACE_TEST_DISCOVERY_IPC_COMMANDS.enumerate,
      { workspaceId: "ws-1", maxFiles: 2, maxVisited: 40 },
    )).resolves.toEqual({ files: ["a.test.js", "z.spec.ts"], truncated: true, visited: 40 });
    await expect(invokeWorkspaceTestDiscoveryIpc(
      invokeCommand,
      WORKSPACE_TEST_DISCOVERY_IPC_COMMANDS.readBounded,
      { workspaceId: "ws-1", relativePath: "a.test.js", maxBytes: 1024 },
    )).resolves.toEqual({ status: "tooLarge" });
  });

  it.each([
    { files: ["../escape.test.js"], truncated: false, visited: 1 },
    { files: [], truncated: "false", visited: 1 },
    { files: [], truncated: false, visited: -1 },
    { files: [], truncated: false, visited: 1, drift: true },
  ])("rejects malformed enumeration %#", async (wire) => {
    await expect(invokeWorkspaceTestDiscoveryIpc(
      vi.fn<InvokeWorkspaceTestDiscoveryCommand>().mockResolvedValue(wire),
      WORKSPACE_TEST_DISCOVERY_IPC_COMMANDS.enumerate,
      { workspaceId: "ws-1", maxFiles: 2, maxVisited: 40 },
    )).rejects.toThrow("Invalid workspace test discovery IPC value");
  });

  it.each([
    { status: "ok", content: 42 },
    { status: "tooLarge", content: "drift" },
    { status: "missing" },
  ])("rejects malformed bounded read %#", async (wire) => {
    await expect(invokeWorkspaceTestDiscoveryIpc(
      vi.fn<InvokeWorkspaceTestDiscoveryCommand>().mockResolvedValue(wire),
      WORKSPACE_TEST_DISCOVERY_IPC_COMMANDS.readBounded,
      { workspaceId: "ws-1", relativePath: "a.test.js", maxBytes: 1024 },
    )).rejects.toThrow("Invalid workspace test discovery IPC value");
  });
});
