// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { CallHierarchyRow } from "../domain/callHierarchy";
import type { LanguageServerFeaturesGateway } from "../domain/languageServerFeatures";
import type { ReferenceRow } from "../domain/referencesView";
import type { TypeHierarchyRow } from "../domain/typeHierarchy";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { emptyLanguageServerCapabilities } from "../domain/languageServerRuntime";
import type { EditorDocument } from "../domain/workspace";
import {
  createWorkspaceRuntimeOwner,
  transferWorkspaceRuntimeOwner,
  type WorkspaceRuntimeOwner,
} from "../domain/workspaceRuntimeOwner";
import {
  useWorkbenchSymbolPanels,
  type WorkbenchSymbolPanels,
  type WorkbenchSymbolPanelsDependencies,
} from "./useWorkbenchSymbolPanels";

const ROOT = "/workspace";

function renderPanels(
  overrides: Partial<WorkbenchSymbolPanelsDependencies> = {},
) {
  const owner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
  const openNavigationTarget = vi.fn(async () => true);
  const deps: WorkbenchSymbolPanelsDependencies = {
    activeDocumentRef: { current: null },
    activeEditorPositionRef: { current: null },
    closeCompetingSurfaces: vi.fn(),
    requestLanguageServerDocumentLease: vi.fn(async (rootPath, path) => ({
      lifecycleIdentity: 1,
      path,
      rootPath,
      sessionId: 7,
      syncGeneration: 0,
    })),
    isLanguageServerDocumentRequestLeaseCurrent: vi.fn(() => true),
    flushPendingJavaScriptTypeScriptDocumentChange: vi.fn(
      async () => undefined,
    ),
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: vi.fn(
      () => true,
    ),
    isLanguageServerSessionActiveForRoot: vi.fn(() => true),
    javaScriptTypeScriptLanguageServerFeaturesGateway: {} as WorkbenchSymbolPanelsDependencies["javaScriptTypeScriptLanguageServerFeaturesGateway"],
    javaScriptTypeScriptLanguageServerRuntimeStatus: null,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot: null,
    languageServerFeaturesGateway: {} as WorkbenchSymbolPanelsDependencies["languageServerFeaturesGateway"],
    languageServerRuntimeStatus: null,
    languageServerRuntimeStatusRoot: null,
    openNavigationTarget,
    reportError: vi.fn(),
    resolveCurrentWorkspaceRuntimeOwner: () => owner,
    setMessage: vi.fn(),
    shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly: vi.fn(() => false),
    workspaceRoot: ROOT,
    ...overrides,
  };
  let api: WorkbenchSymbolPanels | null = null;
  const root = createRoot(document.createElement("div"));

  function Harness() {
    api = useWorkbenchSymbolPanels(deps);
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return {
    api: () => api as WorkbenchSymbolPanels,
    deps,
    openNavigationTarget,
    root,
  };
}

function range() {
  return {
    end: { character: 8, line: 3 },
    start: { character: 2, line: 3 },
  };
}

function callRow(path: string): CallHierarchyRow {
  return {
    detail: path,
    direction: "incoming",
    id: path,
    item: {
      detail: path,
      kind: 6,
      name: "run",
      range: range(),
      selectionRange: range(),
      uri: `file://${path}`,
    },
    kindLabel: "method",
    label: "run",
    range: range(),
  };
}

function typeRow(path: string): TypeHierarchyRow {
  return {
    detail: path,
    direction: "supertype",
    id: path,
    item: {
      detail: path,
      kind: 5,
      name: "Service",
      range: range(),
      selectionRange: range(),
      uri: `file://${path}`,
    },
    kindLabel: "class",
    label: "Service",
    range: range(),
  };
}

function referenceRow(path: string): ReferenceRow {
  return {
    column: 3,
    id: path,
    line: 4,
    location: { range: range(), uri: `file://${path}` },
    path,
    relativePath: path,
  };
}

describe("useWorkbenchSymbolPanels PHP target delegation", () => {
  it.each([
    ["call hierarchy", (api: WorkbenchSymbolPanels, path: string) => api.openCallHierarchyRow(callRow(path))],
    ["type hierarchy", (api: WorkbenchSymbolPanels, path: string) => api.openTypeHierarchyRow(typeRow(path))],
    ["references", (api: WorkbenchSymbolPanels, path: string) => api.openReferenceRow(referenceRow(path))],
  ])("delegates PHP vendor %s targets to the open boundary", async (_label, openRow) => {
    const harness = renderPanels();
    const path = `${ROOT}/vendor/acme/package/src/Service.php`;

    await act(async () => {
      await openRow(harness.api(), path);
    });

    expect(harness.openNavigationTarget).toHaveBeenCalledWith(
      path,
      { column: 3, lineNumber: 4 },
      expect.any(String),
      expect.objectContaining({
        readOnly: false,
        shouldCommit: expect.any(Function),
      }),
    );

    harness.root.unmount();
  });

  it("keeps an in-app PHP reference editable", async () => {
    const harness = renderPanels();
    const path = `${ROOT}/app/Services/Service.php`;

    await act(async () => {
      await harness.api().openReferenceRow(referenceRow(path));
    });

    expect(harness.openNavigationTarget).toHaveBeenCalledWith(
      path,
      { column: 3, lineNumber: 4 },
      "reference",
      expect.objectContaining({
        readOnly: false,
        shouldCommit: expect.any(Function),
      }),
    );

    harness.root.unmount();
  });
});

function panelDocument(language: "php" | "typescript"): EditorDocument {
  const source = language === "php" ? "<?php service();" : "service();";

  return {
    content: source,
    language,
    name: language === "php" ? "Source.php" : "source.ts",
    path: `${ROOT}/src/${language === "php" ? "Source.php" : "source.ts"}`,
    savedContent: source,
  };
}

function runningStatus(capability: "references" = "references"): LanguageServerRuntimeStatus {
  return {
    capabilities: {
      ...emptyLanguageServerCapabilities(),
      [capability]: true,
    },
    kind: "running",
    rootPath: ROOT,
    sessionId: 7,
  };
}

describe("useWorkbenchSymbolPanels PHP document lease", () => {
  it("requests the lease with the captured root before calling phpactor", async () => {
    const document = panelDocument("php");
    const requestLease = vi.fn(async (rootPath: string, path: string) => ({
      lifecycleIdentity: 1,
      path,
      rootPath,
      sessionId: 7,
      syncGeneration: 0,
    }));
    const gateway = {
      references: vi.fn(async () => []),
    } as unknown as LanguageServerFeaturesGateway;
    const harness = renderPanels({
      activeDocumentRef: { current: document },
      activeEditorPositionRef: { current: { column: 2, lineNumber: 1 } },
      languageServerFeaturesGateway: gateway,
      languageServerRuntimeStatus: runningStatus(),
      languageServerRuntimeStatusRoot: ROOT,
      requestLanguageServerDocumentLease: requestLease,
    });

    await act(async () => {
      await harness.api().openReferencesPanel();
    });

    expect(requestLease).toHaveBeenCalledWith(ROOT, document.path);
    expect(gateway.references).toHaveBeenCalledTimes(1);

    harness.root.unmount();
  });

  it("does not call phpactor after the document lease becomes invalid", async () => {
    const gateway = {
      references: vi.fn(async () => []),
    } as unknown as LanguageServerFeaturesGateway;
    const harness = renderPanels({
      activeDocumentRef: { current: panelDocument("php") },
      activeEditorPositionRef: { current: { column: 2, lineNumber: 1 } },
      isLanguageServerDocumentRequestLeaseCurrent: vi.fn(() => false),
      languageServerFeaturesGateway: gateway,
      languageServerRuntimeStatus: runningStatus(),
      languageServerRuntimeStatusRoot: ROOT,
    });

    await act(async () => {
      await harness.api().openReferencesPanel();
    });

    expect(gateway.references).not.toHaveBeenCalled();
    expect(harness.api().referencesView).toBeNull();

    harness.root.unmount();
  });
});

describe.each([
  ["PHP", "php"],
  ["JavaScript/TypeScript", "typescript"],
] as const)("useWorkbenchSymbolPanels %s references owner fence", (_label, language) => {
  it("drops a replaced owner's references result before panel and message mutations", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    const replacementOwner = createWorkspaceRuntimeOwner("workspace-b", ROOT);
    let currentOwner: WorkspaceRuntimeOwner = firstOwner;
    const gateway = {
      references: vi.fn(async () => {
        currentOwner = replacementOwner;
        return [referenceRow(`${ROOT}/src/Target.ts`).location];
      }),
    } as unknown as LanguageServerFeaturesGateway;
    const status = runningStatus();
    const harness = renderPanels({
      activeDocumentRef: { current: panelDocument(language) },
      activeEditorPositionRef: { current: { column: 2, lineNumber: 1 } },
      javaScriptTypeScriptLanguageServerFeaturesGateway: gateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus:
        language === "typescript" ? status : null,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot:
        language === "typescript" ? ROOT : null,
      languageServerFeaturesGateway: gateway,
      languageServerRuntimeStatus: language === "php" ? status : null,
      languageServerRuntimeStatusRoot: language === "php" ? ROOT : null,
      resolveCurrentWorkspaceRuntimeOwner: () => currentOwner,
    });

    await act(async () => {
      await harness.api().openReferencesPanel();
    });

    expect(harness.api().referencesView).toBeNull();
    expect(harness.deps.setMessage).not.toHaveBeenCalled();
    expect(harness.deps.reportError).not.toHaveBeenCalled();
    expect(harness.openNavigationTarget).not.toHaveBeenCalled();

    harness.root.unmount();
  });
});

describe("useWorkbenchSymbolPanels file references owner fence", () => {
  it("drops a replaced owner's file-reference result", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    const replacementOwner = createWorkspaceRuntimeOwner("workspace-b", ROOT);
    let currentOwner: WorkspaceRuntimeOwner = firstOwner;
    const gateway = {
      executeCommandLocations: vi.fn(async () => {
        currentOwner = replacementOwner;
        return [referenceRow(`${ROOT}/src/Target.ts`).location];
      }),
    } as unknown as LanguageServerFeaturesGateway;
    const harness = renderPanels({
      activeDocumentRef: { current: panelDocument("typescript") },
      javaScriptTypeScriptLanguageServerFeaturesGateway: gateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus: runningStatus(),
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: ROOT,
      resolveCurrentWorkspaceRuntimeOwner: () => currentOwner,
    });

    await act(async () => {
      await harness.api().openFileReferencesPanel();
    });

    expect(harness.api().referencesView).toBeNull();
    expect(harness.deps.setMessage).not.toHaveBeenCalled();
    expect(harness.deps.reportError).not.toHaveBeenCalled();

    harness.root.unmount();
  });

  it("accepts a same-owner alias transfer and checks the captured owner", async () => {
    const owner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    let currentOwner: WorkspaceRuntimeOwner = owner;
    const isSessionActive = vi.fn(() => true);
    const gateway = {
      executeCommandLocations: vi.fn(async () => {
        currentOwner = transferWorkspaceRuntimeOwner(owner, "/workspace-alias");
        return [referenceRow(`${ROOT}/src/Target.ts`).location];
      }),
    } as unknown as LanguageServerFeaturesGateway;
    const harness = renderPanels({
      activeDocumentRef: { current: panelDocument("typescript") },
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot:
        isSessionActive,
      javaScriptTypeScriptLanguageServerFeaturesGateway: gateway,
      javaScriptTypeScriptLanguageServerRuntimeStatus: runningStatus(),
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: ROOT,
      resolveCurrentWorkspaceRuntimeOwner: () => currentOwner,
    });

    await act(async () => {
      await harness.api().openFileReferencesPanel();
    });

    expect(isSessionActive).toHaveBeenCalledWith(ROOT, 7, owner);
    expect(harness.api().referencesView?.locations).toHaveLength(1);
    expect(harness.deps.setMessage).toHaveBeenLastCalledWith(null);

    harness.root.unmount();
  });
});
