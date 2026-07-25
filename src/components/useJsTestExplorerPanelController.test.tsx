// @vitest-environment jsdom

import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JsTestCoverageGateway } from "../domain/jsTestCoverage";
import type { JsTestWatchGateway } from "../domain/jsTestCommand";
import type { WorkspaceTestDiscoveryGateway } from "../domain/jsTestDiscovery";
import type { JsTestGateway } from "../domain/jsTestRunScope";
import type { DebugLaunchTarget } from "../domain/debug";
import type { JsTestExplorerSuiteNode } from "../domain/jsTestExplorerTree";
import type {
  JsTestExplorerCurrentFileIdentity,
  JsTestExplorerOpenedFilesSnapshot,
} from "../domain/jsTestExplorerFilter";
import type { EditorDocument } from "../domain/workspace";
import { DEFAULT_WORKSPACE_PATH_POLICY } from "../domain/workspacePath";
import {
  jsTestExplorerActiveDocumentIdentity,
  jsTestExplorerOpenedDocumentIdentitySnapshot,
} from "./jsTestExplorerActiveDocumentOwnership";

const mocks = vi.hoisted(() => ({
  useJsTestExplorer: vi.fn(),
}));

vi.mock("../application/useJsTestExplorer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../application/useJsTestExplorer")>();
  mocks.useJsTestExplorer.mockImplementation(actual.useJsTestExplorer);
  return { ...actual, useJsTestExplorer: mocks.useJsTestExplorer };
});

import { useJsTestExplorerPanelController } from "./useJsTestExplorerPanelController";

describe("useJsTestExplorerPanelController coverage integration", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useJsTestExplorerPanelController>;
  const onOpenLocation = vi.fn();
  const openDebugPanel = vi.fn();
  const startDebug = vi.fn(async (_launch: DebugLaunchTarget) => undefined);

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    onOpenLocation.mockClear();
    openDebugPanel.mockClear();
    startDebug.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("runs and clears coverage through the injected gateway", async () => {
    const coverageGateway = createCoverageGateway();
    await render(coverageGateway);
    await act(async () => latest.onRunCoverage());
    expect(coverageGateway.run).toHaveBeenCalledWith("/workspace");
    expect(latest.coverageReport?.files[0]?.firstUncoveredLine).toBe(9);
    act(() => latest.onClearCoverage());
    expect(latest.coverageReport).toBeNull();
  });

  it("opens only safe coverage files at their first uncovered line", async () => {
    await render(createCoverageGateway());
    const navigable = coverageResponse().report.files[0]!;
    act(() => latest.onOpenCoverageFile(navigable));
    act(() => latest.onOpenCoverageFile({ ...navigable, firstUncoveredLine: null }));
    act(() => latest.onOpenCoverageFile({ ...navigable, path: "../outside.ts" }));
    expect(onOpenLocation).toHaveBeenCalledExactlyOnceWith("/workspace/src/example.ts", 9);
  });

  it("routes selected debug through the application coordinator", async () => {
    await render(createCoverageGateway());
    const suite: JsTestExplorerSuiteNode = {
      children: [],
      filePath: "/workspace/src/example.test.ts",
      id: "suite",
      kind: "suite",
      label: "math",
      status: "idle",
      suitePath: ["math"],
    };
    await act(async () => latest.onDebugNode(suite));
    expect(openDebugPanel).toHaveBeenCalledOnce();
    expect(startDebug).toHaveBeenCalledExactlyOnceWith({
      kind: "js-test-selection",
      runner: "vitest",
      filePath: suite.filePath,
      packageRootPath: "/workspace",
      selection: { kind: "suite", fullName: "math" },
    });
  });

  it("projects the failed-run lifecycle as panel state and void handlers", async () => {
    await render(createCoverageGateway());

    expect(latest.canRerunFailedTests).toBe(false);
    expect(latest.canCancelTestRun).toBe(false);
    expect(latest.failedRunPhase).toBe("idle");
    expect(latest.failedRunCompleted).toBe(0);
    expect(latest.failedRunTotal).toBe(0);
    expect(latest.onRerunFailedTests()).toBeUndefined();
    expect(latest.onCancelTestRun()).toBeUndefined();
  });

  it("passes only the current relative document path through the controller seam", async () => {
    const coverageGateway = createCoverageGateway();

    await render(coverageGateway, "src/a.test.ts");
    expect(latest.currentFileIdentity?.relativeFilePath).toBe("src/a.test.ts");

    await render(coverageGateway, "src/b.test.ts");
    expect(latest.currentFileIdentity?.relativeFilePath).toBe("src/b.test.ts");

    await render(coverageGateway, null);
    expect(latest.currentFileIdentity).toBeNull();

    await render(coverageGateway, "src/final-a.test.ts");
    expect(latest.currentFileIdentity?.relativeFilePath).toBe("src/final-a.test.ts");
  });

  it("passes only the bounded opened-file identity snapshot through the controller seam", async () => {
    const snapshot = jsTestExplorerOpenedDocumentIdentitySnapshot({
      openedEditorResourcePaths: ["/workspace/src/b.test.ts", "/workspace/src/a.test.ts"],
      workspace: {
        policy: DEFAULT_WORKSPACE_PATH_POLICY,
        selectedPath: "/workspace",
        workspaceId: "workspace-id",
      },
      workspaceRoot: "/workspace",
    });
    if (!snapshot) throw new Error("Expected an available opened-file snapshot.");

    await render(createCoverageGateway(), null, snapshot);

    expect(latest.openedFilesSnapshot).toBe(snapshot);
    expect(
      latest.openedFilesSnapshot?.identities.map(({ relativeFilePath }) => relativeFilePath),
    ).toEqual(["src/a.test.ts", "src/b.test.ts"]);
    expect(latest.openedFilesSnapshot?.truncated).toBe(false);
  });

  it("passes watch gateway and derived watch command to the explorer when the runner supports native watch", async () => {
    const watchGateway = {} as JsTestWatchGateway;

    await render(createCoverageGateway(), null, undefined, watchGateway);

    await vi.waitFor(() =>
      expect(mocks.useJsTestExplorer).toHaveBeenLastCalledWith(
        expect.objectContaining({
          continuousRunWatchCommand: {
            kind: "vitest-watch",
            packageRootRelativePath: "",
            scope: { kind: "all" },
          },
          watchGateway,
        }),
      ),
    );
  });

  it("passes a null watch command to the explorer for the debounced-rescope fallback", async () => {
    const watchGateway = {} as JsTestWatchGateway;
    const testDiscoveryGateway = jestDiscoveryGateway();

    await render(
      createCoverageGateway(),
      null,
      undefined,
      watchGateway,
      true,
      testDiscoveryGateway,
    );

    await vi.waitFor(() =>
      expect(testDiscoveryGateway.readTextFileBounded).toHaveBeenCalledWith(
        "/workspace",
        "node_modules/.bin/jest",
        1_048_576,
      ),
    );
    await vi.waitFor(() =>
      expect(mocks.useJsTestExplorer).toHaveBeenLastCalledWith(
        expect.objectContaining({
          continuousRunWatchCommand: null,
          watchGateway,
        }),
      ),
    );
  });

  it("does not expose watch capability for an untrusted workspace", async () => {
    const watchGateway = {} as JsTestWatchGateway;
    const testDiscoveryGateway = discoveryGateway();

    await render(
      createCoverageGateway(),
      null,
      undefined,
      watchGateway,
      false,
      testDiscoveryGateway,
    );

    expect(mocks.useJsTestExplorer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        continuousRunWatchCommand: null,
        watchGateway: null,
        workspaceTrusted: false,
      }),
    );
    expect(testDiscoveryGateway.readTextFileBounded).not.toHaveBeenCalled();
  });

  async function render(
    coverageGateway: JsTestCoverageGateway,
    activeDocumentRelativePath: string | null = null,
    openedFilesSnapshot?: JsTestExplorerOpenedFilesSnapshot,
    watchGateway?: JsTestWatchGateway,
    workspaceTrusted = true,
    testDiscoveryGateway = discoveryGateway(),
  ) {
    await act(async () => {
      root.render(
        <Harness
          activeDocumentIdentity={currentIdentity(activeDocumentRelativePath)}
          coverageGateway={coverageGateway}
          onOpenLocation={onOpenLocation}
          openedFilesSnapshot={openedFilesSnapshot}
          openDebugPanel={openDebugPanel}
          startDebug={startDebug}
          testDiscoveryGateway={testDiscoveryGateway}
          watchGateway={watchGateway}
          workspaceTrusted={workspaceTrusted}
          onReady={(model) => {
            latest = model;
          }}
        />,
      );
    });
  }
});

function Harness({
  activeDocumentIdentity,
  coverageGateway,
  onOpenLocation,
  openedFilesSnapshot,
  openDebugPanel,
  startDebug,
  testDiscoveryGateway,
  watchGateway,
  workspaceTrusted,
  onReady,
}: {
  activeDocumentIdentity: JsTestExplorerCurrentFileIdentity | null;
  coverageGateway: JsTestCoverageGateway;
  onOpenLocation: (path: string, lineNumber: number) => void;
  openedFilesSnapshot?: JsTestExplorerOpenedFilesSnapshot;
  openDebugPanel: () => void;
  startDebug: (launch: DebugLaunchTarget) => Promise<void>;
  testDiscoveryGateway?: WorkspaceTestDiscoveryGateway;
  watchGateway?: JsTestWatchGateway;
  workspaceTrusted?: boolean;
  onReady: (model: ReturnType<typeof useJsTestExplorerPanelController>) => void;
}) {
  const stableDiscoveryGateway = useMemo(
    () => testDiscoveryGateway ?? discoveryGateway(),
    [testDiscoveryGateway],
  );
  const model = useJsTestExplorerPanelController({
    activeDocumentIdentity,
    coverageGateway,
    coverageInvalidationVersion: 0,
    discoveryGateway: stableDiscoveryGateway,
    discoveryVersion: 0,
    debugStartBlocked: false,
    isDebugStartBlocked: () => false,
    isOpen: false,
    openedFilesSnapshot,
    onOpenLocation,
    openDebugPanel,
    rootPath: "/workspace",
    runGateway: runGateway(),
    runRequestVersion: 0,
    workspaceId: "workspace-id",
    workspaceTrusted: workspaceTrusted ?? true,
    startDebug,
    watchGateway,
  });
  onReady(model);
  return null;
}

function currentIdentity(
  relativeFilePath: string | null,
): JsTestExplorerCurrentFileIdentity | null {
  if (!relativeFilePath) return null;
  const segments = relativeFilePath.split("/");
  const activeDocument: EditorDocument = {
    content: "",
    language: "typescript",
    name: segments[segments.length - 1] ?? relativeFilePath,
    path: `/workspace/${relativeFilePath}`,
    savedContent: "",
  };
  return jsTestExplorerActiveDocumentIdentity({
    activeDocument,
    workspace: {
      policy: DEFAULT_WORKSPACE_PATH_POLICY,
      selectedPath: "/workspace",
      workspaceId: "workspace-id",
    },
    workspaceRoot: "/workspace",
  });
}

function createCoverageGateway(): JsTestCoverageGateway {
  return { run: vi.fn(async () => coverageResponse()) };
}

function coverageResponse() {
  return {
    status: "ok" as const,
    report: {
      files: [
        {
          firstUncoveredLine: 9,
          lines: [{ hits: 0, lineNumber: 9 }],
          path: "src/example.ts",
          summary: { covered: 0, percentage: 0, total: 1 },
          branches: { covered: 0, percentage: null, total: 0 },
          functions: { covered: 0, percentage: null, total: 0 },
        },
      ],
      summary: { covered: 0, percentage: 0, total: 1 },
      branches: { covered: 0, percentage: null, total: 0 },
      functions: { covered: 0, percentage: null, total: 0 },
      truncated: false,
    },
  };
}

function discoveryGateway(): WorkspaceTestDiscoveryGateway {
  return {
    enumerateJsTestFiles: vi.fn(async () => ({ files: [], truncated: false, visited: 0 })),
    readTextFileBounded: vi.fn(async (_root, relativePath) =>
      relativePath === "vitest.config.ts"
        ? { content: "export default {}", status: "ok" as const }
        : { status: "tooLarge" as const },
    ),
  };
}

function jestDiscoveryGateway() {
  return {
    enumerateJsTestFiles: vi.fn(async () => ({ files: [], truncated: false, visited: 0 })),
    readTextFileBounded: vi.fn(async (_root, relativePath) =>
      relativePath === "jest.config.ts"
        ? { content: "export default {}", status: "ok" as const }
        : { status: "tooLarge" as const },
    ),
  };
}

function runGateway(): JsTestGateway {
  return { run: vi.fn(async () => ({ status: "unavailable" as const, message: "unused" })) };
}
