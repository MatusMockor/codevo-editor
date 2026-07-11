// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { CallHierarchyRow } from "../domain/callHierarchy";
import type { ReferenceRow } from "../domain/referencesView";
import type { TypeHierarchyRow } from "../domain/typeHierarchy";
import {
  useWorkbenchSymbolPanels,
  type WorkbenchSymbolPanels,
  type WorkbenchSymbolPanelsDependencies,
} from "./useWorkbenchSymbolPanels";

const ROOT = "/workspace";

function renderPanels() {
  const openNavigationTarget = vi.fn(async () => true);
  const deps = {
    activeDocumentRef: { current: null },
    activeEditorPositionRef: { current: null },
    closeCompetingSurfaces: vi.fn(),
    flushPendingDocumentChange: vi.fn(async () => undefined),
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
    setMessage: vi.fn(),
    shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly: vi.fn(() => false),
    workspaceRoot: ROOT,
  } satisfies WorkbenchSymbolPanelsDependencies;
  let api: WorkbenchSymbolPanels | null = null;
  const root = createRoot(document.createElement("div"));

  function Harness() {
    api = useWorkbenchSymbolPanels(deps);
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return { api: () => api as WorkbenchSymbolPanels, openNavigationTarget, root };
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
      { readOnly: false },
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
      { readOnly: false },
    );

    harness.root.unmount();
  });
});
