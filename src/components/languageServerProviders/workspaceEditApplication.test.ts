import type * as Monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import { applyWorkspaceEditWithOpenModels } from "./workspaceEditApplication";

describe("workspace edit provider authority", () => {
  it("rolls back an open-model commit when authority changes during the host applier", async () => {
    let active = true;
    let content = "before";
    let versionId = 1;
    const setValue = vi.fn((value: string) => {
      content = value;
      versionId += 1;
    });
    const model = {
      getValue: () => content,
      getVersionId: () => versionId,
      pushEditOperations: (_selections: readonly unknown[], edits: readonly { text: string }[]) => {
        content = edits[0]?.text ?? content;
        versionId += 1;
      },
      setValue,
      uri: {
        fsPath: "/project/src/User.php",
        path: "/project/src/User.php",
      },
    };
    const monaco = {
      editor: {
        getModels: () => [model],
      },
      Range: class {
        constructor(
          readonly startLineNumber: number,
          readonly startColumn: number,
          readonly endLineNumber: number,
          readonly endColumn: number,
        ) {}
      },
    } as unknown as typeof Monaco;
    const decision = await applyWorkspaceEditWithOpenModels(
      monaco,
      {
        applyWorkspaceEdit: async (_edit, context) => {
          context.applyOpenModels?.();
          active = false;
        },
        getWorkspaceRoot: () => "/project",
        isProviderRegistrationActive: () => active,
      },
      {
        changes: {
          "file:///project/src/User.php": [
            {
              newText: "after",
              range: {
                end: { character: 6, line: 0 },
                start: { character: 0, line: 0 },
              },
            },
          ],
        },
      },
      "/project",
    );

    expect(decision).toEqual({
      kind: "rejected",
      reason: "inactiveWorkspace",
    });
    expect(content).toBe("before");
    expect(setValue).toHaveBeenCalledWith("before");
  });
});
