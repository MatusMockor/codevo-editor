import { describe, expect, it } from "vitest";
import type { Command, CommandContext } from "../application/commandRegistry";
import type { ProjectSymbolSearchResult } from "./projectSymbols";
import type { FileSearchResult } from "./workspace";
import {
  buildSearchEverywhereModel,
  flattenSearchEverywhereItems,
  type SearchEverywhereModel,
} from "./searchEverywhere";

function fileResult(name: string): FileSearchResult {
  return {
    name,
    path: `/workspace/src/${name}`,
    relativePath: `src/${name}`,
  };
}

function symbolResult(name: string): ProjectSymbolSearchResult {
  return {
    column: 1,
    containerName: null,
    fullyQualifiedName: `App\\${name}`,
    kind: "class",
    lineNumber: 10,
    name,
    path: `/workspace/app/${name}.php`,
    relativePath: `app/${name}.php`,
  };
}

const context: CommandContext = {
  hasWorkspace: true,
  hasActiveDocument: true,
  activeDocumentDirty: false,
};

function command(id: string, title: string, enabled = true): Command {
  return {
    id,
    title,
    category: "Editor",
    isEnabled: () => enabled,
    run: () => {},
  };
}

describe("buildSearchEverywhereModel", () => {
  it("groups results into Files, Symbols and Actions sections", () => {
    const model = buildSearchEverywhereModel({
      query: "",
      files: [fileResult("User.ts")],
      symbols: [symbolResult("User")],
      commands: [command("editor.save", "Save File")],
      context,
    });

    expect(model.sections.map((section) => section.kind)).toEqual([
      "file",
      "symbol",
      "action",
    ]);
    expect(model.sections[0].label).toBe("Files");
    expect(model.sections[1].label).toBe("Symbols");
    expect(model.sections[2].label).toBe("Actions");
  });

  it("omits empty sections", () => {
    const model = buildSearchEverywhereModel({
      query: "user",
      files: [fileResult("User.ts")],
      symbols: [],
      commands: [],
      context,
    });

    expect(model.sections.map((section) => section.kind)).toEqual(["file"]);
  });

  it("filters commands by query against title, category and id", () => {
    const model = buildSearchEverywhereModel({
      query: "save",
      files: [],
      symbols: [],
      commands: [
        command("editor.save", "Save File"),
        command("editor.closeTab", "Close"),
      ],
      context,
    });

    const actions = model.sections.find((section) => section.kind === "action");
    expect(actions?.items.map((item) => item.label)).toEqual(["Save File"]);
  });

  it("drops disabled commands", () => {
    const model = buildSearchEverywhereModel({
      query: "save",
      files: [],
      symbols: [],
      commands: [command("editor.save", "Save File", false)],
      context,
    });

    expect(
      model.sections.some((section) => section.kind === "action"),
    ).toBe(false);
  });

  it("returns all enabled commands when the query is empty", () => {
    const model = buildSearchEverywhereModel({
      query: "",
      files: [],
      symbols: [],
      commands: [
        command("editor.save", "Save File"),
        command("editor.closeTab", "Close"),
      ],
      context,
    });

    const actions = model.sections.find((section) => section.kind === "action");
    expect(actions?.items).toHaveLength(2);
  });

  it("carries the source payload on each item for dispatch", () => {
    const file = fileResult("User.ts");
    const symbol = symbolResult("User");
    const cmd = command("editor.save", "Save File");

    const model = buildSearchEverywhereModel({
      query: "",
      files: [file],
      symbols: [symbol],
      commands: [cmd],
      context,
    });

    const fileItem = model.sections[0].items[0];
    const symbolItem = model.sections[1].items[0];
    const actionItem = model.sections[2].items[0];

    expect(fileItem).toMatchObject({ kind: "file", file });
    expect(symbolItem).toMatchObject({ kind: "symbol", symbol });
    expect(actionItem).toMatchObject({ kind: "action", command: cmd });
  });

  it("assigns each item a unique stable id", () => {
    const model = buildSearchEverywhereModel({
      query: "",
      files: [fileResult("User.ts"), fileResult("UserController.ts")],
      symbols: [symbolResult("User")],
      commands: [command("editor.save", "Save File")],
      context,
    });

    const ids = flattenSearchEverywhereItems(model).map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("flattenSearchEverywhereItems", () => {
  it("returns items in section order for keyboard navigation", () => {
    const model: SearchEverywhereModel = buildSearchEverywhereModel({
      query: "",
      files: [fileResult("User.ts")],
      symbols: [symbolResult("User")],
      commands: [command("editor.save", "Save File")],
      context,
    });

    const flat = flattenSearchEverywhereItems(model);
    expect(flat.map((item) => item.kind)).toEqual(["file", "symbol", "action"]);
  });

  it("returns an empty list when there are no results", () => {
    const model = buildSearchEverywhereModel({
      query: "nothing",
      files: [],
      symbols: [],
      commands: [],
      context,
    });

    expect(flattenSearchEverywhereItems(model)).toEqual([]);
  });
});
