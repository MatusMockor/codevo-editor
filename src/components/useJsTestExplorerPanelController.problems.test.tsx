// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { JsTestProblemsSnapshot } from "../domain/jsTestProblems";

const mocks = vi.hoisted(() => {
  const problemSnapshot = {
    entries: [],
    generation: 7,
    owner: { rootKey: "/workspace", workspaceId: "workspace-id" },
    total: 0,
    truncated: false,
  } satisfies JsTestProblemsSnapshot;
  return {
    problemSnapshot,
    useJsTestExplorer: vi.fn(() => ({
      canCancelTestRun: () => false,
      canRerunFailedTests: () => false,
      canStartContinuousRun: () => false,
      cancelTestRun: vi.fn(),
      continuousRunEnabled: false,
      continuousRunPending: false,
      continuousRunRunning: false,
      continuousRunStopping: false,
      error: null,
      failedRunCompleted: 0,
      failedRunPhase: "idle" as const,
      failedRunTotal: 0,
      isLoading: false,
      isRunning: false,
      problemSnapshot,
      refresh: vi.fn(),
      rerunFailedTests: vi.fn(),
      result: null,
      run: vi.fn(),
      startContinuousRun: vi.fn(),
      stopContinuousRun: vi.fn(),
      tree: null,
      truncated: false,
      unavailable: null,
    })),
  };
});

vi.mock("../application/useJsTestExplorer", () => ({
  useJsTestExplorer: mocks.useJsTestExplorer,
}));
vi.mock("../application/useJsTestCoverage", () => ({
  useJsTestCoverage: () => ({
    clear: vi.fn(),
    error: null,
    isRunning: false,
    report: null,
    run: vi.fn(),
    unavailable: null,
  }),
}));
vi.mock("../application/useJsTestExplorerDebug", () => ({
  useJsTestExplorerDebug: () => ({
    blocked: false,
    blockedReason: null,
    debug: vi.fn(),
    error: null,
    isDebugging: false,
    unavailable: null,
  }),
}));

import { useJsTestExplorerPanelController } from "./useJsTestExplorerPanelController";

describe("useJsTestExplorerPanelController problem integration", () => {
  it("forwards coverage invalidation and exposes the exact application snapshot", () => {
    const root = createRoot(document.createElement("div"));
    let latest: ReturnType<typeof useJsTestExplorerPanelController> | null = null;
    function Harness() {
      latest = useJsTestExplorerPanelController({
        coverageGateway: { run: vi.fn() },
        coverageInvalidationVersion: 17,
        debugStartBlocked: false,
        discoveryGateway: {} as never,
        discoveryVersion: 3,
        isDebugStartBlocked: () => false,
        isOpen: false,
        onOpenLocation: vi.fn(),
        openDebugPanel: vi.fn(),
        rootPath: "/workspace",
        runGateway: {} as never,
        runRequestVersion: 5,
        startDebug: vi.fn(),
        workspaceId: "workspace-id",
        workspaceTrusted: true,
      });
      return null;
    }
    act(() => root.render(<Harness />));

    expect(mocks.useJsTestExplorer).toHaveBeenCalledWith({
      continuousRunBlocked: false,
      continuousRunVersion: 0,
      discoveryGateway: expect.anything(),
      discoveryVersion: 3,
      isOpen: false,
      resultInvalidationVersion: 17,
      rootPath: "/workspace",
      runGateway: expect.anything(),
      runRequestVersion: 5,
      taskGateway: null,
      workspaceId: "workspace-id",
      workspaceTrusted: true,
    });
    expect(latest!.problemSnapshot).toBe(mocks.problemSnapshot);
    act(() => root.unmount());
  });
});
