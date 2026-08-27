// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_WORKSPACE_PATH_POLICY } from "../../domain/workspacePath";
import type { EditorDocument } from "../../domain/workspace";
import { createWorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import type { EditorSessionDocumentLifecycleAuthority } from "../editorSessionDocumentAuthority";
import type { JavaScriptTypeScriptIncrementalLegacyClaim } from "../javaScriptTypeScriptIncrementalSyncProduction";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import { useWorkbenchChangedDocumentSyncCoordinator } from "./useWorkbenchChangedDocumentSyncCoordinator";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const PATH = `${ROOT}/server.ts`;

describe("useWorkbenchChangedDocumentSyncCoordinator", () => {
  it("rejects a pending fallback after same-path lifecycle replacement", async () => {
    const claim = deferredClaim(1);
    const harness = renderHarness(claim.value);
    const replacement = { ...harness.document, content: "replacement dirty content" };

    act(() => harness.report([PATH]));
    harness.replaceLifecycle(replacement);
    await act(async () => {
      claim.resolve(false);
      await claim.settled;
    });

    expect(harness.scheduleJavaScriptTypeScript).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("rejects a pending A1 fallback after B to A2 owner replacement", async () => {
    const claim = deferredClaim(2);
    const harness = renderHarness(claim.value);

    act(() => harness.report([PATH]));
    harness.replaceWorkspaceAuthority();
    await act(async () => {
      claim.resolve(false);
      await claim.settled;
    });

    expect(harness.scheduleJavaScriptTypeScript).not.toHaveBeenCalled();
    harness.unmount();
  });

  it.each([
    ["current root", (harness: SchedulingHarness) => harness.replaceCurrentRoot()],
    ["descriptor object", (harness: SchedulingHarness) => harness.replaceIdentityObject()],
    ["workspace ID", (harness: SchedulingHarness) => harness.replaceWorkspaceId()],
    ["canonical root", (harness: SchedulingHarness) => harness.replaceCanonicalRoot()],
    ["selected path", (harness: SchedulingHarness) => harness.replaceSelectedPath()],
    ["runtime owner object", (harness: SchedulingHarness) => harness.replaceOwnerObject()],
    ["runtime owner key", (harness: SchedulingHarness) => harness.replaceOwnerKey()],
    ["runtime execution root", (harness: SchedulingHarness) => harness.replaceExecutionRoot()],
    ["claim generation", (harness: SchedulingHarness) => harness.replaceOwnerGeneration()],
  ])("rejects a pending fallback when only the captured %s changes", async (_, mutate) => {
    const claim = deferredClaim(3);
    const harness = renderHarness(claim.value);

    act(() => harness.report([PATH]));
    mutate(harness);
    await act(async () => {
      claim.resolve(false);
      await claim.settled;
    });

    expect(harness.scheduleJavaScriptTypeScript).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("admits a fallback for a restored selected-path alias with a distinct canonical root", async () => {
    const claim = deferredClaim(4);
    const harness = renderHarness(claim.value, {
      canonicalRoot: "/canonical/restored",
      selectedRoot: "/selected/restored",
    });

    act(() => harness.report([harness.document.path]));
    await act(async () => {
      claim.resolve(false);
      await claim.settled;
    });

    expect(harness.scheduleJavaScriptTypeScript).toHaveBeenCalledExactlyOnceWith(harness.document);
    harness.unmount();
  });
});

type SchedulingHarness = ReturnType<typeof renderHarness>;

function renderHarness(
  claim: JavaScriptTypeScriptIncrementalLegacyClaim,
  paths: { readonly canonicalRoot: string; readonly selectedRoot: string } = {
    canonicalRoot: ROOT,
    selectedRoot: ROOT,
  },
) {
  const documentPath = `${paths.selectedRoot}/server.ts`;
  const document: EditorDocument = {
    content: "dirty content",
    language: "typescript",
    name: "server.ts",
    path: documentPath,
    savedContent: "saved content",
  };
  const documentsRef = { current: { [documentPath]: document } };
  const currentWorkspaceRootRef = { current: paths.selectedRoot as string | null };
  const workspaceIdentity = identity("workspace-a", paths.selectedRoot, paths.canonicalRoot);
  const workspaceIdentityDescriptorRef = {
    current: workspaceIdentity as WorkspaceIdentityDescriptor | null,
  };
  const initialOwner = createWorkspaceRuntimeOwner("workspace-a", paths.selectedRoot);
  const workspaceRuntimeOwner = {
    executionRoot: initialOwner.executionRoot,
    ownerKey: initialOwner.ownerKey,
  };
  const workspaceRuntimeOwnerRef = {
    current: workspaceRuntimeOwner,
  };
  let ownerGeneration = 1;
  let lifecycle: EditorSessionDocumentLifecycleAuthority = { identity: {} };
  let listener: ((paths: readonly string[]) => void) | null = null;
  const scheduleJavaScriptTypeScript = vi.fn<(value: EditorDocument) => void>();
  const root = createRoot(globalThis.document.createElement("div"));

  function Probe() {
    useWorkbenchChangedDocumentSyncCoordinator({
      currentWorkspaceRootRef,
      documentsRef,
      incrementalSyncRef: {
        current: { claimLegacyChange: () => claim },
      },
      isDocumentSessionLifecycleAuthorityCurrent: (candidate) => candidate === lifecycle,
      resolveDocumentSessionLifecycleAuthority: () => lifecycle,
      scheduleDocumentChange: vi.fn(),
      scheduleJavaScriptTypeScriptDocumentChange: scheduleJavaScriptTypeScript,
      subscribeChangedDocuments: (nextListener) => {
        listener = nextListener;
        return () => {
          listener = null;
        };
      },
      workspaceIdentityDescriptorRef,
      workspaceRuntimeOwnerClaimsRef: {
        current: { generationFor: () => ownerGeneration },
      },
      workspaceRuntimeOwnerRef,
    });
    return null;
  }

  act(() => root.render(<Probe />));
  return {
    document,
    report: (paths: readonly string[]) => {
      if (!listener) throw new Error("Changed-document listener is not mounted");
      listener(paths);
    },
    replaceLifecycle: (replacement: EditorDocument) => {
      lifecycle = { identity: {} };
      documentsRef.current = { [documentPath]: replacement };
    },
    replaceCanonicalRoot: () => {
      workspaceIdentity.canonicalRoot = "/canonical-replacement";
    },
    replaceCurrentRoot: () => {
      currentWorkspaceRootRef.current = "/workspace-b";
    },
    replaceExecutionRoot: () => {
      workspaceRuntimeOwner.executionRoot = "/execution-replacement";
    },
    replaceIdentityObject: () => {
      workspaceIdentityDescriptorRef.current = { ...workspaceIdentity };
    },
    replaceOwnerGeneration: () => {
      ownerGeneration = 2;
    },
    replaceOwnerKey: () => {
      workspaceRuntimeOwner.ownerKey = createWorkspaceRuntimeOwner("workspace-b", ROOT).ownerKey;
    },
    replaceOwnerObject: () => {
      workspaceRuntimeOwnerRef.current = { ...workspaceRuntimeOwner };
    },
    replaceSelectedPath: () => {
      workspaceIdentity.selectedPath = "/selected-replacement";
    },
    replaceWorkspaceAuthority: () => {
      workspaceRuntimeOwnerRef.current = createWorkspaceRuntimeOwner("workspace-b", ROOT);
      workspaceIdentityDescriptorRef.current = identity("workspace-b");
      ownerGeneration = 1;
      workspaceRuntimeOwnerRef.current = createWorkspaceRuntimeOwner("workspace-a", ROOT);
      workspaceIdentityDescriptorRef.current = identity("workspace-a");
      ownerGeneration = 2;
    },
    replaceWorkspaceId: () => {
      workspaceIdentity.workspaceId = "workspace-b";
    },
    scheduleJavaScriptTypeScript,
    unmount: () => act(() => root.unmount()),
  };
}

function identity(
  workspaceId: string,
  selectedPath: string = ROOT,
  canonicalRoot: string = selectedPath,
): WorkspaceIdentityDescriptor {
  return {
    canonicalRoot,
    caseSensitive: true,
    policy: DEFAULT_WORKSPACE_PATH_POLICY,
    selectedPath,
    unicodeNormalizationPolicy: "preserved",
    workspaceId,
  };
}

function deferredClaim(revision: number) {
  let settle!: (value: boolean) => void;
  const settled = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  return {
    resolve: settle,
    settled,
    value: Object.freeze({
      revision,
      suppressLegacy: () => settled,
    }),
  };
}
