// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import type { BackgroundTokenizer } from "../../domain/backgroundTokenizer";
import type { EditorDocument } from "../../domain/workspace";
import { useEditorActiveModelLifecycle } from "./useEditorActiveModelLifecycle";

describe("useEditorActiveModelLifecycle large JS/TS tokenization", () => {
  it("never starts the background tokenizer for a custom-policy 3 MiB TypeScript document", () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    const root = createRoot(host);
    const activeDocument: EditorDocument = {
      content: "x".repeat(3 * 1024 * 1024),
      language: "typescript",
      name: "large.ts",
      path: "/workspace/large.ts",
      savedContent: "",
    };
    const tokenizer = { start: vi.fn(), stop: vi.fn() };
    let modelChange: (() => void) | undefined;
    const editor = {
      onDidChangeModel: vi.fn((listener: () => void) => {
        modelChange = listener;
        return { dispose: vi.fn() };
      }),
    } as unknown as Monaco.editor.IStandaloneCodeEditor;

    function Harness() {
      useEditorActiveModelLifecycle({
        activeDocumentContent: activeDocument.content,
        activeDocumentContentReady: false,
        activeDocumentPath: activeDocument.path,
        activeDocumentRef: { current: activeDocument },
        backgroundTokenizerRef: { current: tokenizer as unknown as BackgroundTokenizer },
        editor,
        generatedSurfaceId: "surface-1",
        groupId: "group-1",
        isOpeningFile: false,
        largeSmartDocumentPolicyRef: {
          current: { characterLimit: 10 * 1024 * 1024, lineLimit: 200_000 },
        },
        monaco: null,
        runtime: null,
        runtimeRegistrationRef: { current: {} as never },
        workspaceRoot: "/workspace",
        workspaceRootRef: { current: "/workspace" },
      });
      return null;
    }

    act(() => root.render(<Harness />));
    act(() => modelChange?.());

    expect(tokenizer.stop).toHaveBeenCalledOnce();
    expect(tokenizer.start).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
