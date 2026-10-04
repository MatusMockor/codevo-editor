// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_PROJECT_GROUPING_STORAGE_KEY,
  readAgentProjectGrouping,
  saveAgentProjectGroupingMode,
  saveAgentProjectGroupingOverride,
} from "../../application/agentProjectGroupingPreference";
import { saveProjectDisplayName } from "../../application/projectDisplayNames";
import { saveRemoteProjectLink } from "../../application/remoteProjectLinks";
import { REMOTE_PROJECT_INVENTORY_SLOW_AFTER_MS } from "../../application/useRemoteProjectInventories";
import { MAX_AGENT_PROJECT_GROUPING_OVERRIDES } from "../../domain/agentProjectGrouping";
import type { RemoteRunnerDescriptor, RemoteRunnerProject } from "../../domain/remoteRunner";
import { projectFixture } from "../agentMode/agentThreadsSurfaceTestFixtures";
import { MAX_PROJECT_GROUPING_ROWS } from "./projectGroupingPresentation";
import { ProjectGroupingSettings, type ProjectGroupingRemote } from "./ProjectGroupingSettings";

type ProjectPage = Readonly<{ items: readonly RemoteRunnerProject[] }>;

let host: HTMLDivElement;
let root: Root;
const descriptor: RemoteRunnerDescriptor = {
  protocolVersion: 1,
  runnerId: "runner",
  name: "Runner",
  capabilities: { taskExecution: true, eventReplay: true },
};
const local = projectFixture({ rootKey: "/local/app", rootPath: "/local/app", label: "app" });
const SERVER_KEY = "remote:server:runner:project";
const server = { id: "server", name: "Linux", connected: true };
const KEY = AGENT_PROJECT_GROUPING_STORAGE_KEY;

function gateway() {
  return {
    getRunner: vi.fn(async () => descriptor),
    listProjects: vi.fn(async (): Promise<ProjectPage> => ({
      items: [{ id: "project", name: "Server app" }],
    })),
  };
}

function render(remote: ProjectGroupingRemote | null = null, projects = [local]) {
  act(() => root.render(<ProjectGroupingSettings projects={projects} remote={remote} />));
}

async function toggle(open: boolean) {
  await act(async () => {
    const details = host.querySelector("details")!;
    details.open = open;
    details.dispatchEvent(new Event("toggle"));
  });
}

function control(label: string): HTMLSelectElement | null {
  return host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
}

function choose(label: string, value: string) {
  act(() => {
    const select = control(label)!;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function button(text: string): HTMLButtonElement | null {
  return (
    Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === text,
    ) ?? null
  );
}

function click(text: string) {
  act(() => button(text)!.click());
}

function optionLabels(label: string): ReadonlyArray<string | null> {
  return Array.from(control(label)?.options ?? [], (option) => option.textContent);
}

function alerts(): ReadonlyArray<string | null> {
  return Array.from(host.querySelectorAll('[role="alert"]'), (alert) => alert.textContent);
}

function fullOverrides(prefix: string): string {
  return JSON.stringify({
    mode: "repository",
    overrides: Array.from({ length: MAX_AGENT_PROJECT_GROUPING_OVERRIDES }, (_, index) => [
      `${prefix}${index}`,
      "separate",
    ]),
  });
}

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
  vi.useRealTimers();
});

describe("ProjectGroupingSettings", () => {
  it("persists the default grouping and re-renders the stored choice", () => {
    render();
    expect(host.textContent).toContain("Project grouping");
    expect(control("Default project grouping")?.value).toBe("repository");
    expect(optionLabels("Default project grouping")).toEqual([
      "Group by repository",
      "Keep separate",
    ]);
    choose("Default project grouping", "separate");
    expect(readAgentProjectGrouping().mode).toBe("separate");
    expect(control("Default project grouping")?.value).toBe("separate");
    act(() => {
      saveAgentProjectGroupingMode("repository");
    });
    expect(control("Default project grouping")?.value).toBe("repository");
  });

  it("renders overrides only when expanded and persists a per-project choice", async () => {
    render();
    expect(control("Grouping for app (/local/app)")).toBeNull();
    await toggle(true);
    expect(control("Grouping for app (/local/app)")?.value).toBe("");
    expect(optionLabels("Grouping for app (/local/app)")).toEqual([
      "Use default",
      "Group by repository",
      "Keep separate",
    ]);
    choose("Grouping for app (/local/app)", "separate");
    expect([...readAgentProjectGrouping().overrides]).toEqual([["/local/app", "separate"]]);
    expect(control("Grouping for app (/local/app)")?.value).toBe("separate");
    expect(control("Default project grouping")?.value).toBe("repository");
    choose("Grouping for app (/local/app)", "");
    expect(readAgentProjectGrouping().overrides.size).toBe(0);
    expect(control("Grouping for app (/local/app)")?.value).toBe("");
  });

  it("loads server projects only when expanded and stores the exact server project key", async () => {
    const api = gateway();
    render({ gateway: api, servers: [server] });
    expect(api.getRunner).not.toHaveBeenCalled();
    await toggle(true);
    expect(api.getRunner).toHaveBeenCalledTimes(1);
    expect(api.listProjects).toHaveBeenCalledWith({ serverId: "server" });
    choose("Grouping for Server app (Linux)", "separate");
    expect([...readAgentProjectGrouping().overrides]).toEqual([[SERVER_KEY, "separate"]]);
    expect(control("Grouping for Server app (Linux)")?.value).toBe("separate");
    expect(control("Grouping for app (/local/app)")?.value).toBe("");
  });

  it("does not publish a server inventory that resolves after the section was collapsed", async () => {
    const api = gateway();
    const pending: Array<(page: ProjectPage) => void> = [];
    api.listProjects.mockImplementation(
      () => new Promise<ProjectPage>((resolve) => pending.push(resolve)),
    );
    render({ gateway: api, servers: [server] });
    await toggle(true);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Loading projects on Linux…");
    await toggle(false);
    expect(host.querySelector("details select")).toBeNull();
    await act(async () => pending[0]?.({ items: [{ id: "project", name: "Late app" }] }));
    expect(host.textContent).not.toContain("Late app");
    expect(host.querySelector("details select")).toBeNull();
    await toggle(true);
    expect(api.listProjects).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain("Late app");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Loading projects on Linux…");
    await act(async () => pending[1]?.({ items: [{ id: "project", name: "Fresh app" }] }));
    expect(control("Grouping for Fresh app (Linux)")?.value).toBe("");
  });

  it("says a slow server is still loading and shows its projects when they arrive", async () => {
    vi.useFakeTimers();
    saveAgentProjectGroupingOverride(SERVER_KEY, "separate");
    const api = gateway();
    const pending: Array<(page: ProjectPage) => void> = [];
    api.listProjects.mockImplementation(
      () => new Promise<ProjectPage>((resolve) => pending.push(resolve)),
    );
    render({ gateway: api, servers: [server] });
    await toggle(true);
    act(() => {
      vi.advanceTimersByTime(REMOTE_PROJECT_INVENTORY_SLOW_AFTER_MS);
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Still loading projects on Linux…",
    );
    expect(alerts()).toEqual([]);
    expect(host.textContent).not.toContain("reopen this section");
    expect(control("Grouping for project (Linux, loading)")?.value).toBe("separate");
    expect(button("Reset overrides for unavailable projects")).toBeNull();
    await act(async () => pending[0]?.({ items: [{ id: "project", name: "Server app" }] }));
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(control("Grouping for Server app (Linux)")?.value).toBe("separate");
  });

  it("shows a linked server project as following its local project instead of offering a choice", async () => {
    saveRemoteProjectLink(SERVER_KEY, "/local/app");
    saveAgentProjectGroupingOverride(SERVER_KEY, "separate");
    const api = gateway();
    render({ gateway: api, servers: [server] });
    await toggle(true);
    const linked = control("Grouping for Server app (Linux, follows app)");
    expect(linked?.disabled).toBe(true);
    expect(linked?.value).toBe("separate");
    expect(control("Grouping for app (/local/app)")?.disabled).toBe(false);
    render({ gateway: api, servers: [server] }, []);
    expect(control("Grouping for Server app (Linux)")?.disabled).toBe(false);
  });

  it("shows user-set project names in the override rows", async () => {
    saveProjectDisplayName(["/local/app"], "Storefront");
    saveProjectDisplayName([SERVER_KEY], "Storefront server");
    render({ gateway: gateway(), servers: [server] });
    await toggle(true);
    expect(control("Grouping for Storefront (/local/app)")).not.toBeNull();
    expect(control("Grouping for Storefront server (Linux)")).not.toBeNull();
    expect(control("Grouping for app (/local/app)")).toBeNull();
  });

  it("resets every override for unavailable projects with one action and keeps the rest", async () => {
    saveAgentProjectGroupingOverride("/local/app", "separate");
    saveAgentProjectGroupingOverride("/closed/site", "separate");
    saveAgentProjectGroupingOverride("remote:server:runner:old", "separate");
    saveAgentProjectGroupingOverride("remote:gone:runner:old", "repository");
    saveAgentProjectGroupingOverride("remote:offline:runner:kept", "separate");
    const offline = { id: "offline", name: "Backup", connected: false };
    render({ gateway: gateway(), servers: [server, offline] });
    await toggle(true);
    expect(control("Grouping for site (/closed/site, not open)")?.value).toBe("separate");
    expect(control("Grouping for old (Linux, not available)")?.value).toBe("separate");
    expect(control("Grouping for old (server not found)")?.value).toBe("repository");
    expect(control("Grouping for kept (Backup, not connected)")?.value).toBe("separate");
    click("Reset overrides for unavailable projects");
    expect([...readAgentProjectGrouping().overrides.keys()]).toEqual([
      "/local/app",
      "remote:offline:runner:kept",
    ]);
    expect(control("Grouping for site (/closed/site, not open)")).toBeNull();
    expect(control("Grouping for kept (Backup, not connected)")?.value).toBe("separate");
    expect(button("Reset overrides for unavailable projects")).toBeNull();
    choose("Grouping for kept (Backup, not connected)", "");
    expect(control("Grouping for kept (Backup, not connected)")).toBeNull();
  });

  it("labels saved overrides as not loaded when the server inventory fails", async () => {
    saveAgentProjectGroupingOverride(SERVER_KEY, "separate");
    const api = gateway();
    api.listProjects.mockRejectedValueOnce(new Error("offline"));
    render({ gateway: api, servers: [server] });
    await toggle(true);
    expect(alerts()).toEqual([
      "Could not load projects on Linux. Close and reopen this section to retry.",
    ]);
    expect(control("Grouping for project (Linux, not loaded)")?.value).toBe("separate");
    expect(button("Reset overrides for unavailable projects")).toBeNull();
  });

  it("keeps overridden projects listed when the rows are bounded and says so", async () => {
    const projects = Array.from({ length: MAX_PROJECT_GROUPING_ROWS + 6 }, (_, index) =>
      projectFixture({ rootKey: `/local/p${index}`, rootPath: `/local/p${index}`, label: "p" }),
    );
    const last = `/local/p${MAX_PROJECT_GROUPING_ROWS + 5}`;
    saveAgentProjectGroupingOverride(last, "separate");
    render(null, projects);
    await toggle(true);
    expect(host.querySelectorAll("details select")).toHaveLength(MAX_PROJECT_GROUPING_ROWS);
    expect(control(`Grouping for p (${last})`)?.value).toBe("separate");
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      `Showing ${MAX_PROJECT_GROUPING_ROWS} of ${MAX_PROJECT_GROUPING_ROWS + 6} projects. Projects with an override take priority.`,
    );
  });

  it("explains a full override list and offers actions that free space", async () => {
    render();
    await toggle(true);
    localStorage.setItem(KEY, fullOverrides("/saved/p"));
    choose("Grouping for app (/local/app)", "separate");
    expect(alerts()).toEqual([
      "The override limit is reached. Set a listed project to Use default first.",
    ]);
    expect(readAgentProjectGrouping().overrides.has("/local/app")).toBe(false);
    expect(host.querySelectorAll("details select")).toHaveLength(MAX_PROJECT_GROUPING_ROWS);
    expect(control("Grouping for app (/local/app)")).toBeNull();
    choose("Grouping for p0 (/saved/p0, not open)", "");
    expect(alerts()).toEqual([]);
    expect(readAgentProjectGrouping().overrides.size).toBe(
      MAX_AGENT_PROJECT_GROUPING_OVERRIDES - 1,
    );
    click("Reset overrides for unavailable projects");
    expect(readAgentProjectGrouping().overrides.size).toBe(0);
    choose("Grouping for app (/local/app)", "separate");
    expect([...readAgentProjectGrouping().overrides]).toEqual([["/local/app", "separate"]]);
  });

  it("explains a rejected save and keeps the previous choice", async () => {
    render();
    await toggle(true);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    choose("Grouping for app (/local/app)", "separate");
    setItem.mockRestore();
    expect(alerts()).toEqual([
      "Could not save project grouping. Your previous choice remains active.",
    ]);
    expect(control("Grouping for app (/local/app)")?.value).toBe("");
    choose("Grouping for app (/local/app)", "separate");
    expect(alerts()).toEqual([]);
    expect(control("Grouping for app (/local/app)")?.value).toBe("separate");
  });

  it("keeps unreadable saved settings until the user resets them", async () => {
    const raw = JSON.stringify({
      mode: "repository_path",
      overrides: [["/local/app", "separate"]],
    });
    localStorage.setItem(KEY, raw);
    render();
    await toggle(true);
    expect(alerts()).toEqual([
      "Saved grouping settings could not be read, so the default is used. Reset them to make changes.",
    ]);
    expect(control("Default project grouping")?.value).toBe("repository");
    expect(control("Default project grouping")?.disabled).toBe(true);
    expect(control("Grouping for app (/local/app)")?.disabled).toBe(true);
    expect(control("Grouping for app (/local/app)")?.value).toBe("");
    expect(localStorage.getItem(KEY)).toBe(raw);
    click("Reset grouping settings");
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(alerts()).toEqual([]);
    expect(button("Reset grouping settings")).toBeNull();
    expect(control("Default project grouping")?.disabled).toBe(false);
    choose("Default project grouping", "separate");
    expect(readAgentProjectGrouping().mode).toBe("separate");
  });

  it("shows an empty state without projects or servers", async () => {
    render(null, []);
    await toggle(true);
    expect(host.textContent).toContain("No projects to group yet.");
    expect(host.querySelectorAll("details select")).toHaveLength(0);
  });
});
