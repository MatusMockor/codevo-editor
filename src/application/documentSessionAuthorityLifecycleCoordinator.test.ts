import { describe, expect, it, vi } from "vitest";
import { createEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { EditorDocument } from "../domain/workspace";
import type { DocumentSessionOwnerInput } from "./documentSessionStorePort";
import type { ResolveDocumentSaveOwnership } from "./documentSaveIdentity";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";
import { DocumentSessionAuthorityLifecycleCoordinator } from "./documentSessionAuthorityLifecycleCoordinator";

const documentsA = { "/a/file.ts": document("/a/file.ts") };
const documentsB = { "/b/file.ts": document("/b/file.ts") };

describe("DocumentSessionAuthorityLifecycleCoordinator", () => {
  it("rotates exact A-B-A owners and forwards each restored document snapshot", () => {
    const activate = vi.fn<
      (
        input: DocumentSessionOwnerInput,
        resolveOwnership: ResolveDocumentSaveOwnership,
        documents: Readonly<Record<string, EditorDocument>>,
      ) => boolean
    >(() => true);
    const deactivate = vi.fn();
    const coordinator = new DocumentSessionAuthorityLifecycleCoordinator({ activate, deactivate });

    expect(coordinator.activate(activation(descriptor("a"), documentsA))).toBe(true);
    expect(coordinator.activate(activation(descriptor("b"), documentsB))).toBe(true);
    expect(coordinator.activate(activation(descriptor("a"), documentsA))).toBe(true);

    expect(activate.mock.calls.map(([input]) => input.ownerKey)).toEqual([
      createEditorSessionOwnerKey("workspace-a", "/a"),
      createEditorSessionOwnerKey("workspace-b", "/b"),
      createEditorSessionOwnerKey("workspace-a", "/a"),
    ]);
    expect(activate.mock.calls.map(([input]) => input.workspaceId)).toEqual([
      "workspace-a",
      "workspace-b",
      "workspace-a",
    ]);
    expect(activate.mock.calls.map(([, , documents]) => documents)).toEqual([
      documentsA,
      documentsB,
      documentsA,
    ]);
    expect(deactivate).toHaveBeenCalledTimes(3);
  });

  it("does not activate a legacy workspace without an exact descriptor", () => {
    const activate = vi.fn(() => true);
    const deactivate = vi.fn();
    const coordinator = new DocumentSessionAuthorityLifecycleCoordinator({ activate, deactivate });

    expect(
      coordinator.activate({
        ...activation(descriptor("a"), documentsA),
        descriptor: null,
        ownerKey: null,
      }),
    ).toBe(false);
    expect(activate).not.toHaveBeenCalled();
    expect(deactivate).not.toHaveBeenCalled();
  });

  it("does not tear down a current owner for a stale activation candidate", () => {
    const activate = vi.fn(() => true);
    const deactivate = vi.fn();
    const coordinator = new DocumentSessionAuthorityLifecycleCoordinator({ activate, deactivate });

    expect(
      coordinator.activate({
        ...activation(descriptor("a"), documentsA),
        isCurrent: () => false,
      }),
    ).toBe(false);
    expect(activate).not.toHaveBeenCalled();
    expect(deactivate).not.toHaveBeenCalled();
  });

  it("deactivates only an exact active-owner close commit", () => {
    const activate = vi.fn(() => true);
    const deactivate = vi.fn();
    const coordinator = new DocumentSessionAuthorityLifecycleCoordinator({ activate, deactivate });
    const ownerA = createEditorSessionOwnerKey("workspace-a", "/a");

    coordinator.deactivateActiveClose("/b", descriptor("b"), "/a", ownerA);
    coordinator.deactivateActiveClose("/a", descriptor("b"), "/a", ownerA);
    expect(deactivate).not.toHaveBeenCalled();

    coordinator.deactivateActiveClose("/a", descriptor("a"), "/a", ownerA);
    expect(deactivate).toHaveBeenCalledOnce();
  });

  it("fails closed when activation rejects, throws, or loses current ownership", () => {
    const activate = vi
      .fn<() => boolean>()
      .mockReturnValueOnce(false)
      .mockImplementationOnce(() => {
        throw new Error("activation failed");
      })
      .mockReturnValueOnce(true);
    const deactivate = vi.fn();
    const coordinator = new DocumentSessionAuthorityLifecycleCoordinator({ activate, deactivate });

    expect(coordinator.activate(activation(descriptor("a"), documentsA))).toBe(false);
    expect(coordinator.activate(activation(descriptor("a"), documentsA))).toBe(false);
    expect(
      coordinator.activate({
        ...activation(descriptor("a"), documentsA),
        isCurrent: vi
          .fn()
          .mockReturnValueOnce(true)
          .mockReturnValueOnce(true)
          .mockReturnValueOnce(false),
      }),
    ).toBe(false);
    expect(deactivate).toHaveBeenCalledTimes(6);
  });
});

function activation(
  descriptorValue: WorkspaceIdentityDescriptor,
  documents: Readonly<Record<string, EditorDocument>>,
) {
  return {
    descriptor: descriptorValue,
    documents,
    isCurrent: () => true,
    ownerKey: createEditorSessionOwnerKey(
      descriptorValue.workspaceId,
      descriptorValue.canonicalRoot,
    ),
    resolveOwnership: () => ({
      canonicalRoot: descriptorValue.canonicalRoot,
      workspaceId: descriptorValue.workspaceId,
      workspaceRelativePath: "file.ts",
    }),
    rootPath: descriptorValue.selectedPath,
  };
}

function descriptor(id: "a" | "b"): WorkspaceIdentityDescriptor {
  return {
    canonicalRoot: `/${id}`,
    caseSensitive: true,
    policy: { caseSensitive: true, unicodeNormalization: "none" },
    selectedPath: `/${id}`,
    unicodeNormalizationPolicy: "preserved",
    workspaceId: `workspace-${id}`,
  };
}

function document(path: string): EditorDocument {
  return {
    content: "const value = 1;",
    language: "typescript",
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    savedContent: "const value = 1;",
  };
}
