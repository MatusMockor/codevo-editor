import { describe, expect, it } from "vitest";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";
import {
  bestIndexedSymbolMatch,
  editorPositionFromProjectSymbol,
} from "./projectSymbolNavigation";

function symbol(
  overrides: Partial<ProjectSymbolSearchResult>,
): ProjectSymbolSearchResult {
  return {
    column: 4,
    containerName: null,
    fullyQualifiedName: "App\\Services\\ReportService",
    kind: "class",
    lineNumber: 12,
    name: "ReportService",
    path: "/workspace/app/Services/ReportService.php",
    relativePath: "app/Services/ReportService.php",
    ...overrides,
  };
}

describe("projectSymbolNavigation", () => {
  it("prefers exact symbol matches outside the active file", () => {
    const activeFileMatch = symbol({
      path: "/workspace/app/Active.php",
      relativePath: "app/Active.php",
    });
    const externalMatch = symbol({
      path: "/workspace/app/External.php",
      relativePath: "app/External.php",
    });

    expect(
      bestIndexedSymbolMatch(
        [activeFileMatch, externalMatch],
        "ReportService",
        "/workspace/app/Active.php",
      ),
    ).toBe(externalMatch);
  });

  it("falls back to an exact match in the active file", () => {
    const activeFileMatch = symbol({
      path: "/workspace/app/Active.php",
      relativePath: "app/Active.php",
    });

    expect(
      bestIndexedSymbolMatch(
        [activeFileMatch],
        "App\\Services\\ReportService",
        "/workspace/app/Active.php",
      ),
    ).toBe(activeFileMatch);
  });

  it("does not return fuzzy symbol matches", () => {
    expect(
      bestIndexedSymbolMatch(
        [symbol({ name: "ReportServiceFactory" })],
        "ReportService",
        "/workspace/app/Active.php",
      ),
    ).toBeNull();
  });

  it("normalizes invalid symbol positions to Monaco's one-based range", () => {
    expect(
      editorPositionFromProjectSymbol(symbol({ column: 0, lineNumber: -3 })),
    ).toEqual({ column: 1, lineNumber: 1 });
  });
});
