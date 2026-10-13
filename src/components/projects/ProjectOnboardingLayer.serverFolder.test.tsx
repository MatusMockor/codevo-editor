// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { remoteAgentProjectKey } from "../../application/remoteAgentProjection";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import { waitForReact } from "../../test/reactTestLifecycle";
import { MAX_PENDING_PROJECT_CLONES } from "../agentMode/agentProjectCreationSession";
import { useAgentProjectCreation } from "../agentMode/useAgentProjectCreation";
import {
  RemoteRunnerContext,
  type RemoteRunnerContextValue,
} from "../remoteRunner/remoteRunnerContext";
import { ProjectOnboardingLayer } from "./ProjectOnboardingLayer";

const SERVER = {
  id: "srv",
  name: "build-box",
  host: "10.0.0.2",
  username: "dev",
  port: 22,
  connected: true,
};
const SELECTION = Object.freeze({});
const PALETTE = '[role="dialog"][aria-label="Add project"]';
const BROWSER = 'section[aria-label="Choose folder on server"]';
const BILLING_KEY = remoteAgentProjectKey("srv", "runner", "billing");
const billing = {
  rootKey: BILLING_KEY,
  rootPath: BILLING_KEY,
  label: "billing",
  ownerId: "owner",
  generation: 1,
  trust: "trusted",
  origin: "active-tab",
} as AgentProjectDescriptor;

const FOLDERS: Readonly<Record<string, readonly string[]>> = {
  "/srv": ["repos"],
  "/srv/repos": ["billing"],
  "/srv/repos/billing": [],
};

describe("ProjectOnboardingLayer existing server folder", () => {
  let host: HTMLDivElement;
  let root: Root;
  let workspaceRoot = "/work";
  const onProjectAdded = vi.fn<(project: AgentProjectDescriptor) => void>();
  let publishProjects: (rows: readonly AgentProjectDescriptor[]) => void = () => undefined;
  const refreshProjects = vi.fn<() => Promise<void>>(async () => {
    await Promise.resolve();
    publishProjects([billing]);
  });
  const registerProject = vi.fn(async () => ({
    status: "registered" as const,
    project: { id: "billing", name: "billing" },
    created: true,
  }));
  const listProjectDirectories = vi.fn(
    async ({ path = "/srv" }: Readonly<{ serverId: string; path?: string }>) => ({
      path,
      parentPath: path === "/srv" ? null : path.slice(0, path.lastIndexOf("/")),
      entries: (FOLDERS[path] ?? []).map((name) => ({ name, path: `${path}/${name}` })),
      truncated: false,
    }),
  );
  const cloneProject = vi.fn(async () => ({
    id: `clone-${cloneProject.mock.calls.length}`,
    status: "running" as const,
    project: null,
    error: null,
  }));
  const getProjectClone = vi.fn(async ({ cloneId }: Readonly<{ cloneId: string }>) => ({
    id: cloneId,
    status: "running" as const,
    project: null,
    error: null,
  }));
  let creation!: ReturnType<typeof useAgentProjectCreation>;
  const gateway = {
    cloneProject,
    getProjectClone,
    getRunner: async () => ({
      protocolVersion: 1,
      runnerId: "runner",
      name: "Runner",
      capabilities: { taskExecution: true, eventReplay: true, projectCloning: true },
    }),
    listProjectDirectories,
    registerProject,
  } as unknown as RemoteRunnerGateway;

  function Harness() {
    const [projects, setProjects] = useState<readonly AgentProjectDescriptor[]>([]);
    publishProjects = setProjects;
    creation = useAgentProjectCreation({
      chrome: null,
      projects,
      workspaceRoot,
      selectionIdentity: SELECTION,
      selectedServerId: "srv",
      onProjectAdded,
      reportNotice: () => undefined,
      refreshProjects,
    });
    return (
      <>
        <button onClick={creation.open} type="button">
          Add project
        </button>
        <ProjectOnboardingLayer
          chrome={null}
          creation={creation}
          lookupGateway={null}
          selectedServerId="srv"
          servers={[SERVER]}
        />
      </>
    );
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    workspaceRoot = "/work";
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function render(): Promise<void> {
    await act(async () =>
      root.render(
        <RemoteRunnerContext.Provider value={{ gateway } as unknown as RemoteRunnerContextValue}>
          <Harness />
        </RemoteRunnerContext.Provider>,
      ),
    );
  }

  function option(text: string): HTMLElement {
    const found = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((row) =>
      row.textContent?.includes(text),
    );
    expect(found, `option ${text}`).toBeInstanceOf(HTMLElement);
    return found as HTMLElement;
  }

  function button(selector: string): HTMLElement {
    const found = host.querySelector<HTMLElement>(selector);
    expect(found, selector).toBeInstanceOf(HTMLElement);
    return found as HTMLElement;
  }

  async function click(target: HTMLElement): Promise<void> {
    await act(async () => target.click());
  }

  async function openFolderBrowser(): Promise<void> {
    await render();
    await click(button("button"));
    expect(document.querySelector(PALETTE)).not.toBeNull();
    await click(option("Existing folder on server"));
    await waitForReact(() =>
      expect(host.querySelector(".agent-add-project__path-value")?.textContent).toBe("/srv"),
    );
  }

  async function fillCloneCapacity(): Promise<void> {
    for (let index = 0; index < MAX_PENDING_PROJECT_CLONES; index += 1) {
      await act(async () => creation.choose("srv", "clone"));
      await waitForReact(() =>
        expect(creation.remoteAdd.availability.gitUrl).toEqual({ status: "ready" }),
      );
      await act(async () => creation.remoteAdd.chooseSource("gitUrl"));
      await act(async () =>
        creation.remoteAdd.submitEntry(`git@github.com:acme/service-${index}.git`),
      );
      await act(async () => creation.remoteAdd.confirmClone());
      await waitForReact(() => expect(creation.pendingClones).toHaveLength(index + 1));
    }
  }

  async function submitBilling(): Promise<void> {
    await click(option("repos"));
    await waitForReact(() => expect(option("billing")).toBeInstanceOf(HTMLElement));
    await click(option("billing"));
    await waitForReact(() =>
      expect(host.querySelector(".agent-add-project__path-value")?.textContent).toBe(
        "/srv/repos/billing",
      ),
    );
    await click(button(".agent-add-project__add"));
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Project name"]')?.value).toBe(
      "billing",
    );
    await click(button(".agent-remote-add-project__primary"));
  }

  async function registerBilling(): Promise<void> {
    await submitBilling();
    await waitForReact(() => expect(onProjectAdded).toHaveBeenCalledExactlyOnceWith(billing));
  }

  it("opens the folder step straight from the palette", async () => {
    await openFolderBrowser();
    expect(document.querySelector(PALETTE)).toBeNull();
    expect(host.querySelector(BROWSER)?.textContent).toContain("Existing folder on server");
    expect(host.querySelector('[aria-label="Choose repository"]')).toBeNull();
    expect(creation.remoteAdd.open).toBe(false);
    expect(listProjectDirectories).toHaveBeenCalledExactlyOnceWith({ serverId: "srv" });
  });

  it("returns to the palette with Back", async () => {
    await openFolderBrowser();
    await click(button('button[aria-label="Go back"]'));
    await waitForReact(() => expect(document.querySelector(PALETTE)).not.toBeNull());
    expect(host.querySelector(BROWSER)).toBeNull();
    expect(creation.remoteFolder.open).toBe(false);
    expect(option("Existing folder on server")).toBeInstanceOf(HTMLElement);
  });

  it("registers the chosen folder and selects the new server project", async () => {
    await openFolderBrowser();
    await registerBilling();
    expect(registerProject).toHaveBeenCalledExactlyOnceWith({
      serverId: "srv",
      path: "/srv/repos/billing",
      name: "billing",
    });
    expect(refreshProjects).toHaveBeenCalledTimes(1);
    expect(cloneProject).not.toHaveBeenCalled();
    expect(creation.pendingClones).toHaveLength(0);
    expect(host.querySelector(".agent-remote-add-project")).toBeNull();
    expect(document.querySelector(PALETTE)).toBeNull();
  });

  it("selects the project when it appears although the refresh never resolves", async () => {
    refreshProjects.mockImplementationOnce(() => new Promise<void>(() => undefined));
    await openFolderBrowser();
    await submitBilling();
    await waitForReact(() => expect(refreshProjects).toHaveBeenCalledTimes(1));
    expect(onProjectAdded).not.toHaveBeenCalled();
    expect(
      host.querySelector<HTMLButtonElement>(".agent-remote-add-project__primary")?.textContent,
    ).toBe("Adding project…");

    await act(async () => publishProjects([billing]));
    await waitForReact(() => expect(onProjectAdded).toHaveBeenCalledExactlyOnceWith(billing));
    expect(host.querySelector(".agent-remote-add-project")).toBeNull();
  });

  it("still selects the project after a rejected refresh once it is listed", async () => {
    refreshProjects.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    await openFolderBrowser();
    await submitBilling();
    await waitForReact(() => expect(refreshProjects).toHaveBeenCalledTimes(1));
    expect(onProjectAdded).not.toHaveBeenCalled();
    await act(async () => publishProjects([billing]));
    await waitForReact(() => expect(onProjectAdded).toHaveBeenCalledExactlyOnceWith(billing));
  });

  it("closes the folder step when the workspace is replaced", async () => {
    await openFolderBrowser();
    workspaceRoot = "/other";
    await render();
    expect(host.querySelector(BROWSER)).toBeNull();
    expect(creation.remoteFolder.open).toBe(false);
    workspaceRoot = "/work";
    await render();
    expect(host.querySelector(BROWSER)).toBeNull();
    expect(creation.remoteFolder.open).toBe(false);
  });

  it("adds a folder at full clone capacity while clone actions stay refused", async () => {
    await render();
    await fillCloneCapacity();
    expect(cloneProject).toHaveBeenCalledTimes(MAX_PENDING_PROJECT_CLONES);

    await click(button("button"));
    const notice = `You can keep up to ${MAX_PENDING_PROJECT_CLONES} clones open. Finish or remove one before starting another.`;
    expect(document.querySelector(PALETTE)?.textContent).toContain(notice);
    await click(option("Clone repository"));
    expect(creation.capacityError).toBe(notice);
    expect(document.querySelector(PALETTE)?.textContent).toContain(notice);
    expect(cloneProject).toHaveBeenCalledTimes(MAX_PENDING_PROJECT_CLONES);
    expect(host.querySelector(BROWSER)).toBeNull();

    await click(option("Existing folder on server"));
    await waitForReact(() =>
      expect(host.querySelector(".agent-add-project__path-value")?.textContent).toBe("/srv"),
    );
    expect(document.querySelector(PALETTE)).toBeNull();
    await registerBilling();
    expect(registerProject).toHaveBeenCalledTimes(1);
    expect(creation.pendingClones).toHaveLength(MAX_PENDING_PROJECT_CLONES);
    expect(cloneProject).toHaveBeenCalledTimes(MAX_PENDING_PROJECT_CLONES);
  });
});
