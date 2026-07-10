import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriWorkspaceIdentityGateway } from "./tauriWorkspaceIdentityGateway";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("TauriWorkspaceIdentityGateway", () => {
  beforeEach(() => invoke.mockReset());

  it("preserves picker cancellation", async () => {
    invoke.mockResolvedValueOnce({ status: "cancelled" });

    await expect(
      new TauriWorkspaceIdentityGateway().openFromPicker(),
    ).resolves.toEqual({ status: "cancelled" });
    expect(invoke).toHaveBeenCalledWith("open_workspace_from_picker");
  });

  it("maps the selected and canonical roots and treats unknown case sensitivity conservatively", async () => {
    invoke.mockResolvedValueOnce({
      status: "opened",
      descriptor: {
        workspaceId: "ws-1",
        selectedRootPath: "/link/project",
        canonicalRootPath: "/real/project",
        caseSensitive: null,
        unicodeNormalizationPolicy: "canonicalDecomposition",
      },
    });

    const result = await new TauriWorkspaceIdentityGateway().openFromPicker();

    expect(result).toEqual({
      status: "opened",
      descriptor: {
        workspaceId: "ws-1",
        selectedPath: "/link/project",
        canonicalRoot: "/real/project",
        caseSensitive: null,
        unicodeNormalizationPolicy: "canonicalDecomposition",
        policy: { caseSensitive: true, unicodeNormalization: "NFD" },
      },
    });
  });

  it("looks up and unregisters only by opaque workspace id", async () => {
    invoke.mockResolvedValue(undefined);
    const gateway = new TauriWorkspaceIdentityGateway();

    await gateway.getDescriptor("ws-2");
    await gateway.unregister("ws-2");

    expect(invoke).toHaveBeenNthCalledWith(1, "get_workspace_descriptor", {
      workspaceId: "ws-2",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "unregister_workspace", {
      workspaceId: "ws-2",
    });
  });

  it("resolves both aliases while registered and invalidates them before unregister completes", async () => {
    let finishUnregister: (() => void) | undefined;
    invoke
      .mockResolvedValueOnce({
        status: "opened",
        descriptor: {
          workspaceId: "ws-1",
          selectedRootPath: "/link/project",
          canonicalRootPath: "/real/project",
          caseSensitive: true,
          unicodeNormalizationPolicy: "preserved",
        },
      })
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (finishUnregister = resolve)),
      );
    const gateway = new TauriWorkspaceIdentityGateway();
    await gateway.openFromPicker();

    expect(gateway.descriptorForPath("/link/project/src/App.ts")?.workspaceId).toBe(
      "ws-1",
    );
    expect(gateway.descriptorForPath("/real/project/src/App.ts")?.workspaceId).toBe(
      "ws-1",
    );

    const unregistering = gateway.unregister("ws-1");
    expect(gateway.descriptorForPath("/link/project/src/App.ts")).toBeNull();
    finishUnregister?.();
    await unregistering;
  });
});
