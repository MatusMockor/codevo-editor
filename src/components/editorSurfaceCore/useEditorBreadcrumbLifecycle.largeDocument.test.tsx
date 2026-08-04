// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LARGE_SMART_DOCUMENT_LINE_LIMIT } from "../../domain/largeDocumentPolicy";
import type {
  JavaScriptTypeScriptLanguageServerFeaturesGateway,
  LanguageServerDocumentSymbol,
  LanguageServerFeaturesGateway,
} from "../../domain/languageServerFeatures";
import type { EditorDocument } from "../../domain/workspace";
import { useEditorBreadcrumbLifecycle } from "./useEditorBreadcrumbLifecycle";

const LARGE_CONTENT = "const value = 1;\n".repeat(LARGE_SMART_DOCUMENT_LINE_LIMIT + 1);
const ELIGIBLE_CONTENT = "export const user = 1;\n";

function symbol(name: string): LanguageServerDocumentSymbol {
  return {
    children: [],
    containerName: null,
    detail: null,
    kind: 12,
    name,
    range: { end: { character: 0, line: 1 }, start: { character: 0, line: 0 } },
    selectionRange: { end: { character: 1, line: 0 }, start: { character: 0, line: 0 } },
  } as unknown as LanguageServerDocumentSymbol;
}

function typescriptDocument(content: string): EditorDocument {
  return {
    content,
    language: "typescript",
    name: "large-20k.ts",
    path: "/project/src/large-20k.ts",
    savedContent: content,
  };
}

describe("useEditorBreadcrumbLifecycle large JavaScript/TypeScript documents", () => {
  let host: HTMLDivElement;
  let root: Root;
  const documentSymbols = vi.fn(async () => [symbol("processEvent1")]);
  const phpDocumentSymbols = vi.fn(async () => [symbol("UserController")]);
  const setBreadcrumbSymbolsByPath = vi.fn();
  const errorReporter = vi.fn();
  let activeDocument: EditorDocument | null = null;
  let activeDocumentIsLargeSmart = false;

  function Harness() {
    useEditorBreadcrumbLifecycle({
      activeDocument,
      activeDocumentIsLargeSmart,
      activeDocumentRef: { current: activeDocument },
      errorReporterRef: { current: errorReporter },
      flushPendingLanguageServerDocument: async () => undefined,
      isLanguageServerDocumentRequestLeaseCurrentRef: { current: undefined },
      isLanguageServerDocumentSyncedRef: { current: () => true },
      javaScriptTypeScriptFeaturesGateway: {
        documentSymbols,
      } as unknown as JavaScriptTypeScriptLanguageServerFeaturesGateway,
      languageServerFeaturesGateway: {
        documentSymbols: phpDocumentSymbols,
      } as unknown as LanguageServerFeaturesGateway,
      requestLanguageServerDocumentLeaseRef: { current: undefined },
      runtime: null,
      runtimeStatusRef: { current: null },
      setBreadcrumbSymbolsByPath,
      workspaceRoot: "/project",
    });
    return null;
  }

  async function renderHarness() {
    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    documentSymbols.mockClear();
    phpDocumentSymbols.mockClear();
    setBreadcrumbSymbolsByPath.mockClear();
    errorReporter.mockClear();
    activeDocumentIsLargeSmart = false;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("requests no document symbols for a policy-large TypeScript document", async () => {
    activeDocument = typescriptDocument(LARGE_CONTENT);

    await renderHarness();

    expect(documentSymbols).not.toHaveBeenCalled();
    expect(errorReporter).not.toHaveBeenCalled();
  });

  it("publishes an empty breadcrumb trail instead of a partial one for a policy-large document", async () => {
    activeDocument = typescriptDocument(LARGE_CONTENT);

    await renderHarness();

    const publishedTrails = setBreadcrumbSymbolsByPath.mock.calls.map(([update]) =>
      typeof update === "function" ? update({}) : update,
    );

    expect(
      publishedTrails.every((trail) => (trail["/project/src/large-20k.ts"] ?? []).length === 0),
    ).toBe(true);
  });

  it("requests document symbols for an eligible TypeScript document", async () => {
    activeDocument = typescriptDocument(ELIGIBLE_CONTENT);

    await renderHarness();

    expect(documentSymbols).toHaveBeenCalledTimes(1);
    expect(documentSymbols).toHaveBeenCalledWith("/project", "/project/src/large-20k.ts");
    expect(errorReporter).not.toHaveBeenCalled();
  });
});
