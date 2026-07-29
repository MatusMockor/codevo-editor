import type * as Monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import { LiveDocumentRuntime } from "../application/liveDocumentRuntime";
import { DocumentSessionStore } from "../application/documentSessionStore";
import { createRegisteredDocumentSaveIdentity } from "../application/documentSaveIdentity";
import { EditorSessionDocumentAuthoritySidecar } from "../application/editorSessionDocumentAuthority";
import type { LiveModelIngressRegistration } from "../application/liveModelIngressCoordinator";
import type { EditorGroupDocumentSessionAuthority } from "../application/useEditorSessionState";
import { createLegacyEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { LiveModelSourceHandle } from "../application/liveModelIngressCoordinator";
import type { CaptureLiveDocumentSnapshotReceipt } from "../application/liveDocumentSnapshotBroker";
import { workspaceModelUri } from "./phpMonacoDocumentContext";
import {
  EditorLiveDocumentBindingCoordinator,
  utf8BytesUpperBoundForUtf16Length,
  type EditorLiveDocumentBindingRegistration,
} from "./editorLiveDocumentBindingCoordinator";

interface ModelHarness {
  readonly dispose: () => void;
  readonly edit: (content: string) => Parameters<LiveModelSourceHandle["recordChange"]>[0];
  readonly getValue: ReturnType<typeof vi.fn<() => string>>;
  readonly model: Monaco.editor.ITextModel;
  readonly onValueLengthRead: (listener: (() => void) | null) => void;
}

interface MonacoHarness {
  readonly emitCreated: (model: Monaco.editor.ITextModel) => void;
  readonly monaco: typeof Monaco;
}

class RecordingRuntime {
  blockRetire = false;
  onPurposeCapture: () => CaptureLiveDocumentSnapshotReceipt = () => ({
    reason: "stale",
    status: "rejected",
  });
  readonly registrations: LiveModelIngressRegistration[] = [];
  readonly retired: LiveModelSourceHandle[] = [];
  private readonly active = new Set<LiveModelSourceHandle>();

  register(input: LiveModelIngressRegistration) {
    this.registrations.push(input);
    const handle: LiveModelSourceHandle = Object.freeze({
      channelAuthority: Object.freeze({}),
      currentRevision: () =>
        this.active.has(handle)
          ? {
              alternativeVersionId: input.base.alternativeVersionId,
              contentVersion: input.base.contentVersion,
              mode: "retained" as const,
              modelVersionId: input.base.modelVersionId,
              utf16Length: input.base.utf16Length,
            }
          : null,
      handleAuthority: Object.freeze({}),
      modelAuthority: input.source.modelAuthority,
      recordChange: () => ({ status: "stale" as const }),
      release: () => ({ status: "stale" as const }),
    });
    this.active.add(handle);
    return { handle, role: "registered" as const, status: "registered" as const };
  }

  retire(handle: LiveModelSourceHandle): boolean {
    this.retired.push(handle);
    if (this.blockRetire) return false;
    return this.active.delete(handle);
  }

  capture() {
    return { reason: "stale" as const, status: "rejected" as const };
  }

  captureForDirtySearch() {
    return this.onPurposeCapture();
  }

  captureForSave() {
    return this.onPurposeCapture();
  }

  consumeCurrent(): boolean {
    return false;
  }

  release(): boolean {
    return false;
  }

  subscribe(): () => void {
    return () => undefined;
  }
}

describe("EditorLiveDocumentBindingCoordinator", () => {
  it.each([1, 2, 4])("joins %i exact registrations without full-text reads", (count) => {
    const model = createModel("/workspace", "/workspace/src/shared.ts", "hello");
    const monaco = createMonacoHarness([model.model]);
    const runtime = new LiveDocumentRuntime();
    const coordinator = new EditorLiveDocumentBindingCoordinator(runtime);
    const lease = documentAuthority("/workspace", "/workspace/src/shared.ts");
    const registrations = Array.from({ length: count }, (_, index) =>
      registration({
        authority: groupAuthority(lease, `group-${index}`),
        editor: editor(model.model),
        id: `surface-${index}`,
        monaco: monaco.monaco,
        workspaceRoot: "/workspace",
      }),
    );

    const receipt = coordinator.reconcile(registrations);

    expect(receipt).toEqual({
      boundCount: count,
      rejections: [],
      status: "reconciled",
    });
    const handles = registrations.map(({ id }) => coordinator.currentHandle(id));
    expect(handles.every(Boolean)).toBe(true);
    expect(new Set(handles).size).toBe(count);
    expect(model.getValue).not.toHaveBeenCalled();
    expect(handles[0]!.recordChange(model.edit("changed")).status).toBe("committed");
    const captures = handles.map((handle, index) =>
      index % 2 === 0
        ? coordinator.captureForSave(handle!)
        : coordinator.captureForDirtySearch(handle!),
    );
    expect(captures.every((capture) => capture.status === "captured")).toBe(true);
    expect(model.getValue).toHaveBeenCalledOnce();
    captures.forEach((capture, index) => {
      if (capture.status !== "captured") return;
      expect(capture.snapshot).toMatchObject({
        content: "changed",
        purpose: index % 2 === 0 ? "save" : "dirty-search",
      });
      expect(coordinator.release(handles[index]!, capture.snapshot)).toBe(true);
    });

    coordinator.reconcile(registrations.slice(1));
    expect(coordinator.currentHandle("surface-0")).toBeNull();
    registrations
      .slice(1)
      .forEach(({ id }) => expect(coordinator.currentHandle(id)).not.toBeNull());
    coordinator.dispose();
    registrations.forEach(({ id }) => expect(coordinator.currentHandle(id)).toBeNull());
  });

  it("seeds a bounded retained base from metadata and a conservative UTF-8 charge", () => {
    const text = "ascii-\u{1f642}-ž";
    const model = createModel("/workspace", "/workspace/src/base.ts", text, {
      alternativeVersionId: 9,
      modelVersionId: 7,
    });
    const monaco = createMonacoHarness([model.model]);
    const runtime = new RecordingRuntime();
    const coordinator = new EditorLiveDocumentBindingCoordinator(runtime);
    const authority = groupAuthority(
      documentAuthority("/workspace", "/workspace/src/base.ts"),
      "group",
    );

    expect(
      coordinator.reconcile([
        registration({
          authority,
          editor: editor(model.model),
          id: "surface",
          monaco: monaco.monaco,
          workspaceRoot: "/workspace",
        }),
      ]).boundCount,
    ).toBe(1);

    expect(runtime.registrations[0]?.base).toEqual({
      alternativeVersionId: 9,
      contentVersion: 7,
      modelVersionId: 7,
      utf16Length: text.length,
      utf8Bytes: text.length * 3,
    });
    expect(runtime.registrations[0]?.authority).toMatchObject({
      canonicalRoot: "/workspace",
      path: "/workspace/src/base.ts",
    });
    expect(runtime.registrations[0]?.authority.documentIdentityKey).not.toContain("\0");
    expect(runtime.registrations[0]?.source.probe().status).toBe("available");
    expect(model.getValue).not.toHaveBeenCalled();
  });

  it("bounds ASCII, BMP and surrogate UTF-16 charges without inspecting text", () => {
    expect(utf8BytesUpperBoundForUtf16Length("ascii".length)).toBe(15);
    expect(utf8BytesUpperBoundForUtf16Length("ž".length)).toBe(3);
    expect(utf8BytesUpperBoundForUtf16Length("\u{1f642}".length)).toBe(6);
    expect(utf8BytesUpperBoundForUtf16Length(-1)).toBeNull();
    expect(utf8BytesUpperBoundForUtf16Length(Number.MAX_SAFE_INTEGER)).toBeNull();
  });

  it("supports exact rooted and rootless models while rejecting a rooted model as rootless", () => {
    const rooted = createModel("/workspace", "/workspace/src/rooted.ts", "rooted");
    const loose = createModel(null, "/loose.ts", "loose");
    const monaco = createMonacoHarness([rooted.model, loose.model]);
    const runtime = new RecordingRuntime();
    const coordinator = new EditorLiveDocumentBindingCoordinator(runtime);

    const rootedAuthority = groupAuthority(
      documentAuthority("/workspace", "/workspace/src/rooted.ts"),
      "rooted",
    );
    const looseAuthority = groupAuthority(documentAuthority("/loose", "/loose.ts"), "loose");
    const receipt = coordinator.reconcile([
      registration({
        authority: rootedAuthority,
        editor: editor(rooted.model),
        id: "rooted",
        monaco: monaco.monaco,
        workspaceRoot: "/workspace",
      }),
      registration({
        authority: looseAuthority,
        editor: editor(loose.model),
        id: "loose",
        monaco: monaco.monaco,
        workspaceRoot: null,
      }),
    ]);
    expect(receipt.boundCount).toBe(2);

    const rootedAsLoose = coordinator.reconcile([
      registration({
        authority: rootedAuthority,
        editor: editor(rooted.model),
        id: "wrong",
        monaco: monaco.monaco,
        workspaceRoot: null,
      }),
    ]);
    expect(rootedAsLoose).toMatchObject({
      boundCount: 0,
      rejections: [{ id: "wrong", reason: "invalid-binding" }],
    });
  });

  it("binds an active alias path through the exact stable document lease identity", () => {
    const aliasModel = createModel("/workspace", "/workspace/src/alias-b.ts", "alias");
    const monaco = createMonacoHarness([aliasModel.model]);
    const runtime = new RecordingRuntime();
    const coordinator = new EditorLiveDocumentBindingCoordinator(runtime);
    const aliasAuthority = groupAuthority(
      documentAuthority("/workspace", "/workspace/src/alias-b.ts"),
      "group",
    );

    const receipt = coordinator.reconcile([
      registration({
        authority: aliasAuthority,
        editor: editor(aliasModel.model),
        id: "alias",
        monaco: monaco.monaco,
        workspaceRoot: "/workspace",
      }),
    ]);

    expect(receipt.boundCount).toBe(1);
    expect(runtime.registrations[0]?.authority).toMatchObject({
      path: "/workspace/src/alias-b.ts",
    });
    expect(coordinator.currentHandle("alias")).not.toBeNull();
  });

  it("fails old handles closed across A-B-A and same-path model replacement", () => {
    const firstA = createModel("/a", "/a/src/file.ts", "a1");
    const modelB = createModel("/b", "/b/src/file.ts", "b");
    const monaco = createMonacoHarness([firstA.model, modelB.model]);
    const runtime = new LiveDocumentRuntime();
    const coordinator = new EditorLiveDocumentBindingCoordinator(runtime);
    const editorHarness = mutableEditor(firstA.model);
    const currentSelections = new Set<object>();
    const firstAuthority = groupAuthority(documentAuthority("/a", "/a/src/file.ts", 1), "group");
    currentSelections.add(firstAuthority.identity);

    const registerCurrent = (
      authority: EditorGroupDocumentSessionAuthority,
      workspaceRoot: string,
    ) =>
      registration({
        authority,
        editor: editorHarness.editor,
        id: "surface",
        isCurrent: (candidate) => currentSelections.has(candidate.identity),
        monaco: monaco.monaco,
        workspaceRoot,
      });

    coordinator.reconcile([registerCurrent(firstAuthority, "/a")]);
    const staleA = coordinator.currentHandle("surface");
    expect(staleA).not.toBeNull();

    currentSelections.clear();
    const authorityB = groupAuthority(documentAuthority("/b", "/b/src/file.ts", 2), "group");
    currentSelections.add(authorityB.identity);
    editorHarness.setModel(modelB.model);
    coordinator.reconcile([registerCurrent(authorityB, "/b")]);
    const handleB = coordinator.currentHandle("surface");
    expect(handleB).not.toBeNull();
    expect(handleB).not.toBe(staleA);
    expect(staleA?.currentRevision()).toBeNull();
    expect(coordinator.captureForSave(staleA!)).toEqual({
      reason: "stale",
      status: "rejected",
    });

    firstA.dispose();
    const secondA = createModel("/a", "/a/src/file.ts", "a2");
    monaco.emitCreated(secondA.model);
    currentSelections.clear();
    const nextAuthorityA = groupAuthority(documentAuthority("/a", "/a/src/file.ts", 3), "group");
    currentSelections.add(nextAuthorityA.identity);
    editorHarness.setModel(secondA.model);
    coordinator.reconcile([registerCurrent(nextAuthorityA, "/a")]);

    const currentA = coordinator.currentHandle("surface");
    expect(currentA).not.toBeNull();
    expect(currentA).not.toBe(staleA);
    expect(currentA).not.toBe(handleB);
    expect(handleB?.currentRevision()).toBeNull();
    expect(coordinator.captureForDirtySearch(handleB!)).toEqual({
      reason: "stale",
      status: "rejected",
    });
    expect(currentA!.recordChange(secondA.edit("a2-current")).status).toBe("committed");
    const currentCapture = coordinator.captureForSave(currentA!);
    expect(currentCapture.status).toBe("captured");
    if (currentCapture.status === "captured") {
      expect(coordinator.release(currentA!, currentCapture.snapshot)).toBe(true);
    }
    expect(firstA.getValue).not.toHaveBeenCalled();
    expect(secondA.getValue).toHaveBeenCalledOnce();
  });

  it("invalidates lookup and snapshot source when any exact binding authority is lost", () => {
    const model = createModel("/workspace", "/workspace/src/current.ts", "value");
    const foreign = createModel("/workspace", "/workspace/src/foreign.ts", "foreign");
    const monaco = createMonacoHarness([model.model, foreign.model]);
    const runtime = new RecordingRuntime();
    const coordinator = new EditorLiveDocumentBindingCoordinator(runtime);
    const editorHarness = mutableEditor(model.model);
    let sessionCurrent = true;
    const authority = groupAuthority(
      documentAuthority("/workspace", "/workspace/src/current.ts"),
      "group",
    );
    const input = registration({
      authority,
      editor: editorHarness.editor,
      id: "surface",
      isCurrent: () => sessionCurrent,
      monaco: monaco.monaco,
      workspaceRoot: "/workspace",
    });
    coordinator.reconcile([input]);
    const source = runtime.registrations[0]!.source;
    expect(source.probe().status).toBe("available");

    editorHarness.setModel(foreign.model);
    expect(coordinator.currentHandle("surface")).toBeNull();
    expect(source.probe().status).toBe("unavailable");

    editorHarness.setModel(model.model);
    sessionCurrent = false;
    expect(coordinator.currentHandle("surface")).toBeNull();
    expect(source.probe().status).toBe("unavailable");
    expect(model.getValue).not.toHaveBeenCalled();
  });

  it("reports stale when a rejected closed-purpose capture rotates currentness reentrantly", () => {
    const model = createModel("/workspace", "/workspace/src/rejected.ts", "value");
    const monaco = createMonacoHarness([model.model]);
    const runtime = new RecordingRuntime();
    const coordinator = new EditorLiveDocumentBindingCoordinator(runtime);
    let current = true;
    const authority = groupAuthority(
      documentAuthority("/workspace", "/workspace/src/rejected.ts"),
      "group",
    );
    runtime.onPurposeCapture = () => {
      current = false;
      return { reason: "aborted", status: "rejected" };
    };
    coordinator.reconcile([
      registration({
        authority,
        editor: editor(model.model),
        id: "surface",
        isCurrent: () => current,
        monaco: monaco.monaco,
        workspaceRoot: "/workspace",
      }),
    ]);
    const handle = coordinator.currentHandle("surface")!;

    expect(coordinator.captureForSave(handle)).toEqual({
      reason: "stale",
      status: "rejected",
    });
    expect(handle.currentRevision()).toBeNull();
  });

  it("keeps a blocked retirement retryable and the exact snapshot source available", () => {
    const model = createModel("/workspace", "/workspace/src/retry.ts", "value");
    const monaco = createMonacoHarness([model.model]);
    const runtime = new RecordingRuntime();
    const coordinator = new EditorLiveDocumentBindingCoordinator(runtime);
    const authority = groupAuthority(
      documentAuthority("/workspace", "/workspace/src/retry.ts"),
      "group",
    );
    coordinator.reconcile([
      registration({
        authority,
        editor: editor(model.model),
        id: "surface",
        monaco: monaco.monaco,
        workspaceRoot: "/workspace",
      }),
    ]);
    const source = runtime.registrations[0]!.source;
    const handle = coordinator.currentHandle("surface");

    runtime.blockRetire = true;
    expect(coordinator.reconcile([])).toMatchObject({
      boundCount: 0,
      rejections: [{ id: "surface", reason: "retire-blocked" }],
    });
    expect(coordinator.currentHandle("surface")).toBeNull();
    expect(handle?.currentRevision()).toBeNull();
    expect(source.probe().status).toBe("available");

    runtime.blockRetire = false;
    expect(coordinator.reconcile([])).toMatchObject({ boundCount: 0, rejections: [] });
    expect(coordinator.currentHandle("surface")).toBeNull();
    expect(source.probe().status).toBe("unavailable");
  });

  it("revokes stale A snapshot access while an exact joined B binding stays live", () => {
    const model = createModel("/workspace", "/workspace/src/joined.ts", "value");
    const monaco = createMonacoHarness([model.model]);
    const runtime = new LiveDocumentRuntime();
    const coordinator = new EditorLiveDocumentBindingCoordinator(runtime);
    const lease = documentAuthority("/workspace", "/workspace/src/joined.ts");
    const authorityA = groupAuthority(lease, "group-a");
    const authorityB = groupAuthority(lease, "group-b");
    let currentA = true;
    const registrations = [
      registration({
        authority: authorityA,
        editor: editor(model.model),
        id: "surface-a",
        isCurrent: () => currentA,
        monaco: monaco.monaco,
        workspaceRoot: "/workspace",
      }),
      registration({
        authority: authorityB,
        editor: editor(model.model),
        id: "surface-b",
        monaco: monaco.monaco,
        workspaceRoot: "/workspace",
      }),
    ];
    coordinator.reconcile(registrations);
    const handleA = coordinator.currentHandle("surface-a")!;
    const handleB = coordinator.currentHandle("surface-b")!;
    const staleAListener = vi.fn();
    const unsubscribeA = coordinator.subscribe(handleA, staleAListener);
    expect(handleA.recordChange(model.edit("value-a")).status).toBe("committed");
    expect(staleAListener).toHaveBeenCalledTimes(1);
    const capturedA = coordinator.capture(handleA, new AbortController().signal);
    expect(capturedA.status).toBe("captured");

    currentA = false;
    expect(coordinator.currentHandle("surface-a")).toBeNull();
    expect(handleA.currentRevision()).toBeNull();
    expect(coordinator.capture(handleA, new AbortController().signal)).toEqual({
      reason: "stale",
      status: "rejected",
    });
    if (capturedA.status === "captured") {
      expect(coordinator.consumeCurrent(handleA, capturedA.snapshot)).toBe(false);
      expect(coordinator.release(handleA, capturedA.snapshot)).toBe(true);
    }

    const nextEvent = model.edit("value-b");
    expect(handleA.recordChange(nextEvent).status).toBe("stale");
    coordinator.reconcile([registrations[1]!]);
    expect(handleB.recordChange(nextEvent).status).toBe("committed");
    expect(staleAListener).toHaveBeenCalledTimes(1);
    unsubscribeA();
    const capturedB = coordinator.capture(handleB, new AbortController().signal);
    expect(capturedB.status).toBe("captured");
    if (capturedB.status === "captured") {
      expect(coordinator.release(handleB, capturedB.snapshot)).toBe(true);
    }
  });

  it("fails capture closed when the session validator reentrantly retires the binding", () => {
    const model = createModel("/workspace", "/workspace/src/reentrant.ts", "value");
    const monaco = createMonacoHarness([model.model]);
    const runtime = new LiveDocumentRuntime();
    const coordinator = new EditorLiveDocumentBindingCoordinator(runtime);
    const authority = groupAuthority(
      documentAuthority("/workspace", "/workspace/src/reentrant.ts"),
      "group",
    );
    let retireDuringValidation = false;
    const input = registration({
      authority,
      editor: editor(model.model),
      id: "surface",
      isCurrent: () => {
        if (retireDuringValidation) {
          retireDuringValidation = false;
          coordinator.reconcile([]);
        }
        return true;
      },
      monaco: monaco.monaco,
      workspaceRoot: "/workspace",
    });
    coordinator.reconcile([input]);
    const handle = coordinator.currentHandle("surface")!;
    expect(handle.recordChange(model.edit("changed")).status).toBe("committed");

    retireDuringValidation = true;
    expect(coordinator.capture(handle, new AbortController().signal)).toEqual({
      reason: "stale",
      status: "rejected",
    });
    expect(coordinator.currentHandle("surface")).toBeNull();
    expect(handle.currentRevision()).toBeNull();
  });

  it("revalidates and compensates when source probing blocks retirement reentrantly", () => {
    const model = createModel("/workspace", "/workspace/src/probe.ts", "value");
    const monaco = createMonacoHarness([model.model]);
    const ownedRuntime = new LiveDocumentRuntime();
    let blockRetire = true;
    const runtime = {
      capture: ownedRuntime.capture.bind(ownedRuntime),
      captureForDirtySearch: ownedRuntime.captureForDirtySearch.bind(ownedRuntime),
      captureForSave: ownedRuntime.captureForSave.bind(ownedRuntime),
      consumeCurrent: ownedRuntime.consumeCurrent.bind(ownedRuntime),
      register: ownedRuntime.register.bind(ownedRuntime),
      release: ownedRuntime.release.bind(ownedRuntime),
      retire: (handle: LiveModelSourceHandle) =>
        blockRetire ? false : ownedRuntime.retire(handle),
      subscribe: ownedRuntime.subscribe.bind(ownedRuntime),
    };
    const coordinator = new EditorLiveDocumentBindingCoordinator(runtime);
    const authority = groupAuthority(
      documentAuthority("/workspace", "/workspace/src/probe.ts"),
      "group",
    );
    coordinator.reconcile([
      registration({
        authority,
        editor: editor(model.model),
        id: "surface",
        monaco: monaco.monaco,
        workspaceRoot: "/workspace",
      }),
    ]);
    const handle = coordinator.currentHandle("surface")!;
    expect(handle.recordChange(model.edit("changed")).status).toBe("committed");
    model.onValueLengthRead(() => {
      model.onValueLengthRead(null);
      coordinator.reconcile([]);
    });

    expect(coordinator.capture(handle, new AbortController().signal)).toEqual({
      reason: "stale",
      status: "rejected",
    });
    expect(coordinator.currentHandle("surface")).toBeNull();
    blockRetire = false;
    expect(coordinator.dispose()).toBe(true);
  });
});

function registration({
  authority,
  editor: editorValue,
  id,
  isCurrent = () => true,
  monaco,
  workspaceRoot,
}: {
  readonly authority: EditorGroupDocumentSessionAuthority;
  readonly editor: Monaco.editor.IStandaloneCodeEditor;
  readonly id: string;
  readonly isCurrent?: (authority: EditorGroupDocumentSessionAuthority) => boolean;
  readonly monaco: typeof Monaco;
  readonly workspaceRoot: string | null;
}): EditorLiveDocumentBindingRegistration {
  return {
    editor: editorValue,
    id,
    isSessionAuthorityCurrent: isCurrent,
    monacoApi: monaco,
    sessionAuthority: authority,
    workspaceRoot,
  };
}

function documentAuthority(root: string, path: string, generation = 1) {
  return Object.freeze({
    generation,
    path,
    root,
  });
}

const authorityContexts = new WeakMap<
  ReturnType<typeof documentAuthority>,
  {
    readonly lifecycle: NonNullable<
      ReturnType<EditorSessionDocumentAuthoritySidecar["resolveLifecycle"]>
    >;
    readonly sidecar: EditorSessionDocumentAuthoritySidecar;
  }
>();

function groupAuthority(
  descriptor: ReturnType<typeof documentAuthority>,
  groupId: string,
): EditorGroupDocumentSessionAuthority {
  let context = authorityContexts.get(descriptor);
  if (!context) {
    const store = new DocumentSessionStore();
    const sidecar = new EditorSessionDocumentAuthoritySidecar(store);
    const relativePath = descriptor.path.slice(descriptor.root.length).replace(/^\/+/, "");
    const document = {
      content: "",
      language: "typescript",
      name: descriptor.path.split("/").pop() ?? descriptor.path,
      path: descriptor.path,
      savedContent: "",
    };
    const activated = sidecar.activateOwner(
      {
        canonicalRoot: descriptor.root,
        ownerKey: createLegacyEditorSessionOwnerKey(descriptor.root),
        rootPath: descriptor.root,
        workspaceId: descriptor.root,
      },
      (_rootPath, path) =>
        path === descriptor.path
          ? createRegisteredDocumentSaveIdentity(descriptor.root, descriptor.root, relativePath)
          : null,
      { [descriptor.path]: document },
    );
    const lifecycle = activated ? sidecar.resolveLifecycle(descriptor.path) : null;
    if (!lifecycle) throw new Error("Expected exact test document authority");
    context = { lifecycle, sidecar };
    authorityContexts.set(descriptor, context);
  }
  const authority = context.sidecar.createGroupAuthority(
    context.lifecycle,
    groupId,
    descriptor.path,
    Object.freeze({}),
  );
  if (!authority) throw new Error("Expected exact test group authority");
  return authority;
}

function editor(model: Monaco.editor.ITextModel): Monaco.editor.IStandaloneCodeEditor {
  return {
    getModel: () => model,
  } as Monaco.editor.IStandaloneCodeEditor;
}

function mutableEditor(initial: Monaco.editor.ITextModel) {
  let model = initial;
  return {
    editor: {
      getModel: () => model,
    } as Monaco.editor.IStandaloneCodeEditor,
    setModel: (next: Monaco.editor.ITextModel) => {
      model = next;
    },
  };
}

function createModel(
  workspaceRoot: string | null,
  path: string,
  content: string,
  versions: { readonly alternativeVersionId?: number; readonly modelVersionId?: number } = {},
): ModelHarness {
  let disposed = false;
  let currentContent = content;
  let alternativeVersionId = versions.alternativeVersionId ?? 1;
  let modelVersionId = versions.modelVersionId ?? 1;
  let valueLengthListener: (() => void) | null = null;
  const disposeListeners = new Set<() => void>();
  const getValue = vi.fn(() => currentContent);
  const uriString = workspaceRoot ? workspaceModelUri(workspaceRoot, path) : `file://${path}`;
  if (!uriString) throw new Error("Expected model URI");
  const model = {
    getAlternativeVersionId: () => alternativeVersionId,
    getValue,
    getValueLength: () => {
      valueLengthListener?.();
      return currentContent.length;
    },
    getVersionId: () => modelVersionId,
    isDisposed: () => disposed,
    onWillDispose: (listener: () => void) => {
      disposeListeners.add(listener);
      return { dispose: () => disposeListeners.delete(listener) };
    },
    uri: {
      fsPath: path,
      path,
      scheme: workspaceRoot ? "codevo-workspace" : "file",
      toString: () => uriString,
    },
  } as unknown as Monaco.editor.ITextModel;
  return {
    dispose: () => {
      if (disposed) return;
      disposeListeners.forEach((listener) => listener());
      disposed = true;
    },
    edit: (nextContent) => {
      const previousLength = currentContent.length;
      currentContent = nextContent;
      alternativeVersionId += 1;
      modelVersionId += 1;
      return Object.freeze({
        alternativeVersionId,
        changes: Object.freeze([
          Object.freeze({
            range: Object.freeze({
              endColumn: previousLength + 1,
              endLineNumber: 1,
              startColumn: 1,
              startLineNumber: 1,
            }),
            rangeLength: previousLength,
            rangeOffset: 0,
            text: nextContent,
          }),
        ]),
        isEolChange: false,
        isFlush: false,
        isRedoing: false,
        isUndoing: false,
        modelVersionId,
        postUtf16Length: nextContent.length,
      });
    },
    getValue,
    model,
    onValueLengthRead: (listener) => {
      valueLengthListener = listener;
    },
  };
}

function createMonacoHarness(initialModels: readonly Monaco.editor.ITextModel[]): MonacoHarness {
  const models = [...initialModels];
  const listeners = new Set<(model: Monaco.editor.ITextModel) => void>();
  const monaco = {
    editor: {
      getModels: () => [...models],
      onDidCreateModel: (listener: (model: Monaco.editor.ITextModel) => void) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    },
  } as unknown as typeof Monaco;
  return {
    emitCreated: (model) => {
      models.push(model);
      listeners.forEach((listener) => listener(model));
    },
    monaco,
  };
}
