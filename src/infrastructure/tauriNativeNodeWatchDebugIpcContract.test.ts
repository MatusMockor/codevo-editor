import { describe, expect, it, vi } from "vitest";
import type { NativeNodeWatchDebugStartRequest } from "../domain/nativeNodeWatchDebugGateway";
import { invokeDebugIpc, type InvokeDebugCommand } from "./tauriDebugIpcContract";

const request: NativeNodeWatchDebugStartRequest = {
  rootPath: "/workspace",
  scriptPath: "/workspace/server.js",
  watch: true,
  preserveOutput: true,
  breakpoints: [
    {
      id: "server-entry",
      filePath: "/workspace/server.js",
      lineNumber: 7,
      enabled: true,
    },
  ],
  exceptionPauseMode: "uncaught",
  exceptionTypeFilter: ["TypeError", "app.DomainError"],
  justMyCode: "nodeInternalsAndDependencies",
};

describe("native Node watch debug IPC contract", () => {
  it("preserves the exact closed request and decodes the existing start response", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue({
      status: "ok",
      sessionId: 19,
    });

    await expect(
      invokeDebugIpc(invokeCommand, "debug_start_native_node_watch", request),
    ).resolves.toEqual({ status: "ok", sessionId: 19 });
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_start_native_node_watch", request);
  });

  it("validates the exact confirmation owner and void response", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue(undefined);
    await expect(
      invokeDebugIpc(invokeCommand, "debug_confirm_native_node_watch", {
        rootPath: "/workspace",
        sessionId: 19,
      }),
    ).resolves.toBeUndefined();
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_confirm_native_node_watch", {
      rootPath: "/workspace",
      sessionId: 19,
    });
  });

  it.each([
    ["unknown field", { ...request, runtimeArgs: ["--inspect"] }],
    ["false watch", { ...request, watch: false }],
    ["false preserve output", { ...request, preserveOutput: false }],
    ["unsafe root", { ...request, rootPath: "/work\nspace" }],
    ["unsafe script", { ...request, scriptPath: "/workspace/\0server.js" }],
    ["invalid pause mode", { ...request, exceptionPauseMode: "caught" }],
    ["missing exception filter", withoutExceptionTypeFilter(request)],
    ["duplicate exception filter", { ...request, exceptionTypeFilter: ["Error", "Error"] }],
    ["invalid exception filter", { ...request, exceptionTypeFilter: ["invalid-name"] }],
    [
      "oversized exception filter",
      { ...request, exceptionTypeFilter: Array.from({ length: 9 }, (_, index) => `Error${index}`) },
    ],
    ["invalid just-my-code policy", { ...request, justMyCode: "**/node_modules/**" }],
  ])("rejects %s before transport", async (_label, invalidRequest) => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();

    await expect(
      invokeDebugIpc(
        invokeCommand,
        "debug_start_native_node_watch",
        invalidRequest as NativeNodeWatchDebugStartRequest,
      ),
    ).rejects.toThrow("debug_start_native_node_watch args");
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("enforces bounded paths and existing breakpoint caps", async () => {
    const invokeCommand = vi.fn<InvokeDebugCommand>();

    await expect(
      invokeDebugIpc(invokeCommand, "debug_start_native_node_watch", {
        ...request,
        scriptPath: `/${"a".repeat(4_096)}`,
      }),
    ).rejects.toThrow("debug_start_native_node_watch args.scriptPath");
    await expect(
      invokeDebugIpc(invokeCommand, "debug_start_native_node_watch", {
        ...request,
        breakpoints: Array.from({ length: 2_001 }, (_, index) => ({
          id: `breakpoint-${index}`,
          filePath: `/workspace/file-${index}.js`,
          lineNumber: 1,
          enabled: true,
        })),
      }),
    ).rejects.toThrow("debug_start_native_node_watch args.breakpoints");
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});

function withoutExceptionTypeFilter(
  value: NativeNodeWatchDebugStartRequest,
): Omit<NativeNodeWatchDebugStartRequest, "exceptionTypeFilter"> {
  const { exceptionTypeFilter: _, ...requestWithoutFilter } = value;
  return requestWithoutFilter;
}
