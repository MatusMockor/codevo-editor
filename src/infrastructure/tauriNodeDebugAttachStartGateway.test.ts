import { describe, expect, it, vi } from "vitest";
import type { NodeDebugAttachCandidateStartRequest } from "./tauriNodeDebugAttachStartIpcContract";
import { TauriNodeDebugAttachStartGateway } from "./tauriNodeDebugAttachStartGateway";

const request: NodeDebugAttachCandidateStartRequest = {
  rootPath: "/workspace",
  candidateLeaseId: "0123456789abcdef0123456789abcdef",
  breakpoints: [],
  exceptionPauseMode: "none",
  exceptionTypeFilter: [],
};

describe("TauriNodeDebugAttachStartGateway", () => {
  it("maps the reused session response into the existing runtime status", async () => {
    const gateway = new TauriNodeDebugAttachStartGateway(
      vi.fn(async () => ({ status: "ok", sessionId: 19 })),
    );
    await expect(gateway.start(request)).resolves.toEqual({ kind: "ok", sessionId: 19 });
  });

  it("returns the generic runtime failure for rejected invokes", async () => {
    const gateway = new TauriNodeDebugAttachStartGateway(
      vi.fn(async () => {
        throw new Error("private transport details");
      }),
    );
    await expect(gateway.start(request)).resolves.toEqual({
      kind: "error",
      message: "Node attach candidate could not be started safely.",
    });
  });
});
