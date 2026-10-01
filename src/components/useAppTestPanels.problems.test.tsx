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
  useJsTestExplorerPanelController: vi.fn(() => ({
    problemSnapshot: mocks.problemSnapshot,
  })),
}));

vi.mock("../application/usePhpTestResults", () => ({
  usePhpTestResults: vi.fn(() => ({ state: "idle" })),
}));
vi.mock("./useJsTestExplorerPanelController", () => ({
  useJsTestExplorerPanelController: mocks.useJsTestExplorerPanelController,
}));

import { useAppTestPanels } from "./useAppTestPanels";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("useAppTestPanels JavaScript test problem composition", () => {
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
    const textClipboard = {
      canWriteText: vi.fn(() => true),
      writeText: vi.fn(async (_text: string) => undefined),
    };
    const jsTestWatchGateway = {} as never;
    mocks.problemSnapshot = snapshot(1, "first failure");

    function Harness() {
      void unrelatedRenderVersion;
      useAppTestPanels({
        jsTestCoverageGateway: {} as never,
        jsTestGateway: {} as never,
        jsTestWatchGateway,
        phpTestGateway: {} as never,
        textClipboard,
        workbench: {
          bottomPanelView: "testResults",
          bottomPanelVisible: true,
          jsTestCoverageVersion: 0,
          jsTestDiscoveryVersion: 0,
          jsTestRunRequestVersion: 0,
          openSourceLocation: vi.fn(),
          phpTestRunRequestVersion: 0,
          notices: visibleNotices,
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
      | [
          {
            readonly openedFilesSnapshot: unknown;
            readonly outputClipboard: unknown;
            readonly watchGateway: unknown;
          },
        ]
      | undefined;
    expect(controllerCall?.[0].openedFilesSnapshot).toMatchObject({
      hadEditorResources: true,
      identities: [{ relativeFilePath: "src/a.test.ts" }, { relativeFilePath: "src/b.test.ts" }],
      truncated: false,
    });
    expect(controllerCall?.[0].outputClipboard).toBe(textClipboard);
    expect(controllerCall?.[0].watchGateway).toBe(jsTestWatchGateway);

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
