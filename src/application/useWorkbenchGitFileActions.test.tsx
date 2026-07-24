// @vitest-environment jsdom

import { useEffect, useState, type MutableRefObject } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import { useWorkbenchGitFileActions } from "./useWorkbenchGitFileActions";

type Actions = ReturnType<typeof useWorkbenchGitFileActions>;

describe("useWorkbenchGitFileActions", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("routes a previously captured blame callback to the latest active document", () => {
    const activeDocumentRef: MutableRefObject<EditorDocument | null> = {
      current: editorDocument("/workspace/src/First.php"),
    };
    let actions: Actions | null = null;
    let enabledPaths = new Set<string>();

    act(() => {
      root.render(
        <Harness
          activeDocumentRef={activeDocumentRef}
          onSnapshot={(nextActions, nextEnabledPaths) => {
            actions = nextActions;
            enabledPaths = nextEnabledPaths;
          }}
        />,
      );
    });
    const previouslyCapturedToggle = requireActions(actions).toggleGitBlame;
    activeDocumentRef.current = editorDocument("/workspace/src/Second.php");

    act(() => previouslyCapturedToggle());

    expect(enabledPaths.has("/workspace/src/Second.php")).toBe(true);
    expect(enabledPaths.has("/workspace/src/First.php")).toBe(false);
  });
});

function Harness({
  activeDocumentRef,
  onSnapshot,
}: {
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  onSnapshot(actions: Actions, enabledPaths: Set<string>): void;
}) {
  const [enabledPaths, setEnabledPaths] = useState(new Set<string>());
  const actions = useWorkbenchGitFileActions({
    activeDocumentRef,
    currentWorkspaceRootRef: { current: "/workspace" },
    gitGateway: { blame: vi.fn(async () => []) },
    openFile: vi.fn(async () => true),
    openFileHistory: vi.fn(async () => undefined),
    resolveGitRepositoryTarget: vi.fn(() => null),
    setGitBlameEnabledPaths: setEnabledPaths,
    showBottomPanelView: vi.fn(),
    workspaceFiles: { readTextFile: vi.fn(async () => "") },
  });

  useEffect(() => onSnapshot(actions, enabledPaths), [actions, enabledPaths, onSnapshot]);
  return null;
}

function requireActions(actions: Actions | null): Actions {
  if (!actions) throw new Error("Hook actions were not captured.");
  return actions;
}

function editorDocument(path: string): EditorDocument {
  const segments = path.split("/");
  return {
    content: "<?php",
    language: "php",
    name: segments[segments.length - 1] ?? path,
    path,
    savedContent: "<?php",
  };
}
