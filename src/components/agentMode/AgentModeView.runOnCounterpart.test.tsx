// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentComposerDraftStore } from "../../application/agentComposerDrafts";
import {
  saveAgentProjectGroupingMode,
  saveAgentProjectGroupingOverride,
} from "../../application/agentProjectGroupingPreference";
import {
  createAgentViewCommandBridge,
  type AgentViewCommandBridge,
} from "../../application/agentViewCommandBridge";
import { defaultAgentNewThreadDefaults } from "../../domain/agentNewThreadDefaults";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { waitForReact } from "../../test/reactTestLifecycle";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import { AgentModeView } from "./AgentModeView";
import { AgentNewThreadDefaultsProvider } from "./AgentNewThreadDefaultsProvider";
import { SURFACE_FIXTURE_ROOT } from "./agentSurfaceTestFixtures";
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

const IDENTITY_COMMAND = "remote_runner_repository_identity";
const IDENTITY = "github.com/acme/app";
const SAME_REPOSITORY = /^same-/;
const OTHER_ROOT = "/workspace/other";
const PROMPT = "Fix the login flow";
const LOCAL_DRAFT = `new:${SURFACE_FIXTURE_ROOT}`;

interface ServerProject {
  readonly id: string;
  readonly name: string;
}

function serverProject(projectId: string): string {
  return `remote:linux:runner:${projectId}`;
}

function runnerGateway(projects: ReadonlyArray<ServerProject>): RemoteRunnerGateway {
  return {
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
      },
    }),
    listProjects: vi.fn().mockResolvedValue({ items: projects }),
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
}

describe("agent workbench draft follows its repository across the Run on picker", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    agentComposerDraftStore.reset();
    tauri.invoke.mockReset();
    tauri.invoke.mockImplementation(
      (command: string, args?: { request?: { projectId?: string } }) =>
        command === IDENTITY_COMMAND
          ? Promise.resolve({
              repositoryKey: SAME_REPOSITORY.test(args?.request?.projectId ?? "") ? IDENTITY : null,
            })
          : Promise.reject(new Error("unavailable")),
    );
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

  async function mount(serverProjects: ReadonlyArray<ServerProject>) {
    const gateway = runnerGateway(serverProjects);
    const commands = createAgentViewCommandBridge();
    const other = projectFixture({
      rootKey: OTHER_ROOT,
      rootPath: OTHER_ROOT,
      ownerId: "agent-root:other",
      label: "other",
      origin: "background-tab",
      repositories: [fixtureRepository(OTHER_ROOT, "")],
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
              projects={[projectFixture({ repositoryIdentity: IDENTITY }), other]}
              workspaceRoot={SURFACE_FIXTURE_ROOT}
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
    await waitForReact(() =>
      expect(identityRequests()).toEqual(
        expect.arrayContaining(serverProjects.map((project) => project.id)),
      ),
    );
    await act(async () => {
      await new Promise((settled) => setTimeout(settled, 0));
    });
    return commands;
  }

  function identityRequests(): ReadonlyArray<string> {
    return tauri.invoke.mock.calls
      .filter(([command]) => command === IDENTITY_COMMAND)
      .map(([, args]) => (args as { request: { projectId: string } }).request.projectId);
  }

  function chooser(): Element | null {
    return host.querySelector('[aria-label="Choose server project"]');
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
    expect(setter).toBeDefined();
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

  function pickModel(model: string): void {
    click(host.querySelector("#agent-launch-model"));
    click(host.querySelector('[role="dialog"] button[data-provider="codex"]'));
    click(host.querySelector(`[role="option"][data-value="${model}"]`));
  }

  function model(): string | undefined {
    return host.querySelector<HTMLElement>("#agent-launch-model")?.dataset.value;
  }

  function submitSlashNew(): void {
    typePrompt("/new");
    act(() => textarea().focus());
    act(() => {
      textarea().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
  }

  function startDraftWithShortcut(commands: AgentViewCommandBridge): void {
    act(() => commands.run("agent.newThread"));
    expect(host.querySelector('[aria-label="Run on: This computer"]')).not.toBeNull();
    typePrompt(PROMPT);
    expect(agentComposerDraftStore.snapshot()).toEqual([[LOCAL_DRAFT, PROMPT]]);
  }

  it.each([
    ["projects are grouped by repository", "same-grouped", () => undefined],
    [
      "every project is kept separate",
      "same-separate",
      () => saveAgentProjectGroupingMode("separate"),
    ],
    [
      "the server project is kept separate",
      "same-overridden",
      () => saveAgentProjectGroupingOverride(serverProject("same-overridden"), "separate"),
    ],
  ])(
    "targets the server checkout of the repository after the new-thread shortcut when %s",
    async (_grouping, checkout, applyGrouping) => {
      applyGrouping();
      const commands = await mount([
        { id: checkout, name: "Server app" },
        { id: `unrelated-to-${checkout}`, name: "Unrelated" },
      ]);
      startDraftWithShortcut(commands);

      await runOn("This computer", "Linux server");

      expect(chooser()).toBeNull();
      expect(textarea().disabled).toBe(false);
      expect(textarea().value).toBe(PROMPT);
      expect(agentComposerDraftStore.snapshot()).toEqual([
        [`new:${serverProject(checkout)}`, PROMPT],
      ]);

      await runOn("Linux server", "This computer");

      expect(textarea().value).toBe(PROMPT);
      expect(agentComposerDraftStore.snapshot()).toEqual([[LOCAL_DRAFT, PROMPT]]);
    },
  );

  it("resets the server draft's launch choice on /new and keeps the local project's choice", async () => {
    saveAgentProjectGroupingMode("separate");
    const commands = await mount([{ id: "same-restarted", name: "Server app" }]);
    act(() => commands.run("agent.newThread"));
    pickModel("gpt-6-astra");
    await runOn("This computer", "Linux server");
    expect(chooser()).toBeNull();
    pickModel("gpt-6-luna");
    expect(model()).toBe("gpt-6-luna");

    submitSlashNew();

    await waitForReact(() => expect(model()).toBe("gpt-6.1-sol"));
    expect(host.querySelector('[aria-label="Reasoning effort"]')?.textContent).toBe("High");
    expect(host.querySelector('[aria-label="Run on: Linux server"]')).not.toBeNull();
    expect(chooser()).toBeNull();

    await runOn("Linux server", "This computer");

    await waitForReact(() => expect(model()).toBe("gpt-6-astra"));
  });

  it("keeps the chooser when the server has no checkout of the repository, even under the same name", async () => {
    saveAgentProjectGroupingMode("separate");
    const commands = await mount([{ id: "unrelated-namesake", name: "app" }]);
    startDraftWithShortcut(commands);

    await runOn("This computer", "Linux server");

    expect(chooser()).not.toBeNull();
    expect(
      [...(chooser()?.querySelectorAll("option") ?? [])].map((option) => option.textContent),
    ).toEqual(["Choose a project…", "app"]);
    expect(agentComposerDraftStore.snapshot()).toEqual([[LOCAL_DRAFT, PROMPT]]);

    await runOn("Linux server", "This computer");

    expect(textarea().value).toBe(PROMPT);
    expect(agentComposerDraftStore.snapshot()).toEqual([[LOCAL_DRAFT, PROMPT]]);
  });

  it("keeps the chooser when the server holds several checkouts of the repository", async () => {
    saveAgentProjectGroupingMode("separate");
    const commands = await mount([
      { id: "same-one", name: "Checkout one" },
      { id: "same-two", name: "Checkout two" },
    ]);
    startDraftWithShortcut(commands);

    await runOn("This computer", "Linux server");

    expect(chooser()).not.toBeNull();
    expect(agentComposerDraftStore.snapshot()).toEqual([[LOCAL_DRAFT, PROMPT]]);
  });
});
