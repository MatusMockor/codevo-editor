import type * as Monaco from "monaco-editor";
import { describe, expect, it } from "vitest";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import {
  MAX_MONACO_DIAGNOSTIC_ITEMS,
  toBoundedDiagnosticOverviewDecorations,
  toBoundedLocalPhpDiagnosticMarkers,
  toBoundedMonacoDiagnosticMarkers,
  toDiagnosticOverviewDecoration,
  toLocalPhpDiagnostic,
  toMonacoDiagnosticMarker,
  toMonacoInspectionMarker,
  toMonacoSyntaxDiagnosticMarker,
  toSyntaxOverviewDecoration,
} from "./editorDiagnosticMonacoMappings";

class FakeRange {
  constructor(
    readonly startLineNumber: number,
    readonly startColumn: number,
    readonly endLineNumber: number,
    readonly endColumn: number,
  ) {}
}

const monaco = {
  MarkerSeverity: { Error: 8, Hint: 1, Info: 2, Warning: 4 },
  MarkerTag: { Deprecated: 2, Unnecessary: 1 },
  Range: FakeRange,
  Uri: { parse: (value: string) => ({ value }) },
  editor: {
    OverviewRulerLane: { Right: 4 },
    TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
  },
} as unknown as typeof Monaco;

const diagnostic: LanguageServerDiagnostic = {
  character: 2,
  code: 17,
  codeDescriptionHref: "https://example.test/rule/17",
  data: { fix: true },
  line: 3,
  message: "Bad *value*.",
  relatedInformation: [
    {
      character: 0,
      endCharacter: 3,
      endLine: 1,
      line: 1,
      message: "Declared here",
      uri: "file:///workspace/source.php",
    },
  ],
  severity: "warning",
  source: "PHP*LS",
  tags: [1, 2, 99],
};

describe("editor diagnostic Monaco mappings", () => {
  it("maps LSP markers including code links, data, tags and related locations", () => {
    expect(toMonacoDiagnosticMarker(monaco, diagnostic)).toEqual({
      code: { target: { value: "https://example.test/rule/17" }, value: "17" },
      data: { fix: true },
      endColumn: 4,
      endLineNumber: 4,
      message: "Bad *value*.",
      relatedInformation: [
        {
          endColumn: 4,
          endLineNumber: 2,
          message: "Declared here",
          resource: { value: "file:///workspace/source.php" },
          startColumn: 1,
          startLineNumber: 2,
        },
      ],
      severity: 4,
      source: "PHP*LS",
      startColumn: 3,
      startLineNumber: 4,
      tags: [1, 2],
    });
  });

  it("maps overview decorations with escaped markdown and severity colors", () => {
    expect(toDiagnosticOverviewDecoration(monaco, diagnostic)).toEqual({
      options: {
        hoverMessage: { value: "**PHP\\*LS**: Bad \\*value\\*\\." },
        overviewRuler: { color: "#d8b878", position: 4 },
        stickiness: 1,
      },
      range: new FakeRange(4, 3, 4, 4),
    });
  });

  it("escapes literal backslashes in diagnostic markdown", () => {
    const decoration = toDiagnosticOverviewDecoration(monaco, {
      ...diagnostic,
      message: String.raw`Bad \*value*`,
    });

    expect(decoration.options.hoverMessage).toEqual({
      value: String.raw`**PHP\*LS**: Bad \\\*value\*`,
    });
  });

  it("keeps single-line PHP syntax markers visible with a minimum width", () => {
    const syntax = {
      character: 4,
      endCharacter: 4,
      endLine: 2,
      line: 2,
      message: "Unexpected token",
    };
    expect(toMonacoSyntaxDiagnosticMarker(monaco, syntax)).toEqual({
      endColumn: 6,
      endLineNumber: 3,
      message: "Unexpected token",
      severity: 8,
      source: "PHP Syntax",
      startColumn: 5,
      startLineNumber: 3,
    });
    expect(toSyntaxOverviewDecoration(monaco, syntax).range).toEqual(new FakeRange(3, 5, 3, 6));
  });

  it("maps lightweight inspections as unnecessary warnings", () => {
    expect(
      toMonacoInspectionMarker(monaco, {
        character: 1,
        endCharacter: 4,
        endLine: 0,
        kind: "unused-import",
        line: 0,
        message: "Import is unused",
        severity: "warning",
        unnecessary: true,
      }),
    ).toEqual({
      endColumn: 5,
      endLineNumber: 1,
      message: "Import is unused",
      severity: 4,
      source: "PHP Inspection",
      startColumn: 2,
      startLineNumber: 1,
      tags: [1],
    });
  });

  it("normalizes local diagnostics into the shared Problems contract", () => {
    expect(
      toLocalPhpDiagnostic(
        {
          character: 1,
          endCharacter: 4,
          endLine: 0,
          kind: "unused-variable",
          line: 0,
          message: "Variable is unused",
          severity: "warning",
          unnecessary: true,
        },
        "PHP Inspection",
        "warning",
      ),
    ).toEqual({
      character: 1,
      endCharacter: 4,
      endLine: 0,
      line: 0,
      message: "Variable is unused",
      severity: "warning",
      source: "PHP Inspection",
      tags: [1],
    });
  });

  it("bounds marker and overview projections for 100,000 diagnostics", () => {
    const diagnostic: LanguageServerDiagnostic = {
      character: 0,
      line: 0,
      message: "Problem",
      severity: "error",
      source: "typescript",
    };
    const diagnostics = Array<LanguageServerDiagnostic>(100_000).fill(diagnostic);

    expect(toBoundedMonacoDiagnosticMarkers(monaco, diagnostics)).toHaveLength(
      MAX_MONACO_DIAGNOSTIC_ITEMS,
    );
    expect(toBoundedDiagnosticOverviewDecorations(monaco, diagnostics, [])).toHaveLength(
      MAX_MONACO_DIAGNOSTIC_ITEMS,
    );
  });

  it("shares each UI budget across diagnostic sources", () => {
    const diagnostic: LanguageServerDiagnostic = {
      character: 0,
      line: 0,
      message: "Problem",
      severity: "error",
      source: "typescript",
    };
    const syntax = {
      character: 0,
      endCharacter: 1,
      endLine: 0,
      line: 0,
      message: "Syntax problem",
    };
    const inspection = {
      character: 0,
      endCharacter: 1,
      endLine: 0,
      kind: "unused-variable" as const,
      line: 0,
      message: "Unused",
      severity: "warning" as const,
      unnecessary: true,
    };

    expect(
      toBoundedDiagnosticOverviewDecorations(
        monaco,
        Array<LanguageServerDiagnostic>(1_500).fill(diagnostic),
        Array(1_500).fill(syntax),
      ),
    ).toHaveLength(MAX_MONACO_DIAGNOSTIC_ITEMS);
    expect(
      toBoundedLocalPhpDiagnosticMarkers(
        monaco,
        Array(1_500).fill(syntax),
        Array(1_500).fill(inspection),
      ),
    ).toHaveLength(MAX_MONACO_DIAGNOSTIC_ITEMS);
  });
});
