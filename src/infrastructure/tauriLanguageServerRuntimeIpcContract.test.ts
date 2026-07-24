import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { emptyLanguageServerCapabilities } from "../domain/languageServerRuntime";
import {
  decodeLanguageServerRuntimeLogPath,
  decodeLanguageServerRuntimeStatus,
  invokeLanguageServerRuntimeIpc,
  type InvokeLanguageServerRuntimeCommand,
  type LanguageServerRuntimeIpcArgs,
  type LanguageServerRuntimeIpcResult,
} from "./tauriLanguageServerRuntimeIpcContract";

describe("language-server runtime Tauri IPC contract", () => {
  it("keeps operation arguments and results statically associated", () => {
    expectTypeOf<LanguageServerRuntimeIpcArgs<"cancelRequest">>().toEqualTypeOf<{
      readonly requestId: number;
      readonly rootPath: string;
    }>();
    expectTypeOf<LanguageServerRuntimeIpcArgs<"openLog">>().toEqualTypeOf<{
      readonly kind: "phpactor" | "tsserver";
      readonly rootPath: string;
    }>();
    expectTypeOf<LanguageServerRuntimeIpcResult<"stop">>().toMatchTypeOf<{
      kind: string;
    }>();
  });

  it("preserves the configured command name and exact wire payload", async () => {
    const invokeCommand = vi
      .fn<InvokeLanguageServerRuntimeCommand>()
      .mockResolvedValue("/tmp/runtime.log");

    await invokeLanguageServerRuntimeIpc(
      invokeCommand,
      {
        getStatus: "get_status",
        openLog: "open_language_runtime_log",
        start: "start_runtime",
        stop: "stop_runtime",
      },
      "openLog",
      {
        kind: "tsserver",
        rootPath: "/workspace",
      },
    );

    expect(invokeCommand).toHaveBeenCalledWith("open_language_runtime_log", {
      kind: "tsserver",
      rootPath: "/workspace",
    });
  });

  it("invokes request cancellation with the exact scoped payload", async () => {
    const invokeCommand = vi.fn<InvokeLanguageServerRuntimeCommand>().mockResolvedValue(undefined);

    await invokeLanguageServerRuntimeIpc(
      invokeCommand,
      {
        cancelRequest: "cancel_lsp_request",
        getStatus: "get_status",
        start: "start_runtime",
        stop: "stop_runtime",
      },
      "cancelRequest",
      {
        requestId: 42,
        rootPath: "/workspace",
      },
    );

    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("cancel_lsp_request", {
      requestId: 42,
      rootPath: "/workspace",
    });
  });

  it.each([
    { kind: "stopped", rootPath: "/workspace" },
    { kind: "starting", rootPath: "/workspace", sessionId: 4 },
    { kind: "crashed", rootPath: "/workspace", message: "exited" },
    {
      kind: "running",
      rootPath: "/workspace",
      sessionId: 4,
      capabilities: emptyLanguageServerCapabilities(),
    },
  ])("decodes a valid %s runtime status", (wire) => {
    expect(decodeLanguageServerRuntimeStatus(wire)).toEqual(wire);
  });

  it.each([
    null,
    { kind: "renamed" },
    { kind: "starting", session_id: 4 },
    { kind: "crashed", message: 42 },
    { kind: "stopped", rootPath: 42 },
    { kind: "running", sessionId: 4, capabilities: {} },
  ])("rejects malformed runtime status %#", (wire) => {
    expect(() => decodeLanguageServerRuntimeStatus(wire)).toThrow(
      /^Invalid language-server runtime IPC status:/,
    );
  });

  it("validates the optional inlay-hint resolve capability", () => {
    const capabilities = {
      ...emptyLanguageServerCapabilities(),
      inlayHintResolve: "yes",
    };

    expect(() =>
      decodeLanguageServerRuntimeStatus({
        capabilities,
        kind: "running",
        rootPath: "/workspace",
        sessionId: 4,
      }),
    ).toThrow("running.capabilities.inlayHintResolve must be a boolean when present");
  });

  it("validates the runtime log response", () => {
    expect(decodeLanguageServerRuntimeLogPath("/tmp/runtime.log")).toBe("/tmp/runtime.log");
    expect(() => decodeLanguageServerRuntimeLogPath({ path: "/tmp/runtime.log" })).toThrow(
      "Invalid language-server log IPC response: expected a string path.",
    );
  });
});
