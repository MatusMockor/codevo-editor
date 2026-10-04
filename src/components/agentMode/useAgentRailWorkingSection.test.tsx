// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentRailWorkingSectionPersistence,
  AgentRailWorkingSectionPreferencePort,
} from "../../application/agentRailWorkingSectionPreferencePort";
import type { AgentRailWorkingSection } from "../../domain/agentRailWorkingSection";
import {
  AGENT_RAIL_WORKING_SECTION_STORAGE_KEY,
  BrowserAgentRailWorkingSectionPreference,
} from "../../infrastructure/browserAgentRailWorkingSectionPreference";
import type { KeyValueStorage } from "../../infrastructure/browserSettingsGateway";
import {
  useAgentRailWorkingSection,
  type AgentRailWorkingSectionState,
} from "./useAgentRailWorkingSection";

class RecordingPreference implements AgentRailWorkingSectionPreferencePort {
  readonly saved: AgentRailWorkingSection[] = [];
  private readonly subscribers = new Set<() => void>();
  constructor(private stored: AgentRailWorkingSection = "off") {}

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  load(): AgentRailWorkingSection {
    return this.stored;
  }

  persistence(): AgentRailWorkingSectionPersistence {
    return "persisted";
  }

  save(workingSection: AgentRailWorkingSection): AgentRailWorkingSectionPersistence {
    this.stored = workingSection;
    this.saved.push(workingSection);
    for (const notify of [...this.subscribers]) notify();
    return "persisted";
  }

  subscribe(notify: () => void): () => void {
    this.subscribers.add(notify);
    return () => {
      this.subscribers.delete(notify);
    };
  }
}

function memoryStorage(): KeyValueStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("useAgentRailWorkingSection", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: AgentRailWorkingSectionState | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    latest = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  function Probe({
    preference,
  }: {
    readonly preference: AgentRailWorkingSectionPreferencePort | null;
  }) {
    latest = useAgentRailWorkingSection(preference);
    return null;
  }

  function render(preference: AgentRailWorkingSectionPreferencePort | null): void {
    act(() => root.render(<Probe preference={preference} />));
  }

  function state(): AgentRailWorkingSectionState {
    expect(latest).not.toBeNull();
    return latest as AgentRailWorkingSectionState;
  }

  it("stays off without a preference port", () => {
    render(null);
    expect(state().workingSection).toBe("off");
    expect(state().persistence).toBe("persisted");

    act(() => state().setWorkingSection("on"));
    expect(state().workingSection).toBe("off");
  });

  it("loads the stored preference and saves only real changes", () => {
    const preference = new RecordingPreference("on");
    render(preference);
    expect(state().workingSection).toBe("on");
    expect(preference.saved).toEqual([]);

    act(() => state().setWorkingSection("on"));
    expect(preference.saved).toEqual([]);

    act(() => state().setWorkingSection("off"));
    expect(state().workingSection).toBe("off");
    act(() => state().setWorkingSection("on"));
    expect(preference.saved).toEqual(["off", "on"]);
  });

  it("keeps a stable state object until the preference changes", () => {
    const preference = new RecordingPreference();
    render(preference);
    const first = state();

    render(preference);
    expect(state()).toBe(first);

    act(() => state().setWorkingSection("on"));
    expect(state()).not.toBe(first);
    expect(state().setWorkingSection).toBe(first.setWorkingSection);
  });

  it("follows a change saved elsewhere without saving it again", () => {
    const preference = new RecordingPreference();
    render(preference);
    expect(state().workingSection).toBe("off");

    act(() => {
      preference.save("on");
    });
    expect(state().workingSection).toBe("on");
    expect(preference.saved).toEqual(["on"]);

    act(() => {
      preference.save("off");
    });
    expect(state().workingSection).toBe("off");
    expect(preference.saved).toEqual(["on", "off"]);
  });

  it("stops listening for changes once unmounted", () => {
    const preference = new RecordingPreference();
    render(preference);
    expect(preference.subscriberCount).toBeGreaterThan(0);

    act(() => root.unmount());
    expect(preference.subscriberCount).toBe(0);
    root = createRoot(host);
  });

  it("reloads and resubscribes when it is handed a different preference", () => {
    const first = new RecordingPreference("on");
    const second = new RecordingPreference("off");
    render(first);
    expect(state().workingSection).toBe("on");

    render(second);
    expect(state().workingSection).toBe("off");
    expect(first.subscriberCount).toBe(0);
    expect(second.subscriberCount).toBeGreaterThan(0);

    act(() => {
      first.save("off");
      first.save("on");
    });
    expect(state().workingSection).toBe("off");

    act(() => state().setWorkingSection("on"));
    expect(second.saved).toEqual(["on"]);
    expect(first.saved).toEqual(["off", "on"]);

    render(null);
    expect(state().workingSection).toBe("off");
    expect(second.subscriberCount).toBe(0);
  });

  it("keeps two surfaces that share one preference in step", () => {
    const storage = memoryStorage();
    const preference = new BrowserAgentRailWorkingSectionPreference(storage);
    const settingsHost = document.createElement("div");
    document.body.append(settingsHost);
    const settingsRoot = createRoot(settingsHost);
    let settings: AgentRailWorkingSectionState | null = null;
    function SettingsProbe() {
      settings = useAgentRailWorkingSection(preference);
      return null;
    }
    render(preference);
    act(() => settingsRoot.render(<SettingsProbe />));

    act(() => (settings as AgentRailWorkingSectionState | null)?.setWorkingSection("on"));
    expect(state().workingSection).toBe("on");
    expect(storage.values.get(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY)).toBe("on");

    act(() => state().setWorkingSection("off"));
    expect((settings as AgentRailWorkingSectionState | null)?.workingSection).toBe("off");
    expect(storage.values.has(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY)).toBe(false);

    act(() => settingsRoot.unmount());
    settingsHost.remove();
  });

  it("follows a change written by another window and ignores unrelated keys", () => {
    const storage = memoryStorage();
    const preference = new BrowserAgentRailWorkingSectionPreference(storage);
    render(preference);

    storage.values.set(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY, "on");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "editor.unrelated.v1" }));
    });
    expect(state().workingSection).toBe("off");

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: AGENT_RAIL_WORKING_SECTION_STORAGE_KEY }),
      );
    });
    expect(state().workingSection).toBe("on");

    storage.values.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(state().workingSection).toBe("off");
  });

  it("detaches its window listener once the last subscriber leaves", () => {
    const storage = memoryStorage();
    const preference = new BrowserAgentRailWorkingSectionPreference(storage);
    const seen: string[] = [];
    const unsubscribe = preference.subscribe(() => seen.push(preference.load()));

    unsubscribe();
    storage.values.set(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY, "on");
    window.dispatchEvent(
      new StorageEvent("storage", { key: AGENT_RAIL_WORKING_SECTION_STORAGE_KEY }),
    );

    expect(seen).toEqual([]);
    expect(preference.load()).toBe("on");
  });

  it("persists through the browser adapter so the next mount starts where it left off", () => {
    const storage = memoryStorage();
    render(new BrowserAgentRailWorkingSectionPreference(storage));
    expect(state().workingSection).toBe("off");

    act(() => state().setWorkingSection("on"));
    expect(storage.values.get(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY)).toBe("on");
    expect(state().persistence).toBe("persisted");

    act(() => root.unmount());
    root = createRoot(host);
    render(new BrowserAgentRailWorkingSectionPreference(storage));
    expect(state().workingSection).toBe("on");
  });

  it("keeps the change for the session and says so when this device cannot store it", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    localStorage.setItem("filler", "x".repeat(5_000_000 - "filler".length - 10));
    const preference = new BrowserAgentRailWorkingSectionPreference();
    render(preference);

    act(() => state().setWorkingSection("on"));

    expect(setItem.mock.results.map((result) => result.type)).toEqual(["return", "throw"]);
    expect(state().workingSection).toBe("on");
    expect(state().persistence).toBe("sessionOnly");
    expect(localStorage.getItem(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY)).toBeNull();

    act(() => root.unmount());
    root = createRoot(host);
    render(preference);
    expect(state().workingSection).toBe("on");
    expect(state().persistence).toBe("sessionOnly");

    act(() => root.unmount());
    root = createRoot(host);
    render(new BrowserAgentRailWorkingSectionPreference());
    expect(state().workingSection).toBe("off");
    expect(state().persistence).toBe("persisted");

    localStorage.removeItem("filler");
    render(preference);
    act(() => state().setWorkingSection("off"));
    act(() => state().setWorkingSection("on"));
    expect(state().persistence).toBe("persisted");
    expect(localStorage.getItem(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY)).toBe("on");
  });
});
