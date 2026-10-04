// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workbenchAgentPaletteProvider } from "../../application/commandPalette/commandPaletteProvider";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { PROJECT_DISPLAY_NAMES_STORAGE_KEY } from "../../application/projectDisplayNames";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import {
  RemoteRunnerContext,
  type RemoteRunnerContextValue,
} from "../remoteRunner/remoteRunnerContext";
import { AgentModeView, type AgentModeViewProps } from "./AgentModeView";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  fixtureRepository,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";

const LOCAL = "/workspace/editor";
const SERVER = "remote:linux:runner:codevo-editor";
const API = "/workspace/api-service";
const IDENTITY = "github.com/codevo/editor";

function project(rootKey: string, label: string, identity?: string): AgentProjectDescriptor {
  return projectFixture({
    rootKey,
    rootPath: rootKey,
    ownerId: `agent-root:${rootKey}`,
    label,
    origin: rootKey === LOCAL ? "active-tab" : "background-tab",
    repositories: [fixtureRepository(rootKey, "")],
    ...(identity === undefined ? {} : { repositoryIdentity: identity }),
  });
}

function threadIn(threadId: string, rootKey: string, pinned = false): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    repositoryLabel: "folder",
    thread: {
      ...base,
      threadId,
      title: `Thread ${threadId}`,
      pinned,
      target: { isolation: "in-place", worktreePath: null },
      owner: { rootKey, ownerId: `agent-root:${rootKey}`, repositoryRoot: rootKey },
    },
  });
}

function remoteContext(): RemoteRunnerContextValue {
  return {
    gateway: {} as RemoteRunnerGateway,
    servers: [],
    status: "ready",
    error: null,
    refresh: async () => undefined,
    connect: async () => null,
    disconnect: async () => undefined,
    remove: async () => undefined,
    selectedServerId: null,
    selectServer: () => undefined,
  };
}

describe("renaming a project in agent mode", () => {
  let host: HTMLDivElement;
  let root: Root;
  const selectWorkspace = vi.fn<(project: AgentProjectDescriptor | null) => void>();
  const onCloseProject = vi.fn<(rootPath: string) => void>();
  const startThread = vi.fn(async () => ({ threadId: "new" }));

  beforeEach(() => {
    localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    selectWorkspace.mockReset();
    onCloseProject.mockReset();
    startThread.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function props(overrides: Partial<AgentModeViewProps> = {}): AgentModeViewProps {
    return {
      agents: {
        ...threadsSurfaceFixture({
          threads: [
            threadIn("local-1", LOCAL),
            threadIn("server-1", SERVER, true),
            threadIn("api-1", API),
          ],
          repositories: [fixtureRepository(LOCAL, ""), fixtureRepository(API, "")],
          startThread,
        }),
        providerManagement: unconfiguredAgentProviderManagement(),
      },
      projects: [
        project(SERVER, "codevo-editor", IDENTITY),
        project(LOCAL, "editor", IDENTITY),
        project(API, "api-service"),
      ],
      workspaceRoot: LOCAL,
      overflowRootPaths: [],
      providerEnabled: { claudeCode: true, codex: true },
      chrome: chromeFixture({
        workspaceActivation: {
          select: selectWorkspace,
          state: { kind: "none", rootPath: null },
          retry: () => undefined,
        },
      }),
      onTrustProject: () => undefined,
      onReleaseProject: () => undefined,
      onCloseProject,
      ...overrides,
    };
  }

  function render(node: ReactNode): void {
    act(() =>
      root.render(
        <RemoteRunnerContext.Provider value={remoteContext()}>{node}</RemoteRunnerContext.Provider>,
      ),
    );
  }

  function projectNames(): ReadonlyArray<string> {
    return [...host.querySelectorAll(".agent-rail .cv-sb-project__name")].map(
      (node) => node.textContent ?? "",
    );
  }

  function projectGroup(label: string): HTMLElement {
    const group = [...host.querySelectorAll<HTMLElement>(".agent-rail .cv-sb-project")].find(
      (candidate) => candidate.querySelector(".cv-sb-project__name")?.textContent === label,
    );
    expect(group).toBeDefined();
    return group as HTMLElement;
  }

  function projectThreadIds(label: string): ReadonlyArray<string> {
    return [...projectGroup(label).querySelectorAll<HTMLElement>("[data-thread-id]")].map(
      (row) => row.dataset.threadId ?? "",
    );
  }

  function clickMenuItem(label: string): void {
    const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === label,
    );
    expect(item).toBeDefined();
    act(() => item?.click());
  }

  function openRenameFromRail(label: string): void {
    const actions = projectGroup(label).querySelector<HTMLButtonElement>(
      `button[aria-label="Project actions for ${label}"]`,
    );
    expect(actions).not.toBeNull();
    act(() => actions?.click());
    clickMenuItem("Rename project…");
  }

  function renameDialog(): HTMLElement | null {
    return document.querySelector<HTMLElement>(".cv-dialog");
  }

  function nameInput(): HTMLInputElement {
    const input = renameDialog()?.querySelector<HTMLInputElement>("input") ?? null;
    expect(input).not.toBeNull();
    return input as HTMLInputElement;
  }

  function confirmName(value: string): void {
    const input = nameInput();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
    });
  }

  function switcher(): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>(".agent-rail .cv-sb-switch");
    expect(button).not.toBeNull();
    return button as HTMLButtonElement;
  }

  function switcherLabels(): ReadonlyArray<string> {
    act(() => switcher().click());
    const labels = [
      ...document.querySelectorAll(
        '[role="dialog"][aria-label="Switch project"] .cv-project-switch__label',
      ),
    ].map((node) => node.textContent ?? "");
    act(() => switcher().click());
    return labels;
  }

  function pinnedRowProject(threadId: string): string | null {
    return (
      host.querySelector(`.agent-rail [data-thread-id="${threadId}"] .cv-card-row__project`)
        ?.textContent ?? null
    );
  }

  function selectedSession(): string | null {
    const section = host.querySelector<HTMLElement>('section[aria-label^="Agent thread "]');
    return section?.getAttribute("aria-label")?.replace("Agent thread ", "") ?? null;
  }

  function identitySnapshot() {
    const palette = workbenchAgentPaletteProvider.current();
    return {
      activeProjectKey: palette?.activeProjectKey ?? null,
      projectKeys: palette?.projects.map((candidate) => candidate.key) ?? [],
      railKeys: [...host.querySelectorAll<HTMLElement>(".agent-rail .cv-sb-project")].map(
        (node) => node.dataset.projectRootKey ?? "",
      ),
      currentRailKey:
        host.querySelector<HTMLElement>('.agent-rail .cv-sb-project[data-current="true"]')?.dataset
          .projectRootKey ?? null,
      session: selectedSession(),
      workspaceSelections: selectWorkspace.mock.calls.length,
    };
  }

  function storedEntries(): ReadonlyArray<ReadonlyArray<unknown>> | null {
    const raw = localStorage.getItem(PROJECT_DISPLAY_NAMES_STORAGE_KEY);
    if (raw === null) return null;
    return JSON.parse(raw) as ReadonlyArray<ReadonlyArray<unknown>>;
  }

  function storedNames(): unknown {
    return storedEntries()?.map((entry) => entry.slice(0, 2)) ?? null;
  }

  it("renames a merged project once for its local and server checkouts across the rail and switcher", () => {
    render(<AgentModeView {...props()} />);
    expect(projectNames()).toEqual(["editor", "api-service"]);
    expect(pinnedRowProject("server-1")).toBe("editor");
    const before = identitySnapshot();

    openRenameFromRail("editor");
    expect(nameInput().placeholder).toBe("editor");
    expect(renameDialog()?.textContent).toContain("all 2 checkouts");
    confirmName("Flagship");

    expect(renameDialog()).toBeNull();
    expect(storedNames()).toEqual([
      [LOCAL, "Flagship"],
      [SERVER, "Flagship"],
    ]);
    const tokens = storedEntries()?.map((entry) => entry[2]) ?? [];
    expect(tokens[0]).toMatch(/^[0-9a-f]{16}$/);
    expect(tokens[1]).toBe(tokens[0]);
    expect(projectNames()).toEqual(["Flagship", "api-service"]);
    expect(projectGroup("Flagship").querySelector(".cv-favicon")?.textContent).toBe("F");
    expect(projectThreadIds("Flagship")).toEqual(["local-1"]);
    expect(
      projectGroup("Flagship").querySelector('button[aria-label="Collapse Flagship"]'),
    ).not.toBeNull();
    expect(
      projectGroup("Flagship").querySelector('button[aria-label="Create new thread in Flagship"]'),
    ).not.toBeNull();
    expect(
      projectGroup("Flagship").querySelector('[role="group"]')?.getAttribute("aria-label"),
    ).toBe("Flagship threads");
    expect(pinnedRowProject("server-1")).toBe("Flagship");
    expect(switcher().getAttribute("aria-label")).toBe("Switch project: Flagship");
    expect(switcherLabels()).toEqual(["All projects", "Flagship", "api-service"]);
    expect(identitySnapshot()).toEqual(before);
    expect(before.railKeys).toEqual([LOCAL, API]);
  });

  it("keeps project commands on the physical checkout after a rename", () => {
    render(<AgentModeView {...props()} />);
    openRenameFromRail("editor");
    confirmName("Flagship");

    const actions = projectGroup("Flagship").querySelector<HTMLButtonElement>(
      'button[aria-label="Project actions for Flagship"]',
    );
    act(() => actions?.click());
    clickMenuItem("Close project");

    expect(onCloseProject).toHaveBeenCalledExactlyOnceWith(LOCAL);
    expect(startThread).not.toHaveBeenCalled();
  });

  it("restores the folder and runner names when the project is reset to default", () => {
    localStorage.setItem(
      PROJECT_DISPLAY_NAMES_STORAGE_KEY,
      JSON.stringify([
        [LOCAL, "Flagship", "aaaaaaaaaaaaaaaa"],
        [SERVER, "Flagship", "aaaaaaaaaaaaaaaa"],
        [API, "Backend", "bbbbbbbbbbbbbbbb"],
      ]),
    );
    render(<AgentModeView {...props()} />);
    expect(projectNames()).toEqual(["Flagship", "Backend"]);

    openRenameFromRail("Flagship");
    const reset = [...(renameDialog()?.querySelectorAll("button") ?? [])].find(
      (candidate) => candidate.textContent === "Reset to default",
    );
    expect(reset).toBeDefined();
    act(() => reset?.click());

    expect(storedNames()).toEqual([[API, "Backend"]]);
    expect(projectNames()).toEqual(["editor", "Backend"]);
    expect(pinnedRowProject("server-1")).toBe("editor");
    expect(switcherLabels()).toEqual(["All projects", "editor", "Backend"]);
  });

  it("renames a server-only project without a server notice", () => {
    render(
      <AgentModeView
        {...props({ projects: [project(SERVER, "codevo-editor"), project(API, "api-service")] })}
      />,
    );
    expect(projectNames()).toEqual(["codevo-editor", "api-service"]);

    openRenameFromRail("codevo-editor");
    expect(renameDialog()?.textContent).toContain("The name is shown only in Codevo.");
    confirmName("Server copy");

    expect(storedNames()).toEqual([[SERVER, "Server copy"]]);
    expect(projectNames()).toEqual(["Server copy", "api-service"]);
    expect(host.textContent).not.toContain("not available on the server");
    expect(
      [...host.querySelectorAll<HTMLElement>(".agent-rail .cv-sb-project")].map(
        (node) => node.dataset.projectRootKey,
      ),
    ).toEqual([SERVER, API]);
  });

  it("keeps a checkout's name when the group later splits into separate projects", () => {
    render(<AgentModeView {...props()} />);
    openRenameFromRail("editor");
    confirmName("Flagship");

    render(
      <AgentModeView
        {...props({
          projects: [
            project(SERVER, "codevo-editor"),
            project(LOCAL, "editor"),
            project(API, "api-service"),
          ],
        })}
      />,
    );

    expect(projectNames()).toEqual(["Flagship", "Flagship", "api-service"]);
  });
});
