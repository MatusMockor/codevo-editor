import { describe, expect, it } from "vitest";
import {
  editorDrawerMoreViews,
  editorDrawerTabs,
  editorDrawerViewAvailable,
  editorDrawerViewLabel,
  workbenchPanelPlacement,
  type EditorDrawerAvailability,
} from "./editorDrawer";

const NOTHING: EditorDrawerAvailability = {
  artisan: false,
  expressRoutes: false,
  javaScriptWorkspace: false,
  nette: false,
  symfony: false,
  phpWorkspace: false,
};

const JS: EditorDrawerAvailability = { ...NOTHING, expressRoutes: true, javaScriptWorkspace: true };

describe("workbenchPanelPlacement", () => {
  it("routes the terminal to the bottom slot and every other view to the drawer", () => {
    expect(workbenchPanelPlacement("terminal", true)).toEqual({ terminal: true, drawer: null });
    expect(workbenchPanelPlacement("problems", true)).toEqual({
      terminal: false,
      drawer: "problems",
    });
    expect(workbenchPanelPlacement("runtime", true)).toEqual({
      terminal: false,
      drawer: "runtime",
    });
  });

  it("shows nothing while the panel is hidden", () => {
    expect(workbenchPanelPlacement("terminal", false)).toEqual({ terminal: false, drawer: null });
    expect(workbenchPanelPlacement("problems", false)).toEqual({ terminal: false, drawer: null });
  });
});

describe("editorDrawerTabs", () => {
  it("always shows Problems as the only primary tab", () => {
    expect(editorDrawerTabs("problems", NOTHING).map((tab) => tab.label)).toEqual(["Problems"]);
  });

  it("adds the active secondary view as a transient second tab", () => {
    const tabs = editorDrawerTabs("search", JS);

    expect(tabs.map((tab) => [tab.view, tab.transient])).toEqual([
      ["problems", false],
      ["search", true],
    ]);
  });

  it("falls back to Problems when the active view is not available in this workspace", () => {
    expect(editorDrawerTabs("symfony", NOTHING).map((tab) => tab.view)).toEqual(["problems"]);
  });
});

describe("editorDrawerMoreViews", () => {
  it("lists the always-available secondary views for a plain workspace", () => {
    expect(editorDrawerMoreViews(NOTHING).map((tab) => tab.view)).toEqual([
      "search",
      "index",
      "runtime",
      "history",
    ]);
  });

  it("adds framework and test views by availability", () => {
    expect(editorDrawerMoreViews(JS).map((tab) => tab.view)).toEqual([
      "search",
      "testResults",
      "index",
      "runtime",
      "history",
      "expressRoutes",
      "packages",
    ]);
    expect(
      editorDrawerMoreViews({ ...NOTHING, artisan: true, phpWorkspace: true }).map(
        (tab) => tab.view,
      ),
    ).toEqual(["search", "testResults", "index", "runtime", "history", "routes", "phpTree"]);
  });
});

describe("editorDrawerViewLabel", () => {
  it("names every view the way the old bottom panel did, with the new PHP labels", () => {
    expect(editorDrawerViewLabel("testResults")).toBe("Tests");
    expect(editorDrawerViewLabel("routes")).toBe("Routes");
    expect(editorDrawerViewLabel("expressRoutes")).toBe("Express routes");
    expect(editorDrawerViewLabel("phpTree")).toBe("PHP structure");
  });

  it("treats Problems as always available", () => {
    expect(editorDrawerViewAvailable("problems", NOTHING)).toBe(true);
    expect(editorDrawerViewAvailable("nette", NOTHING)).toBe(false);
  });
});
