import { describe, expect, it } from "vitest";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  normalizeAppSettings,
  normalizeWorkspaceSettings,
} from "./settings";

describe("settings defaults", () => {
  it("creates app and workspace defaults", () => {
    expect(defaultAppSettings()).toEqual({ recentWorkspacePath: null });
    expect(defaultWorkspaceSettings()).toEqual({ intelligenceMode: "basic" });
  });
});

describe("normalizeAppSettings", () => {
  it("accepts valid persisted app settings", () => {
    expect(
      normalizeAppSettings({ recentWorkspacePath: "/project" }),
    ).toEqual({ recentWorkspacePath: "/project" });
    expect(normalizeAppSettings({ recentWorkspacePath: null })).toEqual({
      recentWorkspacePath: null,
    });
  });

  it("falls back for invalid app settings", () => {
    expect(normalizeAppSettings({ recentWorkspacePath: 1 })).toEqual(
      defaultAppSettings(),
    );
    expect(normalizeAppSettings(null)).toEqual(defaultAppSettings());
  });
});

describe("normalizeWorkspaceSettings", () => {
  it("accepts valid persisted workspace settings", () => {
    expect(
      normalizeWorkspaceSettings({ intelligenceMode: "lightSmart" }),
    ).toEqual({ intelligenceMode: "lightSmart" });
  });

  it("falls back for invalid workspace settings", () => {
    expect(normalizeWorkspaceSettings({ intelligenceMode: "unknown" })).toEqual(
      defaultWorkspaceSettings(),
    );
    expect(normalizeWorkspaceSettings(null)).toEqual(defaultWorkspaceSettings());
  });
});
