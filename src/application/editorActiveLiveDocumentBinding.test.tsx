// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLegacyEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import { DocumentSessionStore } from "./documentSessionStore";
import { createRegisteredDocumentSaveIdentity } from "./documentSaveIdentity";
import {
  createEditorGroupChangeHunksBaseline,
  EditorSessionDocumentAuthoritySidecar,
} from "./editorSessionDocumentAuthority";
import type { EditorGroupDocumentSessionAuthority } from "./useEditorSessionState";
import type {
  EditorChangeHunksSnapshotPort,
  EditorLiveDocumentContentAccessPort,
} from "./editorChangeHunksSnapshotPort";
import type { LiveModelSourceHandle } from "./liveModelIngressCoordinator";
import type { LiveDocumentSnapshot } from "./liveDocumentSnapshotBroker";
import type { OwnedEditorChangeHunksInput } from "./useOwnedEditorChangeHunks";

const ownedHunksMock = vi.hoisted(() =>
  vi.fn((_input: OwnedEditorChangeHunksInput) => ({ hunks: [], status: "idle" as const })),
);

vi.mock("./useOwnedEditorChangeHunks", async (importOriginal) => ({
  ...(await importOriginal()),
  useOwnedEditorChangeHunks: ownedHunksMock,
}));

import {
  createEditorActiveLiveDocumentBinding,
  captureEditorActiveLiveDocumentForDirtySearch,
  captureEditorActiveLiveDocumentForSave,
  consumeCurrentEditorActiveLiveDocumentContent,
  consumeEditorActiveLiveDocumentSaveCapture,
  releaseEditorActiveLiveDocumentContent,
  retireEditorLiveDocumentBindingOwner,
  useEditorActiveLiveDocumentChangeHunks,
  useEditorActiveLiveDocumentChangeHunksController,
  type EditorActiveLiveDocumentBinding,
  type EditorActiveLiveDocumentChangeHunksInput,
} from "./editorActiveLiveDocumentBinding";

describe("editorActiveLiveDocumentBinding", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    ownedHunksMock.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps every raw capability in the private vault", () => {
    const binding = bindingFixture().binding;

    expect(Object.keys(binding).sort()).toEqual(["groupId", "isCurrent", "path"]);
    expect(binding).not.toHaveProperty("handle");
    expect(binding).not.toHaveProperty("snapshots");
    expect(binding).not.toHaveProperty("createBaseline");
    expect(binding).not.toHaveProperty("lease");
    expect(binding).not.toHaveProperty("selectionLease");
    expect(binding).not.toHaveProperty("sessionAuthority");
  });

  it("selects an exact vault-backed snapshot with the exact saved baseline", () => {
    const { authority, binding, handle, snapshots } = bindingFixture();
    renderSelection({
      ...selectionInput(binding),
      savedContent: "saved exact",
    });

    expect(ownedHunksMock).toHaveBeenCalledOnce();
    const expectedBaseline = createEditorGroupChangeHunksBaseline(authority, "saved exact");
    expect(ownedHunksMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        baseline: expectedBaseline,
        liveDocument: { handle },
        mode: "snapshot",
        snapshots: expect.any(Object),
      }),
    );
    expect(
      (
        ownedHunksMock.mock.calls[0]![0] as Extract<
          OwnedEditorChangeHunksInput,
          { mode: "snapshot" }
        >
      ).snapshots,
    ).not.toBe(snapshots);
  });

  it("rejects a forged binding and stale or reentrant currentness in exact mode", () => {
    const forged = {
      groupId: "group-a",
      isCurrent: () => true,
      path: "/workspace/a.ts",
    } satisfies EditorActiveLiveDocumentBinding;
    renderSelection(selectionInput(forged));
    expect(ownedHunksMock.mock.calls[ownedHunksMock.mock.calls.length - 1]?.[0]).toEqual(
      expect.objectContaining({ baseline: null, liveDocument: null, mode: "snapshot" }),
    );

    let validation = 0;
    const stale = bindingFixture(() => {
      validation += 1;
      return validation === 1;
    }).binding;
    renderSelection(selectionInput(stale));
    expect(ownedHunksMock.mock.calls[ownedHunksMock.mock.calls.length - 1]?.[0]).toEqual(
      expect.objectContaining({ baseline: null, liveDocument: null, mode: "snapshot" }),
    );
  });

  it("permits legacy hunks only when exact binding is not required", () => {
    renderSelection({
      ...selectionInput(null),
      exactBindingRequired: false,
    });

    expect(ownedHunksMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        baselineContent: "legacy saved",
        content: "legacy current",
        mode: "legacy",
        ownerKey: "legacy-owner",
        path: "/legacy/a.ts",
      }),
    );
  });

  it("rejects a valid vault binding paired with another active group or path", () => {
    const { binding } = bindingFixture();
    renderSelection({
      ...selectionInput(binding),
      activeGroupId: "group-b",
    });
    expect(ownedHunksMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ baseline: null, liveDocument: null, mode: "snapshot" }),
    );

    renderSelection({
      ...selectionInput(binding),
      activePath: "/workspace/b.ts",
    });
    expect(ownedHunksMock.mock.calls[ownedHunksMock.mock.calls.length - 1]?.[0]).toEqual(
      expect.objectContaining({ baseline: null, liveDocument: null, mode: "snapshot" }),
    );
  });

  it("owns binding state and keeps its publication callback stable across content churn", () => {
    const callbacks: Array<(binding: EditorActiveLiveDocumentBinding | null) => void> = [];
    const { binding } = bindingFixture();

    function Harness({ savedContent }: { savedContent: string }) {
      const controller = useEditorActiveLiveDocumentChangeHunksController({
        activeDocument: {
          content: "current",
          path: "/workspace/a.ts",
          savedContent,
        },
        activeGroupId: "group-a",
        exactBindingRequired: true,
        gateway: selectionInput(null).gateway,
        legacyBaselineContent: null,
        legacyOwnerKey: null,
        policy: { characterLimit: 1000, lineLimit: 100 },
      });
      callbacks.push(controller.onActiveLiveDocumentBindingChange);
      return null;
    }

    act(() => root.render(<Harness savedContent="saved-0" />));
    act(() => callbacks[0]?.(binding));
    for (let index = 1; index <= 100; index += 1) {
      act(() => root.render(<Harness savedContent={`saved-${index}`} />));
    }

    expect(new Set(callbacks).size).toBe(1);
    expect(ownedHunksMock.mock.calls[ownedHunksMock.mock.calls.length - 1]?.[0]).toEqual(
      expect.objectContaining({
        baseline: expect.objectContaining({ content: "saved-100" }),
        mode: "snapshot",
      }),
    );
  });

  it("captures closed purposes without leaking raw snapshot capabilities", () => {
    const { binding, handle, liveContent, rawSnapshot } = bindingFixture();
    const saved = captureEditorActiveLiveDocumentForSave(binding);
    expect(saved.status).toBe("captured");
    if (saved.status !== "captured") return;

    expect(liveContent.captureForSave).toHaveBeenCalledWith(handle, undefined);
    expect(Object.keys(saved.capture).sort()).toEqual([
      "alternativeVersionId",
      "content",
      "contentVersion",
      "kind",
      "modelVersionId",
      "purpose",
      "utf16Length",
      "utf8BytesUpperBound",
    ]);
    expect(saved.capture).not.toHaveProperty("authority");
    expect(saved.capture).not.toHaveProperty("handle");
    expect(saved.capture).not.toHaveProperty("modelAuthority");
    expect(saved.capture).not.toHaveProperty("reservationAuthority");
    expect(saved.capture).not.toHaveProperty("snapshotAuthority");
    expect(saved.capture).not.toHaveProperty("sourceAuthority");
    expect(consumeCurrentEditorActiveLiveDocumentContent(binding, saved.capture)).toBe(true);
    expect(liveContent.consumeCurrent).toHaveBeenCalledWith(handle, rawSnapshot);
    expect(consumeCurrentEditorActiveLiveDocumentContent(binding, saved.capture)).toBe(false);
    expect(releaseEditorActiveLiveDocumentContent(binding, saved.capture)).toBe(false);
  });

  it("selects purpose-specific limits, forwards abort and releases rejected currentness", () => {
    const controller = new AbortController();
    let current = true;
    const fixture = bindingFixture(() => current);
    fixture.liveContent.captureForDirtySearch.mockImplementation((_handle, signal) => {
      expect(signal).toBe(controller.signal);
      current = false;
      return { snapshot: fixture.rawSnapshotFor("dirty-search"), status: "captured" };
    });

    expect(
      captureEditorActiveLiveDocumentForDirtySearch(fixture.binding, controller.signal),
    ).toEqual({
      reason: "stale",
      status: "rejected",
    });
    expect(fixture.liveContent.captureForSave).not.toHaveBeenCalled();
    expect(fixture.liveContent.release).toHaveBeenCalledOnce();

    const rejectedCurrent = bindingFixture();
    rejectedCurrent.liveContent.captureForSave.mockReturnValue({
      reason: "aborted",
      status: "rejected",
    });
    expect(
      captureEditorActiveLiveDocumentForSave(rejectedCurrent.binding, controller.signal),
    ).toEqual({
      reason: "aborted",
      status: "rejected",
    });
    expect(rejectedCurrent.liveContent.captureForDirtySearch).not.toHaveBeenCalled();

    let rejectedStillCurrent = true;
    const reentrantRejection = bindingFixture(() => rejectedStillCurrent);
    reentrantRejection.liveContent.captureForSave.mockImplementation(() => {
      rejectedStillCurrent = false;
      return { reason: "aborted", status: "rejected" };
    });
    expect(captureEditorActiveLiveDocumentForSave(reentrantRejection.binding)).toEqual({
      reason: "stale",
      status: "rejected",
    });
  });

  it("fails old captures and bindings closed across A to B to A", () => {
    let currentA = true;
    const firstA = bindingFixture(() => currentA);
    const capturedA = captureEditorActiveLiveDocumentForSave(firstA.binding);
    expect(capturedA.status).toBe("captured");
    if (capturedA.status !== "captured") return;

    currentA = false;
    const bindingB = bindingFixture();
    const nextA = bindingFixture();
    expect(captureEditorActiveLiveDocumentForSave(firstA.binding)).toEqual({
      reason: "stale",
      status: "rejected",
    });
    expect(consumeCurrentEditorActiveLiveDocumentContent(bindingB.binding, capturedA.capture)).toBe(
      false,
    );
    expect(consumeCurrentEditorActiveLiveDocumentContent(nextA.binding, capturedA.capture)).toBe(
      false,
    );
    expect(releaseEditorActiveLiveDocumentContent(firstA.binding, capturedA.capture)).toBe(true);
  });

  it("blocks reentrant double settlement and leaves a throwing release retryable", () => {
    const fixture = bindingFixture();
    const captured = captureEditorActiveLiveDocumentForSave(fixture.binding);
    expect(captured.status).toBe("captured");
    if (captured.status !== "captured") return;
    fixture.liveContent.release
      .mockImplementationOnce(() => {
        expect(releaseEditorActiveLiveDocumentContent(fixture.binding, captured.capture)).toBe(
          false,
        );
        throw new Error("uncertain release");
      })
      .mockReturnValueOnce(true);

    expect(releaseEditorActiveLiveDocumentContent(fixture.binding, captured.capture)).toBe(false);
    expect(consumeCurrentEditorActiveLiveDocumentContent(fixture.binding, captured.capture)).toBe(
      false,
    );
    expect(fixture.liveContent.consumeCurrent).not.toHaveBeenCalled();
    expect(releaseEditorActiveLiveDocumentContent(fixture.binding, captured.capture)).toBe(true);
    expect(releaseEditorActiveLiveDocumentContent(fixture.binding, captured.capture)).toBe(false);
  });

  it("makes a directly rejected release consume-blocking but release-retryable", () => {
    const fixture = bindingFixture();
    const captured = captureEditorActiveLiveDocumentForSave(fixture.binding);
    expect(captured.status).toBe("captured");
    if (captured.status !== "captured") return;
    fixture.liveContent.release.mockReturnValueOnce(false).mockReturnValueOnce(true);

    expect(releaseEditorActiveLiveDocumentContent(fixture.binding, captured.capture)).toBe(false);
    expect(consumeCurrentEditorActiveLiveDocumentContent(fixture.binding, captured.capture)).toBe(
      false,
    );
    expect(fixture.liveContent.consumeCurrent).not.toHaveBeenCalled();
    expect(releaseEditorActiveLiveDocumentContent(fixture.binding, captured.capture)).toBe(true);
  });

  it("compensates consume false with an exact release before settling", () => {
    const fixture = bindingFixture();
    const captured = captureEditorActiveLiveDocumentForSave(fixture.binding);
    expect(captured.status).toBe("captured");
    if (captured.status !== "captured") return;
    fixture.liveContent.consumeCurrent.mockReturnValue(false);

    expect(consumeCurrentEditorActiveLiveDocumentContent(fixture.binding, captured.capture)).toBe(
      false,
    );
    expect(fixture.liveContent.release).toHaveBeenCalledWith(fixture.handle, fixture.rawSnapshot);
    expect(releaseEditorActiveLiveDocumentContent(fixture.binding, captured.capture)).toBe(false);
  });

  it("keeps consume-false captures release-only retryable until cleanup succeeds", () => {
    const fixture = bindingFixture();
    const captured = captureEditorActiveLiveDocumentForSave(fixture.binding);
    expect(captured.status).toBe("captured");
    if (captured.status !== "captured") return;
    fixture.liveContent.consumeCurrent.mockReturnValue(false);
    fixture.liveContent.release.mockReturnValueOnce(false).mockReturnValueOnce(true);

    expect(consumeCurrentEditorActiveLiveDocumentContent(fixture.binding, captured.capture)).toBe(
      false,
    );
    expect(consumeCurrentEditorActiveLiveDocumentContent(fixture.binding, captured.capture)).toBe(
      false,
    );
    expect(fixture.liveContent.consumeCurrent).toHaveBeenCalledOnce();
    expect(releaseEditorActiveLiveDocumentContent(fixture.binding, captured.capture)).toBe(true);
    expect(releaseEditorActiveLiveDocumentContent(fixture.binding, captured.capture)).toBe(false);
  });

  it("contains uncertain consume and permits only exact release retries", () => {
    const fixture = bindingFixture();
    const captured = captureEditorActiveLiveDocumentForSave(fixture.binding);
    expect(captured.status).toBe("captured");
    if (captured.status !== "captured") return;
    fixture.liveContent.consumeCurrent.mockImplementation(() => {
      throw new Error("uncertain consume");
    });
    fixture.liveContent.release.mockReturnValueOnce(false).mockReturnValueOnce(true);

    expect(consumeCurrentEditorActiveLiveDocumentContent(fixture.binding, captured.capture)).toBe(
      false,
    );
    expect(consumeCurrentEditorActiveLiveDocumentContent(fixture.binding, captured.capture)).toBe(
      false,
    );
    expect(fixture.liveContent.consumeCurrent).toHaveBeenCalledOnce();
    expect(releaseEditorActiveLiveDocumentContent(fixture.binding, captured.capture)).toBe(true);
  });

  it("does not retain facade capacity across repeated compensated consume failures", () => {
    const fixture = bindingFixture();
    fixture.liveContent.consumeCurrent.mockReturnValue(false);

    for (let index = 0; index < 100; index += 1) {
      const captured = captureEditorActiveLiveDocumentForSave(fixture.binding);
      expect(captured.status).toBe("captured");
      if (captured.status !== "captured") return;
      expect(consumeCurrentEditorActiveLiveDocumentContent(fixture.binding, captured.capture)).toBe(
        false,
      );
    }

    expect(fixture.liveContent.consumeCurrent).toHaveBeenCalledTimes(100);
    expect(fixture.liveContent.release).toHaveBeenCalledTimes(100);
  });

  it("consumes save captures only for the exact private session authority", () => {
    const fixture = bindingFixture();
    const captured = captureEditorActiveLiveDocumentForSave(fixture.binding);
    expect(captured.status).toBe("captured");
    if (captured.status !== "captured") return;
    const cloned = Object.freeze({ ...captured.capture });

    expect(
      consumeEditorActiveLiveDocumentSaveCapture(
        fixture.binding,
        sessionAuthority(),
        captured.capture,
        fixture.modelAuthority,
      ),
    ).toBe(false);
    expect(
      consumeEditorActiveLiveDocumentSaveCapture(
        fixture.binding,
        fixture.authority,
        cloned,
        fixture.modelAuthority,
      ),
    ).toBe(false);
    expect(fixture.liveContent.consumeCurrent).not.toHaveBeenCalled();
    expect(
      consumeEditorActiveLiveDocumentSaveCapture(
        fixture.binding,
        fixture.authority,
        captured.capture,
        fixture.modelAuthority,
      ),
    ).toBe(true);
    expect(
      consumeEditorActiveLiveDocumentSaveCapture(
        fixture.binding,
        fixture.authority,
        captured.capture,
        fixture.modelAuthority,
      ),
    ).toBe(false);
  });

  it("fails save consume closed when currentness rotates reentrantly", () => {
    let current = true;
    const fixture = bindingFixture(() => current);
    const captured = captureEditorActiveLiveDocumentForSave(fixture.binding);
    expect(captured.status).toBe("captured");
    if (captured.status !== "captured") return;
    fixture.liveContent.consumeCurrent.mockImplementation(() => {
      current = false;
      return true;
    });

    expect(
      consumeEditorActiveLiveDocumentSaveCapture(
        fixture.binding,
        fixture.authority,
        captured.capture,
        fixture.modelAuthority,
      ),
    ).toBe(false);
    expect(
      consumeEditorActiveLiveDocumentSaveCapture(
        fixture.binding,
        fixture.authority,
        captured.capture,
        fixture.modelAuthority,
      ),
    ).toBe(false);
  });

  it("rejects an old attachment model authority after same-session model replacement", () => {
    const authority = sessionAuthority();
    const oldModelAuthority = Object.freeze({});
    const nextModelAuthority = Object.freeze({});
    const next = bindingFixture(() => true, authority, nextModelAuthority);
    const captured = captureEditorActiveLiveDocumentForSave(next.binding);
    expect(captured.status).toBe("captured");
    if (captured.status !== "captured") return;

    expect(
      consumeEditorActiveLiveDocumentSaveCapture(
        next.binding,
        authority,
        captured.capture,
        oldModelAuthority,
      ),
    ).toBe(false);
    expect(next.liveContent.consumeCurrent).not.toHaveBeenCalled();
    expect(
      consumeEditorActiveLiveDocumentSaveCapture(
        next.binding,
        authority,
        captured.capture,
        nextModelAuthority,
      ),
    ).toBe(true);
  });

  it("fails save consume closed when private model authority changes reentrantly", () => {
    const modelAuthority = Object.freeze({});
    const fixture = bindingFixture(() => true, undefined, modelAuthority);
    const captured = captureEditorActiveLiveDocumentForSave(fixture.binding);
    expect(captured.status).toBe("captured");
    if (captured.status !== "captured") return;
    fixture.liveContent.consumeCurrent.mockImplementation(() => {
      Object.defineProperty(fixture.handle, "modelAuthority", {
        value: Object.freeze({}),
      });
      return true;
    });

    expect(
      consumeEditorActiveLiveDocumentSaveCapture(
        fixture.binding,
        fixture.authority,
        captured.capture,
        modelAuthority,
      ),
    ).toBe(false);
  });

  it("wakes blocked retirement after a much later private snapshot release without polling", async () => {
    const { binding, handle } = bindingFixture();
    renderSelection(selectionInput(binding));
    const selectedSnapshots = (
      ownedHunksMock.mock.calls[0]![0] as Extract<OwnedEditorChangeHunksInput, { mode: "snapshot" }>
    ).snapshots;
    let blocked = true;
    const owner = { dispose: vi.fn(() => !blocked) };

    retireEditorLiveDocumentBindingOwner(owner);
    await settleMicrotasks(300);
    expect(owner.dispose).toHaveBeenCalledTimes(2);

    blocked = false;
    selectedSnapshots.release(handle, {} as never);
    await settleMicrotasks(2);
    expect(owner.dispose).toHaveBeenCalledTimes(3);
    await settleMicrotasks(300);
    expect(owner.dispose).toHaveBeenCalledTimes(3);
  });

  function renderSelection(input: EditorActiveLiveDocumentChangeHunksInput): void {
    function Harness() {
      useEditorActiveLiveDocumentChangeHunks(input);
      return null;
    }
    act(() => root.render(<Harness />));
  }
});

function selectionInput(
  binding: EditorActiveLiveDocumentBinding | null,
): EditorActiveLiveDocumentChangeHunksInput {
  return {
    activeGroupId: "group-a",
    activePath: "/workspace/a.ts",
    binding,
    exactBindingRequired: true,
    gateway: {
      compute: vi.fn(async (request) => ({
        generation: request.generation,
        hunks: [],
        ownerKey: request.ownerKey,
        path: request.path,
        status: "ready" as const,
      })),
    },
    legacy: {
      baselineContent: "legacy saved",
      content: "legacy current",
      ownerKey: "legacy-owner",
      path: "/legacy/a.ts",
    },
    policy: { characterLimit: 1000, lineLimit: 100 },
    savedContent: "saved",
  };
}

function bindingFixture(
  isCurrent: () => boolean = () => true,
  authority = sessionAuthority(),
  modelAuthority = Object.freeze({}),
) {
  const handle = { modelAuthority } as LiveModelSourceHandle;
  const rawSnapshotFor = (
    purpose: "change-hunks" | "dirty-search" | "save",
  ): LiveDocumentSnapshot =>
    ({
      alternativeVersionId: 1,
      authority: {},
      content: "current",
      contentVersion: 1,
      modelAuthority: {},
      modelVersionId: 1,
      purpose,
      reservationAuthority: {},
      snapshotAuthority: {},
      sourceAuthority: {},
      utf16Length: 7,
      utf8BytesUpperBound: 21,
    }) as LiveDocumentSnapshot;
  const rawSnapshot = rawSnapshotFor("save");
  const captureForDirtySearch = vi.fn<EditorLiveDocumentContentAccessPort["captureForDirtySearch"]>(
    () => ({
      snapshot: rawSnapshotFor("dirty-search"),
      status: "captured" as const,
    }),
  );
  const captureForSave = vi.fn<EditorLiveDocumentContentAccessPort["captureForSave"]>(() => ({
    snapshot: rawSnapshot,
    status: "captured" as const,
  }));
  const snapshots = {
    capture: vi.fn(),
    captureForDirtySearch,
    captureForSave,
    consumeCurrent: vi.fn(),
    release: vi.fn(() => true),
    subscribe: vi.fn(() => () => undefined),
  } satisfies EditorChangeHunksSnapshotPort & EditorLiveDocumentContentAccessPort;
  snapshots.consumeCurrent.mockReturnValue(true);
  return {
    authority,
    binding: createEditorActiveLiveDocumentBinding({
      handle,
      isCurrent,
      liveContent: snapshots,
      sessionAuthority: authority,
      snapshots,
    }),
    handle,
    liveContent: snapshots,
    modelAuthority,
    rawSnapshot,
    rawSnapshotFor,
    snapshots,
  };
}

function sessionAuthority(): EditorGroupDocumentSessionAuthority {
  const path = "/workspace/a.ts";
  const store = new DocumentSessionStore();
  const sidecar = new EditorSessionDocumentAuthoritySidecar(store);
  const activated = sidecar.activateOwner(
    {
      canonicalRoot: "/workspace",
      ownerKey: createLegacyEditorSessionOwnerKey("/workspace"),
      rootPath: "/workspace",
      workspaceId: "/workspace",
    },
    (_rootPath, candidate) =>
      candidate === path
        ? createRegisteredDocumentSaveIdentity("/workspace", "/workspace", "a.ts")
        : null,
    {
      [path]: {
        content: "",
        language: "typescript",
        name: "a.ts",
        path,
        savedContent: "",
      },
    },
  );
  const lifecycle = activated ? sidecar.resolveLifecycle(path) : null;
  const authority = lifecycle
    ? sidecar.createGroupAuthority(lifecycle, "group-a", path, Object.freeze({}))
    : null;
  if (!authority) throw new Error("Expected exact test group authority");
  return authority;
}

async function settleMicrotasks(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}
