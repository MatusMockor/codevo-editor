// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import {
  createWorkbenchRevealPathPort,
  useWorkbenchTaskDebugNavigationCoordinator,
} from "./useWorkbenchTaskDebugCoordinator";

describe("useWorkbenchTaskDebugNavigationCoordinator", () => {
  it("adapts the exact bounded reveal command without transforming rejection", async () => {
    const rejected = new Error("native reveal failed");
    const invokeCommand = vi.fn(async () => {
      throw rejected;
    });
    const port = createWorkbenchRevealPathPort(invokeCommand);
    const request = { path: "/workspace/server.ts", rootPath: "/workspace" };

    await expect(port.revealPath(request)).rejects.toBe(rejected);
    expect(invokeCommand).toHaveBeenCalledWith("reveal_item_in_dir", request);
  });

  it("suppresses a reveal rejection after an exact owner A to B to A transition", async () => {
    let rejectReveal!: (error: unknown) => void;
    const reveal = new Promise<void>((_resolve, reject) => {
      rejectReveal = reject;
    });
    const reportError = vi.fn();
    const rootPath = "/workspace";
    const ownerA = createWorkspaceRuntimeOwner("workspace-a", rootPath);
    const ownerB = createWorkspaceRuntimeOwner("workspace-b", rootPath);
    const replacementA = createWorkspaceRuntimeOwner("workspace-a", rootPath);
    const runtimeOwnerRef = { current: ownerA };
    const currentWorkspaceRootRef = { current: rootPath };
    const revealPath = vi.fn(() => reveal);
    const root = createRoot(document.createElement("div"));
    let result: ReturnType<typeof useWorkbenchTaskDebugNavigationCoordinator> | null = null;

    function Harness() {
      result = useWorkbenchTaskDebugNavigationCoordinator({
        activeDocumentRef: { current: null },
        currentWorkspaceRootRef,
        openNavigationTarget: vi.fn() as never,
        projectSymbolSearch: vi.fn() as never,
        reportErrorForActiveWorkspaceRoot: reportError,
        revealPathGateway: { revealPath },
        runInActiveTerminal: vi.fn(),
        setBottomPanelView: vi.fn(),
        setBottomPanelVisible: vi.fn(),
        setJsTestRunRequestVersion: vi.fn(),
        setMessage: vi.fn(),
        setPhpTestRunRequestVersion: vi.fn(),
        workspaceDescriptor: null,
        workspaceRoot: rootPath,
        workspaceRuntimeOwnerRef: runtimeOwnerRef,
      });
      return null;
    }

    act(() => root.render(<Harness />));
    act(() =>
      result!.revealEntry({ kind: "file", name: "server.ts", path: "/workspace/server.ts" }),
    );
    expect(revealPath).toHaveBeenCalledWith({
      path: "/workspace/server.ts",
      rootPath,
    });

    runtimeOwnerRef.current = ownerB;
    runtimeOwnerRef.current = replacementA;
    rejectReveal(new Error("stale reveal"));
    await act(async () => Promise.resolve());

    expect(reportError).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
