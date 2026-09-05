import { describe, expect, it } from "vitest";
import {
  resolveSettingsRoute,
  settingsRowDescriptor,
  settingsRowsForSection,
  settingsSectionDescriptor,
  SETTINGS_ROWS,
  SETTINGS_SECTIONS,
} from "./settingsRegistry";

describe("settings registry", () => {
  it("keeps every row id unique", () => {
    const ids = SETTINGS_ROWS.map((row) => row.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names the nav sections in the approved order", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
      "general",
      "appearance",
      "agents",
      "keymap",
      "index",
      "php",
      "snippets",
    ]);
  });

  it("gives every section at least one row and only rows of that section", () => {
    for (const section of SETTINGS_SECTIONS) {
      const rows = settingsRowsForSection(section.id);

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.section === section.id)).toBe(true);
    }
  });

  it("places every row in a declared section", () => {
    const sectionIds = new Set(SETTINGS_SECTIONS.map((section) => section.id));

    expect(SETTINGS_ROWS.every((row) => sectionIds.has(row.section))).toBe(true);
  });

  it("prefixes every row id with its own section id", () => {
    for (const row of SETTINGS_ROWS) {
      expect(row.id.startsWith(`${row.section}.`)).toBe(true);
    }
  });

  it("resolves the domain sections onto the redesigned nav", () => {
    expect(resolveSettingsRoute("general")).toEqual({ section: "general", row: null });
    expect(resolveSettingsRoute("keymap")).toEqual({ section: "keymap", row: null });
    expect(resolveSettingsRoute("snippets")).toEqual({ section: "snippets", row: null });
    expect(resolveSettingsRoute("git")).toEqual({
      section: "index",
      row: "index.gitDirectoryMappings",
    });
  });

  it("looks descriptors up by id", () => {
    expect(settingsRowDescriptor("general.formatOnSave").title).toBe("Format on save");
    expect(settingsSectionDescriptor("index").label).toBe("Index & languages");
    expect(() => settingsRowsForSection("php").length).not.toThrow();
  });

  it("marks workspace-scoped rows as workspace availability", () => {
    expect(settingsRowDescriptor("general.formatOnSave").availability).toBe("workspace");
    expect(settingsRowDescriptor("appearance.theme").availability).toBe("always");
  });
});
