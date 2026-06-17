import { describe, expect, it } from "vitest";
import { BrowserSettingsGateway, type KeyValueStorage } from "./browserSettingsGateway";

describe("BrowserSettingsGateway", () => {
  it("returns defaults when settings are missing", async () => {
    const gateway = new BrowserSettingsGateway(memoryStorage());

    await expect(gateway.loadAppSettings()).resolves.toEqual({
      recentWorkspacePath: null,
      theme: "dark",
    });
    await expect(gateway.loadWorkspaceSettings("/project")).resolves.toEqual({
      autoSave: true,
      autoSaveConfigured: true,
      extraIgnorePatterns: [],
      intelligenceMode: "basic",
      intelephensePath: null,
      phpBackend: "auto",
      phpactorPath: null,
      revealActiveFileInTree: true,
      session: {
        activePath: null,
        bottomPanelView: "problems",
        openPaths: [],
        sidebarView: "files",
      },
    });
  });

  it("persists app and workspace settings", async () => {
    const storage = memoryStorage();
    const gateway = new BrowserSettingsGateway(storage);

    await gateway.saveAppSettings({
      recentWorkspacePath: "/project",
      theme: "ayuMirage",
    });
    await gateway.saveWorkspaceSettings("/project", {
      autoSave: true,
      autoSaveConfigured: true,
      extraIgnorePatterns: ["var/cache"],
      intelligenceMode: "lightSmart",
      intelephensePath: "/tools/intelephense",
      phpBackend: "phpactor",
      phpactorPath: "/tools/phpactor",
      revealActiveFileInTree: false,
      session: {
        activePath: "/project/src/User.php",
        bottomPanelView: "index",
        openPaths: ["/project/src/User.php", "/project/README.md"],
        sidebarView: "php",
      },
    });

    await expect(gateway.loadAppSettings()).resolves.toEqual({
      recentWorkspacePath: "/project",
      theme: "ayuMirage",
    });
    await expect(gateway.loadWorkspaceSettings("/project")).resolves.toEqual({
      autoSave: true,
      autoSaveConfigured: true,
      extraIgnorePatterns: ["var/cache"],
      intelligenceMode: "lightSmart",
      intelephensePath: "/tools/intelephense",
      phpBackend: "phpactor",
      phpactorPath: "/tools/phpactor",
      revealActiveFileInTree: false,
      session: {
        activePath: "/project/src/User.php",
        bottomPanelView: "index",
        openPaths: ["/project/src/User.php", "/project/README.md"],
        sidebarView: "php",
      },
    });
  });

  it("falls back when persisted JSON is invalid", async () => {
    const storage = memoryStorage();
    storage.setItem("editor.settings.app", "{");
    storage.setItem("editor.settings.workspace:%2Fproject", "{");
    const gateway = new BrowserSettingsGateway(storage);

    await expect(gateway.loadAppSettings()).resolves.toEqual({
      recentWorkspacePath: null,
      theme: "dark",
    });
    await expect(gateway.loadWorkspaceSettings("/project")).resolves.toEqual({
      autoSave: true,
      autoSaveConfigured: true,
      extraIgnorePatterns: [],
      intelligenceMode: "basic",
      intelephensePath: null,
      phpBackend: "auto",
      phpactorPath: null,
      revealActiveFileInTree: true,
      session: {
        activePath: null,
        bottomPanelView: "problems",
        openPaths: [],
        sidebarView: "files",
      },
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
