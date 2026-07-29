import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("App live-document binding wiring", () => {
  it("keeps raw live-document capabilities outside the React composition root", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    expect(source).toContain('from "./application/editorActiveLiveDocumentBinding"');
    expect(source).toContain("useEditorActiveLiveDocumentChangeHunksController({");
    expect(source).toContain("activeDocument: workbench.activeDocument");
    expect(source).toContain("activeGroupId: editorGroupsState.activeGroupId");
    expect(source).toContain(
      "exactBindingRequired: workbench.workspaceIdentityDescriptor !== null",
    );
    expect(source).toContain(
      "legacyBaselineContent: workbench.activeDocumentGitBaseline ?? activeDocumentSavedContent",
    );
    expect(source).toContain("legacyOwnerKey: editorSessionOwnerKey");
    expect(source).not.toContain("appEditorChangeHunksInput");
    expect(source).not.toContain("useOwnedEditorChangeHunks");
    expect(source).not.toContain("activeLiveDocumentBinding.handle");
    expect(source).not.toContain("activeLiveDocumentBinding.snapshots");
    expect(source).not.toContain("activeLiveDocumentBinding.createBaseline");
    expect(source).not.toContain("useState<EditorActiveLiveDocumentBinding");
    expect(source).not.toContain("binding: activeLiveDocumentBinding");
    expect(source).not.toContain("activeEditorChangeHunks.slice()");
    expect(source).toContain("groupIsActive ? activeEditorChangeHunks : EMPTY_EDITOR_CHANGE_HUNKS");
  });

  it("forwards active-group lifecycle wiring and the presenter-owned authority revision", () => {
    const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const presenterSource = readFileSync(
      new URL("./components/workbenchEditorHostPresenter.ts", import.meta.url),
      "utf8",
    );

    expect(appSource).toContain("activeGroupId: editorGroupsState.activeGroupId");
    expect(appSource).toContain("onActiveLiveDocumentBindingChange,");
    expect(appSource).toContain("liveDocumentRuntime,");
    expect(presenterSource).toContain(
      "documentSessionAuthorityRevision: editorHost.documentSessionAuthorityRevision",
    );
  });
});
