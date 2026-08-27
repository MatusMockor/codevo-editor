// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialEditorGroupsState } from "../../domain/editorGroups";
import {
  createEditorSessionOwnerKey,
  createLegacyEditorSessionOwnerKey,
} from "../../domain/editorSessionOwnerKey";
import { DEFAULT_WORKSPACE_PATH_POLICY } from "../../domain/workspacePath";
import {
  createLegacyWorkspaceRuntimeOwner,
  createWorkspaceRuntimeOwner,
} from "../../domain/workspaceRuntimeOwner";
import type { EditorDocument } from "../../domain/workspace";
import { createRegisteredDocumentSaveIdentity } from "../documentSaveIdentity";
import { useEditorSessionState, type EditorSessionState } from "../useEditorSessionState";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import {
  captureWorkbenchDocumentLifecycleCurrent,
  captureWorkbenchEditorDocumentAuthority,
  captureWorkbenchFallbackNavigationScope,
  captureStableLegacyActiveDocumentCurrent,
  isWorkbenchFallbackNavigationScopeCurrent,
} from "./useWorkbenchEditorDocumentCoordinator";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const PATH = "/workspace/src/Subject.php";

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function document(content: string): EditorDocument {
  return {
    content,
    language: "php",
    name: "Subject.php",
    path: PATH,
    savedContent: content,
  };
}

function identity(workspaceId: string): WorkspaceIdentityDescriptor {
  return {
    admissionToken: 1,
    canonicalRoot: ROOT,
    caseSensitive: true,
    policy: DEFAULT_WORKSPACE_PATH_POLICY,
    selectedPath: ROOT,
    unicodeNormalizationPolicy: "preserved",
    workspaceId,
  };
}

function renderSession(): { readonly root: Root; session(): EditorSessionState } {
  const container = globalThis.document.createElement("div");
  const root = createRoot(container);
  const captured: { current: EditorSessionState | null } = { current: null };
  function Probe() {
    captured.current = useEditorSessionState();
    return null;
  }
  act(() => root.render(<Probe />));
  return {
    root,
    session: () => {
      if (!captured.current) {
        throw new Error("Editor session unavailable.");
      }
      return captured.current;
    },
  };
}

function activate(
  session: EditorSessionState,
  workspaceId: string,
  currentDocument: EditorDocument,
): void {
  const owner = {
    canonicalRoot: ROOT,
    ownerKey: createEditorSessionOwnerKey(workspaceId, ROOT),
    rootPath: ROOT,
    workspaceId,
  };
  const resolveIdentity = (rootPath: string, path: string) => {
    if (rootPath !== ROOT || path !== PATH) {
      return null;
    }
    return createRegisteredDocumentSaveIdentity(workspaceId, ROOT, "src/Subject.php");
  };
  expect(
    session.activateDocumentSessionAuthority(owner, resolveIdentity, {
      [PATH]: currentDocument,
    }),
  ).toBe(true);
  session.setDocuments({ [PATH]: currentDocument });
  session.updateEditorGroups(() =>
    createInitialEditorGroupsState("editor-main", {
      activePath: PATH,
      openPaths: [PATH],
      previewPath: null,
    }),
  );
}

describe("Workbench editor document authority", () => {
  let mountedRoot: Root | null = null;

  afterEach(() => {
    if (!mountedRoot) {
      return;
    }
    act(() => mountedRoot?.unmount());
    mountedRoot = null;
  });

  it("suppresses stale A1 publications and admits fresh A2 after A-B-A replacement", async () => {
    const harness = renderSession();
    mountedRoot = harness.root;
    const identityRef = { current: identity("workspace-a") };
    const ownerRef = { current: createWorkspaceRuntimeOwner("workspace-a", ROOT) };
    const rootRef = { current: ROOT as string | null };
    const generations = new Map<string, number>([["workspace-a", 1]]);
    const firstDocument = document("<?php class Subject {}");
    act(() => activate(harness.session(), "workspace-a", firstDocument));
    const dependencies = {
      activeDocumentRef: harness.session().activeDocumentRef,
      currentWorkspaceRootRef: rootRef,
      isDocumentSessionLifecycleAuthorityCurrent:
        harness.session().isDocumentSessionLifecycleAuthorityCurrent,
      isEditorGroupDocumentSessionAuthorityCurrent:
        harness.session().isEditorGroupDocumentSessionAuthorityCurrent,
      resolveActiveDocumentSessionAuthority:
        harness.session().resolveActiveDocumentSessionAuthority,
      resolveDocumentSessionLifecycleAuthority:
        harness.session().resolveDocumentSessionLifecycleAuthority,
      workspaceIdentityDescriptorRef: identityRef,
      workspaceRuntimeOwnerClaimsRef: {
        current: { generationFor: (ownerKey: string) => generations.get(ownerKey) ?? null },
      },
      workspaceRuntimeOwnerRef: ownerRef,
    };
    const firstAuthority = captureWorkbenchEditorDocumentAuthority(
      dependencies,
      ROOT,
      firstDocument,
    );
    expect(firstAuthority).not.toBeNull();
    expect(captureWorkbenchEditorDocumentAuthority(dependencies, ROOT, firstDocument)).toBe(
      firstAuthority,
    );
    const foreignContext = {
      ...dependencies,
      currentWorkspaceRootRef: { current: "/foreign" as string | null },
    };
    const foreignAuthority = captureWorkbenchEditorDocumentAuthority(
      foreignContext,
      ROOT,
      firstDocument,
    );
    expect(foreignAuthority).not.toBe(firstAuthority);
    expect(foreignAuthority?.isCurrent()).toBe(false);
    expect(firstAuthority?.isCurrent()).toBe(true);
    const gate = deferred<void>();
    const write = vi.fn();
    const open = vi.fn();
    const message = vi.fn();
    const pending = gate.promise.then(() => {
      if (!firstAuthority?.isCurrent()) {
        return;
      }
      write();
      open();
      message();
    });

    act(() => {
      harness.session().setDocuments({
        [PATH]: document("<?php class SubjectChangedInPlace {}"),
      });
    });
    expect(firstAuthority?.isCurrent()).toBe(false);

    act(() => {
      harness.session().deactivateDocumentSessionAuthority();
      identityRef.current = identity("workspace-b");
      ownerRef.current = createWorkspaceRuntimeOwner("workspace-b", "/workspace-b");
      rootRef.current = "/workspace-b";
      generations.set("workspace-b", 2);
      identityRef.current = identity("workspace-a");
      ownerRef.current = createWorkspaceRuntimeOwner("workspace-a", ROOT);
      rootRef.current = ROOT;
      generations.set("workspace-a", 3);
      activate(harness.session(), "workspace-a", document("<?php class SubjectA2 {}"));
    });
    gate.resolve();
    await pending;

    expect(firstAuthority?.isCurrent()).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();

    const freshDocument = harness.session().activeDocumentRef.current;
    const freshAuthority = captureWorkbenchEditorDocumentAuthority(
      dependencies,
      ROOT,
      freshDocument,
    );
    expect(freshAuthority?.isCurrent()).toBe(true);
    if (freshAuthority?.isCurrent()) {
      write();
      open();
      message();
    }
    expect(write).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
    expect(message).toHaveBeenCalledOnce();
  });

  it("rejects a normalized legacy-looking owner with a registered claim generation", () => {
    const currentDocument = document("<?php class Subject {}");
    const write = vi.fn();
    const open = vi.fn();
    const message = vi.fn();
    const owner = createLegacyWorkspaceRuntimeOwner(ROOT);
    const current = captureWorkbenchDocumentLifecycleCurrent(
      {
        activeDocumentRef: { current: currentDocument },
        currentWorkspaceRootRef: { current: ROOT },
        isDocumentSessionLifecycleAuthorityCurrent: () => true,
        isEditorGroupDocumentSessionAuthorityCurrent: () => true,
        resolveActiveDocumentSessionAuthority: () => null,
        resolveDocumentSessionLifecycleAuthority: () => null,
        workspaceIdentityDescriptorRef: { current: null },
        workspaceRuntimeOwnerClaimsRef: {
          current: { generationFor: () => 7 },
        },
        workspaceRuntimeOwnerRef: { current: owner },
      },
      ROOT,
      currentDocument,
      () => true,
    );
    if (current?.()) {
      write();
      open();
      message();
    }
    expect(current).toBeNull();
    expect(write).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
  });

  it("retains the legacy lifecycle predicate while its exact inputs remain unchanged", () => {
    const currentDocument = document("<?php class Subject {}");
    const owner = createLegacyWorkspaceRuntimeOwner(ROOT);
    const identityRef = { current: null as WorkspaceIdentityDescriptor | null };
    const dependencies = {
      activeDocumentRef: { current: currentDocument },
      currentWorkspaceRootRef: { current: ROOT as string | null },
      isDocumentSessionLifecycleAuthorityCurrent: () => true,
      isEditorGroupDocumentSessionAuthorityCurrent: () => true,
      resolveActiveDocumentSessionAuthority: () => null,
      resolveDocumentSessionLifecycleAuthority: () => null,
      workspaceIdentityDescriptorRef: identityRef,
      workspaceRuntimeOwnerClaimsRef: {
        current: { generationFor: () => null },
      },
      workspaceRuntimeOwnerRef: { current: owner },
    };
    const first = captureStableLegacyActiveDocumentCurrent(dependencies, ROOT, currentDocument);
    const second = captureStableLegacyActiveDocumentCurrent(dependencies, ROOT, currentDocument);
    expect(second).toBe(first);
    expect(first?.()).toBe(true);
    expect(second?.()).toBe(true);
    identityRef.current = identity("workspace-a");
    const registeredPartial = captureStableLegacyActiveDocumentCurrent(
      dependencies,
      ROOT,
      currentDocument,
    );
    expect(registeredPartial).toBeNull();
  });

  it("admits exact legacy navigation and rejects same-path replacement and partial identity", () => {
    const firstDocument = document("<?php class SubjectA1 {}");
    const activeDocumentRef = { current: firstDocument as EditorDocument | null };
    const identityRef = { current: null as WorkspaceIdentityDescriptor | null };
    const rootRef = { current: ROOT as string | null };
    let legacyGeneration: number | null = null;
    const authority = {
      activeDocumentRef,
      currentWorkspaceRootRef: rootRef,
      isDocumentSessionLifecycleAuthorityCurrent: () => true,
      isEditorGroupDocumentSessionAuthorityCurrent: () => true,
      resolveActiveDocumentSessionAuthority: () => null,
      resolveDocumentSessionLifecycleAuthority: () => null,
      workspaceIdentityDescriptorRef: identityRef,
      workspaceRuntimeOwnerClaimsRef: {
        current: { generationFor: () => legacyGeneration },
      },
      workspaceRuntimeOwnerRef: { current: createLegacyWorkspaceRuntimeOwner(ROOT) },
    };
    const navigationScope = {
      activeDocumentRef,
      activeGroupId: "editor-main",
      activePath: PATH,
      currentEditorSessionOwnerKeyRef: {
        current: createLegacyEditorSessionOwnerKey(ROOT),
      },
      editorSessionOwnerKey: createLegacyEditorSessionOwnerKey(ROOT),
      editorSurfaceCommandRunner: null,
    };
    const surface = {};
    const firstScope = captureWorkbenchFallbackNavigationScope(authority, navigationScope, surface);
    expect(
      isWorkbenchFallbackNavigationScopeCurrent(authority, navigationScope, surface, firstScope),
    ).toBe(true);

    activeDocumentRef.current = document("<?php class SubjectB {}");
    expect(
      isWorkbenchFallbackNavigationScopeCurrent(authority, navigationScope, surface, firstScope),
    ).toBe(false);
    activeDocumentRef.current = firstDocument;
    identityRef.current = identity("workspace-a");
    const partialScope = captureWorkbenchFallbackNavigationScope(
      authority,
      navigationScope,
      surface,
    );
    expect(
      isWorkbenchFallbackNavigationScopeCurrent(authority, navigationScope, surface, partialScope),
    ).toBeNull();
    identityRef.current = null;
    legacyGeneration = 7;
    const claimedLegacyScope = captureWorkbenchFallbackNavigationScope(
      authority,
      navigationScope,
      surface,
    );
    expect(
      isWorkbenchFallbackNavigationScopeCurrent(
        authority,
        navigationScope,
        surface,
        claimedLegacyScope,
      ),
    ).toBeNull();
  });
});
