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

  it("lists the redesigned sections in mockup order with PHP kept last", () => {
    expect(SETTINGS_SECTIONS.map((section) => [section.id, section.label])).toEqual([
      ["general", "General"],
      ["agents", "Providers"],
      ["environments", "Environments"],
      ["keymap", "Keybindings"],
      ["index", "Index & languages"],
      ["snippets", "Snippets"],
      ["usage", "Usage"],
      ["archive", "Archive"],
      ["php", "PHP"],
    ]);
  });

  it("routes the legacy appearance section to the General palette row", () => {
    expect(resolveSettingsRoute("appearance")).toEqual({
      section: "general",
      row: "appearance.palette",
    });
    expect(resolveSettingsRoute("usage")).toEqual({ section: "usage", row: null });
    expect(resolveSettingsRoute("archive")).toEqual({ section: "archive", row: null });
  });

  it("files every appearance row and the single updates row under General", () => {
    const general = settingsRowsForSection("general").map((row) => row.id);
    expect(general).toEqual(
      expect.arrayContaining([
        "appearance.palette",
        "appearance.colorScheme",
        "appearance.syntaxTheme",
        "appearance.agentThreadFontSize",
        "appearance.editorFontFamily",
        "appearance.editorFontSize",
        "general.appUpdates",
        "general.statusBar",
        "general.threadAttention",
      ]),
    );
    expect(general).not.toContain("general.updateChannel");
    expect(settingsRowDescriptor("general.statusBar").title).toBe("Editor header items");
    expect(settingsRowsForSection("usage").map((row) => row.id)).toEqual([
      "usage.limits",
      "usage.localActivity",
    ]);
    expect(settingsRowsForSection("archive").map((row) => row.id)).toEqual(["archive.threads"]);
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

  it("prefixes every row id with its own section id, keeping appearance ids under General", () => {
    for (const row of SETTINGS_ROWS) {
      const prefix = row.id.startsWith("appearance.") ? "general" : row.id.split(".")[0];
      expect(row.section).toBe(prefix);
    }
  });

  it("resolves the domain sections onto the redesigned nav", () => {
    expect(resolveSettingsRoute("general")).toEqual({ section: "general", row: null });
    expect(resolveSettingsRoute("keymap")).toEqual({ section: "keymap", row: null });
    expect(resolveSettingsRoute("snippets")).toEqual({ section: "snippets", row: null });
    expect(resolveSettingsRoute("environments")).toEqual({ section: "environments", row: null });
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
    expect(settingsRowDescriptor("appearance.palette").availability).toBe("always");
  });
});
