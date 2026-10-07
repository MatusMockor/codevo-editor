// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AudioCaptureStartOutcome,
  SpeechDictationPorts,
} from "../../application/speechDictationPorts";
import type { AppSettings } from "../../domain/settings";
import {
  SPEECH_INPUT_MAX_LISTED_DEVICES,
  type SpeechInputSetting,
} from "../../domain/speechDictationInputSetting";
import {
  BrowserSettingsGateway,
  type KeyValueStorage,
} from "../../infrastructure/browserSettingsGateway";
import { createSpeechDictationPorts } from "../../infrastructure/speechDictationComposition";
import { TauriRemoteRunnerGateway } from "../../infrastructure/tauriRemoteRunnerGateway";
import {
  BUILT_IN_MICROPHONE,
  STUDIO_MICROPHONE,
  installFakeAudioInputs,
  numberedAudioInputs,
  type FakeAudioInputs,
  type FakeAudioInputsOptions,
} from "../../test/audioInputDevicesTestSupport";
import { flushAsync } from "../../test/speechDictationTestSupport";
import { useAgentDictationInput } from "../agentMode/dictation/useAgentDictationInput";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import { AgentsSettingsPage } from "./pages/AgentsSettingsPage";
import { settingsPagePropsFixture } from "./pages/settingsPageTestSupport";
import { SETTINGS_ROWS, settingsRowDescriptor, settingsRowsForSection } from "./settingsRegistry";
import { searchSettingsRows } from "./settingsSearch";

const ROW = '[data-settings-row="agents.dictationMicrophone"]';
const APP_SETTINGS_KEY = "editor.settings.app";
const STUDIO: SpeechInputSetting = { kind: "device", id: "studio-1", label: "Studio Mic" };
const GONE: SpeechInputSetting = { kind: "device", id: "gone-1", label: "Gone Mic" };
const BASE_DESCRIPTION = "Microphone used when dictating into the composer.";
const SINK = { onFrame: () => undefined, onFailure: () => undefined };

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

function settingsWith(input: SpeechInputSetting | undefined): AppSettings {
  const settings = settingsPagePropsFixture().draft.appSettings;
  return input === undefined ? settings : { ...settings, speechDictationInput: input };
}

describe("dictation microphone setting", () => {
  let host: HTMLDivElement;
  let root: Root;
  let inputs: FakeAudioInputs | null = null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    inputs?.restore();
    inputs = null;
  });

  function install(options: FakeAudioInputsOptions = {}) {
    const installed = installFakeAudioInputs(options);
    inputs = installed;
    const gateway = new TauriRemoteRunnerGateway(vi.fn().mockResolvedValue([]));
    return { inputs: installed, gateway, ports: createSpeechDictationPorts(gateway) };
  }

  async function renderPage(
    initial: AppSettings,
    saved: AppSettings[],
    gateway: TauriRemoteRunnerGateway,
    ports: SpeechDictationPorts | null,
  ): Promise<void> {
    const fixture = settingsPagePropsFixture();
    function Harness() {
      const [appSettings, setAppSettings] = useState(initial);
      useAgentDictationInput(appSettings.speechDictationInput);
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
    await act(async () => {
      root.render(
        <RemoteRunnerProvider gateway={gateway} speechDictation={ports}>
          <Harness />
        </RemoteRunnerProvider>,
      );
      await flushAsync();
    });
  }

  async function open(options: FakeAudioInputsOptions, input?: SpeechInputSetting) {
    const installed = install(options);
    const saved: AppSettings[] = [];
    await renderPage(settingsWith(input), saved, installed.gateway, installed.ports);
    return { ...installed, saved };
  }

  function row(): HTMLElement {
    const element = host.querySelector<HTMLElement>(ROW);
    expect(element).not.toBeNull();
    return element ?? document.createElement("div");
  }

  function select(): HTMLSelectElement {
    const element = row().querySelector("select");
    expect(element).not.toBeNull();
    return element ?? document.createElement("select");
  }

  function button(): HTMLButtonElement {
    const element = row().querySelector("button");
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function description(): string {
    return row().querySelector(".settings-row__description")?.textContent ?? "";
  }

  function optionLabels(): (string | null)[] {
    return [...select().options].map((option) => option.textContent);
  }

  function selectedLabel(): string | null {
    return select().selectedOptions[0]?.textContent ?? null;
  }

  function choose(value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    act(() => {
      setter?.call(select(), value);
      select().dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function settle(action: () => void = () => undefined): Promise<void> {
    await act(async () => {
      action();
      await flushAsync();
    });
  }

  async function capture(ports: SpeechDictationPorts): Promise<AudioCaptureStartOutcome> {
    let outcome: AudioCaptureStartOutcome = { kind: "failed", reason: "failed" };
    await act(async () => {
      const handle = ports.capture.start(SINK);
      outcome = await handle.started;
      handle.stop();
      await flushAsync();
    });
    return outcome;
  }

  it("describes the row, lists it after the language row and finds it by search", () => {
    const descriptor = settingsRowDescriptor("agents.dictationMicrophone");
    const rows = settingsRowsForSection("agents").map((entry) => entry.id);

    expect(descriptor.title).toBe("Dictation microphone");
    expect(descriptor.description).toBe(BASE_DESCRIPTION);
    expect(rows.indexOf("agents.dictationMicrophone")).toBe(
      rows.indexOf("agents.dictationLanguage") + 1,
    );
    expect(rows.indexOf("agents.dictationMicrophone")).toBe(
      rows.indexOf("agents.workingSection") - 1,
    );
    expect(searchSettingsRows("microphone", SETTINGS_ROWS, false)[0]?.row.id).toBe(
      "agents.dictationMicrophone",
    );
    for (const query of ["mic", "input", "audio", "dictation"]) {
      expect(searchSettingsRows(query, SETTINGS_ROWS, false).map((hit) => hit.row.id)).toContain(
        "agents.dictationMicrophone",
      );
    }
  });

  it("uses the system default when nothing is saved", async () => {
    const { inputs, ports } = await open({ granted: true });

    expect(optionLabels()).toEqual(["System default", "MacBook Pro Microphone", "Studio Mic"]);
    expect(selectedLabel()).toBe("System default");
    expect(description()).toBe(BASE_DESCRIPTION);
    expect(await capture(ports)).toEqual({ kind: "started" });
    expect(inputs.requestedDeviceIds()).toEqual([null]);
  });

  it("names the select after the row like the language select", async () => {
    await open({ granted: true });
    const title = document.getElementById(select().getAttribute("aria-labelledby") ?? "");
    const described = document.getElementById(select().getAttribute("aria-describedby") ?? "");
    const language = host.querySelector('[data-settings-row="agents.dictationLanguage"] select');

    expect(title?.textContent).toBe("Dictation microphone");
    expect(described?.textContent).toBe(BASE_DESCRIPTION);
    expect(select().className).toBe(language?.className);
    expect(select().parentElement?.getAttribute("data-width")).toBe(
      language?.parentElement?.getAttribute("data-width"),
    );
    expect(select().tabIndex).toBe(0);
  });

  it("persists the chosen device and captures from exactly that device next", async () => {
    const storage = memoryStorage();
    const settings = new BrowserSettingsGateway(storage);
    const { inputs, gateway, ports } = install({ granted: true });
    const saved: AppSettings[] = [];
    await renderPage(await settings.loadAppSettings(), saved, gateway, ports);

    choose("device:studio-1");

    expect(selectedLabel()).toBe("Studio Mic");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.speechDictationInput).toEqual(STUDIO);
    expect(saved[0]?.agentFollowUpBehavior).toBe("queue");
    expect(await capture(ports)).toEqual({ kind: "started" });
    expect(inputs.requestedDeviceIds()).toEqual(["studio-1"]);

    await settings.saveAppSettings(saved[0] ?? (await settings.loadAppSettings()));
    const reloaded = await new BrowserSettingsGateway(storage).loadAppSettings();
    expect(reloaded.speechDictationInput).toEqual(STUDIO);

    act(() => root.unmount());
    root = createRoot(host);
    const restarted = createSpeechDictationPorts(gateway);
    await renderPage(reloaded, [], gateway, restarted);

    expect(selectedLabel()).toBe("Studio Mic");
    expect(await capture(restarted)).toEqual({ kind: "started" });
    expect(inputs.requestedDeviceIds()).toEqual(["studio-1", "studio-1"]);
  });

  it("returns to the system default when it is chosen again", async () => {
    const { inputs, ports, saved } = await open({ granted: true }, STUDIO);

    choose("system-default");

    expect(saved[0]?.speechDictationInput).toEqual({ kind: "system-default" });
    expect(selectedLabel()).toBe("System default");
    await capture(ports);
    expect(inputs.requestedDeviceIds()).toEqual([null]);
  });

  it("says a saved microphone is not connected and captures from the default", async () => {
    const { inputs, ports, saved } = await open({ granted: true }, GONE);

    expect(optionLabels()).toEqual([
      "System default",
      "MacBook Pro Microphone",
      "Studio Mic",
      "Gone Mic (not connected)",
    ]);
    expect(selectedLabel()).toBe("Gone Mic (not connected)");
    expect(select().selectedOptions[0]?.disabled).toBe(true);
    expect(description()).toBe(
      "Gone Mic is not connected. Dictation uses the system default until it is back.",
    );
    expect(await capture(ports)).toEqual({ kind: "started", inputFallback: "system-default" });
    expect(inputs.requestedDeviceIds()).toEqual(["gone-1", null]);
    expect(saved).toEqual([]);
  });

  it("shows a saved microphone as selected again when it is reconnected", async () => {
    const { inputs } = await open({ granted: true, devices: [BUILT_IN_MICROPHONE] }, STUDIO);
    expect(selectedLabel()).toBe("Studio Mic (not connected)");

    await settle(() => inputs.changeDevices([BUILT_IN_MICROPHONE, STUDIO_MICROPHONE]));

    expect(selectedLabel()).toBe("Studio Mic");
    expect(optionLabels()).toEqual(["System default", "MacBook Pro Microphone", "Studio Mic"]);
    expect(description()).toBe(BASE_DESCRIPTION);
  });

  it("re-identifies a saved microphone whose id changed by its label", async () => {
    const { inputs, ports } = await open(
      { granted: true },
      { kind: "device", id: "studio-old", label: "Studio Mic" },
    );

    expect(selectedLabel()).toBe("Studio Mic");
    expect(select().value).toBe("device:studio-1");
    expect(description()).toBe(BASE_DESCRIPTION);
    expect(await capture(ports)).toEqual({ kind: "started" });
    expect(inputs.streams[inputs.streams.length - 1]?.deviceId).toBe("studio-1");
  });

  it("asks for microphone access instead of listing blank devices", async () => {
    const { inputs } = await open({});

    expect(row().querySelector("select")).toBeNull();
    expect(button().textContent).toBe("Allow access");
    expect(description()).toBe("Allow microphone access to choose a device.");
    expect(inputs.requestedDeviceIds()).toEqual([]);

    await settle(() => button().click());

    expect(row().querySelector("button")).toBeNull();
    expect(optionLabels()).toEqual(["System default", "MacBook Pro Microphone", "Studio Mic"]);
    expect(inputs.streams.every((stream) => stream.tracks.every((track) => track.stopped))).toBe(
      true,
    );
  });

  it("keeps naming the saved microphone while labels are hidden", async () => {
    await open({}, STUDIO);

    expect(description()).toBe(
      "Allow microphone access to choose a device. Dictation is set to Studio Mic.",
    );
  });

  it("says when microphone access is blocked and lets the user retry", async () => {
    const { inputs } = await open({ denied: true });

    await settle(() => button().click());

    expect(button().textContent).toBe("Try again");
    expect(button().disabled).toBe(false);
    expect(description()).toBe(
      "Microphone access is blocked. Allow Codevo under Privacy & Security in System Settings, then try again.",
    );

    inputs.setDenied(false);
    await settle(() => button().click());

    expect(optionLabels()).toEqual(["System default", "MacBook Pro Microphone", "Studio Mic"]);
  });

  it("says when no microphone is connected", async () => {
    await open({ devices: [] });

    expect(button().textContent).toBe("Try again");
    expect(description()).toBe("No microphone found. Connect one, then try again.");
  });

  it("lists the microphones once a dictation was allowed to capture", async () => {
    const { ports } = await open({});
    expect(row().querySelector("select")).toBeNull();

    await capture(ports);

    expect(optionLabels()).toEqual(["System default", "MacBook Pro Microphone", "Studio Mic"]);
  });

  it("follows devicechange and stops listening when the page unmounts", async () => {
    const { inputs } = await open({ granted: true });
    expect(inputs.deviceChangeListeners()).toBe(1);

    await settle(() =>
      inputs.changeDevices([BUILT_IN_MICROPHONE, { deviceId: "usb-1", label: "USB Headset" }]),
    );

    expect(optionLabels()).toEqual(["System default", "MacBook Pro Microphone", "USB Headset"]);

    act(() => root.unmount());
    root = createRoot(host);
    const enumerations = inputs.enumerateDevices.mock.calls.length;
    inputs.changeDevices([BUILT_IN_MICROPHONE]);
    await flushAsync();

    expect(inputs.deviceChangeListeners()).toBe(0);
    expect(inputs.enumerateDevices).toHaveBeenCalledTimes(enumerations);
  });

  it("caps the list and says that it did", async () => {
    await open({
      granted: true,
      devices: numberedAudioInputs(SPEECH_INPUT_MAX_LISTED_DEVICES + 8),
    });

    expect(select().options).toHaveLength(SPEECH_INPUT_MAX_LISTED_DEVICES + 1);
    expect(optionLabels().slice(0, 3)).toEqual(["System default", "Microphone 1", "Microphone 2"]);
    expect(description()).toBe(
      `${BASE_DESCRIPTION} Showing the first ${SPEECH_INPUT_MAX_LISTED_DEVICES} microphones.`,
    );
  });

  it.each([
    "studio-1",
    7,
    null,
    [],
    {},
    { kind: "device" },
    { kind: "device", id: "studio-1" },
    { kind: "device", id: "studio 1", label: "Studio Mic" },
    { kind: "device", id: "studio-1", label: "Studio\nMic" },
    { kind: "device", id: "studio-1", label: "Studio Mic", groupId: "group-1" },
    { kind: "speaker", id: "studio-1", label: "Studio Mic" },
  ])("falls back to the system default when the stored input is %j", async (value) => {
    const storage = memoryStorage();
    storage.setItem(
      APP_SETTINGS_KEY,
      JSON.stringify({ agentFollowUpBehavior: "steer", speechDictationInput: value }),
    );
    const loaded = await new BrowserSettingsGateway(storage).loadAppSettings();
    const { inputs, gateway, ports } = install({ granted: true });
    await renderPage(loaded, [], gateway, ports);

    expect(loaded).not.toHaveProperty("speechDictationInput");
    expect(loaded.agentFollowUpBehavior).toBe("steer");
    expect(selectedLabel()).toBe("System default");
    await capture(ports);
    expect(inputs.requestedDeviceIds()).toEqual([null]);
  });

  it("ignores a value outside the listed devices", async () => {
    const { saved } = await open({ granted: true });
    const stray = document.createElement("option");
    stray.value = "device:stray-1";
    select().append(stray);

    choose("device:stray-1");

    expect(saved).toEqual([]);
  });

  it("cannot choose the disconnected microphone again", async () => {
    const { saved } = await open({ granted: true }, GONE);

    choose("device:gone-1");

    expect(saved).toEqual([]);
  });

  it("says the choice is not available without capture ports", async () => {
    const { gateway } = install({ granted: true });
    await renderPage(settingsWith(undefined), [], gateway, null);

    expect(row().querySelector("select")).toBeNull();
    expect(row().querySelector("button")).toBeNull();
    expect(row().querySelector(".settings-readout")?.textContent).toBe("Not available");
    expect(description()).toBe("Choosing a microphone is not available here.");
  });
});
