import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriWorkspaceGateway } from "./tauriWorkspaceGateway";
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

  it("registers a path without opening the picker and caches its selected and canonical aliases", async () => {
    invoke.mockResolvedValueOnce({
      workspaceId: "ws-path",
      selectedRootPath: "/link/project",
      canonicalRootPath: "/real/project",
      caseSensitive: true,
      unicodeNormalizationPolicy: "preserved",
    });
    const gateway = new TauriWorkspaceIdentityGateway();

    await expect(gateway.openPath("/link/project")).resolves.toMatchObject({
      workspaceId: "ws-path",
      selectedPath: "/link/project",
      canonicalRoot: "/real/project",
    });

    expect(invoke).toHaveBeenCalledWith("register_workspace_path", {
      rootPath: "/link/project",
    });
    expect(gateway.descriptorForPath("/link/project/src/App.ts")?.workspaceId).toBe(
      "ws-path",
    );
    expect(gateway.descriptorForPath("/real/project/src/App.ts")?.workspaceId).toBe(
      "ws-path",
    );
  });

  it("uses canonical lexical identity for a selected path containing parent segments", async () => {
    invoke.mockResolvedValueOnce({
      workspaceId: "ws-parent",
      selectedRootPath: "/real/project/packages/..",
      canonicalRootPath: "/real/project",
      caseSensitive: true,
      unicodeNormalizationPolicy: "preserved",
    });
    const gateway = new TauriWorkspaceIdentityGateway();

    const descriptor = await gateway.openPath("/real/project/packages/..");

    expect(descriptor.selectedPath).toBe("/real/project/packages/..");
    expect(descriptor.canonicalRoot).toBe("/real/project");
    expect(gateway.descriptorForPath("/real/project/src/App.ts")).toBe(
      descriptor,
    );
    expect(gateway.descriptorForPath("/real/project/packages/../src/App.ts")).toBe(
      descriptor,
    );
  });

  it("routes overlapping workspaces by normalized canonical depth instead of alias length", async () => {
    invoke
      .mockResolvedValueOnce({
        workspaceId: "ws-parent",
        selectedRootPath:
          "/real/project/an/intentionally/long/alias/../../../..",
        canonicalRootPath: "/real/project",
        caseSensitive: true,
        unicodeNormalizationPolicy: "preserved",
      })
      .mockResolvedValueOnce({
        workspaceId: "ws-nested",
        selectedRootPath: "/real/project/packages",
        canonicalRootPath: "/real/project/packages",
        caseSensitive: true,
        unicodeNormalizationPolicy: "preserved",
      });
    const gateway = new TauriWorkspaceIdentityGateway();
    await gateway.openPath(
      "/real/project/an/intentionally/long/alias/../../../..",
    );
    const nested = await gateway.openPath("/real/project/packages");

    expect(gateway.descriptorForPath("/real/project/packages/App.ts")).toBe(
      nested,
    );
  });

  it.each([
    ["parent alias first", ["/link/project", "/link/project/packages"]],
    ["nested alias first", ["/link/project/packages", "/link/project"]],
  ])(
    "uses the most specific retained symlink-like alias with %s",
    async (_order, selectedPaths) => {
      for (const selectedRootPath of selectedPaths) {
        invoke.mockResolvedValueOnce({
          workspaceId: "ws-shared",
          selectedRootPath,
          canonicalRootPath: "/real/project",
          caseSensitive: true,
          unicodeNormalizationPolicy: "preserved",
        });
      }
      invoke.mockResolvedValueOnce(undefined);
      const gateway = new TauriWorkspaceIdentityGateway();
      await gateway.openPath(selectedPaths[0]);
      await gateway.openPath(selectedPaths[1]);

      expect(
        gateway.matchForPath("/link/project/packages/src/App.ts"),
      ).toMatchObject({
        matchedRoot: "/link/project/packages",
        relativePath: "src/App.ts",
      });

      const unregistering = gateway.unregister("ws-shared");
      expect(
        gateway.matchForPath("/link/project/packages/src/App.ts"),
      ).toBeNull();
      await unregistering;
    },
  );

  it("preserves every alias when the same workspace id is registered again", async () => {
    let finishUnregister: (() => void) | undefined;
    invoke
      .mockResolvedValueOnce({
        workspaceId: "ws-shared",
        selectedRootPath: "/alias-one/project",
        canonicalRootPath: "/real/project",
        caseSensitive: true,
        unicodeNormalizationPolicy: "preserved",
      })
      .mockResolvedValueOnce({
        workspaceId: "ws-shared",
        selectedRootPath: "/alias-two/project",
        canonicalRootPath: "/real/project",
        caseSensitive: true,
        unicodeNormalizationPolicy: "preserved",
      })
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (finishUnregister = resolve)),
      );
    const gateway = new TauriWorkspaceIdentityGateway();
    await gateway.openPath("/alias-one/project");
    const latest = await gateway.openPath("/alias-two/project");

    expect(gateway.descriptorForPath("/alias-one/project/src/App.ts")).toBe(
      latest,
    );
    expect(gateway.descriptorForPath("/alias-two/project/src/App.ts")).toBe(
      latest,
    );
    expect(gateway.descriptorForPath("/real/project/src/App.ts")).toBe(latest);

    const unregistering = gateway.unregister("ws-shared");
    expect(gateway.descriptorForPath("/alias-one/project/src/App.ts")).toBeNull();
    expect(gateway.descriptorForPath("/alias-two/project/src/App.ts")).toBeNull();
    await vi.waitFor(() => expect(finishUnregister).toBeTypeOf("function"));
    finishUnregister?.();
    await unregistering;
  });

  it("uses each retained alias for trusted reads and writes until unregister", async () => {
    invoke
      .mockResolvedValueOnce({
        workspaceId: "ws-shared",
        selectedRootPath: "/alias-one/project",
        canonicalRootPath: "/real/project",
        caseSensitive: true,
        unicodeNormalizationPolicy: "preserved",
      })
      .mockResolvedValueOnce({
        workspaceId: "ws-shared",
        selectedRootPath: "/alias-two/project",
        canonicalRootPath: "/real/project",
        caseSensitive: true,
        unicodeNormalizationPolicy: "preserved",
      })
      .mockResolvedValue({
        status: "success",
        content: "content",
        revision: null,
      });
    const identities = new TauriWorkspaceIdentityGateway();
    const files = new TauriWorkspaceGateway(identities);
    await identities.openPath("/alias-one/project");
    await identities.openPath("/alias-two/project");

    await files.readTextFile("/alias-one/project/src/One.ts");
    await files.writeTextFile(
      "/alias-one/project/src/One.ts",
      "one",
      revision(),
    );
    await files.readTextFile("/alias-two/project/src/Two.ts");
    await files.writeTextFile(
      "/alias-two/project/src/Two.ts",
      "two",
      revision(),
    );

    expect(invoke).toHaveBeenNthCalledWith(3, "workspace_read_text_file", {
      workspaceId: "ws-shared",
      relativePath: "src/One.ts",
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "workspace_save_text_file", {
      workspaceId: "ws-shared",
      relativePath: "src/One.ts",
      content: "one",
      expectedRevision: revision(),
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "workspace_read_text_file", {
      workspaceId: "ws-shared",
      relativePath: "src/Two.ts",
    });
    expect(invoke).toHaveBeenNthCalledWith(6, "workspace_save_text_file", {
      workspaceId: "ws-shared",
      relativePath: "src/Two.ts",
      content: "two",
      expectedRevision: revision(),
    });

    await identities.unregister("ws-shared");
    expect(() =>
      files.writeTextFile("/alias-one/project/src/One.ts", "one", revision()),
    ).toThrow("Reopen it explicitly");
    expect(() =>
      files.writeTextFile("/alias-two/project/src/Two.ts", "two", revision()),
    ).toThrow("Reopen it explicitly");
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
    await vi.waitFor(() => expect(finishUnregister).toBeTypeOf("function"));
    finishUnregister?.();
    await unregistering;
  });

  it("does not cache a deferred picker result superseded by unregister", async () => {
    let finishPicker: ((result: unknown) => void) | undefined;
    let finishUnregister: (() => void) | undefined;
    invoke
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishPicker = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (finishUnregister = resolve)),
      );
    const gateway = new TauriWorkspaceIdentityGateway();

    const opening = gateway.openFromPicker();
    const unregistering = gateway.unregister("ws-deferred");
    await vi.waitFor(() => expect(finishPicker).toBeTypeOf("function"));
    finishPicker?.({
      status: "opened",
      descriptor: {
        workspaceId: "ws-deferred",
        selectedRootPath: "/link/deferred",
        canonicalRootPath: "/real/deferred",
        caseSensitive: true,
        unicodeNormalizationPolicy: "preserved",
      },
    });

    await opening;
    expect(gateway.descriptorForPath("/link/deferred/src/App.ts")).toBeNull();
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("unregister_workspace", {
        workspaceId: "ws-deferred",
      }),
    );
    finishUnregister?.();
    await unregistering;
  });

  it("defers an immediate path reopen until unregister completes", async () => {
    let finishUnregister: (() => void) | undefined;
    invoke
      .mockResolvedValueOnce({
        workspaceId: "ws-reopen",
        selectedRootPath: "/link/reopen",
        canonicalRootPath: "/real/reopen",
        caseSensitive: true,
        unicodeNormalizationPolicy: "preserved",
      })
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (finishUnregister = resolve)),
      )
      .mockResolvedValueOnce({
        workspaceId: "ws-reopen",
        selectedRootPath: "/link/reopen",
        canonicalRootPath: "/real/reopen",
        caseSensitive: true,
        unicodeNormalizationPolicy: "preserved",
      });
    const gateway = new TauriWorkspaceIdentityGateway();
    await gateway.openPath("/link/reopen");

    const unregistering = gateway.unregister("ws-reopen");
    const reopening = gateway.openPath("/link/reopen");
    await vi.waitFor(() => expect(finishUnregister).toBeTypeOf("function"));

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(gateway.descriptorForPath("/link/reopen/src/App.ts")).toBeNull();
    finishUnregister?.();
    await unregistering;
    await expect(reopening).resolves.toMatchObject({ workspaceId: "ws-reopen" });
    expect(gateway.descriptorForPath("/link/reopen/src/App.ts")?.workspaceId).toBe(
      "ws-reopen",
    );
  });
});

function revision() {
  return {
    device: "1",
    inode: "2",
    size: 3,
    modifiedSeconds: 4,
    modifiedNanoseconds: 5,
    contentHash: "6",
  };
}
