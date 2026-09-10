import { describe, expect, it } from "vitest";
import {
  SETTINGS_ROWS,
  type SettingsRowAvailability,
  type SettingsRowDescriptor,
  type SettingsRowId,
} from "./settingsRegistry";
import { searchSettingsRows } from "./settingsSearch";

function row(
  id: SettingsRowId,
  title: string,
  description: string | null,
  keywords: ReadonlyArray<string>,
  availability: SettingsRowAvailability = "always",
): SettingsRowDescriptor {
  return { id, title, description, keywords, availability, section: "general" };
}

const rows: ReadonlyArray<SettingsRowDescriptor> = [
  row("general.autoSave", "Zebra crossing", "Formats the file on save.", []),
  row("appearance.theme", "Alpha", null, ["prettier"]),
  row("general.formatOnPaste", "Reformat on save", null, []),
  row("general.formatOnSave", "Format on save", "Runs the formatter.", ["save"]),
  row("php.inlayHints", "Format on paste", null, [], "workspace"),
];

describe("searchSettingsRows", () => {
  it("returns nothing for a blank query", () => {
    expect(searchSettingsRows("   ", rows, true)).toEqual([]);
  });

  it("ranks a title prefix above a title match above a description match", () => {
    const hits = searchSettingsRows("format on save", rows, true);

    expect(hits.map((hit) => hit.row.id)).toEqual([
      "general.formatOnSave",
      "general.formatOnPaste",
      "general.autoSave",
    ]);
    expect(hits[0]?.matchedIn).toBe("title");
    expect(hits[2]?.matchedIn).toBe("description");
  });

  it("matches keywords when the title and description do not", () => {
    const hits = searchSettingsRows("prettier", rows, true);

    expect(hits.map((hit) => hit.row.id)).toEqual(["appearance.theme"]);
    expect(hits[0]?.matchedIn).toBe("keywords");
  });

  it("hides workspace-only rows without a workspace", () => {
    expect(searchSettingsRows("paste", rows, true).map((hit) => hit.row.id)).toEqual([
      "php.inlayHints",
    ]);
    expect(searchSettingsRows("paste", rows, false)).toEqual([]);
  });

  it("caps the result set at the limit", () => {
    expect(searchSettingsRows("o", rows, true, 2)).toHaveLength(2);
    expect(searchSettingsRows("o", rows, true, 0)).toEqual([]);
  });

  it("finds the real on-save settings across sections", () => {
    const hits = searchSettingsRows("on save", SETTINGS_ROWS, true);
    const ids = hits.map((hit) => hit.row.id);

    expect(hits.length).toBeLessThanOrEqual(50);
    expect(ids).toContain("general.formatOnSave");
    expect(ids).toContain("general.optimizeImportsOnSave");
    expect(ids).toContain("index.eslintFixOnSave");
    expect(ids).toContain("php.phpstanAnalyseOnSave");
  });

  it("finds the agent thread text size by title, keyword and description", () => {
    const ids = (query: string): ReadonlyArray<string> =>
      searchSettingsRows(query, SETTINGS_ROWS, true).map((hit) => hit.row.id);

    expect(ids("agent thread text size")).toContain("appearance.agentThreadFontSize");
    expect(ids("font size")).toContain("appearance.agentThreadFontSize");
    expect(ids("zoom")).toContain("appearance.agentThreadFontSize");
  });
});
