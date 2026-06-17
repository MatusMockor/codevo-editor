import { describe, expect, it } from "vitest";
import { BrowserSettingsGateway, type KeyValueStorage } from "./browserSettingsGateway";
import { defaultKeymapSettings } from "../domain/keymap";

describe("BrowserSettingsGateway", () => {
  it("returns defaults when settings are missing", async () => {
    const gateway = new BrowserSettingsGateway(memoryStorage());

    await expect(gateway.loadAppSettings()).resolves.toEqual({
      keymap: defaultKeymapSettings(),
      recentWorkspacePath: null,
      runtimePolicy: "keepAlive",
      theme: "dark",
      workspaceTabs: [],
    });
    await expect(gateway.loadWorkspaceSettings("/project")).resolves.toEqual({
      autoSave: true,
      autoSaveConfigured: true,
      extraIgnorePatterns: [],
      intelligenceMode: "basic",
      intelephensePath: null,
      phpBackend: "auto",
      phpVersionOverride: null,
      phpactorPath: null,
      revealActiveFileInTree: true,
      session: {
        activePath: null,
        bottomPanelView: "problems",
        openPaths: [],
        sidebarView: "files",
      },
      statusBar: {
        activePath: true,
        dirtyCount: true,
        index: true,
        language: true,
        languageServer: true,
        message: true,
        mode: true,
        workspaceInfo: true,
        workspaceTrust: true,
      },
    });
  });

  it("persists app and workspace settings", async () => {
    const storage = memoryStorage();
    const gateway = new BrowserSettingsGateway(storage);

    await gateway.saveAppSettings({
      keymap: {
        ...defaultKeymapSettings(),
        "editor.save": "Cmd+Shift+S",
      },
      recentWorkspacePath: "/project",
      runtimePolicy: "keepAlive",
      theme: "ayuMirage",
      workspaceTabs: ["/project", "/another-project"],
    });
    await gateway.saveWorkspaceSettings("/project", {
      autoSave: true,
      autoSaveConfigured: true,
      extraIgnorePatterns: ["var/cache"],
      intelligenceMode: "lightSmart",
      intelephensePath: "/tools/intelephense",
      phpBackend: "phpactor",
      phpVersionOverride: "8.2",
      phpactorPath: "/tools/phpactor",
      revealActiveFileInTree: false,
      session: {
        activePath: "/project/src/User.php",
        bottomPanelView: "index",
        openPaths: ["/project/src/User.php", "/project/README.md"],
        sidebarView: "php",
      },
      statusBar: {
        activePath: true,
        dirtyCount: true,
        index: false,
        language: true,
        languageServer: true,
        message: true,
        mode: true,
        workspaceInfo: false,
        workspaceTrust: true,
      },
    });

    await expect(gateway.loadAppSettings()).resolves.toEqual({
      keymap: {
        ...defaultKeymapSettings(),
        "editor.save": "Cmd+Shift+S",
      },
      recentWorkspacePath: "/project",
      runtimePolicy: "keepAlive",
      theme: "ayuMirage",
      workspaceTabs: ["/project", "/another-project"],
    });
    await expect(gateway.loadWorkspaceSettings("/project")).resolves.toEqual({
      autoSave: true,
      autoSaveConfigured: true,
      extraIgnorePatterns: ["var/cache"],
      intelligenceMode: "lightSmart",
      intelephensePath: "/tools/intelephense",
      phpBackend: "phpactor",
      phpVersionOverride: "8.2",
      phpactorPath: "/tools/phpactor",
      revealActiveFileInTree: false,
      session: {
        activePath: "/project/src/User.php",
        bottomPanelView: "index",
        openPaths: ["/project/src/User.php", "/project/README.md"],
        sidebarView: "php",
      },
      statusBar: {
        activePath: true,
        dirtyCount: true,
        index: false,
        language: true,
        languageServer: true,
        message: true,
        mode: true,
        workspaceInfo: false,
        workspaceTrust: true,
      },
    });
  });

  it("falls back when persisted JSON is invalid", async () => {
    const storage = memoryStorage();
    storage.setItem("editor.settings.app", "{");
    storage.setItem("editor.settings.workspace:%2Fproject", "{");
    const gateway = new BrowserSettingsGateway(storage);

    await expect(gateway.loadAppSettings()).resolves.toEqual({
      keymap: defaultKeymapSettings(),
      recentWorkspacePath: null,
      runtimePolicy: "keepAlive",
      theme: "dark",
      workspaceTabs: [],
    });
    await expect(gateway.loadWorkspaceSettings("/project")).resolves.toEqual({
      autoSave: true,
      autoSaveConfigured: true,
      extraIgnorePatterns: [],
      intelligenceMode: "basic",
      intelephensePath: null,
      phpBackend: "auto",
      phpVersionOverride: null,
      phpactorPath: null,
      revealActiveFileInTree: true,
      session: {
        activePath: null,
        bottomPanelView: "problems",
        openPaths: [],
        sidebarView: "files",
      },
      statusBar: {
        activePath: true,
        dirtyCount: true,
        index: true,
        language: true,
        languageServer: true,
        message: true,
        mode: true,
        workspaceInfo: true,
        workspaceTrust: true,
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
