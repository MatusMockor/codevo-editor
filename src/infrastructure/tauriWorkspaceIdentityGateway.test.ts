import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriWorkspaceGateway } from "./tauriWorkspaceGateway";
import wire from "../../contracts/workspace-owner-release-wire.json";
import {
  parseWorkspaceAdmissionAdoptionResult,
  parseWorkspaceOwnerReleaseResult,
  TauriWorkspaceIdentityGateway,
} from "./tauriWorkspaceIdentityGateway";

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
      invoke.mockResolvedValueOnce(RELEASED);
      const gateway = new TauriWorkspaceIdentityGateway();
      await gateway.openPath(selectedPaths[0]);
      await gateway.openPath(selectedPaths[1]);

      expect(gateway.matchForPath("/link/project/packages/src/App.ts")).toMatchObject({
        matchedRoot: "/link/project/packages",
        relativePath: "src/App.ts",
      });

      const unregistering = gateway.unregister(owner("ws-shared", "/real/project"));
      expect(gateway.matchForPath("/link/project/packages/src/App.ts")).not.toBeNull();
      await unregistering;
      expect(gateway.matchForPath("/link/project/packages/src/App.ts")).toBeNull();
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
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishUnregister = () => resolve(RELEASED))),
      );
    const gateway = new TauriWorkspaceIdentityGateway();
    await gateway.openPath("/alias-one/project");
    const latest = await gateway.openPath("/alias-two/project");

    expect(gateway.descriptorForPath("/alias-one/project/src/App.ts")).toBe(latest);
    expect(gateway.descriptorForPath("/alias-two/project/src/App.ts")).toBe(latest);
    expect(gateway.descriptorForPath("/real/project/src/App.ts")).toBe(latest);

    const unregistering = gateway.unregister(owner("ws-shared", "/real/project"));
    await vi.waitFor(() => expect(finishUnregister).toBeTypeOf("function"));
    expect(gateway.descriptorForPath("/alias-one/project/src/App.ts")).toBe(latest);
    finishUnregister?.();
    await unregistering;
    expect(gateway.descriptorForPath("/alias-one/project/src/App.ts")).toBeNull();
    expect(gateway.descriptorForPath("/alias-two/project/src/App.ts")).toBeNull();
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

    invoke.mockResolvedValueOnce(RELEASED);
    await identities.unregister(owner("ws-shared", "/real/project"));
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
      .mockResolvedValueOnce(RELEASED);
    const gateway = new TauriWorkspaceIdentityGateway();

    await gateway.getDescriptor("ws-2");
    await gateway.unregister(owner("ws-2", "/workspace"));

    expect(invoke).toHaveBeenNthCalledWith(1, "get_workspace_descriptor", {
      workspaceId: "ws-2",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "unregister_workspace", {
      workspaceId: "ws-2",
      admissionToken: 1,
      canonicalRootPath: "/workspace",
    });
  });

  it.each(wire.unregisterWorkspace.statuses)(
    "sends the owner id and canonical root and parses the %s release result",
    async (status) => {
      invoke.mockResolvedValueOnce({ status });
      const gateway = new TauriWorkspaceIdentityGateway();

      await expect(gateway.unregister(owner("ws-owner", "/real/owner"))).resolves.toEqual({
        status,
      });

      expect(invoke).toHaveBeenCalledExactlyOnceWith("unregister_workspace", {
        workspaceId: "ws-owner",
        admissionToken: 1,
        canonicalRootPath: "/real/owner",
      });
      expect(Object.keys(invoke.mock.calls[0]?.[1] ?? {}).sort()).toEqual(
        [...wire.unregisterWorkspace.request].sort(),
      );
    },
  );

  it("accepts exactly the shared contract release statuses", () => {
    expect(
      ["released", "releasing", "retainedByOtherOwners", "unknownWorkspace", "staleOwner"].sort(),
    ).toEqual([...wire.unregisterWorkspace.statuses].sort());
    for (const status of wire.unregisterWorkspace.statuses) {
      expect(parseWorkspaceOwnerReleaseResult({ status })).toEqual({ status });
    }
  });

  it.each([
    ["an unknown status", { status: "gone" }],
    ["a dispose-only status", { status: "closed" }],
    ["an extra key", { status: "released", extra: true }],
    ["a missing status", {}],
    ["a bare string", "released"],
    ["null", null],
    ["undefined", undefined],
  ])("rejects a release result with %s", async (_label, result) => {
    invoke.mockResolvedValueOnce(result);

    await expect(
      new TauriWorkspaceIdentityGateway().unregister(owner("ws-bad", "/bad")),
    ).rejects.toThrow("Workspace release result");
  });

  it.each([
    ["an empty canonical root", { workspaceId: "ws", admissionToken: 1, canonicalRootPath: "" }],
    ["an empty workspace id", { workspaceId: "", admissionToken: 1, canonicalRootPath: "/real" }],
    [
      "a NUL canonical root",
      { workspaceId: "ws", admissionToken: 1, canonicalRootPath: "/re\u0000al" },
    ],
    [
      "a missing admission token",
      { workspaceId: "ws", admissionToken: null, canonicalRootPath: "/r" },
    ],
    ["a fractional token", { workspaceId: "ws", admissionToken: 1.5, canonicalRootPath: "/r" }],
  ])("rejects an unregister with %s without IPC", async (_label, releaseOwner) => {
    await expect(new TauriWorkspaceIdentityGateway().unregister(releaseOwner)).rejects.toThrow();

    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(["releasing", "staleOwner"] as const)(
    "keeps routing when an unregister is %s",
    async (status) => {
      invoke.mockResolvedValueOnce(registration(TAB_A, 1)).mockResolvedValueOnce({ status });
      const gateway = new TauriWorkspaceIdentityGateway();
      const current = await gateway.openPath("/link/a");

      await expect(gateway.unregister(owner("ws-a", "/real/a", 1))).resolves.toEqual({ status });

      expect(gateway.descriptorForPath("/link/a/src/App.ts")).toBe(current);
    },
  );

  it("keeps the newest admission routable when an older token is released", async () => {
    invoke
      .mockResolvedValueOnce(registration(TAB_A, 1))
      .mockResolvedValueOnce(registration(TAB_A, 2))
      .mockResolvedValueOnce(RELEASED);
    const gateway = new TauriWorkspaceIdentityGateway();
    await gateway.openPath("/link/a");
    const newest = await gateway.openPath("/link/a");

    await gateway.unregister(owner("ws-a", "/real/a", 1));

    expect(gateway.descriptorForPath("/link/a/src/App.ts")).toBe(newest);
  });

  it.each(wire.adoptWorkspaceAdmission.statuses)(
    "sends an exact adoption and parses the %s result",
    async (status) => {
      invoke.mockResolvedValueOnce({ status });

      await expect(
        new TauriWorkspaceIdentityGateway().adoptAdmission({
          workspaceId: "ws-a",
          newToken: 2,
          replacedToken: 1,
        }),
      ).resolves.toEqual({ status });

      expect(invoke).toHaveBeenCalledExactlyOnceWith("adopt_workspace_admission", {
        workspaceId: "ws-a",
        newToken: 2,
        replacedToken: 1,
      });
      expect(Object.keys(invoke.mock.calls[0]?.[1] ?? {}).sort()).toEqual(
        [...wire.adoptWorkspaceAdmission.request].sort(),
      );
    },
  );

  it("accepts exactly the shared contract adoption statuses", () => {
    expect(["adopted", "staleAdmission", "unknownWorkspace", "releasing"].sort()).toEqual(
      [...wire.adoptWorkspaceAdmission.statuses].sort(),
    );
    expect(() => parseWorkspaceAdmissionAdoptionResult({ status: "released" })).toThrow(
      "not supported",
    );
    expect(() => parseWorkspaceAdmissionAdoptionResult({ status: "adopted", extra: true })).toThrow(
      "malformed",
    );
  });

  it("forgets only the replaced token after an adoption", async () => {
    invoke
      .mockResolvedValueOnce(registration(TAB_A, 1))
      .mockResolvedValueOnce(registration(TAB_A, 2))
      .mockResolvedValueOnce({ status: "adopted" })
      .mockResolvedValueOnce(RELEASED);
    const gateway = new TauriWorkspaceIdentityGateway();
    await gateway.openPath("/link/a");
    const adopted = await gateway.openPath("/link/a");

    await gateway.adoptAdmission({ workspaceId: "ws-a", newToken: 2, replacedToken: 1 });
    expect(gateway.descriptorForPath("/link/a/src/App.ts")).toBe(adopted);
    await gateway.unregister(owner("ws-a", "/real/a", 2));

    expect(gateway.descriptorForPath("/link/a/src/App.ts")).toBeNull();
  });

  it("rejects an invalid adoption without IPC", async () => {
    await expect(
      new TauriWorkspaceIdentityGateway().adoptAdmission({
        workspaceId: "ws-a",
        newToken: 0,
        replacedToken: 1,
      }),
    ).rejects.toThrow("positive safe integer");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rolls back an exact admission and falls back to the remaining live admission", async () => {
    invoke
      .mockResolvedValueOnce(registration(TAB_A, 1))
      .mockResolvedValueOnce(registration(TAB_A, 2))
      .mockResolvedValueOnce(RELEASED);
    const gateway = new TauriWorkspaceIdentityGateway();
    const original = await gateway.openPath("/link/a");
    const reopened = await gateway.openPath("/link/a");

    await gateway.rollbackAdmission(reopened);

    expect(invoke).toHaveBeenLastCalledWith("rollback_workspace_registration", {
      workspaceId: "ws-a",
      admissionToken: 2,
    });
    expect(Object.keys(invoke.mock.lastCall?.[1] ?? {}).sort()).toEqual(
      [...wire.rollbackWorkspaceRegistration.request].sort(),
    );
    expect(gateway.descriptorForPath("/link/a/src/App.ts")).toBe(original);
  });

  it("forgets the workspace when its last live admission is rolled back", async () => {
    invoke.mockResolvedValueOnce(registration(TAB_A, 1)).mockResolvedValueOnce(RELEASED);
    const gateway = new TauriWorkspaceIdentityGateway();
    const only = await gateway.openPath("/link/a");

    await gateway.rollbackAdmission(only);

    expect(gateway.descriptorForPath("/link/a/src/App.ts")).toBeNull();
  });

  it.each([
    ["the pre-status boolean", true],
    ["an unknown status", { status: "closed" }],
  ])(
    "rejects a rollback result with %s and keeps the admission routable",
    async (_label, result) => {
      invoke.mockResolvedValueOnce(registration(TAB_A, 1)).mockResolvedValueOnce(result);
      const gateway = new TauriWorkspaceIdentityGateway();
      const only = await gateway.openPath("/link/a");

      await expect(gateway.rollbackAdmission(only)).rejects.toThrow("Workspace release result");
      expect(gateway.descriptorForPath("/link/a/src/App.ts")).toBe(only);
    },
  );

  it("keeps the admission routable while its rollback is still releasing", async () => {
    invoke
      .mockResolvedValueOnce(registration(TAB_A, 1))
      .mockResolvedValueOnce({ status: "releasing" });
    const gateway = new TauriWorkspaceIdentityGateway();
    const only = await gateway.openPath("/link/a");

    await expect(gateway.rollbackAdmission(only)).resolves.toEqual({ status: "releasing" });
    expect(gateway.descriptorForPath("/link/a/src/App.ts")).toBe(only);
  });

  it.each(wire.rollbackWorkspaceRegistration.settledStatuses)(
    "treats the settled rollback status %s as removing the exact admission",
    async (status) => {
      invoke.mockResolvedValueOnce(registration(TAB_A, 1)).mockResolvedValueOnce({ status });
      const gateway = new TauriWorkspaceIdentityGateway();
      const only = await gateway.openPath("/link/a");

      await expect(gateway.rollbackAdmission(only)).resolves.toEqual({ status });
      expect(gateway.descriptorForPath("/link/a/src/App.ts")).toBeNull();
    },
  );

  it("parses exactly the shared contract rollback statuses", () => {
    expect([...wire.rollbackWorkspaceRegistration.statuses].sort()).toEqual(
      [...wire.unregisterWorkspace.statuses].sort(),
    );
    expect(
      wire.rollbackWorkspaceRegistration.statuses.filter(
        (status) => !wire.rollbackWorkspaceRegistration.settledStatuses.includes(status),
      ),
    ).toEqual(["releasing"]);
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

  it("keeps both aliases routable until the backend releases the exact owner", async () => {
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
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishUnregister = () => resolve(RELEASED))),
      );
    const gateway = new TauriWorkspaceIdentityGateway();
    await gateway.openFromPicker();

    expect(gateway.descriptorForPath("/link/project/src/App.ts")?.workspaceId).toBe("ws-1");
    expect(gateway.descriptorForPath("/real/project/src/App.ts")?.workspaceId).toBe("ws-1");

    const unregistering = gateway.unregister(owner("ws-1", "/real/project"));
    await vi.waitFor(() => expect(finishUnregister).toBeTypeOf("function"));
    expect(gateway.descriptorForPath("/link/project/src/App.ts")?.workspaceId).toBe("ws-1");
    finishUnregister?.();
    await unregistering;
    expect(gateway.descriptorForPath("/link/project/src/App.ts")).toBeNull();
  });

  it("forgets a deferred picker admission only after its exact token is released", async () => {
    let finishPicker: ((result: unknown) => void) | undefined;
    let finishUnregister: (() => void) | undefined;
    invoke
      .mockImplementationOnce(() => new Promise((resolve) => (finishPicker = resolve)))
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishUnregister = () => resolve(RELEASED))),
      );
    const gateway = new TauriWorkspaceIdentityGateway();

    const opening = gateway.openFromPicker();
    const unregistering = gateway.unregister(owner("ws-deferred", "/real/deferred"));
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
    expect(gateway.descriptorForPath("/link/deferred/src/App.ts")?.workspaceId).toBe("ws-deferred");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("unregister_workspace", {
        workspaceId: "ws-deferred",
        admissionToken: 1,
        canonicalRootPath: "/real/deferred",
      }),
    );
    finishUnregister?.();
    await unregistering;
    expect(gateway.descriptorForPath("/link/deferred/src/App.ts")).toBeNull();
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
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishUnregister = () => resolve(RELEASED))),
      )
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

    const unregistering = gateway.unregister(owner("ws-reopen", "/real/reopen"));
    const reopening = gateway.openPath("/link/reopen");
    await vi.waitFor(() => expect(finishUnregister).toBeTypeOf("function"));

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(gateway.descriptorForPath("/link/reopen/src/App.ts")?.workspaceId).toBe("ws-reopen");
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
        .mockResolvedValueOnce(RELEASED);
      const gateway = new TauriWorkspaceIdentityGateway({
        operationTimeoutMs: 10,
      });

      const opening = gateway.openPath("/never");
      const openingExpectation = expect(opening).rejects.toThrow("timed out");
      const unregistering = gateway.unregister(owner("ws-never", "/never"));
      await vi.advanceTimersByTimeAsync(10);

      await openingExpectation;
      await expect(unregistering).resolves.toEqual(RELEASED);
      expect(invoke).toHaveBeenLastCalledWith("unregister_workspace", {
        workspaceId: "ws-never",
        admissionToken: 1,
        canonicalRootPath: "/never",
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
      .mockResolvedValueOnce(RELEASED);
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
      .mockResolvedValueOnce(RELEASED);
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
    invoke.mockResolvedValueOnce(RELEASED);
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
        .mockResolvedValueOnce(RELEASED);
      const gateway = new TauriWorkspaceIdentityGateway({
        maxPendingOperations: 1,
        operationTimeoutMs: 10,
      });
      await gateway.openPath("/cleanup");
      const hangingLookup = gateway.getDescriptor("ws-never");
      const lookupExpectation = expect(hangingLookup).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10);
      await lookupExpectation;

      await expect(gateway.unregister(owner("ws-cleanup", "/cleanup"))).resolves.toEqual(RELEASED);

      expect(invoke).toHaveBeenLastCalledWith("unregister_workspace", {
        workspaceId: "ws-cleanup",
        admissionToken: 1,
        canonicalRootPath: "/cleanup",
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
      .mockResolvedValueOnce(RELEASED);
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
      .mockResolvedValueOnce(RELEASED);

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
      .mockResolvedValueOnce(RELEASED);

    await expect(new TauriWorkspaceIdentityGateway().openFromPicker()).rejects.toThrow(
      "invalid result",
    );
    expect(invoke).toHaveBeenLastCalledWith("rollback_workspace_registration", {
      admissionToken: 1,
      workspaceId: "ws-picker-extra",
    });
  });

  it.each([true, { confirmed: true }, { status: "releasing" }])(
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
        /Workspace release result|still in progress/,
      );
    },
  );
});

const RELEASED = { status: "released" } as const;
const TAB_A = {
  workspaceId: "ws-a",
  selectedRootPath: "/link/a",
  canonicalRootPath: "/real/a",
  caseSensitive: true,
  unicodeNormalizationPolicy: "preserved",
};

function owner(workspaceId: string, canonicalRootPath: string, admissionToken = 1) {
  return { workspaceId, admissionToken, canonicalRootPath };
}

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
