// @vitest-environment jsdom

import type { AppearanceSettings } from "../domain/appearance";
import {
  APP_SETTINGS_KEY,
  BrowserSettingsGateway,
  type KeyValueStorage,
} from "../infrastructure/browserSettingsGateway";
import {
  describe,
  expect,
  flushAsyncTurns,
  it,
  setupWorkbenchControllerTestHarness,
  type WorkbenchController,
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
});
