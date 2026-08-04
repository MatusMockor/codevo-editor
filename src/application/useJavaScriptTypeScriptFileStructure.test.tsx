// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageServerDocumentSymbol } from "../domain/languageServerFeatures";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import { LARGE_SMART_DOCUMENT_STATUS_LABEL } from "../domain/largeDocumentPolicy";
import type { EditorDocument } from "../domain/workspace";
import {
  useJavaScriptTypeScriptFileStructure,
  type JavaScriptTypeScriptFileStructure,
} from "./useJavaScriptTypeScriptFileStructure";

const ROOT = "/workspace";
const SESSION_ID = 7;

const RUNNING_STATUS: LanguageServerRuntimeStatus = {
  capabilities: { ...emptyLanguageServerCapabilities(), documentSymbol: true },
  kind: "running",
  rootPath: ROOT,
  sessionId: SESSION_ID,
};

function typeScriptDocument(path: string, content: string): EditorDocument {
  return { content, language: "typescript", name: path, path, savedContent: content };
}

function documentSymbol(name: string, line: number): LanguageServerDocumentSymbol {
  const range = {
    end: { character: 0, line },
    start: { character: 0, line },
  };

  return {
    children: [],
    containerName: null,
    detail: null,
    kind: 12,
    name,
    range,
    selectionRange: range,
  };
}

function lastMessage(messages: readonly (string | null)[]): string | null {
  return messages.length === 0 ? null : messages[messages.length - 1];
}

interface Harness {
  documentSymbols: ReturnType<typeof vi.fn>;
  hook: () => JavaScriptTypeScriptFileStructure;
  messages: (string | null)[];
  setFileStructureOpen: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

function renderFileStructure(
  symbolsByPath: Record<string, LanguageServerDocumentSymbol[]> = {},
): Harness {
  const container = window.document.createElement("div");
  const root: Root = createRoot(container);
  const captured: { hook: JavaScriptTypeScriptFileStructure | null } = { hook: null };
  const messages: (string | null)[] = [];
  const documentSymbols = vi.fn(
    async (_rootPath: string, path: string) => symbolsByPath[path] ?? [],
  );
  const setFileStructureOpen = vi.fn();

  function TestHarness() {
    captured.hook = useJavaScriptTypeScriptFileStructure({
      currentWorkspaceRootRef: { current: ROOT },
      isLanguageServerSessionActiveForRoot: (rootPath, sessionId) =>
        rootPath === ROOT && sessionId === SESSION_ID,
      languageServerFeaturesGateway: { documentSymbols },
      languageServerRuntimeStatus: RUNNING_STATUS,
      languageServerRuntimeStatusRoot: ROOT,
      reportError: () => undefined,
      setFileStructureOpen,
      setFileStructureScopeCurrent: () => undefined,
      setMessage: (message) => messages.push(message),
      workspaceRoot: ROOT,
    });
    return null;
  }

  act(() => {
    root.render(<TestHarness />);
  });

  return {
    documentSymbols,
    hook: () => captured.hook as JavaScriptTypeScriptFileStructure,
    messages,
    setFileStructureOpen,
    unmount: () => act(() => root.unmount()),
  };
}

describe("useJavaScriptTypeScriptFileStructure large-document policy", () => {
  let harness: Harness | null = null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });

  afterEach(() => {
    harness?.unmount();
    harness = null;
  });

  it("requests document symbols for a policy-eligible document", async () => {
    const path = `${ROOT}/src/small.ts`;
    harness = renderFileStructure({ [path]: [documentSymbol("main", 4)] });
    expect(harness.hook()).not.toBeNull();

    const document = typeScriptDocument(path, "export function main() {}\n".repeat(10));

    await act(async () => {
      expect(harness?.hook().openJavaScriptTypeScriptFileStructure(document)).toBe(true);
    });

    expect(harness.documentSymbols).toHaveBeenCalledTimes(1);
    expect(harness.documentSymbols).toHaveBeenCalledWith(ROOT, path);
    expect(harness.setFileStructureOpen).toHaveBeenCalledWith(true);
    expect(
      harness.hook().javaScriptTypeScriptFileStructureOutlineForDocument(document)?.nodes,
    ).toHaveLength(1);
  });

  it("never requests document symbols for a document over the line limit and states the reason", async () => {
    const path = `${ROOT}/src/huge.ts`;
    harness = renderFileStructure({ [path]: [documentSymbol("main", 1)] });

    const document = typeScriptDocument(path, "\n".repeat(5_000));

    await act(async () => {
      expect(harness?.hook().openJavaScriptTypeScriptFileStructure(document)).toBe(true);
    });

    expect(harness.documentSymbols).not.toHaveBeenCalled();
    expect(harness.setFileStructureOpen).not.toHaveBeenCalled();
    expect(harness.hook().javaScriptTypeScriptFileStructureOutlineForDocument(document)).toBeNull();
    expect(harness.hook().javaScriptTypeScriptFileStructureLoadingForDocument(document)).toBe(
      false,
    );
    expect(lastMessage(harness.messages)).toContain(LARGE_SMART_DOCUMENT_STATUS_LABEL);
    expect(lastMessage(harness.messages)).toContain("File structure is disabled for this file.");
  });

  it("never requests document symbols for a document over the character limit", async () => {
    const path = `${ROOT}/src/wide.ts`;
    harness = renderFileStructure({ [path]: [documentSymbol("main", 1)] });

    const document = typeScriptDocument(path, "a".repeat(256 * 1024 + 1));

    await act(async () => {
      expect(harness?.hook().openJavaScriptTypeScriptFileStructure(document)).toBe(true);
    });

    expect(harness.documentSymbols).not.toHaveBeenCalled();
    expect(lastMessage(harness.messages)).toContain(LARGE_SMART_DOCUMENT_STATUS_LABEL);
  });

  it("re-enables the outline when the exact document drops back under the policy limits", async () => {
    const path = `${ROOT}/src/shrinking.ts`;
    harness = renderFileStructure({ [path]: [documentSymbol("main", 1)] });

    await act(async () => {
      harness
        ?.hook()
        .openJavaScriptTypeScriptFileStructure(typeScriptDocument(path, "\n".repeat(5_000)));
    });

    expect(harness.documentSymbols).not.toHaveBeenCalled();

    const eligibleDocument = typeScriptDocument(path, "export function main() {}\n");

    await act(async () => {
      harness?.hook().openJavaScriptTypeScriptFileStructure(eligibleDocument);
    });

    expect(harness.documentSymbols).toHaveBeenCalledTimes(1);
    expect(
      harness.hook().javaScriptTypeScriptFileStructureOutlineForDocument(eligibleDocument)?.nodes,
    ).toHaveLength(1);
  });

  it("leaves non-JavaScript/TypeScript documents to the PHP structure path", () => {
    harness = renderFileStructure();
    const document: EditorDocument = {
      content: "<?php\n",
      language: "php",
      name: "a.php",
      path: `${ROOT}/a.php`,
      savedContent: "<?php\n",
    };

    act(() => {
      expect(harness?.hook().openJavaScriptTypeScriptFileStructure(document)).toBe(false);
    });

    expect(harness.documentSymbols).not.toHaveBeenCalled();
    expect(harness.messages).toHaveLength(0);
  });
});
