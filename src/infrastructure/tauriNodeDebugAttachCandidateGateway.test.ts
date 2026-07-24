import { describe, expect, it, vi } from "vitest";
import { TauriNodeDebugAttachCandidateGateway } from "./tauriNodeDebugAttachCandidateGateway";
import type { InvokeNodeDebugAttachCandidateCommand } from "./tauriNodeDebugAttachCandidateIpcContract";

describe("TauriNodeDebugAttachCandidateGateway", () => {
  it("delegates LIST without normalizing or widening the root request", async () => {
    const invoke = vi.fn<InvokeNodeDebugAttachCandidateCommand>().mockResolvedValue({
      status: "ok",
      candidates: [],
      truncated: false,
    });
    const gateway = new TauriNodeDebugAttachCandidateGateway(invoke);

    const result = await gateway.list("/workspace/exact");

    expect(invoke).toHaveBeenCalledWith("debug_list_node_attach_candidates", {
      request: { rootPath: "/workspace/exact" },
    });
    expect(result).toEqual({ status: "ok", candidates: [], truncated: false });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("does not expose rejected transport details", async () => {
    const gateway = new TauriNodeDebugAttachCandidateGateway(
      vi
        .fn<InvokeNodeDebugAttachCandidateCommand>()
        .mockRejectedValue({ message: "lease 0123456789abcdef0123456789abcdef" }),
    );

    await expect(gateway.list("/workspace")).resolves.toEqual({ status: "error" });
  });
});
