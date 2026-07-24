import { describe, expect, it, vi } from "vitest";
import type { Breakpoint } from "../domain/debug";
import {
  DEBUG_START_NODE_ATTACH_CANDIDATE_IPC_COMMAND,
  NODE_DEBUG_ATTACH_START_FAILED,
  invokeNodeDebugAttachCandidateStartIpc,
  type InvokeNodeDebugAttachStartCommand,
  type NodeDebugAttachCandidateStartRequest,
} from "./tauriNodeDebugAttachStartIpcContract";

const LEASE_ID = "0123456789abcdef0123456789abcdef";

function breakpoint(): Breakpoint {
  return {
    id: "bp-1",
    filePath: "/workspace/server.ts",
    lineNumber: 7,
    condition: null,
    logMessage: null,
    enabled: true,
    verified: false,
  };
}

function request(
  overrides: Partial<NodeDebugAttachCandidateStartRequest> = {},
): NodeDebugAttachCandidateStartRequest {
  return {
    rootPath: "/workspace",
    candidateLeaseId: LEASE_ID,
    breakpoints: [breakpoint()],
    exceptionPauseMode: "uncaught",
    exceptionTypeFilter: ["TypeError", "app.DomainError"],
    justMyCode: "nodeInternalsAndDependencies",
    ...overrides,
  };
}

describe("Node debug attach candidate start IPC contract", () => {
  it("sends only the exact nested Rust request", async () => {
    const invoke = vi.fn<InvokeNodeDebugAttachStartCommand>().mockResolvedValue({
      status: "ok",
      sessionId: 17,
    });
    const polluted = {
      ...request(),
      pid: 41,
      port: 9229,
      webSocketDebuggerUrl: "ws://127.0.0.1:9229/private",
    } as NodeDebugAttachCandidateStartRequest;

    await invokeNodeDebugAttachCandidateStartIpc(invoke, polluted);

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith(DEBUG_START_NODE_ATTACH_CANDIDATE_IPC_COMMAND, {
      request: {
        rootPath: "/workspace",
        candidateLeaseId: LEASE_ID,
        breakpoints: [breakpoint()],
        exceptionPauseMode: "uncaught",
        exceptionTypeFilter: ["TypeError", "app.DomainError"],
        justMyCode: "nodeInternalsAndDependencies",
      },
    });
    const wire = JSON.stringify(invoke.mock.calls[0]?.[1]);
    expect(wire).not.toContain('"pid"');
    expect(wire).not.toContain('"port"');
    expect(wire).not.toContain("webSocket");
    expect(wire).not.toContain("ws://");
  });

  it.each([
    ["Error", "Error"],
    ["Error", ""],
    ["Error", "invalid-name"],
    ["a.b.c.d.e.f.g.h.i"],
    ["x".repeat(257)],
  ])("rejects malformed exception filter %# before invoke", async (...exceptionTypeFilter) => {
    const invoke = vi.fn<InvokeNodeDebugAttachStartCommand>();
    const result = await invokeNodeDebugAttachCandidateStartIpc(
      invoke,
      request({ exceptionTypeFilter }),
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "error",
      message: NODE_DEBUG_ATTACH_START_FAILED,
    });
  });

  it("snapshots the exception filter once before validation and encoding", async () => {
    const invoke = vi.fn<InvokeNodeDebugAttachStartCommand>().mockResolvedValue({
      status: "ok",
      sessionId: 17,
    });
    let reads = 0;
    const flippingRequest = {
      ...request(),
      get exceptionTypeFilter() {
        reads += 1;
        if (reads === 1) return ["TypeError"];
        return Array.from({ length: 9 }, (_, index) => `Error${index}`);
      },
    };

    await invokeNodeDebugAttachCandidateStartIpc(invoke, flippingRequest);

    expect(reads).toBe(1);
    expect(invoke).toHaveBeenCalledWith(DEBUG_START_NODE_ATTACH_CANDIDATE_IPC_COMMAND, {
      request: expect.objectContaining({ exceptionTypeFilter: ["TypeError"] }),
    });
  });

  it.each([
    "",
    "0123456789ABCDEF0123456789ABCDEF",
    "0123456789abcdef0123456789abcdeg",
    "0123456789abcdef0123456789abcde",
    "0123456789abcdef0123456789abcdef0",
  ])("rejects malformed lease capability %j before invoke", async (candidateLeaseId) => {
    const invoke = vi.fn<InvokeNodeDebugAttachStartCommand>();
    const result = await invokeNodeDebugAttachCandidateStartIpc(
      invoke,
      request({ candidateLeaseId }),
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "error",
      message: NODE_DEBUG_ATTACH_START_FAILED,
    });
  });

  it.each([
    [
      { status: "ok", sessionId: 17 },
      { status: "ok", sessionId: 17 },
    ],
    [
      { status: "unavailable", message: "Unavailable." },
      { status: "unavailable", message: "Unavailable." },
    ],
    [
      { status: "error", message: NODE_DEBUG_ATTACH_START_FAILED },
      { status: "error", message: NODE_DEBUG_ATTACH_START_FAILED },
    ],
  ] as const)("reuses the strict debug start result decoder", async (wire, expected) => {
    const result = await invokeNodeDebugAttachCandidateStartIpc(
      vi.fn<InvokeNodeDebugAttachStartCommand>().mockResolvedValue(wire),
      request(),
    );
    expect(result).toEqual(expected);
  });

  it.each([
    null,
    { status: "ok", sessionId: 0 },
    { status: "ok", sessionId: 1, pid: 41 },
    { status: "error", message: 42 },
  ])("collapses malformed result %# to the generic failed start", async (wire) => {
    const result = await invokeNodeDebugAttachCandidateStartIpc(
      vi.fn<InvokeNodeDebugAttachStartCommand>().mockResolvedValue(wire),
      request(),
    );
    expect(result).toEqual({
      status: "error",
      message: NODE_DEBUG_ATTACH_START_FAILED,
    });
  });

  it("collapses invoke rejection without leaking its details", async () => {
    const result = await invokeNodeDebugAttachCandidateStartIpc(
      vi
        .fn<InvokeNodeDebugAttachStartCommand>()
        .mockRejectedValue(new Error(`failed lease ${LEASE_ID}`)),
      request(),
    );
    expect(result).toEqual({
      status: "error",
      message: NODE_DEBUG_ATTACH_START_FAILED,
    });
    expect(JSON.stringify(result)).not.toContain(LEASE_ID);
  });
});
