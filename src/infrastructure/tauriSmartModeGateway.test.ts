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
    await gateway.setMode("/workspace-b", "fullSmart");

    expect(invoke).toHaveBeenNthCalledWith(1, "get_smart_mode_state", {
      rootPath: "/workspace-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "set_smart_mode", {
      mode: "fullSmart",
      rootPath: "/workspace-b",
    });
  });
});
