// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRailWorkingSectionPreferencePort } from "../../application/agentRailWorkingSectionPreferencePort";
import { defaultAppSettings, defaultWorkspaceSettings } from "../../domain/settings";
import {
  AGENT_RAIL_WORKING_SECTION_STORAGE_KEY,
  BrowserAgentRailWorkingSectionPreference,
} from "../../infrastructure/browserAgentRailWorkingSectionPreference";
import type { KeyValueStorage } from "../../infrastructure/browserSettingsGateway";
import {
  useAgentRailWorkingRail,
  type AgentRailWorkingRailController,
} from "../agentMode/useAgentRailWorkingRail";
import {
  AgentSidebarSettingsRows,
  WORKING_SECTION_NOT_SAVED_NOTE,
} from "./AgentSidebarSettingsRows";
import { AgentsSettingsPage } from "./pages/AgentsSettingsPage";
import { settingsPagePropsFixture } from "./pages/settingsPageTestSupport";
import { settingsEnvironment } from "./settingsEnvironment";
import { settingsRowDescriptor, settingsRowsForSection } from "./settingsRegistry";
import type { WorkbenchSettingsModel } from "./workbenchSettingsModel";

const ROW = '[data-settings-row="agents.workingSection"]';

function memoryStorage(entries: Record<string, string> = {}): KeyValueStorage & {
  readonly values: Map<string, string>;
} {
  const values = new Map(Object.entries(entries));
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

function settingsModel(): WorkbenchSettingsModel {
  return {
    appSettings: defaultAppSettings(),
    gitRepositoryMappings: [],
    openJavaScriptTypeScriptServiceLog: async () => undefined,
    phpTools: null,
    restartJavaScriptTypeScriptService: async () => undefined,
    saveWorkbenchSettings: async () => undefined,
    settingsInitialSection: "agents",
    settingsOpen: true,
    setSettingsOpen: () => undefined,
    workspaceDescriptor: null,
    workspaceIdentityDescriptor: { workspaceId: "workspace-a" },
    workspaceRoot: "/workspace/a",
    workspaceSettings: defaultWorkspaceSettings(),
    workspaceTrust: { rootPath: "/workspace/a", trusted: true },
  };
}

describe("AgentSidebarSettingsRows", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  function toggle(): HTMLButtonElement {
    const control = host.querySelector<HTMLButtonElement>(`${ROW} [role="switch"]`);
    expect(control).not.toBeNull();
    return control as HTMLButtonElement;
  }

  function renderRows(preference: AgentRailWorkingSectionPreferencePort | null): void {
    act(() => root.render(<AgentSidebarSettingsRows workingSectionPreference={preference} />));
  }

  function notSavedNote(): string | null {
    return host.querySelector(`${ROW} [role="status"]`)?.textContent ?? null;
  }

  it("describes the Working section as a beta sidebar preference that starts off", () => {
    const storage = memoryStorage();
    renderRows(new BrowserAgentRailWorkingSectionPreference(storage));

    expect(host.querySelector("h2")?.textContent).toBe("Sidebar");
    expect(host.querySelector(`${ROW} .settings-row__title`)?.textContent).toBe("Working section");
    expect(host.querySelector(`${ROW} .settings-row__meta`)?.textContent).toBe("Beta");
    expect(host.querySelector(`${ROW} .settings-row__description`)?.textContent).toBe(
      settingsRowDescriptor("agents.workingSection").description,
    );
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(toggle().disabled).toBe(false);
    expect(notSavedNote()).toBeNull();
    expect(storage.values.has(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY)).toBe(false);
  });

  it("persists the toggle on this device and restores it on the next visit", () => {
    const storage = memoryStorage();
    renderRows(new BrowserAgentRailWorkingSectionPreference(storage));

    act(() => toggle().click());
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(storage.values.get(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY)).toBe("on");
    expect(notSavedNote()).toBeNull();

    act(() => root.unmount());
    root = createRoot(host);
    renderRows(new BrowserAgentRailWorkingSectionPreference(storage));
    expect(toggle().getAttribute("aria-checked")).toBe("true");

    act(() => toggle().click());
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(storage.values.has(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY)).toBe(false);
  });

  it("switches an open sidebar that shares the preference without a reload", () => {
    const preference = new BrowserAgentRailWorkingSectionPreference(memoryStorage());
    let sidebar: AgentRailWorkingRailController | null = null;
    function SidebarProbe() {
      sidebar = useAgentRailWorkingRail(preference);
      return null;
    }
    act(() =>
      root.render(
        <>
          <SidebarProbe />
          <AgentSidebarSettingsRows workingSectionPreference={preference} />
        </>,
      ),
    );
    const workingSection = () =>
      (sidebar as AgentRailWorkingRailController | null)?.rail.workingSection;
    expect(workingSection()).toBe("off");

    act(() => toggle().click());
    expect(workingSection()).toBe("on");

    act(() => toggle().click());
    expect(workingSection()).toBe("off");
  });

  it("keeps the switch and the sidebar on and says so when this device cannot store the change", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    localStorage.setItem("filler", "x".repeat(5_000_000 - "filler".length - 10));
    const preference = new BrowserAgentRailWorkingSectionPreference();
    let sidebar: AgentRailWorkingRailController | null = null;
    function SidebarProbe() {
      sidebar = useAgentRailWorkingRail(preference);
      return null;
    }
    act(() =>
      root.render(
        <>
          <SidebarProbe />
          <AgentSidebarSettingsRows workingSectionPreference={preference} />
        </>,
      ),
    );

    act(() => toggle().click());

    expect(setItem.mock.results.map((result) => result.type)).toEqual(["return", "throw"]);
    expect(localStorage.getItem(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY)).toBeNull();
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect((sidebar as AgentRailWorkingRailController | null)?.rail.workingSection).toBe("on");
    expect(notSavedNote()).toBe(WORKING_SECTION_NOT_SAVED_NOTE);
    expect(WORKING_SECTION_NOT_SAVED_NOTE).toBe(
      "Could not be saved on this device; it will reset when the app restarts.",
    );
    const description = host.querySelector(`${ROW} .settings-row__description`);
    expect(description?.textContent).toContain(
      settingsRowDescriptor("agents.workingSection").description,
    );
    expect(toggle().getAttribute("aria-describedby")).toBe(description?.id);

    act(() => toggle().click());
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(notSavedNote()).toBeNull();

    localStorage.removeItem("filler");
    act(() => toggle().click());
    expect(localStorage.getItem(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY)).toBe("on");
    expect(notSavedNote()).toBeNull();
  });

  it("stays off and cannot be toggled without a preference", () => {
    renderRows(null);

    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(toggle().disabled).toBe(true);
    act(() => toggle().click());
    expect(toggle().getAttribute("aria-checked")).toBe("false");
  });

  it("lives at the end of the Agents page and uses the preference from the environment", () => {
    const storage = memoryStorage();
    const preference = new BrowserAgentRailWorkingSectionPreference(storage);
    const props = settingsPagePropsFixture({
      env: { agentRailWorkingSectionPreference: preference },
    });
    act(() => root.render(<AgentsSettingsPage {...props} />));

    const rendered = [...host.querySelectorAll("[data-settings-row]")].map((element) =>
      element.getAttribute("data-settings-row"),
    );
    expect(rendered[rendered.length - 1]).toBe("agents.workingSection");
    expect(rendered).toEqual(settingsRowsForSection("agents").map((row) => row.id));
    expect(toggle().getAttribute("aria-checked")).toBe("false");

    act(() => toggle().click());
    expect(storage.values.get(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY)).toBe("on");
    expect(preference.load()).toBe("on");
    expect(localStorage.getItem(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY)).toBeNull();
    expect(props.actions.updateAppSettings).not.toHaveBeenCalled();
  });

  it("renders a disabled switch on the Agents page when the environment has no preference", () => {
    act(() => root.render(<AgentsSettingsPage {...settingsPagePropsFixture()} />));

    expect(toggle().disabled).toBe(true);
    act(() => toggle().click());
    expect(localStorage.getItem(AGENT_RAIL_WORKING_SECTION_STORAGE_KEY)).toBeNull();
  });
});

describe("settingsEnvironment working section preference", () => {
  const base = {
    appUpdater: null,
    providerManagement: null,
    systemFontGateway: { listMonospaceFontFamilies: async () => [] },
  };

  it("hands the composed preference to the settings pages unchanged", () => {
    const preference = new BrowserAgentRailWorkingSectionPreference(memoryStorage());

    const env = settingsEnvironment({
      ...base,
      agentRailWorkingSectionPreference: preference,
      workbench: settingsModel(),
    });

    expect(env.agentRailWorkingSectionPreference).toBe(preference);
  });

  it("carries no preference unless one was composed in", () => {
    const env = settingsEnvironment({ ...base, workbench: settingsModel() });

    expect(env.agentRailWorkingSectionPreference).toBeNull();
  });
});
