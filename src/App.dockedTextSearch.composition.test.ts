import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const controllerSource = readFileSync(
  new URL("./application/useWorkbenchController.ts", import.meta.url),
  "utf8",
);
const dockedTextSearchPropsSource = readFileSync(
  new URL("./components/dockedTextSearchProps.ts", import.meta.url),
  "utf8",
);
const textSearchWorkbenchSource = readFileSync(
  new URL("./application/useWorkbenchTextSearch.ts", import.meta.url),
  "utf8",
);
const textSearchEnd = "              />";
const textSearchStart = "              <TextSearch\n";

describe("docked text search composition", () => {
  it("assembles every TextSearch prop from the dock owner and workbench", () => {
    const appSearch = sourceSection(appSource, textSearchStart, textSearchEnd);
    const mappings = [
      "dismissedPaths: workbench.dismissedTextSearchPaths",
      "hasMoreResults: workbench.textSearchHasMoreResults",
      "isLoading: workbench.textSearchLoading",
      "isOpen: workbench.textSearchOpen",
      "onChangeOptions: workbench.setTextSearchOptions",
      "onChangeQuery: workbench.setTextSearchQuery",
      "onChangeReplacement: workbench.setTextReplacement",
      "onClose: () => setOpen(false)",
      "onDismissFile: workbench.dismissTextSearchFile",
      "onLoadMore: workbench.loadMoreTextSearchResults",
      "onOpen: workbench.openTextSearchResult",
      "onReplaceAll: workbench.replaceAllInPath",
      "onReplaceInFile: workbench.replaceInFile",
      "onRestoreDismissedFiles: workbench.restoreDismissedTextSearchFiles",
      "options: workbench.textSearchOptions",
      "query: workbench.textSearchQuery",
      "replaceBusy: workbench.textReplaceBusy",
      "replacement: workbench.textReplacement",
      "resultCountLowerBound: workbench.textSearchResultCountLowerBound",
      "results: workbench.textSearchResults",
      "resultsTruncated: workbench.textSearchResultsTruncated",
    ];

    expect(appSearch).toContain("{...dockedTextSearchProps({");
    expect(appSearch).toContain("setOpen: setDockedTextSearchOpen");
    expect(appSearch).toContain("workbench");

    for (const mapping of mappings) {
      expect(dockedTextSearchPropsSource).toContain(mapping);
    }
  });

  it("wires every paging value through the controller and App", () => {
    const controllerReturn = sourceSection(
      controllerSource,
      "  return {\n    activeDocument,",
      "    workspaceTrust,\n  };",
    );
    const appSearch = sourceSection(appSource, textSearchStart, textSearchEnd);
    const pagingValues = [
      {
        controller: "textSearchHasMoreResults",
        presenter: "hasMoreResults: workbench.textSearchHasMoreResults",
      },
      {
        controller: "textSearchResultCountLowerBound",
        presenter: "resultCountLowerBound: workbench.textSearchResultCountLowerBound",
      },
      {
        controller: "textSearchResultsTruncated",
        presenter: "resultsTruncated: workbench.textSearchResultsTruncated",
      },
      {
        controller: "loadMoreTextSearchResults",
        presenter: "onLoadMore: workbench.loadMoreTextSearchResults",
      },
    ];

    expect(appSearch).toContain("{...dockedTextSearchProps({");
    expect(appSearch).toContain("setOpen: setDockedTextSearchOpen");
    expect(appSearch).toContain("workbench");
    expect(controllerSource).toContain(
      "const textSearchWorkbench = useWorkbenchDockedTextSearch({",
    );
    expect(controllerReturn).toContain("...textSearchWorkbench");

    for (const value of pagingValues) {
      expect(textSearchWorkbenchSource).toContain(value.controller);
      expect(dockedTextSearchPropsSource).toContain(value.presenter);
    }
  });

  it("routes early competing-surface closures through the dock owner", () => {
    expect(controllerSource).toContain(
      "const { resetTextSearchState, setTextSearchOpen } = textSearchWorkbench;",
    );
    const hierarchyClosure = sourceSection(
      controllerSource,
      "  const closeSymbolPanelCompetingSurfaces = useCallback(() => {",
      "  const {",
    );
    const fileStructureClosure = sourceSection(
      controllerSource,
      "  const openFileStructureWithInitialQuery = useCallback(",
      "  const openFileStructure = useCallback(",
    );

    expect(hierarchyClosure).toContain("setTextSearchOpen(false)");
    expect(fileStructureClosure).toContain("setTextSearchOpen(false)");
  });
});

function sourceSection(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}
