import type * as Monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import type { LanguageServerLocation } from "../domain/languageServerFeatures";
import { toJavaScriptTypeScriptMonacoLocations } from "./javascriptTypescriptMonacoNavigationLocations";
import { workspaceModelUri } from "./phpMonacoDocumentContext";

describe("toJavaScriptTypeScriptMonacoLocations", () => {
  it.each([1, 100, 1_024])(
    "maps %i existing-model results without a per-result model-list scan",
    (count) => {
      const models = Array.from({ length: count }, (_, index) =>
        createModel(`/workspace/src/location-${index}.ts`),
      );
      const getModels = vi.fn(() => models);
      const monaco = {
        Range: class Range {
          constructor(
            readonly startLineNumber: number,
            readonly startColumn: number,
            readonly endLineNumber: number,
            readonly endColumn: number,
          ) {}
        },
        Uri: {
          file: (path: string) => createUri(`file://${path}`, path),
          parse: (value: string) => createUri(value, value),
        },
        editor: {
          getModels,
          onDidCreateModel: () => ({ dispose: () => undefined }),
        },
      } as unknown as typeof Monaco;
      const locations = Array.from({ length: count }, (_, index): LanguageServerLocation => ({
        range: {
          end: { character: 4, line: index },
          start: { character: 0, line: index },
        },
        uri: `file:///workspace/src/location-${index}.ts`,
      }));

      const mapped = toJavaScriptTypeScriptMonacoLocations(monaco, locations, "/workspace");

      expect(mapped).toHaveLength(count);
      expect(getModels).toHaveBeenCalledTimes(1);
      expect(models.reduce((checks, model) => checks + model.isDisposed.mock.calls.length, 0)).toBe(
        count * 2,
      );
      mapped.forEach((location, index) => {
        expect(location.uri).toBe(models[index]?.uri);
      });
    },
  );
});

function createModel(path: string) {
  const uriString = workspaceModelUri("/workspace", path);
  if (!uriString) {
    throw new Error(`Expected workspace URI for ${path}`);
  }

  return {
    isDisposed: vi.fn(() => false),
    onWillDispose: () => ({ dispose: () => undefined }),
    uri: createUri(uriString, path),
  } as unknown as Monaco.editor.ITextModel & {
    isDisposed: ReturnType<typeof vi.fn<() => boolean>>;
  };
}

function createUri(value: string, path: string): Monaco.Uri {
  return {
    fsPath: path,
    path,
    scheme: value.startsWith("file:") ? "file" : "codevo-workspace",
    toString: () => value,
  } as Monaco.Uri;
}
