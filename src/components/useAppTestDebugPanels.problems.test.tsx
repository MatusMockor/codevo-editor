// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { useWorkbenchController } from "../application/useWorkbenchController";
import type { WorkbenchNotice } from "../application/workbenchNotice";
import type { JsTestProblemsSnapshot } from "../domain/jsTestProblems";
import { DEFAULT_WORKSPACE_PATH_POLICY } from "../domain/workspacePath";

const mocks = vi.hoisted(() => ({
  problemSnapshot: null as JsTestProblemsSnapshot | null,
  useDebugPanelProps: vi.fn(() => ({})),
  useJsTestExplorerPanelController: vi.fn(() => ({
    problemSnapshot: mocks.problemSnapshot,
  })),
}));

vi.mock("../application/usePhpTestResults", () => ({
  usePhpTestResults: vi.fn(() => ({ state: "idle" })),
}));
vi.mock("./useDebugPanelProps", () => ({
  useDebugPanelProps: mocks.useDebugPanelProps,
}));
vi.mock("./useJsTestExplorerPanelController", () => ({
  useJsTestExplorerPanelController: mocks.useJsTestExplorerPanelController,
}));

import { useAppTestDebugPanels } from "./useAppTestDebugPanels";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("useAppTestDebugPanels JavaScript test problem composition", () => {
  it("projects snapshots once per identity and keeps a manual clear until that identity changes", () => {
    const root = createRoot(document.createElement("div"));
    const replaceJavaScriptTestProblemNotices = vi.fn(
      (replacements: readonly WorkbenchNotice[]) => {
        visibleNotices = [...replacements];
      },
    );
    let visibleNotices: WorkbenchNotice[] = [];
    let workspaceRoot: string | null = "/workspace";
    let unrelatedRenderVersion = 0;
    const canOpenPicker = vi.fn(() => true);
    const openPicker = vi.fn();
    const debugCopyStackTrace = {
      canCopyStackTrace: vi.fn(() => true),
      copyStackTrace: vi.fn(() => true),
    };
    const debugTextClipboard = {
      canWriteText: vi.fn(() => true),
      writeText: vi.fn(async (_text: string) => undefined),
    };
    mocks.problemSnapshot = snapshot(1, "first failure");

    function Harness() {
      void unrelatedRenderVersion;
      useAppTestDebugPanels({
        debugTextClipboard,
        jsTestCoverageGateway: {} as never,
        jsTestGateway: {} as never,
        phpTestGateway: {} as never,
        workbench: {
          bottomPanelView: "testResults",
          bottomPanelVisible: true,
          debugSession: {
            isDebugStartBlocked: () => false,
            startDebug: vi.fn(),
          },
          debugCopyStackTrace,
          jsTestCoverageVersion: 0,
          jsTestDiscoveryVersion: 0,
          jsTestRunRequestVersion: 0,
          openDebugLocation: vi.fn(),
          openDebugPanel: vi.fn(),
          phpTestRunRequestVersion: 0,
          notices: visibleNotices,
          nodeRunWithoutDebugging: {
            configurationLauncher: { canOpenPicker, openPicker },
          },
          replaceJavaScriptTestProblemNotices,
          editorGroups: {
            activeGroupId: "main",
            groups: {
              main: {
                activePath: "/workspace/src/a.test.ts",
                openPaths: ["/workspace/src/a.test.ts", "untitled:Untitled-1"],
                previewPath: "/workspace/src/b.test.ts",
              },
            },
            layout: { groupId: "main", type: "group" },
          },
          workspaceDescriptor: { javaScriptTypeScript: {} },
          workspaceIdentityDescriptor: {
            canonicalRoot: "/workspace",
            caseSensitive: true,
            policy: DEFAULT_WORKSPACE_PATH_POLICY,
            selectedPath: "/workspace",
            unicodeNormalizationPolicy: "preserved",
            workspaceId: "workspace-id",
          },
          workspaceRoot,
        } as unknown as ReturnType<typeof useWorkbenchController>,
        workspaceTestDiscoveryGateway: {} as never,
        workspaceTrusted: true,
      });
      return null;
    }

    act(() => root.render(<Harness />));
    expect(replaceJavaScriptTestProblemNotices).toHaveBeenCalledTimes(1);
    expect(visibleNotices).toHaveLength(1);
    expect(visibleNotices[0]).toMatchObject({
      message: "example fails: first failure",
      navigationTarget: {
        path: "/workspace/src/example.test.ts",
        range: { start: { column: 1, lineNumber: 7 } },
      },
      severity: "error",
      source: "JavaScript Tests",
    });
    const controllerCall = mocks.useJsTestExplorerPanelController.mock.calls[0] as unknown as
      [
        {
          readonly openedFilesSnapshot: unknown;
          readonly outputClipboard: unknown;
        },
      ] | undefined;
    expect(controllerCall?.[0].openedFilesSnapshot).toMatchObject({
      hadEditorResources: true,
      identities: [{ relativeFilePath: "src/a.test.ts" }, { relativeFilePath: "src/b.test.ts" }],
      truncated: false,
    });
    expect(controllerCall?.[0].outputClipboard).toBe(debugTextClipboard);
    expect(mocks.useDebugPanelProps).toHaveBeenCalledWith(
      expect.objectContaining({
        debugCopyStackTrace,
        nodeRunConfigurationPicker: { canOpenPicker, openPicker },
      }),
    );

    visibleNotices = [];
    unrelatedRenderVersion += 1;
    act(() => root.render(<Harness />));
    expect(replaceJavaScriptTestProblemNotices).toHaveBeenCalledTimes(1);
    expect(visibleNotices).toEqual([]);

    mocks.problemSnapshot = snapshot(2, "second failure");
    act(() => root.render(<Harness />));
    expect(replaceJavaScriptTestProblemNotices).toHaveBeenCalledTimes(2);
    expect(visibleNotices.map(({ message }) => message)).toEqual(["example fails: second failure"]);

    workspaceRoot = null;
    act(() => root.render(<Harness />));
    expect(replaceJavaScriptTestProblemNotices).toHaveBeenCalledTimes(3);
    expect(visibleNotices).toEqual([]);

    unrelatedRenderVersion += 1;
    act(() => root.render(<Harness />));
    expect(replaceJavaScriptTestProblemNotices).toHaveBeenCalledTimes(3);

    act(() => root.unmount());
  });
});

function snapshot(generation: number, message: string): JsTestProblemsSnapshot {
  return {
    entries: [
      {
        filePath: "src/example.test.ts",
        lineNumber: 7,
        message,
        name: "example fails",
        status: "failed",
      },
    ],
    generation,
    owner: { rootKey: "/workspace", workspaceId: "workspace-id" },
    total: 1,
    truncated: false,
  };
}
