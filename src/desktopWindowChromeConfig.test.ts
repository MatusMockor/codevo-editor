import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop window chrome config", () => {
  it("uses app-rendered chrome on Linux and Windows", () => {
    const config = readJson("src-tauri/tauri.conf.json");
    const windowConfig = config.app.windows[0];

    expect(windowConfig.label).toBe("main");
    expect(windowConfig.decorations).toBe(false);
    expect(windowConfig.transparent).toBe(false);
    expect(windowConfig.minWidth).toBe(900);
  });

  it("preserves native macOS traffic-light controls with an overlay title bar", () => {
    const config = readJson("src-tauri/tauri.macos.conf.json");
    const windowConfig = config.app.windows[0];

    expect(windowConfig).toMatchObject({
      decorations: true,
      hiddenTitle: true,
      label: "main",
      minWidth: 900,
      titleBarStyle: "Overlay",
      trafficLightPosition: { x: 14, y: 20 },
      transparent: false,
    });
  });

  it("exposes editor typography commands through the native macOS View menu", () => {
    const runtimeSource = [
      readText("src-tauri/src/lib_composition/workspace_facade.rs"),
      readText("src-tauri/src/lib_composition/runtime.rs"),
    ].join("\n");
    const menuSource = readText("src-tauri/src/application_menu.rs");

    expect(runtimeSource).toContain("const FONT_ZOOM_IN_MENU_ID");
    expect(runtimeSource).toContain("const FONT_ZOOM_OUT_MENU_ID");
    expect(runtimeSource).toContain("const FONT_ZOOM_RESET_MENU_ID");
    expect(runtimeSource).toContain("const TOGGLE_FONT_LIGATURES_MENU_ID");
    expect(runtimeSource).toContain("const OPEN_APPEARANCE_SETTINGS_MENU_ID");
    expect(menuSource).toContain('SubmenuBuilder::new(app, "View")');
    expect(runtimeSource).toContain("FONT_ZOOM_IN_EVENT");
    expect(runtimeSource).toContain("FONT_ZOOM_OUT_EVENT");
    expect(runtimeSource).toContain("FONT_ZOOM_RESET_EVENT");
    expect(runtimeSource).toContain("TOGGLE_FONT_LIGATURES_EVENT");
    expect(runtimeSource).toContain("OPEN_APPEARANCE_SETTINGS_EVENT");
  });

  it("grants the custom chrome only the required window controls", () => {
    const capability = readJson("src-tauri/capabilities/default.json");
    const windowPermissions = capability.permissions
      .filter((permission: string) => permission.startsWith("core:window:"))
      .sort();

    expect(windowPermissions).toEqual([
      "core:window:allow-close",
      "core:window:allow-minimize",
      "core:window:allow-set-always-on-top",
      "core:window:allow-set-focus",
      "core:window:allow-show",
      "core:window:allow-start-dragging",
      "core:window:allow-toggle-maximize",
      "core:window:allow-unminimize",
    ]);
  });
});

function readJson(path: string): any {
  return JSON.parse(readText(path));
}

function readText(path: string): string {
  return readFileSync(resolve(import.meta.dirname, "..", path), "utf8");
}
