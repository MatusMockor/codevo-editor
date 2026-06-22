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
      trafficLightPosition: { x: 14, y: 14 },
    });
  });

  it("grants the custom chrome only the required window controls", () => {
    const capability = readJson("src-tauri/capabilities/default.json");

    expect(capability.permissions).toEqual(
      expect.arrayContaining([
        "core:window:allow-close",
        "core:window:allow-minimize",
        "core:window:allow-start-dragging",
        "core:window:allow-toggle-maximize",
      ]),
    );
  });
});

function readJson(path: string): any {
  return JSON.parse(
    readFileSync(resolve(import.meta.dirname, "..", path), "utf8"),
  );
}
