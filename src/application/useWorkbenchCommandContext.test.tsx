// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { createEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { EditorDocument } from "../domain/workspace";
import { DocumentSessionStore } from "./documentSessionStore";
import { EditorSessionDocumentAuthoritySidecar } from "./editorSessionDocumentAuthority";
import { useWorkbenchCommandContext } from "./useWorkbenchCommandContext";

it("enables Save for live drafts without copying model text into the legacy document", () => {
  const path = "/workspace/file.txt";
  const document: EditorDocument = {
    path,
    name: "file.txt",
    language: "plaintext",
    content: "saved",
    savedContent: "saved",
  };
  const sidecar = new EditorSessionDocumentAuthoritySidecar(new DocumentSessionStore());
  expect(
    sidecar.activateOwner(
      {
        canonicalRoot: "/workspace",
        rootPath: "/workspace",
        workspaceId: "workspace",
        ownerKey: createEditorSessionOwnerKey("workspace", "/workspace"),
      },
      () => ({
        canonicalRoot: "/workspace",
        workspaceId: "workspace",
        workspaceRelativePath: "file.txt",
      }),
      { [path]: document },
    ),
  ).toBe(true);
  const lifecycle = sidecar.resolveLifecycle(path)!;
  const group = sidecar.createGroupAuthority(lifecycle, "main", path, {})!;
  const revision = (version: number, alternative = version) => ({
    alternativeVersionId: alternative,
    contentVersion: version,
    modelVersionId: version,
    mode: version === 1 ? ("retained" as const) : ("incremental" as const),
    utf16Length: 5,
  });
  const attachment = sidecar.attachEditorGroupLiveDocument(
    group,
    { captureCurrentContent: () => "saved", modelIncarnation: {}, holderIncarnation: {} },
    revision(1),
    () => true,
  )!;
  const projection = sidecar.resolveDocumentDirtyProjection(lifecycle)!;
  const host = createRoot(window.document.createElement("div"));
  let result!: ReturnType<typeof useWorkbenchCommandContext>;
  let activeDocument: EditorDocument | null = document;
  let renders = 0;
  function Harness() {
    renders += 1;
    result = useWorkbenchCommandContext({
      activeDocument,
      workspaceRoot: "/workspace",
      captureEditorSurfaceScope: () => undefined,
      resolveDocumentSessionDirtyProjection: () => projection,
    });
    return null;
  }
  act(() => host.render(<Harness />));
  expect(result.commandContext.activeDocumentDirty).toBe(false);
  act(() => {
    expect(attachment.observe(revision(2))).toBe(true);
  });
  expect(result.commandContext.activeDocumentDirty).toBe(true);
  expect(result.commandContextRef.current.activeDocumentDirty).toBe(true);
  expect(document.content).toBe("saved");
  const dirtyRenders = renders;
  act(() => {
    expect(attachment.observe(revision(3))).toBe(true);
  });
  expect(renders).toBe(dirtyRenders);
  act(() => {
    expect(attachment.observe(revision(4, 1))).toBe(true);
  });
  expect(result.commandContext.activeDocumentDirty).toBe(false);
  act(() => {
    expect(attachment.observe(revision(5))).toBe(true);
  });
  activeDocument = { ...document, readOnly: true };
  act(() => host.render(<Harness />));
  expect(result.commandContext.activeDocumentDirty).toBe(false);
  activeDocument = document;
  act(() => host.render(<Harness />));
  expect(result.commandContext.activeDocumentDirty).toBe(true);
  act(() => sidecar.deactivate());
  expect(result.commandContext.activeDocumentDirty).toBe(false);
  act(() => host.unmount());
});
