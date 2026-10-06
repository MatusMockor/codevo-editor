// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppSettings } from "../../domain/settings";
import {
  BrowserSettingsGateway,
  type KeyValueStorage,
} from "../../infrastructure/browserSettingsGateway";
import { AgentDictationSettingsRows } from "./AgentDictationSettingsRows";
import { AgentsSettingsPage } from "./pages/AgentsSettingsPage";
import { settingsPagePropsFixture } from "./pages/settingsPageTestSupport";
import { settingsRowDescriptor, settingsRowsForSection } from "./settingsRegistry";

const ROW = '[data-settings-row="agents.dictationLanguage"]';
const APP_SETTINGS_KEY = "editor.settings.app";

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("dictation language setting", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function select(): HTMLSelectElement {
    const element = host.querySelector<HTMLSelectElement>(`${ROW} select`);
    expect(element).not.toBeNull();
    return element ?? document.createElement("select");
  }

  function choose(value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    act(() => {
      setter?.call(select(), value);
      select().dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function renderPage(initial: AppSettings, saved: AppSettings[]): void {
    const fixture = settingsPagePropsFixture();
    function Harness() {
      const [appSettings, setAppSettings] = useState(initial);
      const update = (next: AppSettings): void => {
        saved.push(next);
        setAppSettings(next);
      };
      return (
        <AgentsSettingsPage
          actions={{ ...fixture.actions, publishAppSettings: update, updateAppSettings: update }}
          draft={{ ...fixture.draft, appSettings }}
          env={fixture.env}
        />
      );
    }
    act(() => root.render(<Harness />));
  }

  it("describes the row and lists it before the sidebar section on the Agents page", () => {
    const descriptor = settingsRowDescriptor("agents.dictationLanguage");
    const rows = settingsRowsForSection("agents").map((row) => row.id);

    expect(descriptor.title).toBe("Dictation language");
    expect(descriptor.description).toBe(
      "Language spoken when dictating into the composer. Audio is transcribed on your connected server and is not stored.",
    );
    expect(rows.indexOf("agents.dictationLanguage")).toBe(
      rows.indexOf("agents.dictationMicrophone") - 1,
    );
    expect(rows.indexOf("agents.dictationLanguage")).toBeLessThan(
      rows.indexOf("agents.workingSection"),
    );
  });

  it("offers exactly the supported languages", () => {
    act(() =>
      root.render(
        <AgentDictationSettingsRows
          language={undefined}
          locale="en-US"
          input={undefined}
          inputDevices={null}
          onChangeInput={() => undefined}
          onChangeLanguage={() => undefined}
        />,
      ),
    );

    expect([...select().options].map((option) => [option.value, option.textContent])).toEqual([
      ["sk", "Slovak"],
      ["en", "English"],
      ["cs", "Czech"],
    ]);
  });

  it.each([
    ["sk-SK", "sk"],
    ["cs-CZ", "cs"],
    ["en-US", "en"],
    ["de-DE", "en"],
  ])("defaults an unset language from the system locale %s", (locale, expected) => {
    act(() =>
      root.render(
        <AgentDictationSettingsRows
          language={undefined}
          locale={locale}
          input={undefined}
          inputDevices={null}
          onChangeInput={() => undefined}
          onChangeLanguage={() => undefined}
        />,
      ),
    );

    expect(select().value).toBe(expected);
  });

  it("keeps a chosen language over the system locale", () => {
    act(() =>
      root.render(
        <AgentDictationSettingsRows
          language="cs"
          locale="sk-SK"
          input={undefined}
          inputDevices={null}
          onChangeInput={() => undefined}
          onChangeLanguage={() => undefined}
        />,
      ),
    );

    expect(select().value).toBe("cs");
  });

  it("persists the chosen language through the settings gateway", async () => {
    const storage = memoryStorage();
    const gateway = new BrowserSettingsGateway(storage);
    const saved: AppSettings[] = [];
    renderPage(await gateway.loadAppSettings(), saved);

    expect(select().value).toBe("en");
    choose("sk");

    expect(select().value).toBe("sk");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.speechDictationLanguage).toBe("sk");
    expect(saved[0]?.agentFollowUpBehavior).toBe("queue");

    await gateway.saveAppSettings(saved[0] ?? (await gateway.loadAppSettings()));
    const reloaded = await new BrowserSettingsGateway(storage).loadAppSettings();
    expect(reloaded.speechDictationLanguage).toBe("sk");

    act(() => root.unmount());
    root = createRoot(host);
    renderPage(reloaded, []);
    expect(select().value).toBe("sk");
  });

  it.each(["de", "SK", "", null, 7, {}, ["sk"]])(
    "falls back to the default when the stored language is %j",
    async (value) => {
      const storage = memoryStorage();
      storage.setItem(
        APP_SETTINGS_KEY,
        JSON.stringify({ agentFollowUpBehavior: "steer", speechDictationLanguage: value }),
      );
      const loaded = await new BrowserSettingsGateway(storage).loadAppSettings();

      expect(loaded.speechDictationLanguage).toBeUndefined();
      expect(loaded.agentFollowUpBehavior).toBe("steer");
      renderPage(loaded, []);
      expect(select().value).toBe("en");
    },
  );

  it("ignores a value outside the closed language set", () => {
    const saved: AppSettings[] = [];
    renderPage(settingsPagePropsFixture().draft.appSettings, saved);
    const stray = document.createElement("option");
    stray.value = "de";
    select().append(stray);

    choose("de");

    expect(saved).toEqual([]);
  });
});
