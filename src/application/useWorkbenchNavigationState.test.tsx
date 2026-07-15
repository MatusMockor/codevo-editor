// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  useWorkbenchNavigationState,
  type WorkbenchNavigationState,
} from "./useWorkbenchNavigationState";
import type { NavigationHistory } from "../domain/navigation";
import type { EditorRevealTarget } from "../domain/languageServerFeatures";
import type { EditorDocument } from "../domain/workspace";

function editorDocument(path: string): EditorDocument {
  return {
    content: "",
    language: "typescript",
    name: path.split("/").pop() ?? path,
    path,
    savedContent: "",
  };
}

interface Harness {
  navigationState: () => WorkbenchNavigationState;
  setActiveDocument: (document: EditorDocument | null) => void;
  unmount: () => void;
}

function renderWorkbenchNavigationState(
  initialActiveDocument: EditorDocument | null,
): Harness {
  const container = window.document.createElement("div");
  const root = createRoot(container);
  const captured: { navigationState: WorkbenchNavigationState | null } = {
    navigationState: null,
  };
  let setActiveDocumentState: (document: EditorDocument | null) => void =
    () => {};

  function HarnessComponent() {
    const [activeDocument, setActiveDocument] = useState(
      initialActiveDocument,
    );
    const navigationState = useWorkbenchNavigationState({ activeDocument });

    setActiveDocumentState = setActiveDocument;
    captured.navigationState = navigationState;

    return null;
  }

  act(() => {
    root.render(<HarnessComponent />);
  });

  return {
    navigationState: () => {
      if (!captured.navigationState) {
        throw new Error("navigation state hook not mounted");
      }

      return captured.navigationState;
    },
    setActiveDocument: (document: EditorDocument | null) => {
      act(() => {
        setActiveDocumentState(document);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("useWorkbenchNavigationState", () => {
  it("does not let a stale reveal acknowledgement clear a newer request", () => {
    const harness = renderWorkbenchNavigationState(
      editorDocument("/workspace/a.ts"),
    );
    const first: EditorRevealTarget = {
      path: "/workspace/a.ts",
      position: { column: 1, lineNumber: 2 },
    };
    const second: EditorRevealTarget = {
      path: "/workspace/b.ts",
      position: { column: 3, lineNumber: 4 },
    };

    act(() => {
      harness.navigationState().setEditorRevealTarget(first);
      harness.navigationState().setEditorRevealTarget(second);
      harness.navigationState().clearEditorRevealTarget(first);
    });

    expect(harness.navigationState().editorRevealTarget).toBe(second);

    act(() => {
      harness.navigationState().clearEditorRevealTarget(second);
    });

    expect(harness.navigationState().editorRevealTarget).toBeNull();
    harness.unmount();
  });

  it("clears the active editor position when the active document becomes null", () => {
    const harness = renderWorkbenchNavigationState(
      editorDocument("/workspace/a.ts"),
    );

    act(() => {
      harness
        .navigationState()
        .updateActiveEditorPosition({ column: 5, lineNumber: 12 });
    });

    expect(harness.navigationState().activeEditorPosition).toEqual({
      column: 5,
      lineNumber: 12,
    });
    expect(harness.navigationState().activeEditorPositionRef.current).toEqual({
      column: 5,
      lineNumber: 12,
    });

    harness.setActiveDocument(null);

    expect(harness.navigationState().activeEditorPosition).toBeNull();
    expect(harness.navigationState().activeEditorPositionRef.current).toBeNull();

    harness.unmount();
  });

  it("resets and restores navigation history", () => {
    const harness = renderWorkbenchNavigationState(
      editorDocument("/workspace/a.ts"),
    );
    const restoredHistory: NavigationHistory = {
      backStack: [
        {
          path: "/workspace/a.ts",
          position: { column: 3, lineNumber: 4 },
        },
      ],
      forwardStack: [
        {
          path: "/workspace/b.ts",
          position: { column: 1, lineNumber: 8 },
        },
      ],
    };

    act(() => {
      harness.navigationState().restoreHistory(restoredHistory);
    });

    expect(harness.navigationState().navigationHistory).toEqual(restoredHistory);

    act(() => {
      harness.navigationState().resetHistory();
    });

    expect(harness.navigationState().navigationHistory).toEqual({
      backStack: [],
      forwardStack: [],
    });

    act(() => {
      harness.navigationState().restoreHistory(restoredHistory);
    });

    expect(harness.navigationState().navigationHistory).toEqual(restoredHistory);

    harness.unmount();
  });
});
