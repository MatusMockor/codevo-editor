// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocumentSaveIdentity } from "../../application/documentSaveIdentity";
import { DocumentSessionStore } from "../../application/documentSessionStore";
import { createEditorOwnerDirtyCountProjection } from "../../application/editorSessionDirtyProjection";
import { createWorkspaceEditorSessionOwnerKey } from "../../domain/editorSessionOwnerKey";
import { initialIndexProgress } from "../../domain/indexProgress";
import { defaultAppSettings, defaultWorkspaceSettings } from "../../domain/settings";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import type { EditorChrome } from "./EditorChromeContext";
import {
  useWorkbenchEditorChrome,
  type EditorChromeWorkbench,
  type WorkbenchEditorChromeOptions,
} from "./useWorkbenchEditorChrome";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const results: EditorChrome[] = [];
let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  results.length = 0;
});

function Probe({
  options,
  workbench,
}: {
  readonly workbench: EditorChromeWorkbench;
  readonly options: WorkbenchEditorChromeOptions;
}) {
  results.push(useWorkbenchEditorChrome(workbench, options));
  return null;
}

function fakeWorkbench(overrides: Partial<EditorChromeWorkbench> = {}): EditorChromeWorkbench {
  const workbench = {
    activeDocument: null,
    activeFrameworkActivityLabel: null,
    indexProgress: initialIndexProgress(),
    javaScriptTypeScriptLanguageServerRuntimeStatus: null,
    languageServerPlan: null,
    languageServerRuntimeStatus: null,
    phpTools: null,
    workspaceDescriptor: null,
    agentWorkbench: { dispatch: vi.fn() },
    appSettings: defaultAppSettings(),
    bottomPanelView: "problems",
    bottomPanelVisible: false,
    diagnosticsSummary: { errors: 1, warnings: 2 },
    dirtyCount: 0,
    documentSessionAuthorityRevision: { ownerDirtyCountProjection: null },
    gitBranch: null,
    gitBranchRepositoryLabel: null,
    gitStatus: { branch: "main" },
    hideBottomPanel: vi.fn(),
    intelligenceMode: "fullSmart",
    openGitBranchPanel: vi.fn(),
    runCommand: vi.fn(),
    showBottomPanelView: vi.fn(),
    workspaceRoot: "/w",
    workspaceSettings: defaultWorkspaceSettings(),
    workspaceTrust: { trusted: false },
    ...overrides,
  };
  return workbench as unknown as EditorChromeWorkbench;
}

function options(overrides: Partial<WorkbenchEditorChromeOptions> = {}) {
  return {
    activeGroupId: "editor-main",
    largeDocumentStatus: null,
    cursorStore: null,
    cursorAuthority: null,
    showGoToLine: vi.fn(),
    markActiveFileReveal: vi.fn(),
    ...overrides,
  } satisfies WorkbenchEditorChromeOptions;
}

function render(workbench: EditorChromeWorkbench, value: WorkbenchEditorChromeOptions) {
  mounted ??= mountUi();
  mounted.render(<Probe options={value} workbench={workbench} />);
  return results[results.length - 1];
}

describe("useWorkbenchEditorChrome", () => {
  it("reads the workbench readouts and keymap shortcuts", () => {
    const chrome = render(fakeWorkbench(), options());

    expect(chrome?.diagnostics).toEqual({ errors: 1, warnings: 2 });
    expect(chrome?.trustNeeded).toBe(true);
    expect(chrome?.statusRows.find((row) => row.id === "branch")?.value).toBe("main");
    expect(chrome?.statusRows.find((row) => row.id === "trust")?.value).toBe("Untrusted");
    expect(chrome?.shortcuts.problems).not.toBe("");
    expect(chrome?.shortcuts.split).not.toBe("");
  });

  it("derives the language and trust from the workbench", () => {
    const chrome = render(
      fakeWorkbench({
        activeDocument: {
          content: "",
          language: "TypeScript",
          name: "a.ts",
          path: "/w/a.ts",
          savedContent: "",
        },
        workspaceTrust: { trusted: true } as EditorChromeWorkbench["workspaceTrust"],
      }),
      options(),
    );

    expect(chrome?.trustNeeded).toBe(false);
    expect(chrome?.statusRows.find((row) => row.id === "language")?.value).toBe("TypeScript");
    expect(chrome?.statusRows.find((row) => row.id === "trust")?.value).toBe("Trusted");
  });

  it("reveals the active file in the Files surface", () => {
    const workbench = fakeWorkbench();
    const value = options();
    render(workbench, value)?.revealInFiles();

    expect(workbench.agentWorkbench.dispatch).toHaveBeenCalledWith({
      kind: "openSurface",
      surface: "files",
    });
    expect(value.markActiveFileReveal).toHaveBeenCalledTimes(1);
  });

  it("routes mode and trust commands", () => {
    const workbench = fakeWorkbench();
    const chrome = render(workbench, options());
    chrome?.toggleIdeMode();
    chrome?.trustWorkspace();

    expect(workbench.runCommand).toHaveBeenCalledWith("smart.toggle");
    expect(workbench.runCommand).toHaveBeenCalledWith("workspace.trust");
  });

  it("stays stable across renders with rebuilt workbench objects", () => {
    const first = render(fakeWorkbench(), options());
    const second = render(fakeWorkbench(), options());

    expect(second).toBe(first);
  });

  it("joins the branch with its repository label and opens the branch picker", () => {
    const workbench = fakeWorkbench({ gitBranch: "feat/x", gitBranchRepositoryLabel: "api" });
    const chrome = render(workbench, options());
    chrome?.openBranches();

    expect(chrome?.statusRows.find((row) => row.id === "branch")?.value).toBe("feat/x · api");
    expect(workbench.openGitBranchPanel).toHaveBeenCalledTimes(1);
  });

  it("merges the live owner dirty count with the legacy count", async () => {
    const store = new DocumentSessionStore();
    const owner = store.activateOwner({
      canonicalRoot: "/workspace",
      ownerKey: createWorkspaceEditorSessionOwnerKey("/workspace"),
      rootPath: "/workspace",
      workspaceId: "/workspace",
    });
    expect(owner.status).toBe("activated");
    const ownerLease = owner.status === "activated" ? owner.lease : null;
    const identity = createDocumentSaveIdentity("/workspace", "src/a.ts");
    expect(identity).not.toBeNull();
    const opened =
      ownerLease === null || identity === null
        ? null
        : store.open(ownerLease, {
            document: {
              content: "saved",
              language: "typescript",
              name: "a.ts",
              path: "/workspace/src/a.ts",
              savedContent: "saved",
            },
            identity,
          });
    expect(opened?.status).toBe("opened");
    const documentLease = opened?.status === "opened" ? opened.lease : null;
    const projection =
      ownerLease === null ? null : createEditorOwnerDirtyCountProjection(store, ownerLease);
    const unsaved = (legacyDirtyCount: number) =>
      render(
        fakeWorkbench({
          dirtyCount: legacyDirtyCount,
          documentSessionAuthorityRevision: {
            ownerDirtyCountProjection: projection,
          } as EditorChromeWorkbench["documentSessionAuthorityRevision"],
        }),
        options(),
      )?.statusRows.find((row) => row.id === "unsaved")?.value;

    expect(unsaved(0)).toBeUndefined();
    expect(unsaved(1)).toBe("1 file");
    expect(unsaved(0)).toBeUndefined();
    await act(async () => {
      const capture = documentLease === null ? null : store.capture(documentLease);
      expect(capture).not.toBeNull();
      if (capture !== null && capture !== undefined) store.edit(capture, "dirty");
    });
    expect(results[results.length - 1]?.statusRows.find((row) => row.id === "unsaved")?.value).toBe(
      "1 file",
    );
    await act(async () => {
      if (ownerLease !== null) store.deactivateOwner(ownerLease);
    });
    expect(unsaved(0)).toBeUndefined();
    expect(unsaved(7)).toBe("7 files");
  });
});
