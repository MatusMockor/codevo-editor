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

function renderPanels(overrides: Partial<WorkbenchSymbolPanelsDependencies> = {}) {
  const owner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
  const openNavigationTarget = vi.fn(async () => true);
  const deps: WorkbenchSymbolPanelsDependencies = {
    activeDocumentRef: { current: null },
    activeEditorPositionRef: { current: null },
    cancelJavaScriptTypeScriptLanguageServerRequest: vi.fn(async () => undefined),
    closeCompetingSurfaces: vi.fn(),
    requestLanguageServerDocumentLease: vi.fn(async (rootPath, path) => ({
      lifecycleIdentity: 1,
      path,
      rootPath,
      sessionId: 7,
      syncGeneration: 0,
    })),
    isLanguageServerDocumentRequestLeaseCurrent: vi.fn(() => true),
    flushPendingJavaScriptTypeScriptDocumentChange: vi.fn(async () => undefined),
    isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: vi.fn(() => true),
    isLanguageServerSessionActiveForRoot: vi.fn(() => true),
    javaScriptTypeScriptLanguageServerFeaturesGateway:
      {} as WorkbenchSymbolPanelsDependencies["javaScriptTypeScriptLanguageServerFeaturesGateway"],
    javaScriptTypeScriptLanguageServerRuntimeStatus: null,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot: null,
    languageServerFeaturesGateway:
      {} as WorkbenchSymbolPanelsDependencies["languageServerFeaturesGateway"],
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
    [
      "call hierarchy",
      (api: WorkbenchSymbolPanels, path: string) => api.openCallHierarchyRow(callRow(path)),
    ],
    [
      "type hierarchy",
      (api: WorkbenchSymbolPanels, path: string) => api.openTypeHierarchyRow(typeRow(path)),
    ],
    [
      "references",
      (api: WorkbenchSymbolPanels, path: string) => api.openReferenceRow(referenceRow(path)),
    ],
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

function javaScriptTypeScriptSymbolPanelGateway(
  references: WorkbenchSymbolPanelsDependencies["javaScriptTypeScriptLanguageServerFeaturesGateway"]["references"],
): WorkbenchSymbolPanelsDependencies["javaScriptTypeScriptLanguageServerFeaturesGateway"] {
  return {
    executeCommandLocations: vi.fn((_rootPath, _command, sessionId) =>
      Object.assign(Promise.resolve([]), { requestId: 2, sessionId }),
    ),
    incomingCalls: vi.fn(async () => []),
    outgoingCalls: vi.fn(async () => []),
    prepareCallHierarchy: vi.fn(async () => []),
    prepareTypeHierarchy: vi.fn(async () => []),
    references,
    typeHierarchySubtypes: vi.fn(async () => []),
    typeHierarchySupertypes: vi.fn(async () => []),
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

describe("useWorkbenchSymbolPanels JavaScript/TypeScript reference request ownership", () => {
  it("passes the captured session id to the identified request", async () => {
    const references = vi.fn(
      (_rootPath: string, _position: unknown, _includeDeclaration: boolean, sessionId: number) =>
        Object.assign(Promise.resolve([]), {
          requestId: 19,
          sessionId,
        }),
    );
    const harness = renderPanels({
      activeDocumentRef: { current: panelDocument("typescript") },
      activeEditorPositionRef: { current: { column: 2, lineNumber: 1 } },
      javaScriptTypeScriptLanguageServerFeaturesGateway:
        javaScriptTypeScriptSymbolPanelGateway(references),
      javaScriptTypeScriptLanguageServerRuntimeStatus: runningStatus(),
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: ROOT,
    });

    await act(async () => {
      await harness.api().openReferencesPanel();
    });

    expect(references).toHaveBeenCalledWith(ROOT, expect.any(Object), true, 7);
    harness.root.unmount();
  });

  it("settles at the deadline, cancels the exact request once, and ignores a late result", async () => {
    vi.useFakeTimers();
    let resolveReferences: (
      locations: ReturnType<typeof referenceRow>["location"][],
    ) => void = () => undefined;
    const pendingReferences = new Promise<ReturnType<typeof referenceRow>["location"][]>(
      (resolve) => {
        resolveReferences = resolve;
      },
    );
    const references = vi.fn(
      (_rootPath: string, _position: unknown, _includeDeclaration: boolean, sessionId: number) =>
        Object.assign(pendingReferences, {
          requestId: 23,
          sessionId,
        }),
    );
    const cancelRequest = vi.fn(async () => undefined);
    const harness = renderPanels({
      activeDocumentRef: { current: panelDocument("typescript") },
      activeEditorPositionRef: { current: { column: 2, lineNumber: 1 } },
      cancelJavaScriptTypeScriptLanguageServerRequest: cancelRequest,
      javaScriptTypeScriptLanguageServerFeaturesGateway:
        javaScriptTypeScriptSymbolPanelGateway(references),
      javaScriptTypeScriptLanguageServerRuntimeStatus: runningStatus(),
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: ROOT,
    });

    try {
      await act(async () => {
        const opening = harness.api().openReferencesPanel();
        await Promise.resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(2_500);
        await opening;
      });

      expect(cancelRequest).toHaveBeenCalledTimes(1);
      expect(cancelRequest).toHaveBeenCalledWith(ROOT, 7, 23);
      expect(harness.api().referencesView).toBeNull();
      expect(harness.deps.setMessage).not.toHaveBeenCalled();

      await act(async () => {
        resolveReferences([referenceRow(`${ROOT}/src/Late.ts`).location]);
        await Promise.resolve();
      });

      expect(cancelRequest).toHaveBeenCalledTimes(1);
      expect(harness.api().referencesView).toBeNull();
      expect(harness.deps.setMessage).not.toHaveBeenCalled();
    } finally {
      harness.root.unmount();
      vi.useRealTimers();
    }
  });

  it("cancels a mismatched exact request and consumes its late rejection", async () => {
    let rejectReferences: (reason: unknown) => void = () => undefined;
    const pendingReferences = new Promise<ReturnType<typeof referenceRow>["location"][]>(
      (_resolve, reject) => {
        rejectReferences = reject;
      },
    );
    const references = vi.fn(() =>
      Object.assign(pendingReferences, {
        requestId: 24,
        sessionId: 8,
      }),
    );
    const cancelRequest = vi.fn(async () => undefined);
    const harness = renderPanels({
      activeDocumentRef: { current: panelDocument("typescript") },
      activeEditorPositionRef: { current: { column: 2, lineNumber: 1 } },
      cancelJavaScriptTypeScriptLanguageServerRequest: cancelRequest,
      javaScriptTypeScriptLanguageServerFeaturesGateway:
        javaScriptTypeScriptSymbolPanelGateway(references),
      javaScriptTypeScriptLanguageServerRuntimeStatus: runningStatus(),
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: ROOT,
    });

    await act(async () => {
      await harness.api().openReferencesPanel();
      rejectReferences(new Error("late foreign rejection"));
      await Promise.resolve();
    });

    expect(cancelRequest).toHaveBeenCalledOnce();
    expect(cancelRequest).toHaveBeenCalledWith(ROOT, 8, 24);
    expect(harness.api().referencesView).toBeNull();
    expect(harness.deps.reportError).not.toHaveBeenCalled();
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
      javaScriptTypeScriptLanguageServerFeaturesGateway: javaScriptTypeScriptSymbolPanelGateway(
        (rootPath, position, _includeDeclaration, sessionId) =>
          Object.assign(gateway.references(rootPath, position), {
            requestId: 1,
            sessionId,
          }),
      ),
      javaScriptTypeScriptLanguageServerRuntimeStatus: language === "typescript" ? status : null,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: language === "typescript" ? ROOT : null,
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

describe("useWorkbenchSymbolPanels reference request generation", () => {
  it("cancels the superseded exact request and keeps the newest reverse-order result", async () => {
    let resolveFirst: (locations: ReturnType<typeof referenceRow>["location"][]) => void = () =>
      undefined;
    const firstResult = new Promise<ReturnType<typeof referenceRow>["location"][]>((resolve) => {
      resolveFirst = resolve;
    });
    let requestNumber = 0;
    const references = vi.fn(
      (_rootPath: string, _position: unknown, _includeDeclaration: boolean, sessionId: number) => {
        requestNumber += 1;
        const result =
          requestNumber === 1
            ? firstResult
            : Promise.resolve([referenceRow(`${ROOT}/src/Newest.ts`).location]);
        return Object.assign(result, {
          requestId: requestNumber === 1 ? 31 : 32,
          sessionId,
        });
      },
    );
    const cancelRequest = vi.fn(async () => undefined);
    const harness = renderPanels({
      activeDocumentRef: { current: panelDocument("typescript") },
      activeEditorPositionRef: { current: { column: 2, lineNumber: 1 } },
      cancelJavaScriptTypeScriptLanguageServerRequest: cancelRequest,
      javaScriptTypeScriptLanguageServerFeaturesGateway:
        javaScriptTypeScriptSymbolPanelGateway(references),
      javaScriptTypeScriptLanguageServerRuntimeStatus: runningStatus(),
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: ROOT,
    });
    let firstOpening = Promise.resolve();

    await act(async () => {
      firstOpening = harness.api().openReferencesPanel();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(references).toHaveBeenCalledTimes(1));

    await act(async () => {
      await harness.api().openReferencesPanel();
    });

    expect(cancelRequest).toHaveBeenCalledTimes(1);
    expect(cancelRequest).toHaveBeenCalledWith(ROOT, 7, 31);
    expect(harness.api().referencesView?.locations[0]?.uri).toContain("Newest.ts");

    await act(async () => {
      resolveFirst([referenceRow(`${ROOT}/src/Stale.ts`).location]);
      await firstOpening;
    });

    expect(harness.api().referencesView?.locations[0]?.uri).toContain("Newest.ts");
    expect(harness.api().referencesView?.locations[0]?.uri).not.toContain("Stale.ts");
    harness.root.unmount();
  });

  it("does not publish a pending result after unmount", async () => {
    let resolveReferences: (
      locations: ReturnType<typeof referenceRow>["location"][],
    ) => void = () => undefined;
    const pendingResult = new Promise<ReturnType<typeof referenceRow>["location"][]>((resolve) => {
      resolveReferences = resolve;
    });
    const references = vi.fn(
      (_rootPath: string, _position: unknown, _includeDeclaration: boolean, sessionId: number) =>
        Object.assign(pendingResult, { requestId: 33, sessionId }),
    );
    const cancelRequest = vi.fn(async () => undefined);
    const harness = renderPanels({
      activeDocumentRef: { current: panelDocument("typescript") },
      activeEditorPositionRef: { current: { column: 2, lineNumber: 1 } },
      cancelJavaScriptTypeScriptLanguageServerRequest: cancelRequest,
      javaScriptTypeScriptLanguageServerFeaturesGateway:
        javaScriptTypeScriptSymbolPanelGateway(references),
      javaScriptTypeScriptLanguageServerRuntimeStatus: runningStatus(),
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: ROOT,
    });
    let opening = Promise.resolve();

    await act(async () => {
      opening = harness.api().openReferencesPanel();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(references).toHaveBeenCalledTimes(1));

    act(() => harness.root.unmount());
    expect(cancelRequest).toHaveBeenCalledOnce();
    expect(cancelRequest).toHaveBeenCalledWith(ROOT, 7, 33);
    resolveReferences([referenceRow(`${ROOT}/src/Late.ts`).location]);
    await opening;

    expect(harness.deps.setMessage).not.toHaveBeenCalled();
    expect(harness.deps.reportError).not.toHaveBeenCalled();
  });

  it("keeps a supersession storm to one active exact backend request", async () => {
    const rejectByRequestId = new Map<number, (reason: unknown) => void>();
    let nextRequestId = 100;
    const references = vi.fn(
      (_rootPath: string, _position: unknown, _includeDeclaration: boolean, sessionId: number) => {
        const requestId = nextRequestId;
        nextRequestId += 1;
        const result = new Promise<ReturnType<typeof referenceRow>["location"][]>(
          (_resolve, reject) => {
            rejectByRequestId.set(requestId, reject);
          },
        );
        return Object.assign(result, { requestId, sessionId });
      },
    );
    const cancelRequest = vi.fn(
      async (_rootPath: string, _sessionId: number, requestId: number) => {
        rejectByRequestId.get(requestId)?.(new Error("cancelled"));
      },
    );
    const harness = renderPanels({
      activeDocumentRef: { current: panelDocument("typescript") },
      activeEditorPositionRef: { current: { column: 2, lineNumber: 1 } },
      cancelJavaScriptTypeScriptLanguageServerRequest: cancelRequest,
      javaScriptTypeScriptLanguageServerFeaturesGateway:
        javaScriptTypeScriptSymbolPanelGateway(references),
      javaScriptTypeScriptLanguageServerRuntimeStatus: runningStatus(),
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: ROOT,
    });
    const openings: Promise<void>[] = [];

    for (let index = 0; index < 32; index += 1) {
      await act(async () => {
        openings.push(harness.api().openReferencesPanel());
        await Promise.resolve();
      });
      await vi.waitFor(() => expect(references).toHaveBeenCalledTimes(index + 1));
    }

    act(() => harness.root.unmount());
    await Promise.all(openings);

    expect(cancelRequest).toHaveBeenCalledTimes(32);
    expect(
      new Set(
        cancelRequest.mock.calls.map(([, sessionId, requestId]) => `${sessionId}:${requestId}`),
      ).size,
    ).toBe(32);
    expect(harness.deps.reportError).not.toHaveBeenCalled();
  });
});

describe("useWorkbenchSymbolPanels file references owner fence", () => {
  it("keeps an all-omitted file-reference receipt truthfully incomplete", async () => {
    const executeCommandLocations = vi.fn(
      (_rootPath: string, _command: unknown, sessionId: number) =>
        Object.assign(
          Promise.resolve(
            Object.assign([], {
              isIncomplete: true,
              totalCount: 5,
            }),
          ),
          { requestId: 50, sessionId },
        ),
    );
    const harness = renderPanels({
      activeDocumentRef: { current: panelDocument("typescript") },
      javaScriptTypeScriptLanguageServerFeaturesGateway: {
        ...javaScriptTypeScriptSymbolPanelGateway(
          (_rootPath, _position, _includeDeclaration, sessionId) =>
            Object.assign(Promise.resolve([]), { requestId: 1, sessionId }),
        ),
        executeCommandLocations,
      },
      javaScriptTypeScriptLanguageServerRuntimeStatus: runningStatus(),
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: ROOT,
    });

    await act(async () => {
      await harness.api().openFileReferencesPanel();
    });

    expect(harness.api().referencesView).toMatchObject({
      isIncomplete: true,
      locations: [],
      totalCount: 5,
    });
    expect(harness.deps.setMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("limited by safety bounds"),
    );
    harness.root.unmount();
  });

  it("cancels superseded and unmounted exact requests across an A-B-A owner replacement", async () => {
    const ownerA = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    let currentOwner: WorkspaceRuntimeOwner = ownerA;
    const rejectByRequestId = new Map<number, (reason: unknown) => void>();
    let nextRequestId = 51;
    const executeCommandLocations = vi.fn(
      (_rootPath: string, _command: unknown, sessionId: number) => {
        const requestId = nextRequestId;
        nextRequestId += 1;
        const pending = new Promise<ReturnType<typeof referenceRow>["location"][]>(
          (_resolve, reject) => {
            rejectByRequestId.set(requestId, reject);
          },
        );
        return Object.assign(pending, { requestId, sessionId });
      },
    );
    const cancelRequest = vi.fn(
      async (_rootPath: string, _sessionId: number, requestId: number) => {
        rejectByRequestId.get(requestId)?.(new Error("cancelled"));
      },
    );
    const harness = renderPanels({
      activeDocumentRef: { current: panelDocument("typescript") },
      cancelJavaScriptTypeScriptLanguageServerRequest: cancelRequest,
      javaScriptTypeScriptLanguageServerFeaturesGateway: {
        ...javaScriptTypeScriptSymbolPanelGateway(
          (_rootPath, _position, _includeDeclaration, sessionId) =>
            Object.assign(Promise.resolve([]), { requestId: 1, sessionId }),
        ),
        executeCommandLocations,
      },
      javaScriptTypeScriptLanguageServerRuntimeStatus: runningStatus(),
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: ROOT,
      resolveCurrentWorkspaceRuntimeOwner: () => currentOwner,
    });
    const openings: Promise<void>[] = [];

    await act(async () => {
      openings.push(harness.api().openFileReferencesPanel());
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(executeCommandLocations).toHaveBeenCalledTimes(1));

    await act(async () => {
      openings.push(harness.api().openFileReferencesPanel());
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(executeCommandLocations).toHaveBeenCalledTimes(2));
    expect(cancelRequest).toHaveBeenCalledWith(ROOT, 7, 51);

    currentOwner = createWorkspaceRuntimeOwner("workspace-b", ROOT);
    currentOwner = createWorkspaceRuntimeOwner("workspace-a-replacement", ROOT);
    act(() => harness.root.unmount());
    await Promise.all(openings);

    expect(cancelRequest).toHaveBeenCalledTimes(2);
    expect(cancelRequest).toHaveBeenLastCalledWith(ROOT, 7, 52);
    expect(harness.deps.setMessage).not.toHaveBeenCalled();
    expect(harness.deps.reportError).not.toHaveBeenCalled();
  });

  it("settles and exactly cancels an identified file-reference request at the deadline", async () => {
    vi.useFakeTimers();
    let resolveLocations: (locations: ReturnType<typeof referenceRow>["location"][]) => void = () =>
      undefined;
    const pendingLocations = new Promise<ReturnType<typeof referenceRow>["location"][]>(
      (resolve) => {
        resolveLocations = resolve;
      },
    );
    const executeCommandLocations = vi.fn(
      (_rootPath: string, _command: unknown, sessionId: number) =>
        Object.assign(pendingLocations, { requestId: 41, sessionId }),
    );
    const cancelRequest = vi.fn(async () => undefined);
    const harness = renderPanels({
      activeDocumentRef: { current: panelDocument("typescript") },
      cancelJavaScriptTypeScriptLanguageServerRequest: cancelRequest,
      javaScriptTypeScriptLanguageServerFeaturesGateway: {
        ...javaScriptTypeScriptSymbolPanelGateway(
          (_rootPath, _position, _includeDeclaration, sessionId) =>
            Object.assign(Promise.resolve([]), { requestId: 1, sessionId }),
        ),
        executeCommandLocations,
      },
      javaScriptTypeScriptLanguageServerRuntimeStatus: runningStatus(),
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: ROOT,
    });

    try {
      await act(async () => {
        const opening = harness.api().openFileReferencesPanel();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(2_500);
        await opening;
      });

      expect(harness.api().referencesView).toBeNull();
      expect(harness.deps.setMessage).not.toHaveBeenCalled();
      expect(cancelRequest).toHaveBeenCalledOnce();
      expect(cancelRequest).toHaveBeenCalledWith(ROOT, 7, 41);

      await act(async () => {
        resolveLocations([referenceRow(`${ROOT}/src/Late.ts`).location]);
        await Promise.resolve();
      });

      expect(harness.api().referencesView).toBeNull();
    } finally {
      harness.root.unmount();
      vi.useRealTimers();
    }
  });

  it("drops a replaced owner's file-reference result", async () => {
    const firstOwner = createWorkspaceRuntimeOwner("workspace-a", ROOT);
    const replacementOwner = createWorkspaceRuntimeOwner("workspace-b", ROOT);
    let currentOwner: WorkspaceRuntimeOwner = firstOwner;
    const executeCommandLocations = vi.fn(
      (_rootPath: string, _command: unknown, sessionId: number) =>
        Object.assign(
          Promise.resolve().then(() => {
            currentOwner = replacementOwner;
            return [referenceRow(`${ROOT}/src/Target.ts`).location];
          }),
          { requestId: 42, sessionId },
        ),
    );
    const harness = renderPanels({
      activeDocumentRef: { current: panelDocument("typescript") },
      javaScriptTypeScriptLanguageServerFeaturesGateway: {
        ...javaScriptTypeScriptSymbolPanelGateway(
          (_rootPath, _position, _includeDeclaration, sessionId) =>
            Object.assign(Promise.resolve([]), { requestId: 1, sessionId }),
        ),
        executeCommandLocations,
      },
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
    const executeCommandLocations = vi.fn(
      (_rootPath: string, _command: unknown, sessionId: number) =>
        Object.assign(
          Promise.resolve().then(() => {
            currentOwner = transferWorkspaceRuntimeOwner(owner, "/workspace-alias");
            return Object.assign([referenceRow(`${ROOT}/src/Target.ts`).location], {
              isIncomplete: true,
              totalCount: 5,
            });
          }),
          { requestId: 43, sessionId },
        ),
    );
    const harness = renderPanels({
      activeDocumentRef: { current: panelDocument("typescript") },
      isJavaScriptTypeScriptLanguageServerSessionActiveForRoot: isSessionActive,
      javaScriptTypeScriptLanguageServerFeaturesGateway: {
        ...javaScriptTypeScriptSymbolPanelGateway(
          (_rootPath, _position, _includeDeclaration, sessionId) =>
            Object.assign(Promise.resolve([]), { requestId: 1, sessionId }),
        ),
        executeCommandLocations,
      },
      javaScriptTypeScriptLanguageServerRuntimeStatus: runningStatus(),
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: ROOT,
      resolveCurrentWorkspaceRuntimeOwner: () => currentOwner,
    });

    await act(async () => {
      await harness.api().openFileReferencesPanel();
    });

    expect(isSessionActive).toHaveBeenCalledWith(ROOT, 7, owner);
    expect(harness.api().referencesView?.locations).toHaveLength(1);
    expect(harness.api().referencesView).toMatchObject({
      isIncomplete: true,
      totalCount: 5,
    });
    expect(harness.deps.setMessage).toHaveBeenLastCalledWith(null);

    harness.root.unmount();
  });
});
