// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type * as Monaco from "monaco-editor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhpSyntaxDiagnostic } from "../../domain/phpSyntaxDiagnostics";
import { useEditorModelCachePruning } from "./useEditorModelCachePruning";

describe("useEditorModelCachePruning", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("does not rescan models across a rapid diagnostics publication storm", async () => {
    const models = Array.from({ length: 2_048 }, (_, index) =>
      createModel(`/workspace/src/model-${index}.ts`),
    );
    const getModels = vi.fn(() => models);
    const monaco = {
      editor: {
        getModels,
        onDidCreateModel: () => ({ dispose: () => undefined }),
      },
    } as unknown as typeof Monaco;
    let publishDiagnostics:
      ((diagnostics: Record<string, PhpSyntaxDiagnostic[]>) => void) | undefined;

    function Harness() {
      const [syntaxDiagnosticsByPath, setSyntaxDiagnosticsByPath] = useState<
        Record<string, PhpSyntaxDiagnostic[]>
      >({});
      const [phpInspectionDiagnosticCountsByPath, setPhpInspectionDiagnosticCountsByPath] =
        useState<Record<string, number>>({});
      const [breadcrumbSymbolsByPath, setBreadcrumbSymbolsByPath] = useState({});
      publishDiagnostics = setSyntaxDiagnosticsByPath;
      useEditorModelCachePruning({
        activeDocumentPath: "/workspace/src/model-0.ts",
        breadcrumbSymbolsByPath,
        monaco,
        onLocalPhpDiagnosticsChange: () => undefined,
        phpInspectionDiagnosticCountsByPath,
        setBreadcrumbSymbolsByPath,
        setPhpInspectionDiagnosticCountsByPath,
        setSyntaxDiagnosticsByPath,
        syntaxDiagnosticsByPath,
        workspaceAuthority: monaco,
        workspaceRoot: "/workspace",
      });
      return null;
    }

    await act(async () => root.render(<Harness />));
    expect(getModels).toHaveBeenCalledTimes(1);

    for (let revision = 0; revision < 250; revision += 1) {
      await act(async () => {
        publishDiagnostics?.({
          "/workspace/src/model-0.ts": [
            {
              character: revision,
              endCharacter: revision + 1,
              endLine: 1,
              line: 1,
              message: `diagnostic-${revision}`,
            },
          ],
        });
      });
    }

    expect(getModels).toHaveBeenCalledTimes(1);
  });

  it("does not prune a same-path replacement created before the close batch flushes", async () => {
    const path = "/workspace/src/reopened.ts";
    const first = createDisposableModel(path);
    const replacement = createDisposableModel(path);
    const createListeners = new Set<(model: Monaco.editor.ITextModel) => void>();
    const monaco = {
      editor: {
        getModels: () => [first.model],
        onDidCreateModel: (listener: (model: Monaco.editor.ITextModel) => void) => {
          createListeners.add(listener);
          return { dispose: () => createListeners.delete(listener) };
        },
      },
    } as unknown as typeof Monaco;
    const onLocalPhpDiagnosticsChange = vi.fn();

    function Harness() {
      const [syntaxDiagnosticsByPath, setSyntaxDiagnosticsByPath] = useState<
        Record<string, PhpSyntaxDiagnostic[]>
      >({
        [path]: [
          {
            character: 0,
            endCharacter: 1,
            endLine: 1,
            line: 1,
            message: "retain me",
          },
        ],
      });
      const [phpInspectionDiagnosticCountsByPath, setPhpInspectionDiagnosticCountsByPath] =
        useState<Record<string, number>>({});
      const [breadcrumbSymbolsByPath, setBreadcrumbSymbolsByPath] = useState({});
      useEditorModelCachePruning({
        activeDocumentPath: path,
        breadcrumbSymbolsByPath,
        monaco,
        onLocalPhpDiagnosticsChange,
        phpInspectionDiagnosticCountsByPath,
        setBreadcrumbSymbolsByPath,
        setPhpInspectionDiagnosticCountsByPath,
        setSyntaxDiagnosticsByPath,
        syntaxDiagnosticsByPath,
        workspaceAuthority: monaco,
        workspaceRoot: "/workspace",
      });
      return syntaxDiagnosticsByPath[path] ? "retained" : "pruned";
    }

    await act(async () => root.render(<Harness />));
    onLocalPhpDiagnosticsChange.mockClear();

    await act(async () => {
      first.dispose();
      for (const listener of createListeners) {
        listener(replacement.model);
      }
      await Promise.resolve();
    });

    expect(host.textContent).toBe("retained");
    expect(onLocalPhpDiagnosticsChange).not.toHaveBeenCalled();
  });
});

function createModel(path: string): Monaco.editor.ITextModel {
  return {
    isDisposed: () => false,
    onWillDispose: () => ({ dispose: () => undefined }),
    uri: {
      fsPath: path,
      path,
      scheme: "file",
      toString: () => `file://${path}`,
    },
  } as unknown as Monaco.editor.ITextModel;
}

function createDisposableModel(path: string): {
  readonly dispose: () => void;
  readonly model: Monaco.editor.ITextModel;
} {
  let disposed = false;
  const disposeListeners = new Set<() => void>();
  return {
    dispose: () => {
      for (const listener of [...disposeListeners]) {
        listener();
      }
      disposed = true;
    },
    model: {
      isDisposed: () => disposed,
      onWillDispose: (listener: () => void) => {
        disposeListeners.add(listener);
        return { dispose: () => disposeListeners.delete(listener) };
      },
      uri: {
        fsPath: path,
        path,
        scheme: "file",
        toString: () => `file://${path}`,
      },
    } as unknown as Monaco.editor.ITextModel,
  };
}
