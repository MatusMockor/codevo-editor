import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriWorkspaceGateway } from "./tauriWorkspaceGateway";
import { TauriWorkspaceIdentityGateway } from "./tauriWorkspaceIdentityGateway";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("TauriWorkspaceIdentityGateway", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("preserves picker cancellation", async () => {
    invoke.mockResolvedValueOnce({ status: "cancelled" });

    await expect(new TauriWorkspaceIdentityGateway().openFromPicker()).resolves.toEqual({
      status: "cancelled",
    });
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
      registration: receipt("ws-1"),
    });

    const result = await new TauriWorkspaceIdentityGateway().openFromPicker();

    expect(result).toEqual({
      status: "opened",
      descriptor: {
        admissionToken: 1,
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
    invoke.mockResolvedValueOnce(
      registration({
        workspaceId: "ws-path",
        selectedRootPath: "/link/project",
        canonicalRootPath: "/real/project",
        caseSensitive: true,
        unicodeNormalizationPolicy: "preserved",
      }),
    );
    const gateway = new TauriWorkspaceIdentityGateway();

    await expect(gateway.openPath("/link/project")).resolves.toMatchObject({
      admissionToken: 1,
      workspaceId: "ws-path",
      selectedPath: "/link/project",
      canonicalRoot: "/real/project",
    });

    expect(invoke).toHaveBeenCalledWith("register_workspace_path", {
      rootPath: "/link/project",
    });
    expect(gateway.descriptorForPath("/link/project/src/App.ts")?.workspaceId).toBe("ws-path");
    expect(gateway.descriptorForPath("/real/project/src/App.ts")?.workspaceId).toBe("ws-path");
  });

  it("settles only the exact backend-closed descriptor from local routing caches", async () => {
    invoke
      .mockResolvedValueOnce(
        registration({
          workspaceId: "ws-path",
          selectedRootPath: "/alias-one/project",
          canonicalRootPath: "/real/project",
          caseSensitive: true,
          unicodeNormalizationPolicy: "preserved",
        }),
      )
      .mockResolvedValueOnce(
        registration(
          {
            workspaceId: "ws-path",
            selectedRootPath: "/alias-two/project",
            canonicalRootPath: "/real/project",
            caseSensitive: true,
            unicodeNormalizationPolicy: "preserved",
          },
          2,
        ),
      );
    const gateway = new TauriWorkspaceIdentityGateway();
    const first = await gateway.openPath("/alias-one/project");
    const second = await gateway.openPath("/alias-two/project");

    expect(gateway.settleClosedDescriptor(first)).toBe(false);
    expect(gateway.descriptorForPath("/alias-two/project/src/App.ts")).toBe(second);
    expect(gateway.settleClosedDescriptor(second)).toBe(true);
    expect(gateway.descriptorForPath("/alias-one/project/src/App.ts")).toBeNull();
    expect(gateway.descriptorForPath("/alias-two/project/src/App.ts")).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("unregister_workspace", expect.anything());
  });

  it("reuses path matches until workspace identity routing changes", async () => {
    invoke
      .mockResolvedValueOnce(
        registration({
          workspaceId: "ws-cached",
          selectedRootPath: "/Selected/Project",
          canonicalRootPath: "/Real/Project",
          caseSensitive: false,
          unicodeNormalizationPolicy: "preserved",
        }),
      )
      .mockResolvedValueOnce(
        registration({
          workspaceId: "ws-cached",
          selectedRootPath: "/Another/Project",
          canonicalRootPath: "/Real/Project",
          caseSensitive: false,
          unicodeNormalizationPolicy: "preserved",
        }),
      );
    const gateway = new TauriWorkspaceIdentityGateway();
    await gateway.openPath("/Selected/Project");
    const foldCase = vi.spyOn(String.prototype, "toLocaleLowerCase");

    try {
      const first = gateway.matchForPath("/selected/project/src/App.ts", "ws-cached");
      const callsAfterFirstMatch = foldCase.mock.calls.length;
      const second = gateway.matchForPath("/selected/project/src/App.ts", "ws-cached");

      expect(first).toMatchObject({ relativePath: "src/App.ts" });
      expect(second).toBe(first);
      expect(callsAfterFirstMatch).toBeGreaterThan(0);
      expect(foldCase).toHaveBeenCalledTimes(callsAfterFirstMatch);

      await gateway.openPath("/Another/Project");
      expect(gateway.matchForPath("/selected/project/src/App.ts", "ws-cached")).toMatchObject({
        relativePath: "src/App.ts",
      });
      expect(foldCase.mock.calls.length).toBeGreaterThan(callsAfterFirstMatch);
    } finally {
      foldCase.mockRestore();
    }
  });

  it("uses canonical lexical identity for a selected path containing parent segments", async () => {
    invoke.mockResolvedValueOnce(
      registration({
        workspaceId: "ws-parent",
        selectedRootPath: "/real/project/packages/..",
        canonicalRootPath: "/real/project",
        caseSensitive: true,
        unicodeNormalizationPolicy: "preserved",
      }),
    );
    const gateway = new TauriWorkspaceIdentityGateway();

    const descriptor = await gateway.openPath("/real/project/packages/..");

    expect(descriptor.selectedPath).toBe("/real/project/packages/..");
    expect(descriptor.canonicalRoot).toBe("/real/project");
    expect(gateway.descriptorForPath("/real/project/src/App.ts")).toBe(descriptor);
    expect(gateway.descriptorForPath("/real/project/packages/../src/App.ts")).toBe(descriptor);
  });

  it("routes overlapping workspaces by normalized canonical depth instead of alias length", async () => {
    invoke
      .mockResolvedValueOnce(
        registration({
          workspaceId: "ws-parent",
          selectedRootPath: "/real/project/an/intentionally/long/alias/../../../..",
          canonicalRootPath: "/real/project",
          caseSensitive: true,
          unicodeNormalizationPolicy: "preserved",
        }),
      )
      .mockResolvedValueOnce(
        registration({
          workspaceId: "ws-nested",
          selectedRootPath: "/real/project/packages",
          canonicalRootPath: "/real/project/packages",
          caseSensitive: true,
          unicodeNormalizationPolicy: "preserved",
        }),
      );
    const gateway = new TauriWorkspaceIdentityGateway();
    await gateway.openPath("/real/project/an/intentionally/long/alias/../../../..");
    const nested = await gateway.openPath("/real/project/packages");

    expect(gateway.descriptorForPath("/real/project/packages/App.ts")).toBe(nested);
  });

  it.each([
    ["parent alias first", ["/link/project", "/link/project/packages"]],
    ["nested alias first", ["/link/project/packages", "/link/project"]],
  ])(
    "uses the most specific retained symlink-like alias with %s",
    async (_order, selectedPaths) => {
      for (const selectedRootPath of selectedPaths) {
        invoke.mockResolvedValueOnce(
          registration({
            workspaceId: "ws-shared",
            selectedRootPath,
            canonicalRootPath: "/real/project",
            caseSensitive: true,
            unicodeNormalizationPolicy: "preserved",
          }),
        );
      }
      invoke.mockResolvedValueOnce(undefined);
      const gateway = new TauriWorkspaceIdentityGateway();
      await gateway.openPath(selectedPaths[0]);
      await gateway.openPath(selectedPaths[1]);

      expect(gateway.matchForPath("/link/project/packages/src/App.ts")).toMatchObject({
        matchedRoot: "/link/project/packages",
        relativePath: "src/App.ts",
      });

      const unregistering = gateway.unregister("ws-shared");
      expect(gateway.matchForPath("/link/project/packages/src/App.ts")).toBeNull();
      await unregistering;
    },
  );

  it("preserves every alias when the same workspace id is registered again", async () => {
    let finishUnregister: (() => void) | undefined;
    invoke
      .mockResolvedValueOnce(
        registration({
          workspaceId: "ws-shared",
          selectedRootPath: "/alias-one/project",
          canonicalRootPath: "/real/project",
          caseSensitive: true,
          unicodeNormalizationPolicy: "preserved",
        }),
      )
      .mockResolvedValueOnce(
        registration({
          workspaceId: "ws-shared",
          selectedRootPath: "/alias-two/project",
          canonicalRootPath: "/real/project",
          caseSensitive: true,
          unicodeNormalizationPolicy: "preserved",
        }),
      )
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishUnregister = resolve)));
    const gateway = new TauriWorkspaceIdentityGateway();
    await gateway.openPath("/alias-one/project");
    const latest = await gateway.openPath("/alias-two/project");

    expect(gateway.descriptorForPath("/alias-one/project/src/App.ts")).toBe(latest);
    expect(gateway.descriptorForPath("/alias-two/project/src/App.ts")).toBe(latest);
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
      .mockResolvedValueOnce(
        registration({
          workspaceId: "ws-shared",
          selectedRootPath: "/alias-one/project",
          canonicalRootPath: "/real/project",
          caseSensitive: true,
          unicodeNormalizationPolicy: "preserved",
        }),
      )
      .mockResolvedValueOnce(
        registration({
          workspaceId: "ws-shared",
          selectedRootPath: "/alias-two/project",
          canonicalRootPath: "/real/project",
          caseSensitive: true,
          unicodeNormalizationPolicy: "preserved",
        }),
      )
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
    await files.writeTextFile("/alias-one/project/src/One.ts", "one", revision());
    await files.readTextFile("/alias-two/project/src/Two.ts");
    await files.writeTextFile("/alias-two/project/src/Two.ts", "two", revision());

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
    expect(() => files.writeTextFile("/alias-one/project/src/One.ts", "one", revision())).toThrow(
      "Reopen it explicitly",
    );
    expect(() => files.writeTextFile("/alias-two/project/src/Two.ts", "two", revision())).toThrow(
      "Reopen it explicitly",
    );
  });

  it("looks up and unregisters only by opaque workspace id", async () => {
    invoke
      .mockResolvedValueOnce({
        workspaceId: "ws-2",
        selectedRootPath: "/workspace",
        canonicalRootPath: "/workspace",
        caseSensitive: true,
        unicodeNormalizationPolicy: "preserved",
      })
      .mockResolvedValueOnce(undefined);
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

  it("rejects a descriptor lookup owned by another workspace", async () => {
    invoke.mockResolvedValueOnce({
      workspaceId: "ws-other",
      selectedRootPath: "/workspace",
      canonicalRootPath: "/workspace",
      caseSensitive: true,
      unicodeNormalizationPolicy: "preserved",
    });

    await expect(new TauriWorkspaceIdentityGateway().getDescriptor("ws-requested")).rejects.toThrow(
      "different workspace",
    );
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
        registration: receipt("ws-1"),
      })
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishUnregister = resolve)));
    const gateway = new TauriWorkspaceIdentityGateway();
    await gateway.openFromPicker();

    expect(gateway.descriptorForPath("/link/project/src/App.ts")?.workspaceId).toBe("ws-1");
    expect(gateway.descriptorForPath("/real/project/src/App.ts")?.workspaceId).toBe("ws-1");

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
      .mockImplementationOnce(() => new Promise((resolve) => (finishPicker = resolve)))
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishUnregister = resolve)));
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
      registration: receipt("ws-deferred"),
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
      .mockResolvedValueOnce(
        registration({
          workspaceId: "ws-reopen",
          selectedRootPath: "/link/reopen",
          canonicalRootPath: "/real/reopen",
          caseSensitive: true,
          unicodeNormalizationPolicy: "preserved",
        }),
      )
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishUnregister = resolve)))
      .mockResolvedValueOnce(
        registration({
          workspaceId: "ws-reopen",
          selectedRootPath: "/link/reopen",
          canonicalRootPath: "/real/reopen",
          caseSensitive: true,
          unicodeNormalizationPolicy: "preserved",
        }),
      );
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
    expect(gateway.descriptorForPath("/link/reopen/src/App.ts")?.workspaceId).toBe("ws-reopen");
  });

  it("times out a stalled operation so cleanup is not blocked forever", async () => {
    vi.useFakeTimers();
    try {
      invoke
        .mockImplementationOnce(() => new Promise(() => undefined))
        .mockResolvedValueOnce(undefined);
      const gateway = new TauriWorkspaceIdentityGateway({
        operationTimeoutMs: 10,
      });

      const opening = gateway.openPath("/never");
      const openingExpectation = expect(opening).rejects.toThrow("timed out");
      const unregistering = gateway.unregister("ws-never");
      await vi.advanceTimersByTimeAsync(10);

      await openingExpectation;
      await expect(unregistering).resolves.toBeUndefined();
      expect(invoke).toHaveBeenLastCalledWith("unregister_workspace", {
        workspaceId: "ws-never",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects operation admission above the bounded queue capacity", async () => {
    invoke
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockImplementationOnce(() => new Promise(() => undefined));
    const gateway = new TauriWorkspaceIdentityGateway({
      maxPendingOperations: 2,
      operationTimeoutMs: 60_000,
    });

    const admitted = [gateway.openPath("/one"), gateway.openPath("/two")];
    for (const operation of admitted) {
      void operation.catch(() => undefined);
    }
    await expect(gateway.openPath("/three")).rejects.toThrow("capacity");

    gateway.dispose();
  });

  it("retains transport permits after caller timeouts until IPC settles", async () => {
    vi.useFakeTimers();
    try {
      invoke.mockImplementation(() => new Promise(() => undefined));
      const gateway = new TauriWorkspaceIdentityGateway({
        maxPendingOperations: 2,
        operationTimeoutMs: 10,
      });

      const first = gateway.openPath("/one");
      const firstExpectation = expect(first).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10);
      await firstExpectation;
      const second = gateway.openPath("/two");
      const secondExpectation = expect(second).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10);
      await secondExpectation;

      await expect(gateway.openPath("/three")).rejects.toThrow("transport capacity");
      gateway.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a late pre-dispose result restore descriptor authority", async () => {
    let finishOpen: ((descriptor: unknown) => void) | undefined;
    invoke
      .mockImplementationOnce(() => new Promise((resolve) => (finishOpen = resolve)))
      .mockResolvedValueOnce(true);
    const gateway = new TauriWorkspaceIdentityGateway();
    const opening = gateway.openPath("/late");
    await vi.waitFor(() => expect(finishOpen).toBeTypeOf("function"));

    gateway.dispose();
    finishOpen?.(
      registration({
        workspaceId: "ws-late",
        selectedRootPath: "/late",
        canonicalRootPath: "/late",
        caseSensitive: true,
        unicodeNormalizationPolicy: "preserved",
      }),
    );

    await expect(opening).rejects.toThrow("disposed");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("rollback_workspace_registration", {
        admissionToken: 1,
        workspaceId: "ws-late",
      }),
    );
    expect(gateway.descriptorForPath("/late/file.ts")).toBeNull();
  });

  it("fences descriptor lookup with disposal and timeout admission", async () => {
    invoke.mockImplementationOnce(() => new Promise(() => undefined));
    const gateway = new TauriWorkspaceIdentityGateway({
      operationTimeoutMs: 60_000,
    });
    const lookup = gateway.getDescriptor("ws-never");
    const lookupExpectation = expect(lookup).rejects.toThrow("disposed");

    gateway.dispose();

    await lookupExpectation;
  });

  it("compensates a native registration rejected by workspace capacity", async () => {
    invoke
      .mockResolvedValueOnce(
        registration({
          workspaceId: "ws-one",
          selectedRootPath: "/one",
          canonicalRootPath: "/one",
          caseSensitive: true,
          unicodeNormalizationPolicy: "preserved",
        }),
      )
      .mockResolvedValueOnce(
        registration({
          workspaceId: "ws-two",
          selectedRootPath: "/two",
          canonicalRootPath: "/two",
          caseSensitive: true,
          unicodeNormalizationPolicy: "preserved",
        }),
      )
      .mockResolvedValueOnce(true);
    const gateway = new TauriWorkspaceIdentityGateway({ maxWorkspaces: 1 });
    await gateway.openPath("/one");

    await expect(gateway.openPath("/two")).rejects.toThrow("capacity");

    expect(invoke).toHaveBeenLastCalledWith("rollback_workspace_registration", {
      admissionToken: 1,
      workspaceId: "ws-two",
    });
    expect(gateway.descriptorForPath("/one/file.ts")?.workspaceId).toBe("ws-one");
    expect(gateway.descriptorForPath("/two/file.ts")).toBeNull();
  });

  it("bounds aliases retained for one repeated workspace identity", async () => {
    for (const selectedRootPath of ["/real", "/alias-one", "/alias-two"]) {
      invoke.mockResolvedValueOnce(
        registration({
          workspaceId: "ws-shared",
          selectedRootPath,
          canonicalRootPath: "/real",
          caseSensitive: true,
          unicodeNormalizationPolicy: "preserved",
        }),
      );
    }
    invoke.mockResolvedValueOnce(true);
    const gateway = new TauriWorkspaceIdentityGateway({
      maxAliasesPerWorkspace: 2,
    });
    await gateway.openPath("/real");
    await gateway.openPath("/alias-one");

    await expect(gateway.openPath("/alias-two")).rejects.toThrow("alias capacity");
    expect(gateway.descriptorForPath("/alias-one/file.ts")?.workspaceId).toBe("ws-shared");
    expect(gateway.descriptorForPath("/alias-two/file.ts")).toBeNull();

    await expect(gateway.openPath("/alias-three")).rejects.toThrow("quarantined");
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it("deduplicates an exact selected and canonical root at alias capacity one", async () => {
    invoke.mockResolvedValueOnce(
      registration({
        workspaceId: "ws-exact",
        selectedRootPath: "/exact",
        canonicalRootPath: "/exact",
        caseSensitive: true,
        unicodeNormalizationPolicy: "preserved",
      }),
    );
    const gateway = new TauriWorkspaceIdentityGateway({
      maxAliasesPerWorkspace: 1,
    });

    await expect(gateway.openPath("/exact")).resolves.toMatchObject({
      workspaceId: "ws-exact",
    });
    expect(gateway.descriptorForPath("/exact/file.ts")?.workspaceId).toBe("ws-exact");
  });

  it("reserves cleanup transport before revoking local identity", async () => {
    vi.useFakeTimers();
    try {
      invoke
        .mockResolvedValueOnce(
          registration({
            workspaceId: "ws-cleanup",
            selectedRootPath: "/cleanup",
            canonicalRootPath: "/cleanup",
            caseSensitive: true,
            unicodeNormalizationPolicy: "preserved",
          }),
        )
        .mockImplementationOnce(() => new Promise(() => undefined))
        .mockResolvedValueOnce(undefined);
      const gateway = new TauriWorkspaceIdentityGateway({
        maxPendingOperations: 1,
        operationTimeoutMs: 10,
      });
      await gateway.openPath("/cleanup");
      const hangingLookup = gateway.getDescriptor("ws-never");
      const lookupExpectation = expect(hangingLookup).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10);
      await lookupExpectation;

      await expect(gateway.unregister("ws-cleanup")).resolves.toBeUndefined();

      expect(invoke).toHaveBeenLastCalledWith("unregister_workspace", {
        workspaceId: "ws-cleanup",
      });
      expect(gateway.descriptorForPath("/cleanup/file.ts")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects malformed descriptors and oversized roots before authority mutation", async () => {
    invoke
      .mockResolvedValueOnce(
        registration({
          workspaceId: "ws-invalid",
          selectedRootPath: "/invalid",
          canonicalRootPath: "/invalid",
          caseSensitive: true,
          unicodeNormalizationPolicy: "preserved",
          unexpected: true,
        }),
      )
      .mockResolvedValueOnce(true);
    const gateway = new TauriWorkspaceIdentityGateway();

    await expect(gateway.openPath("/invalid")).rejects.toThrow("invalid registration descriptor");
    expect(gateway.descriptorForPath("/invalid/file.ts")).toBeNull();
    expect(invoke).toHaveBeenLastCalledWith("rollback_workspace_registration", {
      admissionToken: 1,
      workspaceId: "ws-invalid",
    });

    invoke.mockClear();
    await expect(gateway.openPath(`/${"x".repeat(32_768)}`)).rejects.toThrow("UTF-8 limit");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rolls back an extractable receipt before rejecting extra registration fields", async () => {
    invoke
      .mockResolvedValueOnce({
        ...registration({
          workspaceId: "ws-extra",
          selectedRootPath: "/extra",
          canonicalRootPath: "/extra",
          caseSensitive: true,
          unicodeNormalizationPolicy: "preserved",
        }),
        unexpected: true,
      })
      .mockResolvedValueOnce(true);

    await expect(new TauriWorkspaceIdentityGateway().openPath("/extra")).rejects.toThrow(
      "invalid registration result",
    );
    expect(invoke).toHaveBeenLastCalledWith("rollback_workspace_registration", {
      admissionToken: 1,
      workspaceId: "ws-extra",
    });
  });

  it("rolls back an extractable picker receipt before rejecting extra fields", async () => {
    invoke
      .mockResolvedValueOnce({
        status: "opened",
        descriptor: {
          workspaceId: "ws-picker-extra",
          selectedRootPath: "/picker-extra",
          canonicalRootPath: "/picker-extra",
          caseSensitive: true,
          unicodeNormalizationPolicy: "preserved",
        },
        registration: receipt("ws-picker-extra"),
        unexpected: true,
      })
      .mockResolvedValueOnce(true);

    await expect(new TauriWorkspaceIdentityGateway().openFromPicker()).rejects.toThrow(
      "invalid result",
    );
    expect(invoke).toHaveBeenLastCalledWith("rollback_workspace_registration", {
      admissionToken: 1,
      workspaceId: "ws-picker-extra",
    });
  });

  it.each([false, { confirmed: true }])(
    "surfaces a malformed or unconfirmed registration rollback: %j",
    async (rollbackResult) => {
      invoke
        .mockResolvedValueOnce({
          ...registration({
            workspaceId: "ws-unconfirmed",
            selectedRootPath: "/unconfirmed",
            canonicalRootPath: "/unconfirmed",
            caseSensitive: true,
            unicodeNormalizationPolicy: "preserved",
          }),
          unexpected: true,
        })
        .mockResolvedValueOnce(rollbackResult);

      await expect(new TauriWorkspaceIdentityGateway().openPath("/unconfirmed")).rejects.toThrow(
        "rollback was not confirmed",
      );
    },
  );
});

function receipt(workspaceId: string, admissionToken = 1) {
  return {
    admissionToken,
    createdIdentity: true,
    workspaceId,
  };
}

function registration(descriptor: Record<string, unknown>, admissionToken = 1) {
  return {
    descriptor,
    registration: receipt(String(descriptor.workspaceId), admissionToken),
  };
}

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
