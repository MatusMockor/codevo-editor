import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriSmartModeGateway } from "./tauriSmartModeGateway";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("TauriSmartModeGateway", () => {
  beforeEach(() => invoke.mockReset());

  it("reads and updates smart mode for the requested workspace root", async () => {
    invoke.mockResolvedValue({
      message: "IDE Mode active.",
      mode: "fullSmart",
      status: "ready",
    });
    const gateway = new TauriSmartModeGateway();

    await gateway.getState("/workspace-a");
    await gateway.setMode({
      admissionToken: 7,
      mode: "fullSmart",
      rootPath: "/workspace-b",
      workspaceId: "ws-b",
    });

    expect(invoke).toHaveBeenNthCalledWith(1, "get_smart_mode_state", {
      rootPath: "/workspace-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "set_smart_mode", {
      request: {
        admissionToken: 7,
        mode: "fullSmart",
        rootPath: "/workspace-b",
        workspaceId: "ws-b",
      },
    });
  });

  it("rejects missing stale and unknown authority fields before IPC", async () => {
    const gateway = new TauriSmartModeGateway();

    for (const request of [
      { admissionToken: 0, mode: "basic", rootPath: "/workspace", workspaceId: "ws-1" },
      { mode: "basic", rootPath: "/workspace", workspaceId: "ws-1" },
      {
        admissionToken: 1,
        mode: "basic",
        rootPath: "/workspace",
        unexpected: true,
        workspaceId: "ws-1",
      },
    ]) {
      expect(() => gateway.setMode(request as never)).toThrow();
    }

    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects malformed and unbounded states from IPC", async () => {
    const gateway = new TauriSmartModeGateway();
    for (const response of [
      { message: "invalid", mode: "unknown", status: "ready" },
      { message: "invalid", mode: "basic", status: "ready" },
      { message: "invalid", mode: "basic", status: "off", unexpected: true },
      { message: "x".repeat(4_097), mode: "basic", status: "off" },
    ]) {
      invoke.mockResolvedValueOnce(response);
      await expect(gateway.getState("/workspace")).rejects.toThrow();
    }
  });
});
