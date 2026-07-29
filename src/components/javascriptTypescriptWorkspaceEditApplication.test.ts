import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import type { LanguageServerWorkspaceEdit } from "../domain/languageServerFeatures";
import { applyJavaScriptTypeScriptWorkspaceEditWithOpenModels } from "./javascriptTypescriptWorkspaceEditApplication";
import { workspaceModelUri } from "./phpMonacoDocumentContext";

describe("applyJavaScriptTypeScriptWorkspaceEditWithOpenModels", () => {
  it("prefers the dirty workspace tab when a duplicate file model also exists", async () => {
    const path = "/workspace/src/target.ts";
    const workspaceUri = workspaceModelUri("/workspace", path)!;
    const workspaceModel = editableModel(
      "old\ntyped line one\ntyped line two\ntyped line three\n",
      {
        scheme: "workspace-file",
        toString: () => workspaceUri,
      },
    );
    const transientModel = editableModel("old\n", {
      fsPath: path,
      path,
      scheme: "file",
      toString: () => `file://${path}`,
    });
    const monaco = {
      editor: {
        getModels: () => [workspaceModel, transientModel],
      },
    } as unknown as typeof Monaco;
    const edit: LanguageServerWorkspaceEdit = {
      changes: {
        [`file://${path}`]: [
          {
            newText: "renamed",
            range: {
              end: { character: 3, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
    };

    await expect(
      applyJavaScriptTypeScriptWorkspaceEditWithOpenModels(
        monaco,
        edit,
        "/workspace",
        undefined,
        () => true,
      ),
    ).resolves.toBe(true);

    expect(workspaceModel.getValue()).toBe(
      "renamed\ntyped line one\ntyped line two\ntyped line three\n",
    );
    expect(transientModel.getValue()).toBe("old\n");
  });
});

function editableModel(content: string, uri: object): Monaco.editor.ITextModel {
  let value = content;
  let version = 1;
  const model = {
    getValue: vi.fn(() => value),
    getVersionId: vi.fn(() => version),
    pushEditOperations: vi.fn(
      (
        _selections: unknown[],
        edits: Array<{ text: string }>,
        _cursorStateComputer: () => null,
      ) => {
        value = `${edits[0]?.text ?? ""}${value.slice(3)}`;
        version += 1;
        return null;
      },
    ),
    setValue: vi.fn((nextValue: string) => {
      value = nextValue;
      version += 1;
    }),
    uri,
  };
  return model as unknown as Monaco.editor.ITextModel;
}
