// @vitest-environment jsdom

import type { AppearanceSettings } from "../domain/appearance";
import { tauriWindowZoomGateway } from "../infrastructure/tauriWindowZoomGateway";
import {
  APP_SETTINGS_KEY,
  BrowserSettingsGateway,
  type KeyValueStorage,
} from "../infrastructure/browserSettingsGateway";
import {
  describe,
  expect,
  act,
  defaultAppSettings,
  flushAsyncTurns,
  it,
  setupWorkbenchControllerTestHarness,
  type WorkbenchController,
  vi,
} from "./useWorkbenchController.preview/testSupport";

const INK_MINT_LIGHT: AppearanceSettings = {
  palette: "ink-mint",
  colorScheme: "light",
  syntaxTheme: "matchPalette",
};

function memoryStorage(raw: string): KeyValueStorage {
  const values = new Map<string, string>([[APP_SETTINGS_KEY, raw]]);
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("useWorkbenchController initial appearance", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();

  it("renders the persisted appearance on the first render before hydration settles", async () => {
    const renders: WorkbenchController[] = [];
    const settingsGateway = new BrowserSettingsGateway(
      memoryStorage(JSON.stringify({ appearance: INK_MINT_LIGHT })),
    );

    renderController({
      onWorkbenchRender: (workbench) => {
        renders.push(workbench);
      },
      settingsGateway,
    });
    await flushAsyncTurns();

    expect(renders.length).toBeGreaterThan(0);
    expect(renders.map((workbench) => workbench.appSettings.appearance)).toEqual(
      renders.map(() => INK_MINT_LIGHT),
    );
  });

  it("hydrates whole-window zoom and persists commands in both workbench layouts", async () => {
    const settingsGateway = new BrowserSettingsGateway(
      memoryStorage(JSON.stringify({ appearance: INK_MINT_LIGHT, windowZoomLevel: 2 })),
    );
    const { dependencies, getWorkbench } = renderController({ settingsGateway, strictMode: true });
    dependencies.controllerOptions.windowZoomGateway = tauriWindowZoomGateway;
    await flushAsyncTurns();
    expect(getWorkbench().agentModeActive).toBe(true);
    expect(getWorkbench().activeDocument).toBeNull();
    expect(document.documentElement.style.zoom).toBe(String(1.2 ** 2));

    const runZoom = async (id: string) => {
      const command = getWorkbench().commands.find((candidate) => candidate.id === id);
      expect(command).toBeDefined();
      expect(command?.isEnabled(getWorkbench().commandContext)).toBe(true);
      await act(async () => {
        await command?.run();
      });
      await flushAsyncTurns();
    };

    await runZoom("workbench.zoomIn");
    expect(getWorkbench().appSettings.windowZoomLevel).toBe(3);
    expect(document.documentElement.style.zoom).toBe(String(1.2 ** 3));
    expect((await settingsGateway.loadAppSettings()).windowZoomLevel).toBe(3);

    dependencies.controllerOptions.agentRootLeaseGateway = undefined;
    await runZoom("workbench.zoomOut");
    expect(getWorkbench().agentModeActive).toBe(false);
    expect(getWorkbench().appSettings.windowZoomLevel).toBe(2);
    await runZoom("workbench.zoomReset");
    expect(document.documentElement.style.zoom).toBe("1");
    expect((await settingsGateway.loadAppSettings()).windowZoomLevel).toBe(0);
    expect(getWorkbench().appSettings.editorFontSize).toBe(defaultAppSettings().editorFontSize);
    expect(getWorkbench().appSettings.agentThreadFontSize).toBe(
      defaultAppSettings().agentThreadFontSize,
    );
    expect(getWorkbench().appSettings.appearance).toEqual(INK_MINT_LIGHT);
  });

  it("rolls window zoom back when settings persistence fails", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: { ...defaultAppSettings(), windowZoomLevel: 1 },
    });
    dependencies.controllerOptions.windowZoomGateway = tauriWindowZoomGateway;
    await flushAsyncTurns();
    vi.mocked(dependencies.settingsGateway.saveAppSettings).mockRejectedValueOnce(
      new Error("settings unavailable"),
    );
    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "workbench.zoomIn",
    );
    expect(command).toBeDefined();
    await act(async () => {
      await expect(command?.run()).rejects.toEqual(new Error("settings unavailable"));
    });
    await flushAsyncTurns();
    expect(getWorkbench().appSettings.windowZoomLevel).toBe(1);
    expect(document.documentElement.style.zoom).toBe("1.2");
  });
});
