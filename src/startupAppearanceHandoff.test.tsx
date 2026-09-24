// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initialAppSettings } from "./application/workbenchController/initialAppSettings";
import { useAppWorkbenchThemes } from "./components/useAppWorkbenchThemes";
import { COLOR_SCHEME_ATTRIBUTE, DEFAULT_APPEARANCE, PALETTE_ATTRIBUTE } from "./domain/appearance";
import type { AppSettings } from "./domain/settings";
import { MAX_STARTUP_SETTINGS_LENGTH } from "./domain/startupTheme";
import {
  APP_SETTINGS_KEY,
  BrowserSettingsGateway,
  type KeyValueStorage,
} from "./infrastructure/browserSettingsGateway";
import { applyStartupTheme } from "./startupTheme";

const INK_MINT_LIGHT = {
  palette: "ink-mint",
  colorScheme: "light",
  syntaxTheme: "matchPalette",
} as const;

interface AppearanceSnapshot {
  readonly palette: string | null;
  readonly scheme: string | null;
  readonly shellTheme: string | null;
}

let host: HTMLDivElement;
let root: Root;
let applySettings: (settings: AppSettings) => void = () => undefined;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  applySettings = () => undefined;
  document.documentElement.removeAttribute(PALETTE_ATTRIBUTE);
  document.documentElement.removeAttribute(COLOR_SCHEME_ATTRIBUTE);
});

function memoryStorage(raw: string): KeyValueStorage {
  const values = new Map<string, string>([[APP_SETTINGS_KEY, raw]]);
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function Shell({
  gateway,
  prefersLight,
}: {
  readonly gateway: BrowserSettingsGateway;
  readonly prefersLight: boolean;
}) {
  const [settings, setSettings] = useState<AppSettings>(() => initialAppSettings(gateway));
  const { colorScheme } = useAppWorkbenchThemes(settings.appearance, prefersLight);
  applySettings = setSettings;
  return <main className="app-shell" data-theme={colorScheme} />;
}

function snapshot(): AppearanceSnapshot {
  return {
    palette: document.documentElement.getAttribute(PALETTE_ATTRIBUTE),
    scheme: document.documentElement.getAttribute(COLOR_SCHEME_ATTRIBUTE),
    shellTheme: host.querySelector(".app-shell")?.getAttribute("data-theme") ?? null,
  };
}

async function bootAndHydrate(raw: string, prefersLight: boolean) {
  const storage = memoryStorage(raw);
  applyStartupTheme({
    prefersLight: () => prefersLight,
    readSetting: (key) => storage.getItem(key),
    setDocumentAttribute: (name, value) => document.documentElement.setAttribute(name, value),
  });
  const startup = snapshot();
  const observer = new MutationObserver(() => undefined);
  observer.observe(document.documentElement, {
    attributeFilter: [PALETTE_ATTRIBUTE, COLOR_SCHEME_ATTRIBUTE],
    attributes: true,
  });
  const gateway = new BrowserSettingsGateway(storage);

  act(() => root.render(<Shell gateway={gateway} prefersLight={prefersLight} />));
  const firstCommit = snapshot();
  const firstCommitMutations = observer.takeRecords().length;
  const shell = host.querySelector(".app-shell");
  expect(shell).not.toBeNull();
  observer.observe(shell ?? host, { attributeFilter: ["data-theme"], attributes: true });

  const hydrated = await gateway.loadAppSettings();
  act(() => applySettings(hydrated));
  const afterHydration = snapshot();
  const hydrationMutations = observer.takeRecords().length;
  observer.disconnect();

  return {
    afterHydration,
    firstCommit,
    firstCommitMutations,
    hydrated,
    hydrationMutations,
    startup,
  };
}

describe("startup appearance hand-off to React", () => {
  it("keeps a stored Ink Mint light appearance on a dark OS from the first frame", async () => {
    const result = await bootAndHydrate(JSON.stringify({ appearance: INK_MINT_LIGHT }), false);

    expect(result.startup).toEqual({ palette: "ink-mint", scheme: "light", shellTheme: null });
    expect(result.firstCommitMutations).toBe(0);
    expect(result.hydrationMutations).toBe(0);
    expect(result.firstCommit).toEqual({
      palette: "ink-mint",
      scheme: "light",
      shellTheme: "light",
    });
    expect(result.afterHydration).toEqual(result.firstCommit);
  });

  it("keeps a legacy dark theme dark on a light OS from the first frame", async () => {
    const result = await bootAndHydrate(JSON.stringify({ theme: "dark" }), true);

    expect(result.startup).toEqual({ palette: "graphite-teal", scheme: "dark", shellTheme: null });
    expect(result.firstCommitMutations).toBe(0);
    expect(result.hydrationMutations).toBe(0);
    expect(result.firstCommit).toEqual({
      palette: "graphite-teal",
      scheme: "dark",
      shellTheme: "dark",
    });
    expect(result.afterHydration).toEqual(result.firstCommit);
  });

  it("treats oversized settings as having no stored appearance at startup and at runtime", async () => {
    const raw = JSON.stringify({
      appearance: INK_MINT_LIGHT,
      editorFontFamily: "x".repeat(MAX_STARTUP_SETTINGS_LENGTH),
    });
    const result = await bootAndHydrate(raw, false);

    expect(result.startup).toEqual({ palette: "graphite-teal", scheme: "dark", shellTheme: null });
    expect(result.firstCommitMutations).toBe(0);
    expect(result.hydrationMutations).toBe(0);
    expect(result.hydrated.appearance).toEqual(DEFAULT_APPEARANCE);
    expect(result.afterHydration).toEqual({
      palette: "graphite-teal",
      scheme: "dark",
      shellTheme: "dark",
    });
  });
});
