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
  row("general.terminalShellIntegration", "Zebra crossing", "Formats the file on save.", []),
  row("appearance.palette", "Alpha", null, ["prettier"]),
  row("general.workspaceRoot", "Reformat on save", null, []),
  row("general.trustedWorkspace", "Format on save", "Runs the formatter.", ["save"]),
  row("git.directoryMappings", "Format on paste", null, [], "workspace"),
];

describe("searchSettingsRows", () => {
  it("returns nothing for a blank query", () => {
    expect(searchSettingsRows("   ", rows, true)).toEqual([]);
  });

  it("ranks a title prefix above a title match above a description match", () => {
    const hits = searchSettingsRows("format on save", rows, true);

    expect(hits.map((hit) => hit.row.id)).toEqual([
      "general.trustedWorkspace",
      "general.workspaceRoot",
      "general.terminalShellIntegration",
    ]);
    expect(hits[0]?.matchedIn).toBe("title");
    expect(hits[2]?.matchedIn).toBe("description");
  });

  it("matches keywords when the title and description do not", () => {
    const hits = searchSettingsRows("prettier", rows, true);

    expect(hits.map((hit) => hit.row.id)).toEqual(["appearance.palette"]);
    expect(hits[0]?.matchedIn).toBe("keywords");
  });

  it("hides workspace-only rows without a workspace", () => {
    expect(searchSettingsRows("paste", rows, true).map((hit) => hit.row.id)).toEqual([
      "git.directoryMappings",
    ]);
    expect(searchSettingsRows("paste", rows, false)).toEqual([]);
  });

  it("caps the result set at the limit", () => {
    expect(searchSettingsRows("o", rows, true, 2)).toHaveLength(2);
    expect(searchSettingsRows("o", rows, true, 0)).toEqual([]);
  });

  it("finds the git mapping rows and no removed editor setting", () => {
    const ids = (query: string): ReadonlyArray<string> =>
      searchSettingsRows(query, SETTINGS_ROWS, true).map((hit) => hit.row.id);

    expect(ids("git")).toEqual(
      expect.arrayContaining(["git.directoryMappingsAuto", "git.directoryMappings"]),
    );
    for (const query of ["phpstan", "minimap", "format on save", "snippet"]) {
      expect(
        ids(query).filter((id) => /^(php|index|snippets)\./u.test(id) || id.endsWith("minimap")),
      ).toEqual([]);
    }
  });

  it("finds the agent thread text size by title, keyword and description", () => {
    const ids = (query: string): ReadonlyArray<string> =>
      searchSettingsRows(query, SETTINGS_ROWS, true).map((hit) => hit.row.id);

    expect(ids("agent thread text size")).toContain("appearance.agentThreadFontSize");
    expect(ids("font size")).toContain("appearance.agentThreadFontSize");
    expect(ids("zoom")).toContain("appearance.agentThreadFontSize");
  });

  it("finds the updates row and no update track row", () => {
    expect(searchSettingsRows("update", SETTINGS_ROWS, false).map((hit) => hit.row.id)).toContain(
      "general.appUpdates",
    );
    for (const query of ["track", "stable", "beta", "channel"]) {
      const ids = searchSettingsRows(query, SETTINGS_ROWS, false).map((hit) => hit.row.id);
      expect(ids).not.toContain("general.updateChannel");
    }
    expect(SETTINGS_ROWS.some((row) => row.title === "Update track")).toBe(false);
  });

  it("finds the new thread start block by provider, model, effort and its title", () => {
    for (const query of ["default provider", "provider", "model", "effort", "new thread"]) {
      const ids = searchSettingsRows(query, SETTINGS_ROWS, false).map((hit) => hit.row.id);

      expect(ids).toContain("agents.defaultProvider");
    }

    const [first] = searchSettingsRows("start new threads", SETTINGS_ROWS, false);

    expect(first?.row.id).toBe("agents.defaultProvider");
    expect(first?.matchedIn).toBe("title");
  });

  it("finds the launch source row by last used, remember and project", () => {
    for (const query of ["last used", "remember", "project", "default", "used before"]) {
      const ids = searchSettingsRows(query, SETTINGS_ROWS, false).map((hit) => hit.row.id);

      expect(ids).toContain("agents.newThreadLaunchSource");
    }

    const [first] = searchSettingsRows("in projects you have", SETTINGS_ROWS, false);

    expect(first?.row.id).toBe("agents.newThreadLaunchSource");
    expect(first?.matchedIn).toBe("title");
  });

  it("finds project grouping and project connections in the environments servers row", () => {
    for (const query of [
      "project grouping",
      "grouping",
      "repository",
      "checkout",
      "separate",
      "project connections",
      "connections",
    ]) {
      const hits = searchSettingsRows(query, SETTINGS_ROWS, false);
      const hit = hits.find((candidate) => candidate.row.id === "environments.servers");
      expect(hit?.row.section).toBe("environments");
      expect(hit?.matchedIn).toBe("keywords");
    }
  });

  it("finds the MCP servers page by every keyword a user would try", () => {
    for (const query of ["mcp", "server", "tool", "connector", "auth", "mcp servers"]) {
      const hit = searchSettingsRows(query, SETTINGS_ROWS, false).find(
        (candidate) => candidate.row.id === "mcp.servers",
      );

      expect(hit?.row.section, query).toBe("mcp");
    }

    const [first] = searchSettingsRows("mcp servers", SETTINGS_ROWS, false);

    expect(first?.row.id).toBe("mcp.servers");
    expect(first?.matchedIn).toBe("title");
  });
});
