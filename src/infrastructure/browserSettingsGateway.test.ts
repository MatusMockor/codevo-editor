import { describe, expect, it } from "vitest";
import { BrowserSettingsGateway, type KeyValueStorage } from "./browserSettingsGateway";

describe("BrowserSettingsGateway", () => {
  it("returns defaults when settings are missing", async () => {
    const gateway = new BrowserSettingsGateway(memoryStorage());

    await expect(gateway.loadAppSettings()).resolves.toEqual({
      recentWorkspacePath: null,
    });
    await expect(gateway.loadWorkspaceSettings("/project")).resolves.toEqual({
      intelligenceMode: "basic",
    });
  });

  it("persists app and workspace settings", async () => {
    const storage = memoryStorage();
    const gateway = new BrowserSettingsGateway(storage);

    await gateway.saveAppSettings({ recentWorkspacePath: "/project" });
    await gateway.saveWorkspaceSettings("/project", {
      intelligenceMode: "lightSmart",
    });

    await expect(gateway.loadAppSettings()).resolves.toEqual({
      recentWorkspacePath: "/project",
    });
    await expect(gateway.loadWorkspaceSettings("/project")).resolves.toEqual({
      intelligenceMode: "lightSmart",
    });
  });

  it("falls back when persisted JSON is invalid", async () => {
    const storage = memoryStorage();
    storage.setItem("editor.settings.app", "{");
    storage.setItem("editor.settings.workspace:%2Fproject", "{");
    const gateway = new BrowserSettingsGateway(storage);

    await expect(gateway.loadAppSettings()).resolves.toEqual({
      recentWorkspacePath: null,
    });
    await expect(gateway.loadWorkspaceSettings("/project")).resolves.toEqual({
      intelligenceMode: "basic",
    });
  });
});

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}
