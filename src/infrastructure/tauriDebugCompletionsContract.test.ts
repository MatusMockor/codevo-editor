import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type {
  DebugConsoleCompletionRequest,
  DebugConsoleCompletionResponse,
} from "../domain/debugConsoleCompletions";
import { TauriDebugGateway } from "./tauriDebugGateway";
import {
  decodeDebugIpcResult,
  invokeDebugIpc,
  type DebugIpcCommandArgs,
  type DebugIpcCommandResult,
  type InvokeDebugCommand,
} from "./tauriDebugIpcContract";

const lexicalRequest: DebugConsoleCompletionRequest = {
  rootPath: "/workspace",
  sessionId: 7,
  pauseGeneration: 3,
  frameId: 11,
  query: { kind: "lexical", prefix: "con" },
};

describe("debug completions Tauri contract", () => {
  it("statically associates the structured request and bounded response", () => {
    expectTypeOf<DebugIpcCommandArgs<"debug_completions">>().toEqualTypeOf<{
      readonly request: DebugConsoleCompletionRequest;
    }>();
    expectTypeOf<DebugIpcCommandResult<"debug_completions">>().toEqualTypeOf<
      DebugConsoleCompletionResponse
    >();
  });

  it("validates before transport and returns a deeply frozen exact response", async () => {
    const wire = {
      items: [
        { label: "console", kind: "variable" },
        { label: "constructor", kind: "property" },
      ],
      isIncomplete: false,
    };
    const invokeCommand = vi.fn<InvokeDebugCommand>().mockResolvedValue(wire);

    const result = await invokeDebugIpc(invokeCommand, "debug_completions", {
      request: lexicalRequest,
    });

    expect(result).toEqual(wire);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.items)).toBe(true);
    expect(Object.isFrozen(result.items[0])).toBe(true);
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_completions", {
      request: lexicalRequest,
    });
  });

  it("accepts only closed lexical/member query variants", async () => {
    const invokeCommand = vi
      .fn<InvokeDebugCommand>()
      .mockResolvedValue({ items: [], isIncomplete: false });
    const memberRequest: DebugConsoleCompletionRequest = {
      ...lexicalRequest,
      query: {
        kind: "member",
        root: { kind: "binding", name: "account" },
        path: ["profile", "0", "café"],
        prefix: "na",
      },
    };
    await expect(
      invokeDebugIpc(invokeCommand, "debug_completions", { request: memberRequest }),
    ).resolves.toEqual({ items: [], isIncomplete: false });

    const malformedQueries = [
      { kind: "lexical", prefix: "x", extra: true },
      { kind: "other", prefix: "x" },
      { kind: "member", root: { kind: "this", name: "x" }, path: [], prefix: "" },
      { kind: "member", root: { kind: "binding", name: "" }, path: [], prefix: "" },
      { kind: "member", root: { kind: "binding", name: "x" }, path: [], prefix: "x-y" },
      {
        kind: "member",
        root: { kind: "binding", name: "x" },
        path: ["line\nfeed"],
        prefix: "",
      },
      {
        kind: "member",
        root: { kind: "binding", name: "x" },
        path: Array.from({ length: 9 }, () => "p"),
        prefix: "",
      },
    ];
    for (const query of malformedQueries) {
      await expect(
        invokeDebugIpc(invokeCommand, "debug_completions", {
          request: { ...lexicalRequest, query },
        } as never),
      ).rejects.toThrow(/^Invalid debug IPC value at debug_completions args/);
    }
    expect(invokeCommand).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed, oversized, or open response objects", () => {
    const malformed = [
      { items: [], isIncomplete: "false" },
      { items: [], isIncomplete: false, extra: true },
      { items: [{ label: "x", kind: "method" }], isIncomplete: false },
      { items: [{ label: "x", kind: "variable", extra: true }], isIncomplete: false },
      { items: [{ label: "\ud800", kind: "variable" }], isIncomplete: false },
      { items: [{ label: "x;process.exit()", kind: "property" }], isIncomplete: false },
      { items: [{ label: "foo-bar", kind: "property" }], isIncomplete: false },
      {
        items: Array.from({ length: 201 }, (_, index) => ({
          label: String(index),
          kind: "variable",
        })),
        isIncomplete: true,
      },
      {
        items: [{ label: "x".repeat(1_025), kind: "property" }],
        isIncomplete: true,
      },
      {
        items: Array.from({ length: 64 }, (_, index) => ({
          label: `${index}-${"x".repeat(1_020)}`,
          kind: "property",
        })),
        isIncomplete: true,
      },
    ];
    for (const value of malformed) {
      expect(() => decodeDebugIpcResult("debug_completions", value)).toThrow(
        /^Invalid debug IPC value at debug_completions result/,
      );
    }
  });

  it("returns an empty complete snapshot outside Tauri and delegates inside it", async () => {
    const browserGateway = new TauriDebugGateway(vi.fn(), vi.fn(), () => false);
    const browserResult = await browserGateway.completions(lexicalRequest);
    expect(browserResult).toEqual({ items: [], isIncomplete: false });
    expect(Object.isFrozen(browserResult)).toBe(true);
    expect(Object.isFrozen(browserResult.items)).toBe(true);

    const invokeCommand = vi
      .fn<InvokeDebugCommand>()
      .mockResolvedValue({ items: [{ label: "console", kind: "variable" }], isIncomplete: true });
    const desktopGateway = new TauriDebugGateway(invokeCommand, vi.fn(), () => true);
    await expect(desktopGateway.completions(lexicalRequest)).resolves.toEqual({
      items: [{ label: "console", kind: "variable" }],
      isIncomplete: true,
    });
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("debug_completions", {
      request: lexicalRequest,
    });
  });
});
