import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop window chrome config", () => {
  it("uses app-rendered chrome on Linux and Windows", () => {
    const config = readJson("src-tauri/tauri.conf.json");
    const windowConfig = config.app.windows[0];

    expect(windowConfig.label).toBe("main");
    expect(windowConfig.decorations).toBe(false);
  });

  it("preserves native macOS traffic-light controls with an overlay title bar", () => {
    const config = readJson("src-tauri/tauri.macos.conf.json");
    const windowConfig = config.app.windows[0];

    expect(windowConfig).toMatchObject({
      decorations: true,
      hiddenTitle: true,
      label: "main",
      titleBarStyle: "Overlay",
      trafficLightPosition: { x: 14, y: 20 },
    });
  });

  it("exposes editor typography commands through the native macOS View menu", () => {
    const source = readText("src-tauri/src/lib.rs");

    expect(source).toContain("const FONT_ZOOM_IN_MENU_ID");
    expect(source).toContain("const FONT_ZOOM_OUT_MENU_ID");
    expect(source).toContain("const FONT_ZOOM_RESET_MENU_ID");
    expect(source).toContain("const TOGGLE_FONT_LIGATURES_MENU_ID");
    expect(source).toContain("const OPEN_APPEARANCE_SETTINGS_MENU_ID");
    expect(source).toContain("SubmenuBuilder::new(app, \"View\")");
    expect(source).toContain("FONT_ZOOM_IN_EVENT");
    expect(source).toContain("FONT_ZOOM_OUT_EVENT");
    expect(source).toContain("FONT_ZOOM_RESET_EVENT");
    expect(source).toContain("TOGGLE_FONT_LIGATURES_EVENT");
    expect(source).toContain("OPEN_APPEARANCE_SETTINGS_EVENT");
  });

  it("grants the custom chrome only the required window controls", () => {
    const capability = readJson("src-tauri/capabilities/default.json");
    const windowPermissions = capability.permissions
      .filter((permission: string) => permission.startsWith("core:window:"))
      .sort();

    expect(windowPermissions).toEqual([
      "core:window:allow-close",
      "core:window:allow-minimize",
      "core:window:allow-start-dragging",
      "core:window:allow-toggle-maximize",
    ]);
  });
});

function readJson(path: string): any {
  return JSON.parse(readText(path));
}

function readText(path: string): string {
  return readFileSync(resolve(import.meta.dirname, "..", path), "utf8");
}
