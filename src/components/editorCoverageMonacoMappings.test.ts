import { describe, expect, it } from "vitest";
import type * as Monaco from "monaco-editor";
import {
  phpCoverageModelMatchesDocument,
  toPrecomputedCoverageMonacoDecoration,
} from "./editorCoverageMonacoMappings";

describe("precomputed coverage Monaco mapping", () => {
  it("maps a PHP-compatible precomputed line without importing a coverage parser", () => {
    const monaco = {
      editor: { TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 } },
      Range: class {
        constructor(
          readonly startLineNumber: number,
          readonly startColumn: number,
          readonly endLineNumber: number,
          readonly endColumn: number,
        ) {}
      },
    } as unknown as typeof Monaco;
    expect(
      toPrecomputedCoverageMonacoDecoration(monaco, {
        hits: 3,
        lineNumber: 7,
        status: "covered",
      }),
    ).toMatchObject({
      options: {
        hoverMessage: { value: "Coverage: covered (3 hits)." },
        linesDecorationsClassName: "coverage-gutter coverage-covered-gutter",
        stickiness: 1,
      },
      range: { startLineNumber: 7, startColumn: 1, endLineNumber: 7, endColumn: 1 },
    });
  });

  it("matches exact PHP model paths through Windows aliases without prefix collisions", () => {
    const model = (path: string) =>
      ({ uri: { fsPath: path, path, scheme: "file" } }) as unknown as Monaco.editor.ITextModel;
    expect(
      phpCoverageModelMatchesDocument(
        model("c:\\WORKSPACE\\src\\App.php"),
        "C:\\workspace\\SRC\\app.PHP",
      ),
    ).toBe(true);
    expect(
      phpCoverageModelMatchesDocument(model("/workspace-other/App.php"), "/workspace/App.php"),
    ).toBe(false);
    expect(phpCoverageModelMatchesDocument(model("/Workspace/App.php"), "/workspace/App.php")).toBe(
      false,
    );
  });
});
