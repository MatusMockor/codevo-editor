import { describe, expect, it, vi } from "vitest";
import {
  DEBUG_LIST_NODE_ATTACH_CANDIDATES_IPC_COMMAND,
  invokeNodeDebugAttachCandidateListIpc,
  type InvokeNodeDebugAttachCandidateCommand,
} from "./tauriNodeDebugAttachCandidateIpcContract";

describe("Node debug attach candidate IPC contract", () => {
  it("uses the exact command and nested request shape", async () => {
    const invoke = vi.fn<InvokeNodeDebugAttachCandidateCommand>().mockResolvedValue({
      status: "unavailable",
    });

    await invokeNodeDebugAttachCandidateListIpc(invoke, { rootPath: "/workspace" });

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith(DEBUG_LIST_NODE_ATTACH_CANDIDATES_IPC_COMMAND, {
      request: { rootPath: "/workspace" },
    });
  });

  it.each(["unavailable", "error"] as const)("preserves and freezes %s status", async (status) => {
    const result = await invokeNodeDebugAttachCandidateListIpc(
      vi.fn<InvokeNodeDebugAttachCandidateCommand>().mockResolvedValue({ status }),
      { rootPath: "/workspace" },
    );

    expect(result).toEqual({ status });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("decodes a deeply frozen redacted candidate list", async () => {
    const wire = {
      status: "ok",
      candidates: [
        {
          candidateLeaseId: "0123456789abcdef0123456789abcdef",
          label: "Node.js inspector",
          detail: "Integrated terminal · 127.0.0.1:9229",
          port: 9229,
        },
      ],
      truncated: false,
    };
    const result = await invokeNodeDebugAttachCandidateListIpc(
      vi.fn<InvokeNodeDebugAttachCandidateCommand>().mockResolvedValue(wire),
      { rootPath: "/workspace" },
    );

    expect(result).toEqual(wire);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(Object.isFrozen(result.candidates)).toBe(true);
    expect(Object.isFrozen(result.candidates[0])).toBe(true);
    expect(result.candidates[0]).not.toBe(wire.candidates[0]);
  });

  it.each([
    null,
    {},
    { status: "ok", candidates: [], truncated: false, message: "secret" },
    {
      status: "ok",
      candidates: [
        {
          candidateLeaseId: "not-a-lease",
          label: "Node.js inspector",
          detail: "Integrated terminal",
          port: 9229,
        },
      ],
      truncated: false,
    },
  ])("maps malformed payloads to one frozen generic error", async (payload) => {
    const result = await invokeNodeDebugAttachCandidateListIpc(
      vi.fn<InvokeNodeDebugAttachCandidateCommand>().mockResolvedValue(payload),
      { rootPath: "/workspace" },
    );

    expect(result).toEqual({ status: "error" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result)).toEqual(["status"]);
  });

  it("maps rejected invokes to the same generic result", async () => {
    const result = await invokeNodeDebugAttachCandidateListIpc(
      vi
        .fn<InvokeNodeDebugAttachCandidateCommand>()
        .mockRejectedValue(new Error("secret backend failure")),
      { rootPath: "/workspace" },
    );

    expect(result).toEqual({ status: "error" });
    expect(Object.keys(result)).toEqual(["status"]);
  });
});
