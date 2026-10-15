// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentComposerDraftStore } from "../../application/agentComposerDrafts";
import {
  createAgentViewCommandBridge,
  type AgentViewCommandBridge,
} from "../../application/agentViewCommandBridge";
import { defaultAgentNewThreadDefaults } from "../../domain/agentNewThreadDefaults";
import type { RemoteProjectDirectories } from "../../domain/remoteProjectManagement";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { waitForReact } from "../../test/reactTestLifecycle";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import { AgentModeView } from "./AgentModeView";
import { AgentNewThreadDefaultsProvider } from "./AgentNewThreadDefaultsProvider";
import {
  fixtureRepository,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: tauri.invoke,
}));

const LOCAL_ROOT = "/Users/dev/Developer/playablemaker";
const SERVER_ROOT = "/home/codex/Developer";
const SERVER_FOLDER = `${SERVER_ROOT}/playablemaker`;
const ADDED_KEY = "remote:linux:runner:playablemaker";
const PROMPT = "Rename the asset loader";

interface ServerProject {
  readonly id: string;
  readonly name: string;
  readonly kind?: "folder";
}

interface Runner {
  readonly gateway: RemoteRunnerGateway;
  readonly registerProject: ReturnType<typeof vi.fn>;
  readonly listProjectDirectories: ReturnType<typeof vi.fn>;
}

function runner(folders: readonly string[], registered: readonly ServerProject[] = []): Runner {
  const projects: ServerProject[] = [{ id: "codevo-editor", name: "codevo-editor" }, ...registered];
  const listing: RemoteProjectDirectories = {
    path: SERVER_ROOT,
    parentPath: "/home/codex",
    entries: folders.map((name) => ({ name, path: `${SERVER_ROOT}/${name}` })),
    truncated: false,
  };
  const listProjectDirectories = vi.fn().mockResolvedValue(listing);
  const registerProject = vi.fn(async ({ name }: { name: string }) => {
    projects.push({ id: name, name, kind: "folder" });
    return { status: "registered", project: { id: name, name }, created: true };
  });
  const gateway = {
    collectInstructions: vi.fn().mockResolvedValue({ version: 1, files: [] }),
    listServers: vi.fn().mockResolvedValue([
      {
        id: "linux",
        name: "Linux server",
        host: "linux",
        username: "codex",
        port: 22,
        connected: true,
      },
    ]),
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    removeServer: vi.fn(),
    getRunner: vi.fn().mockResolvedValue({
      protocolVersion: 1,
      runnerId: "runner",
      name: "Linux server",
      capabilities: {
        taskExecution: true,
        instructionSync: true,
        eventReplay: true,
        taskContinuation: true,
        taskLaunchOptions: true,
        folderProjects: true,
      },
    }),
    listProjects: vi.fn(async () => ({ items: [...projects] })),
    listProjectDirectories,
    registerProject,
    cloneProject: vi.fn(),
    getProjectClone: vi.fn(),
    cancelProjectClone: vi.fn(),
    listTasks: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    createTask: vi.fn(),
    startTask: vi.fn(),
    getTask: vi.fn(),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
    continueTask: vi.fn(),
    cancelTask: vi.fn(),
    listEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getDiff: vi.fn().mockResolvedValue({ diff: "", truncated: false }),
    uploadAttachment: vi.fn(),
    getAttachment: vi.fn(),
    readAttachment: vi.fn(),
  } as unknown as RemoteRunnerGateway;
  return { gateway, registerProject, listProjectDirectories };
}

describe("a local project missing on the selected server", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    agentComposerDraftStore.reset();
    tauri.invoke.mockReset();
    tauri.invoke.mockImplementation(() => Promise.reject(new Error("unavailable")));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    agentComposerDraftStore.reset();
    localStorage.clear();
  });

  async function mount(gateway: RemoteRunnerGateway): Promise<AgentViewCommandBridge> {
    const commands = createAgentViewCommandBridge();
    const local = projectFixture({
      rootKey: LOCAL_ROOT,
      rootPath: LOCAL_ROOT,
      ownerId: "agent-root:playablemaker",
      label: "playablemaker",
      repositoryDiscovery: "settled",
      repositories: [
        fixtureRepository(`${LOCAL_ROOT}/pa-ai-be`, "pa-ai-be"),
        fixtureRepository(`${LOCAL_ROOT}/playable-maker`, "playable-maker"),
      ],
    });
    await act(async () =>
      root.render(
        <RemoteRunnerProvider gateway={gateway}>
          <AgentNewThreadDefaultsProvider
            settings={{
              ...defaultAgentNewThreadDefaults(),
              codex: { model: "default", effort: "high" },
            }}
          >
            <AgentModeView
              agents={{
                ...threadsSurfaceFixture({ agentCliKind: "codex" }),
                providerManagement: {
                  ...unconfiguredAgentProviderManagement(),
                  admissionAuthority: (provider) => ({
                    provider,
                    revision: 0,
                    providerGeneration: 1,
                    disposition: { kind: "ready" },
                  }),
                },
              }}
              projects={[local]}
              workspaceRoot={LOCAL_ROOT}
              overflowRootPaths={[]}
              providerEnabled={{ claudeCode: true, codex: true }}
              chrome={chromeFixture()}
              viewCommands={commands}
              onTrustProject={() => undefined}
              onReleaseProject={() => undefined}
              onOpenEnvironmentSettings={() => undefined}
            />
          </AgentNewThreadDefaultsProvider>
        </RemoteRunnerProvider>,
      ),
    );
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="Run on: This computer"]')).not.toBeNull(),
    );
    await waitForReact(() => expect(gateway.listProjects).toHaveBeenCalled());
    await act(async () => {
      await new Promise((settled) => setTimeout(settled, 0));
    });
    return commands;
  }

  function chooser(): Element | null {
    return host.querySelector('[aria-label="Choose server project"]');
  }

  function counterpartRow(): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>(".agent-remote-project-choice__counterpart-add");
  }

  function folderDialog(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[aria-label="Add existing folder on server"]');
  }

  function textarea(): HTMLTextAreaElement {
    const field = host.querySelector<HTMLTextAreaElement>(".agent-composer textarea");
    expect(field).not.toBeNull();
    return field ?? document.createElement("textarea");
  }

  function click(element: Element | null | undefined): void {
    expect(element ?? null).not.toBeNull();
    act(() => {
      element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function typePrompt(text: string): void {
    const field = textarea();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    act(() => {
      setter?.call(field, text);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function runOn(current: string, next: string): Promise<void> {
    click(host.querySelector(`[aria-label="Run on: ${current}"]`));
    click(
      [...document.querySelectorAll('[role="menuitemradio"]')].find((entry) =>
        entry.textContent?.includes(next),
      ),
    );
    await waitForReact(() =>
      expect(host.querySelector(`[aria-label="Run on: ${next}"]`)).not.toBeNull(),
    );
  }

  it("adds the matching server folder after confirmation and keeps later drafts in it", async () => {
    const server = runner(["codevo-runner", "playablemaker"]);
    const commands = await mount(server.gateway);
    act(() => commands.run("agent.newThread"));
    typePrompt(PROMPT);

    await runOn("This computer", "Linux server");

    expect(chooser()?.textContent).toContain("playablemaker isn’t added on this server yet.");
    await waitForReact(() => expect(counterpartRow()?.dataset.counterpartPath).toBe(SERVER_FOLDER));
    expect(counterpartRow()?.textContent).toContain("Add playablemaker on this server");
    expect(server.listProjectDirectories).toHaveBeenCalledWith({ serverId: "linux" });
    expect(server.registerProject).not.toHaveBeenCalled();

    click(counterpartRow());

    const dialog = folderDialog();
    expect(dialog?.textContent).toContain(SERVER_FOLDER);
    expect(dialog?.querySelector<HTMLInputElement>('input[aria-label="Project name"]')?.value).toBe(
      "playablemaker",
    );
    expect(server.registerProject).not.toHaveBeenCalled();

    click(dialog?.querySelector(".agent-remote-add-project__primary"));

    await waitForReact(() => expect(folderDialog()).toBeNull());
    expect(server.registerProject).toHaveBeenCalledWith({
      serverId: "linux",
      path: SERVER_FOLDER,
      name: "playablemaker",
    });
    await waitForReact(() => expect(chooser()).toBeNull());
    expect(host.querySelector('[aria-label="Run on: Linux server"]')).not.toBeNull();
    expect(textarea().disabled).toBe(false);

    await runOn("Linux server", "This computer");
    act(() => commands.run("agent.newThread"));
    await runOn("This computer", "Linux server");

    expect(chooser()).toBeNull();
    typePrompt(PROMPT);
    expect(agentComposerDraftStore.snapshot()).toEqual(
      expect.arrayContaining([[`new:${ADDED_KEY}`, PROMPT]]),
    );
    expect(server.registerProject).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft in the same-named server folder project and shows one project", async () => {
    const server = runner(
      ["playablemaker"],
      [{ id: "playablemaker", name: "playablemaker", kind: "folder" }],
    );
    const commands = await mount(server.gateway);
    await waitForReact(() =>
      expect(
        [...host.querySelectorAll(".agent-rail .cv-sb-project")].filter((row) =>
          row.textContent?.includes("playablemaker"),
        ),
      ).toHaveLength(1),
    );
    act(() => commands.run("agent.newThread"));

    await runOn("This computer", "Linux server");

    expect(chooser()).toBeNull();
    typePrompt(PROMPT);
    expect(agentComposerDraftStore.snapshot()).toEqual(
      expect.arrayContaining([[`new:${ADDED_KEY}`, PROMPT]]),
    );
    expect(server.listProjectDirectories).not.toHaveBeenCalled();
    expect(server.registerProject).not.toHaveBeenCalled();
  });

  it("opens the server folder browser when no folder of that name exists", async () => {
    const server = runner(["codevo-runner"]);
    const commands = await mount(server.gateway);
    act(() => commands.run("agent.newThread"));

    await runOn("This computer", "Linux server");

    await waitForReact(() =>
      expect(counterpartRow()?.textContent).toContain("Choose its folder on the server"),
    );
    expect(counterpartRow()?.dataset.counterpartPath).toBeUndefined();

    click(counterpartRow());

    await waitForReact(() =>
      expect(document.body.textContent).toContain("Existing folder on server"),
    );
    expect(folderDialog()).toBeNull();
    expect(server.registerProject).not.toHaveBeenCalled();
  });
});
