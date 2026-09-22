// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteRunnerCloneJob, RemoteRunnerGateway } from "../../domain/remoteRunner";
import type {
  RepositoryHostsSnapshot,
  RepositoryLookupOutcome,
} from "../../domain/repositoryLookup";
import type { RepositoryLookupGateway } from "../../application/repositoryLookupPorts";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { waitForReact } from "../../test/reactTestLifecycle";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import { AgentModeView } from "./AgentModeView";
import { SURFACE_FIXTURE_ROOT } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";

const CLONE_URL = "git@github.com:acme/storefront-api.git";

const runningClone: RemoteRunnerCloneJob = {
  id: "clone-1",
  status: "running",
  project: null,
  error: null,
};

const succeededClone: RemoteRunnerCloneJob = {
  ...runningClone,
  status: "succeeded",
  project: { id: "cloned", name: "storefront-api" },
};

const hostsSnapshot: RepositoryHostsSnapshot = {
  github: {
    status: "ready",
    hosts: [{ provider: "github", host: "github.com", auth: "authenticated" }],
    truncated: false,
  },
  gitlab: { status: "ready", hosts: [], truncated: false },
};

function lookupGatewayFixture(): RepositoryLookupGateway {
  return {
    listHosts: vi.fn(async () => hostsSnapshot),
    lookup: vi.fn(async (): Promise<RepositoryLookupOutcome> => ({ status: "notFound" })),
  };
}

function gatewayFixture() {
  const projects = [{ id: "project", name: "Server app" }];
  let cloneFinished = false;
  const cloneProject = vi.fn(async () => runningClone);
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
      capabilities: { taskExecution: true, eventReplay: true, projectCloning: true },
    }),
    listProjects: vi.fn(async () => ({ items: [...projects] })),
    cloneProject,
    getProjectClone: vi.fn(async () => (cloneFinished ? succeededClone : runningClone)),
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
  } satisfies RemoteRunnerGateway & { cloneProject: typeof cloneProject };
  const finishClone = () => {
    cloneFinished = true;
    projects.push({ id: "cloned", name: "storefront-api" });
  };
  return { gateway, finishClone };
}

describe("agent workbench remote clone adoption", () => {
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the project picked in the draft chooser when a background clone finishes", async () => {
    const { gateway, finishClone } = gatewayFixture();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () =>
      root.render(
        <RemoteRunnerProvider gateway={gateway} repositoryLookup={lookupGatewayFixture()}>
          <AgentModeView
            agents={{
              ...threadsSurfaceFixture(),
              providerManagement: unconfiguredAgentProviderManagement(),
            }}
            projects={[projectFixture()]}
            workspaceRoot={SURFACE_FIXTURE_ROOT}
            overflowRootPaths={[]}
            providerEnabled={{ claudeCode: true, codex: true }}
            chrome={chromeFixture()}
            onTrustProject={() => undefined}
            onReleaseProject={() => undefined}
            onOpenEnvironmentSettings={() => undefined}
          />
        </RemoteRunnerProvider>,
      ),
    );

    click(host.querySelector('[aria-label="Run on: This computer"]')!);
    await waitForReact(() =>
      expect(host.querySelector('[role="menuitemradio"]')?.textContent).toContain("This computer"),
    );
    click(
      [...host.querySelectorAll('[role="menuitemradio"]')].find((entry) =>
        entry.textContent?.includes("Linux server"),
      )!,
    );
    await waitForReact(() =>
      expect(host.querySelector('section[aria-label="Choose server project"]')).not.toBeNull(),
    );

    click(host.querySelector(".agent-remote-project-choice__add")!);
    await waitForReact(() =>
      expect(host.querySelector(".agent-remote-add-project")).not.toBeNull(),
    );
    const cloneSource = [...host.querySelectorAll<HTMLElement>("button")].find(
      (row) => row.textContent === "Clone repository",
    );
    expect(cloneSource).toBeDefined();
    click(cloneSource!);
    await waitForReact(() => expect(host.querySelector('[role="option"]')).not.toBeNull());
    const gitUrl = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find((row) =>
      row.textContent?.includes("Git URL"),
    );
    expect(gitUrl).toBeDefined();
    click(gitUrl!);
    await waitForReact(() => expect(dialogInput().placeholder).toBe("Enter Git clone URL"));
    typeInto(dialogInput(), CLONE_URL);
    press(dialogInput(), "Enter");
    await waitForReact(() =>
      expect(host.querySelector(".agent-remote-add-project__primary")?.textContent).toBe(
        "Clone on server",
      ),
    );
    click(host.querySelector(".agent-remote-add-project__primary")!);
    await waitForReact(() => expect(gateway.cloneProject).toHaveBeenCalledTimes(1));
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="Repository clone"]')).not.toBeNull(),
    );

    const draft = host.querySelector<HTMLTextAreaElement>(".agent-clone-composer textarea");
    expect(draft).not.toBeNull();
    typeInto(draft!, "Draft kept while I visit the other project");
    click(host.querySelector('button[aria-label="Close clone draft"]')!);
    const chooser = host.querySelector<HTMLSelectElement>(
      'section[aria-label="Choose server project"] select',
    );
    expect(chooser).not.toBeNull();
    act(() => {
      chooser!.value = "remote:linux:runner:project";
      chooser!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitForReact(() =>
      expect(host.querySelector('section[aria-label="Choose server project"]')).toBeNull(),
    );

    finishClone();
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    await waitForReact(() => expect(gateway.listProjects.mock.calls.length).toBeGreaterThan(1));
    await waitForReact(() =>
      expect(host.querySelector('[aria-label="Repository clone"]')?.textContent).toContain(
        "Clone finished",
      ),
    );

    expect(host.querySelector('section[aria-label="Choose server project"]')).toBeNull();
    expect(host.querySelector("button#agent-rail-scope")?.textContent).toContain("Server app");
    expect(host.querySelector("button#agent-rail-scope")?.textContent).not.toContain(
      "storefront-api",
    );
    const cloneRow = host.querySelector('[aria-label="Repository clone"]');
    expect(cloneRow?.textContent).toContain("storefront-api");
    expect(
      [...(cloneRow?.querySelectorAll("button") ?? [])].map((button) => button.textContent),
    ).toEqual(["storefront-api", "Dismiss"]);
    click(cloneRow!.querySelector("button")!);
    expect(host.querySelector<HTMLTextAreaElement>(".agent-clone-composer textarea")?.value).toBe(
      "Draft kept while I visit the other project",
    );
  });

  function dialogInput(): HTMLInputElement {
    const element = host.querySelector<HTMLInputElement>(
      ".agent-remote-add-project .palette-search input",
    );
    expect(element, "Missing dialog input").not.toBeNull();
    return element as HTMLInputElement;
  }
});

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(target: Element, key: string) {
  act(() => target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key })));
}
